import * as Y from 'yjs';
import type { CollaborationSession, SharedState } from './CollaborationSession';
import { BpmnYjsBinding, type BindingModeler } from './BpmnYjsBinding';
import type { ActivityState, IdleDetector } from './IdleDetector';
import { persistCollaborativeXml } from '../services/models.service';

// Live updates are merged and flushed to the shared log at most this often. Fast
// enough to feel live, coarse enough that a drag's many micro-commands coalesce
// into one network write.
const SEND_DEBOUNCE_MS = 300;

// The leader persists the document to `modelXmlData` on this slower cadence,
// decoupled from the live send rate so persistence costs a fraction of live sync.
// (This write is not downloaded by in-session peers, so it carries no egress.)
const PERSIST_DEBOUNCE_MS = 3000;

// Compaction (republishing the full state + pruning the log) is *adaptive*, not
// time-based: the leader only compacts once the shared log has grown by about as
// much as a fresh full state would cost — so its amortised cost per edit stays
// roughly constant regardless of model size, and a joiner never replays more than
// ~2× the state. The floor stops us compacting a tiny log on every little edit.
const COMPACT_MIN_BYTES = 16 * 1024;

/** The bpmn-js services this needs: the binding's plus XML serialization. */
export interface CollabModeler extends BindingModeler {
    saveXML(options: { format?: boolean }): Promise<{ xml?: string }>;
}

/**
 * Owns the shared Yjs document for one open model and wires it to bpmn-js (via
 * {@link BpmnYjsBinding}) and to the Realtime Database (via
 * {@link CollaborationSession}).
 *
 * Lifecycle:
 *   - **Load / seed.** The shared document is *live session state*, not storage:
 *     it means something only while the people who produced it are still here.
 *     So presence decides. With a peer present, the leader-compacted state is
 *     loaded (or awaited, if none has been published yet). Alone, whatever is
 *     stored is the residue of a session that has ended: it is dropped and the
 *     document is seeded from the diagram — which is the saved model. Only after
 *     the doc is populated does the two-way binding go live, so no client ever
 *     seeds a second, competing copy of an already-shared document.
 *   - **Send.** Local edits produce Yjs updates (tagged `local`); these are
 *     merged over a short debounce and appended to the shared log.
 *   - **Receive.** Every log entry is applied to the doc (tagged `remote`); the
 *     binding reconciles the diagram to match. Our own echoed entries are
 *     no-ops.
 *   - **Persist / compact.** The leader alone writes the merged document back to
 *     `modelXmlData` on a slow debounce, and — only once the shared log has grown
 *     by ~a full state's worth — republishes the compacted state and prunes the
 *     log. Existing editors detach from the state after they are ready, so this
 *     republished state is downloaded only by new joiners, keeping per-edit egress
 *     small and independent of model size.
 *   - **Suspend / resume.** A window whose user has walked away
 *     ({@link IdleDetector}'s `away`) unsubscribes from the shared log and steps
 *     down as leader, so it neither downloads other people's edits nor keeps
 *     writing the document on their behalf. On the first sign of activity it
 *     folds in the current published state — the log may have been compacted and
 *     pruned meanwhile — and follows the log again.
 */
export class CollabDoc {
    private readonly doc = new Y.Doc();
    private readonly binding: BpmnYjsBinding;

    // Distinct transaction origins so each side can tell its own writes apart
    // from the peer's: `local` = produced by our diagram; `remote` = applied from
    // the log/state. Object identity is the whole point — never compared by value.
    private readonly LOCAL: object = {};
    private readonly REMOTE: object = {};

    private readonly unsubs: Array<() => void> = [];
    private sendTimer: ReturnType<typeof setTimeout> | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly pendingUpdates: Uint8Array[] = [];

    private stopped = false;
    private ready = false;
    private sawState = false;
    private isLeader = false;
    private peerCount = 0;
    private hasCollaborated = false;

