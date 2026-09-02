import type { CollaborationSession } from './CollaborationSession';
import { persistCollaborativeXml } from '../services/models.service';
import { makePatch, RemoteWriter } from './DocProtocol';

// The active editor publishes at most this often. Fast enough to feel live,
// coarse enough that rapid edits coalesce into one delta.
const BROADCAST_DEBOUNCE_MS = 700;

// The persistence leader writes the document back to `modelXmlData` at most this
// often — decoupled from (and slower than) the live cadence, so persistence
// costs a fraction of what live sync does.
const PERSIST_DEBOUNCE_MS = 3000;

// Snapshot cadence is adaptive rather than a fixed op count: we re-publish a
// full snapshot once the patches since the last snapshot have cost as much to
// download as a fresh snapshot would. This keeps the per-edit cost ~constant
// regardless of model size (≈ 2× the op size) and bounds a joiner's replay to
// ~2× the snapshot. A hard cap bounds replay CPU when patches are tiny relative
// to a very large model.
const MAX_OPS_PER_SNAPSHOT = 400;

interface Box { x: number; y: number; width: number; height: number }

interface SyncCanvas {
    viewbox(): Box;
    viewbox(box: Box): void;
}

interface SyncEventBus {
    on<E>(event: string, callback: (event: E) => void): void;
    off<E>(event: string, callback: (event: E) => void): void;
}

interface SyncModeler {
    get(service: 'canvas'): SyncCanvas;
    get(service: 'eventBus'): SyncEventBus;
    importXML(xml: string): Promise<unknown>;
    saveXML(options: { format?: boolean }): Promise<{ xml?: string }>;
}

/**
 * Delta-based collaboration sync bound to one bpmn-js modeler.
 *
 * Outgoing: when the local user edits, we serialize the diagram and publish a
 * small text patch against our own last-published state to our channel (with an
 * occasional full snapshot) — only while other people are present, so a solo
 * editor costs nothing extra.
 *
 * Incoming: we subscribe to each *other* writer's channel, reconstruct their
 * document from snapshot + patches (RemoteWriter), and import the result
 * (viewport preserved). Applying does not re-broadcast (guarded by `applying`),
 * so there is no echo loop; a burst of ops coalesces into a single import.
 *
 * Persistence: exactly one client — the session's elected leader — writes the
 * document back to `modelXmlData`, on a slow debounce. This removes the per-edit
 * write storm and the silent last-writer-wins overwrite: a single writer owns
 * the persisted file, and it always holds the merged live state.
 *
 * While collaborating, the app forces auto-save on and routes persistence
 * through here; when alone, the app's normal save path is untouched.
 */
export class DocSync {
    private readonly canvas: SyncCanvas;
    private readonly eventBus: SyncEventBus;

    // diagram-js "the diagram content changed" signals. We listen to both because
    // which one fires depends on the bpmn-js build: `elements.changed` fires for
    // create/move/update/delete here, while `commandStack.changed` is the one the
    // app's own autosave uses. Listening to both is safe — the broadcast debounce
    // coalesces duplicates — and robust across versions.
    private static readonly CHANGE_EVENTS = ['elements.changed', 'commandStack.changed'];

    private readonly unsubscribes: Array<() => void> = [];
    /** Per-peer document-channel subscriptions, keyed by peer uid. */
    private readonly peerDocUnsubs = new Map<string, () => void>();
    private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    private applying = false;
    private stopped = false;
    private peerCount = 0;
    /**
     * Whether this session ever had another participant. Persistence flows through
     * DocSync *only* while (and after) collaborating; a purely-solo session leaves
     * persistence to the app's normal save path, so DocSync must never write on a
     * solo unmount (which would race with — and could stale-overwrite — a manual Save).
     */
    private hasCollaborated = false;

    /** Latest known document and what we last persisted (for dedupe). */
    private currentXml: string | null = null;
    private persistedXml: string | null = null;
    /** Server timestamp of the newest remote update applied (cross-writer recency). */
    private lastAppliedT = 0;

    // Outgoing delta state (this user as a writer).
    private mySeq = 0;
    private myLastPublishedXml: string | null = null;
    private opsSinceSnapshot = 0;
    private opBytesSinceSnapshot = 0;
    /** Download cost (compressed bytes) of the last snapshot we published. */
    private lastSnapshotCost = 0;

    // Incoming state: one reconstructor per remote writer, plus a coalescing apply
    // queue so a burst of ops results in a single import of the newest state.
    private readonly remoteWriters = new Map<string, RemoteWriter>();
    private pendingApply: { xml: string; t: number } | null = null;
    private draining = false;

    constructor(
        private readonly modeler: SyncModeler,
        private readonly session: CollaborationSession,
    ) {
        this.canvas = modeler.get('canvas');
        this.eventBus = modeler.get('eventBus');
    }

    start(): void {
        // The `applying` flag suppresses the change flood these fire during a remote import.
        for (const ev of DocSync.CHANGE_EVENTS) this.eventBus.on(ev, this.onLocalChange);
        this.unsubscribes.push(this.session.onPeers((peers) => {
            const previous = this.peerCount;
            this.peerCount = peers.length;
            if (peers.length > 0) this.hasCollaborated = true;
            // Subscribe to each peer's own document channel (and only theirs) so we
            // never download our own writes back.
            this.syncPeerDocSubscriptions(peers.map((p) => p.uid));
            // When the last collaborator leaves, flush a final save of whatever the
            // collaborative session produced before handing back to normal saving.
            if (previous > 0 && this.peerCount === 0) this.flushPersist();
        }));
    }