    /** Newest log entry we have applied — the safe prune point for compaction. */
    private lastLogKey: string | null = null;
    private stateVersion = 0;
    private persistedXml: string | null = null;

    /** Detaches the shared-state listener; kept only until this client is ready. */
    private stateUnsub: (() => void) | null = null;
    /** True while we are waiting for a present peer to publish the first state. */
    private awaitingState = false;
    /** True once we have judged the stored document to be a finished session's residue. */
    private replaceResidue = false;
    /** Resolves with the first peer count presence reports — see initialise(). */
    private readonly firstPeerCount: Promise<number>;
    private reportFirstPeerCount!: (count: number) => void;
    /** Detaches the shared-log listener; null while suspended (user is away). */
    private logUnsub: (() => void) | null = null;
    /** Whether we have dropped out of the session because the user walked away. */
    private suspended = false;
    /** Compressed size of the last state we published (drives adaptive compaction). */
    private lastStateBytes = COMPACT_MIN_BYTES;
    /** Bytes appended to the shared log since the last compaction. */
    private logBytesSinceCompaction = 0;

    constructor(
        private readonly modeler: CollabModeler,
        private readonly session: CollaborationSession,
        private readonly idle: IdleDetector,
    ) {
        this.binding = new BpmnYjsBinding(modeler, this.doc, this.LOCAL);
        this.firstPeerCount = new Promise((resolve) => { this.reportFirstPeerCount = resolve; });
    }

    start(): void {
        // Send only our *own* updates; echoes we apply carry the `remote` origin.
        this.doc.on('update', this.onDocUpdate);
        // The log and the shared state are attached only once initialise() has
        // decided what the stored document *is* — see there. Subscribing to either
        // before that would let a previous session's contents into this one.
        this.unsubs.push(() => this.detachLog());
        this.unsubs.push(() => this.detachState());
        this.unsubs.push(this.session.onLeadership(this.onLeadership));
        this.unsubs.push(this.session.onPeers((peers) => {
            const previous = this.peerCount;
            this.peerCount = peers.length;
            this.reportFirstPeerCount(peers.length);
            if (peers.length > 0) this.hasCollaborated = true;
            if (previous > 0 && this.peerCount === 0) this.flushPersist();
        }));
        // Fires immediately with the current state; `active` is a no-op.
        this.unsubs.push(this.idle.onChange(this.onActivityChange));
        void this.initialise();
    }

    stop(): void {
        this.stopped = true;
        if (this.sendTimer) clearTimeout(this.sendTimer);
        this.flushSend();
        this.flushPersist(); // best-effort final save if we are the leader
        this.doc.off('update', this.onDocUpdate);
        this.binding.stop();
        for (const unsub of this.unsubs.splice(0)) {
            try { unsub(); } catch { /* already detached */ }
        }
        this.doc.destroy();
    }

    // --- load / seed ---------------------------------------------------------

    /**
     * Decide what the stored shared document is, and go live.
     *
     * Presence is what makes that decision. The shared document is *live session
     * state*, not storage: it is only meaningful while the people who produced it
     * are still here. Opening a model nobody else is in means whatever is stored
     * is the residue of a session that has ended — and adopting it would paint
     * those edits over the saved model, resurrecting changes that were never
     * saved and may have been explicitly discarded. So in that case the residue
     * is dropped and the document is seeded from the diagram the modeler has
     * already imported, which is the saved model.
     *
     * With someone else present, the stored document *is* the live session and is
     * loaded as before.
     */
    private async initialise(): Promise<void> {
        // Presence is read first, and the document only afterwards: when we are
        // alone there is no reason to download one we are about to discard, and
        // the state of a large model is the single biggest read in the session.
        const peerCount = await this.firstPeerCount;
        if (this.stopped || this.ready) return;

        if (peerCount === 0) {
            // Replacing the document is the leader's job, exactly as seeding one
            // always was. Leadership is decided by a transaction, so if two clients
            // open at the same instant only one of them clears — otherwise the
            // second could wipe an edit the first had already appended.
            this.replaceResidue = true;
            if (this.session.isLeader) void this.resetAndSeed();
            return;
        }

        const state = await this.session.readState().catch(() => null);
        if (this.stopped || this.ready) return;

        if (state) {
            this.applyState(state);
            this.becomeReady(false);
            return;
        }

        // Someone is here but has not published a state yet: follow the state node
        // until they do, or until leadership falls to us and it is ours to seed.
        this.awaitingState = true;
        this.stateUnsub = this.session.onState(this.onSharedState);
        if (this.session.isLeader) this.seedAndBecomeReady();
    }

    /** Drop a previous session's leftovers, then seed from the saved model. */
    private async resetAndSeed(): Promise<void> {
        if (!this.replaceResidue || this.ready || this.stopped) return;
        this.replaceResidue = false;
        await this.session.clearDocument().catch(() => { /* seeding still overwrites it */ });
        if (this.stopped || this.ready) return;
        this.seedAndBecomeReady();
    }

    /** Populate an empty shared doc from our current diagram, then publish it. */
    private seedAndBecomeReady(): void {
        if (this.ready || this.stopped) return;
        this.binding.pushLocalState(); // local-origin transaction → queued to the log
        this.ready = true;
        this.awaitingState = false;
        this.detachState();
        this.attachLog();
        this.binding.start();
        void this.compact(); // publish the state so joiners have a base
    }

    private becomeReady(seeded: boolean): void {
        if (this.ready || this.stopped) return;
        this.ready = true;
        this.awaitingState = false;
        this.detachState();
        this.attachLog();
        this.binding.start();
        // A loaded (not self-seeded) doc may differ from the base XML the modeler
        // opened with, so bring the diagram in line once; later changes flow
        // through the binding's observer.
        if (!seeded) this.binding.applyToDiagram();
    }

    /** Stop listening to shared-state republications (see start()). */
    private detachState(): void {
        if (this.stateUnsub) { this.stateUnsub(); this.stateUnsub = null; }
    }

    private applyState(state: SharedState): void {
        this.sawState = true;
        this.stateVersion = Math.max(this.stateVersion, state.v);
        Y.applyUpdate(this.doc, state.update, this.REMOTE);
    }

    // --- suspend / resume (user walked away) ---------------------------------

    private onActivityChange = (state: ActivityState): void => {
        if (this.stopped) return;
        const shouldSuspend = state === 'away';
        if (shouldSuspend === this.suspended) return;
        this.suspended = shouldSuspend;
        if (shouldSuspend) this.suspend();
        else void this.resume();
    };

    /** Settle what we owe the session, then stop costing it anything. */
    private suspend(): void {
        this.flushSend();
        this.flushPersist();
        this.detachLog();
        void this.session.suspendLeadership();
    }

    private async resume(): Promise<void> {
        this.session.resumeLeadership();
        // The leader may have compacted and pruned the log while we were gone,
        // so fold in the published state before following the log again. The
        // log replays from its first surviving entry on re-subscribe, so
        // anything newer than that state still reaches us.
        const state = await this.session.readState().catch(() => null);
        if (this.stopped || this.suspended) return;
        if (state && state.v > this.stateVersion) this.applyState(state);
        this.attachLog();
        // Suspended before we ever reached readiness: pick the load/seed up again.
        if (!this.ready) void this.initialise();
    }

    private attachLog(): void {
        if (this.logUnsub || this.stopped) return;
        this.logUnsub = this.session.subscribeUpdates(this.onLogUpdate);
    }

    private detachLog(): void {
        if (!this.logUnsub) return;
        try { this.logUnsub(); } catch { /* already detached */ }
        this.logUnsub = null;
    }

    // --- receive -------------------------------------------------------------