    private syncPeerDocSubscriptions(uids: string[]): void {
        const next = new Set(uids);
        for (const uid of next) {
            if (!this.peerDocUnsubs.has(uid)) {
                const writer = new RemoteWriter();
                this.remoteWriters.set(uid, writer);
                this.peerDocUnsubs.set(uid, this.session.subscribeWriter(uid, {
                    onSnapshot: (snap) => this.enqueueApply(writer.onSnapshot(snap), writer.lastT),
                    onOp: (op) => this.enqueueApply(writer.onOp(op), writer.lastT),
                }));
            }
        }
        for (const [uid, unsub] of this.peerDocUnsubs) {
            if (!next.has(uid)) {
                unsub();
                this.peerDocUnsubs.delete(uid);
                this.remoteWriters.delete(uid);
            }
        }
    }

    stop(): void {
        this.stopped = true;
        if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
        this.flushPersist(); // best-effort final save if we are the leader
        try {
            for (const ev of DocSync.CHANGE_EVENTS) this.eventBus.off(ev, this.onLocalChange);
        } catch { /* modeler may already be destroyed */ }
        for (const unsub of this.unsubscribes.splice(0)) {
            try { unsub(); } catch { /* already detached */ }
        }
        for (const unsub of this.peerDocUnsubs.values()) {
            try { unsub(); } catch { /* already detached */ }
        }
        this.peerDocUnsubs.clear();
    }

    // --- outgoing ------------------------------------------------------------

    private onLocalChange = async (): Promise<void> => {
        if (this.applying || this.stopped) return;
        try {
            const { xml } = await this.modeler.saveXML({ format: true });
            if (!xml || xml === this.currentXml) return;
            this.currentXml = xml;
            if (this.peerCount > 0) {
                this.scheduleBroadcast(xml);
                if (this.session.isLeader) this.schedulePersist();
            }
        } catch (err) {
            console.error('DocSync: failed to serialize local change', err);
        }
    };

    private scheduleBroadcast(xml: string): void {
        if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
        this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = null;
            this.broadcastDelta(xml).catch(() => {});
        }, BROADCAST_DEBOUNCE_MS);
    }

    private async broadcastDelta(xml: string): Promise<void> {
        const prev = this.myLastPublishedXml;
        if (this.stopped || this.peerCount === 0 || xml === prev) return;

        // Publish a fresh full snapshot on first publish, once the patches since
        // the last snapshot cost as much to download as the snapshot itself, or at
        // the hard op cap (bounds a joiner's replay).
        const needSnapshot = prev === null
            || this.opsSinceSnapshot >= MAX_OPS_PER_SNAPSHOT
            || (this.lastSnapshotCost > 0 && this.opBytesSinceSnapshot >= this.lastSnapshotCost);

        if (needSnapshot) {
            this.mySeq += 1;
            const seq = this.mySeq;
            this.myLastPublishedXml = xml;
            this.opsSinceSnapshot = 0;
            this.opBytesSinceSnapshot = 0;
            this.lastSnapshotCost = await this.session.publishSnapshot(xml, seq);
            this.session.pruneOps(seq).catch(() => {}); // ops the snapshot supersedes
            return;
        }

        // Otherwise append a small patch against our last published state (`prev`
        // is non-null here — the null case published a snapshot above).
        const patch = makePatch(prev, xml);
        const base = this.mySeq;
        this.mySeq += 1;
        this.myLastPublishedXml = xml;
        this.opsSinceSnapshot += 1;
        this.opBytesSinceSnapshot += patch.length;
        await this.session.appendOp(patch, this.mySeq, base);
    }

    // --- incoming ------------------------------------------------------------

    /** Queue a reconstructed remote document for import, keeping only the newest. */
    private enqueueApply(xml: string | null, t: number): void {
        if (xml === null || this.stopped) return;
        if (!this.pendingApply || t >= this.pendingApply.t) this.pendingApply = { xml, t };
        void this.drainApply();
    }

    private async drainApply(): Promise<void> {
        if (this.draining) return;
        this.draining = true;
        this.applying = true; // suppress the change-flood our own import fires
        try {
            while (this.pendingApply) {
                const { xml, t } = this.pendingApply;
                this.pendingApply = null;
                // Recency guard: never regress to an older state than one already applied.
                if (this.stopped || t <= this.lastAppliedT || xml === this.currentXml) continue;
                const viewbox = this.canvas.viewbox();
                try {
                    await this.modeler.importXML(xml);
                    this.canvas.viewbox(viewbox); // keep the local user where they were looking
                    this.currentXml = xml;
                    this.lastAppliedT = t;
                    // The leader persists what it receives from others, too.
                    if (this.peerCount > 0 && this.session.isLeader) this.schedulePersist();
                } catch (err) {
                    console.error('DocSync: failed to apply remote document', err);
                }
            }
        } finally {
            this.applying = false;
            this.draining = false;
        }
    }

    // --- persistence (leader only) -------------------------------------------

    private schedulePersist(): void {
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS);
    }

    private flushPersist(): void {
        if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
        // Solo sessions never persist through DocSync — the app's save path owns it.
        if (!this.hasCollaborated || !this.session.isLeader) return;
        if (!this.currentXml || this.currentXml === this.persistedXml) return;
        this.persistedXml = this.currentXml;
        persistCollaborativeXml(this.session.modelId, this.currentXml);
    }
}