    private onLogUpdate = (bytes: Uint8Array, key: string): void => {
        this.lastLogKey = key; // ids are chronological; the last we see is the newest applied
        this.logBytesSinceCompaction += bytes.length;
        Y.applyUpdate(this.doc, bytes, this.REMOTE);
        // The leader owns persistence: it must save peers' edits to `modelXmlData`
        // even when it makes none of its own, or an idle leader would leave a
        // collaborator's work unsaved until it happened to edit. Debounced and
        // de-duped downstream, so applying our own echoed update is a cheap no-op.
        if (this.isLeader) this.schedulePersist();
    };

    private onSharedState = (state: SharedState): void => {
        this.sawState = true;
        if (state.v < this.stateVersion) return;
        this.stateVersion = state.v;
        if (!this.ready) {
            this.applyState(state);
            this.becomeReady(false);
        } else {
            // Idempotent: folds in anything we somehow missed. No-op in the common case.
            Y.applyUpdate(this.doc, state.update, this.REMOTE);
        }
    };

    private onLeadership = (isLeader: boolean): void => {
        this.isLeader = isLeader;
        // We opened a model nobody else was in and have now won the election, so
        // replacing the previous session's leftovers falls to us.
        if (isLeader && this.replaceResidue) void this.resetAndSeed();
        // We were waiting for a present peer to publish a state, became leader —
        // usually because they left — and still none exists, so it falls to us to
        // seed. Gated on `awaitingState` so this can never fire before initialise()
        // has decided what the stored document is.
        if (this.awaitingState && isLeader && !this.ready && !this.sawState) this.seedAndBecomeReady();
    };

    // --- send ----------------------------------------------------------------

    private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin !== this.LOCAL || this.stopped) return;
        // An edit is activity by definition. Routing it through the detector
        // means a suspended window re-attaches to the session before its own
        // change lands, rather than publishing into a session it has left.
        this.idle.notifyActivity();
        this.pendingUpdates.push(update);
        if (!this.sendTimer) {
            this.sendTimer = setTimeout(() => { this.sendTimer = null; this.flushSend(); }, SEND_DEBOUNCE_MS);
        }
        if (this.isLeader) this.schedulePersist();
    };

    private flushSend(): void {
        if (this.sendTimer) { clearTimeout(this.sendTimer); this.sendTimer = null; }
        if (this.pendingUpdates.length === 0) return;
        const merged = Y.mergeUpdates(this.pendingUpdates.splice(0));
        this.session.appendUpdate(merged).catch((err) => console.error('CollabDoc: append failed', err));
    }

    // --- persist / compact (leader only) -------------------------------------

    private schedulePersist(): void {
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS);
    }

    private flushPersist(): void {
        if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
        // Persistence flows through here only while (and after) collaborating; a
        // purely-solo session leaves saving to the app's normal path.
        if (!this.hasCollaborated || !this.session.isLeader || this.stopped) return;
        void this.persistXml();
        this.maybeCompact();
    }

    /** Compact only once the log has grown ~a full state's worth (adaptive). */
    private maybeCompact(): void {
        if (this.logBytesSinceCompaction < Math.max(this.lastStateBytes, COMPACT_MIN_BYTES)) return;
        void this.compact();
    }

    /** Republish the full state and prune the log up to what we have applied. */
    private async compact(): Promise<void> {
        const pruneUpTo = this.lastLogKey; // capture before awaiting: "applied so far"
        const encoded = Y.encodeStateAsUpdate(this.doc);
        this.logBytesSinceCompaction = 0;
        try {
            const bytes = await this.session.publishState(encoded, this.stateVersion + 1);
            this.stateVersion += 1;
            this.lastStateBytes = bytes;
            if (pruneUpTo) await this.session.pruneLog(pruneUpTo);
        } catch (err) {
            console.error('CollabDoc: compact failed', err);
        }
    }

    private async persistXml(): Promise<void> {
        try {
            const { xml } = await this.modeler.saveXML({ format: true });
            if (!xml || xml === this.persistedXml || this.stopped) return;
            this.persistedXml = xml;
            persistCollaborativeXml(this.session.modelId, xml);
        } catch (err) {
            console.error('CollabDoc: persist failed', err);
        }
    }
}
