import {
    getDatabase,
    ref,
    set,
    push,
    get,
    remove,
    update,
    query,
    orderByChild,
    endBefore,
    onValue,
    onChildAdded,
    onChildChanged,
    onChildRemoved,
    onDisconnect,
    runTransaction,
    serverTimestamp,
    type DatabaseReference,
    type Unsubscribe,
} from 'firebase/database';
import type {
    PeerIdentity,
    Peer,
    CursorPayload,
    SelectionPayload,
    ViewportPayload,
} from './types';
import type { WriterSnapshot, WriterOp } from './DocProtocol';
import { compressToBase64, decompressFromBase64 } from './compression';

/**
 * Owns one user's participation in the ephemeral collaboration session for a
 * single model. It is the *only* module that touches `sessions/{modelId}` — the
 * React layer (a `useCollaboration` hook, Phase 1) drives it and never reads or
 * writes the RTDB directly.
 *
 * Design notes that keep Firebase costs down (Firebase bills per MB downloaded):
 *   - Presence is small and changes rarely, so it is read with a single
 *     `onValue` and materialised into a peer list.
 *   - Cursors are high-frequency, so they use per-child listeners
 *     (`onChildAdded/Changed/Removed`) — a cursor move never re-downloads the
 *     whole cursor node, only the one child that changed.
 *   - We never surface our *own* echoed writes: every subscription filters out
 *     `this.identity.uid`.
 *   - Departure is handled by `onDisconnect().remove()` so a crashed tab does
 *     not leave a ghost cursor behind; `leave()` also cancels those handlers.
 *
 * Throttling of cursor writes and idle-stop live in the calling hook (Phase 1),
 * not here — this class stays a thin, testable I/O boundary.
 */
export class CollaborationSession {
    /** The model this session belongs to (used by the persistence leader). */
    readonly modelId: string;

    private readonly db = getDatabase();
    private readonly base: string;

    private readonly presenceSelfRef: DatabaseReference;
    private readonly cursorSelfRef: DatabaseReference;
    private readonly selectionSelfRef: DatabaseReference;
    private readonly viewportSelfRef: DatabaseReference;
    private readonly leaderRef: DatabaseReference;
    /** This user's own document channel: `sessions/{modelId}/docs/{uid}`. */
    private readonly docSelfRef: DatabaseReference;

    private readonly subscriptions: Unsubscribe[] = [];
    private joined = false;

    private isLeaderNow = false;
    private readonly leadershipListeners = new Set<(isLeader: boolean) => void>();

    constructor(
        modelId: string,
        private readonly identity: PeerIdentity,
    ) {
        this.modelId = modelId;
        this.base = `sessions/${modelId}`;
        this.presenceSelfRef = ref(this.db, `${this.base}/presence/${identity.uid}`);
        this.cursorSelfRef = ref(this.db, `${this.base}/cursors/${identity.uid}`);
        this.selectionSelfRef = ref(this.db, `${this.base}/selections/${identity.uid}`);
        this.viewportSelfRef = ref(this.db, `${this.base}/viewports/${identity.uid}`);
        this.leaderRef = ref(this.db, `${this.base}/leader`);
        this.docSelfRef = ref(this.db, `${this.base}/docs/${identity.uid}`);
    }

    /** This user's uid — used to filter out our own echoed document writes. */
    get uid(): string {
        return this.identity.uid;
    }

    /** Whether this client is currently the persistence leader. */
    get isLeader(): boolean {
        return this.isLeaderNow;
    }

    // --- lifecycle -----------------------------------------------------------

    /** Publish presence and arm the on-disconnect cleanup for every self node. */
    async join(): Promise<void> {
        if (this.joined) return;
        this.joined = true;

        // Arm cleanup *before* writing, so a disconnect between the write and the
        // handler registration still gets cleaned up.
        await Promise.all([
            onDisconnect(this.presenceSelfRef).remove(),
            onDisconnect(this.cursorSelfRef).remove(),
            onDisconnect(this.selectionSelfRef).remove(),
            onDisconnect(this.viewportSelfRef).remove(),
            onDisconnect(this.docSelfRef).remove(),
        ]);

        await set(this.presenceSelfRef, {
            name: this.identity.name,
            color: this.identity.color,
            ...(this.identity.avatarUrl ? { avatarUrl: this.identity.avatarUrl } : {}),
            joinedAt: serverTimestamp(),
            lastActive: serverTimestamp(),
        });

        this.startLeadership();
    }

    /** Detach listeners, cancel on-disconnect handlers, and remove all self nodes. */
    async leave(): Promise<void> {
        for (const unsub of this.subscriptions.splice(0)) {
            try { unsub(); } catch { /* already detached */ }
        }
        if (!this.joined) return;
        this.joined = false;

        // Release leadership so a remaining peer takes over. Cancel the armed
        // on-disconnect first, then clear the node if we still hold it.
        await onDisconnect(this.leaderRef).cancel().catch(() => {});
        if (this.isLeaderNow) {
            this.isLeaderNow = false;
            await remove(this.leaderRef).catch(() => {});
        }
        this.leadershipListeners.clear();

        await Promise.all([
            onDisconnect(this.presenceSelfRef).cancel(),
            onDisconnect(this.cursorSelfRef).cancel(),
            onDisconnect(this.selectionSelfRef).cancel(),
            onDisconnect(this.viewportSelfRef).cancel(),
            onDisconnect(this.docSelfRef).cancel(),
        ]).catch(() => { /* offline: server clears via the armed handlers anyway */ });

        await Promise.all([
            remove(this.presenceSelfRef),
            remove(this.cursorSelfRef),
            remove(this.selectionSelfRef),
            remove(this.viewportSelfRef),
            remove(this.docSelfRef),
        ]).catch(() => { /* offline: handled by onDisconnect */ });
    }

    // --- leadership ----------------------------------------------------------
    //
    // Exactly one client per session is the "persistence leader": the only one
    // that writes the shared document back to `modelXmlData`. Election is a
    // transaction on the `leader` node — the first client to find it empty wins.
    // The winner arms `onDisconnect().remove()`, so if it crashes the node
    // clears and the remaining clients re-elect automatically.

    private startLeadership(): void {
        const unsub = onValue(this.leaderRef, (snapshot) => {
            const value = snapshot.val() as { uid: string } | null;
            if (!value) {
                // No leader — try to claim it. A successful claim re-triggers this
                // listener with our uid.
                this.tryClaimLeadership();
                return;
            }
            const wasLeader = this.isLeaderNow;
            this.isLeaderNow = value.uid === this.identity.uid;
            if (this.isLeaderNow && !wasLeader) {
                // Free leadership if this tab dies, so others can re-elect.
                onDisconnect(this.leaderRef).remove();
            }
            if (this.isLeaderNow !== wasLeader) this.emitLeadership();
        });
        this.subscriptions.push(unsub);
    }

    private tryClaimLeadership(): void {
        runTransaction(this.leaderRef, (current) => {
            if (current === null) return { uid: this.identity.uid, ts: Date.now() };
            return undefined; // someone else holds it — abort
        }).catch(() => { /* contention is expected; the winner's write wins */ });
    }

    private emitLeadership(): void {
        for (const listener of this.leadershipListeners) listener(this.isLeaderNow);
    }

    /** Subscribe to leadership changes; fires immediately with the current value. */
    onLeadership(callback: (isLeader: boolean) => void): Unsubscribe {
        this.leadershipListeners.add(callback);
        callback(this.isLeaderNow);
        return () => this.leadershipListeners.delete(callback);
    }

    // --- shared document (delta protocol) ------------------------------------
    //
    // Each user publishes to their *own* channel (`docs/{uid}`) and subscribes
    // only to *other* users' channels, so a client never downloads its own
    // writes (no self-echo). Within a channel:
    //   - `snapshot` holds an occasional full document, gzip+base64 compressed —
    //     the base a joiner/reconnect starts from.
    //   - `ops` is an append-only log of tiny text patches against the previous
    //     state, read with `onChildAdded` so no intermediate patch is ever lost.
    // Only a few hundred bytes cross the wire per edit instead of the whole model.

    /**
     * Publish a full-document snapshot (compressed) at sequence `seq`. Resolves
     * with the compressed byte size, so the caller can size its snapshot cadence
     * against the real download cost.
     */
    publishSnapshot(xml: string, seq: number): Promise<number> {
        const c = compressToBase64(xml);
        return set(ref(this.db, `${this.base}/docs/${this.identity.uid}/snapshot`), {
            c,
            seq,
            t: serverTimestamp(),
        }).then(() => c.length);
    }

    /** Append a patch op transforming state `base` into state `seq`. */
    appendOp(patch: string, seq: number, base: number): Promise<void> {
        const opsRef = ref(this.db, `${this.base}/docs/${this.identity.uid}/ops`);
        return set(push(opsRef), { p: patch, seq, base, t: serverTimestamp() });
    }

    /** Remove ops older than `beforeSeq` (superseded by a fresh snapshot). */
    async pruneOps(beforeSeq: number): Promise<void> {
        const opsRef = ref(this.db, `${this.base}/docs/${this.identity.uid}/ops`);
        const stale = await get(query(opsRef, orderByChild('seq'), endBefore(beforeSeq)));
        if (!stale.exists()) return;
        const updates: Record<string, null> = {};
        stale.forEach((child) => { updates[child.key as string] = null; });
        await update(opsRef, updates);
    }

    /**
     * Subscribe to a single peer's document channel: their snapshot (decompressed)
     * and every op appended to their log. We only ever listen to *other* uids, so
     * our own writes are never echoed back.
     */
    subscribeWriter(
        peerUid: string,
        handlers: { onSnapshot: (snap: WriterSnapshot) => void; onOp: (op: WriterOp) => void },
    ): Unsubscribe {
        const snapshotRef = ref(this.db, `${this.base}/docs/${peerUid}/snapshot`);
        const opsRef = ref(this.db, `${this.base}/docs/${peerUid}/ops`);

        const unsubSnapshot = onValue(snapshotRef, (snapshot) => {
            const v = snapshot.val() as { c?: string; seq?: number; t?: number } | null;
            if (!v || typeof v.c !== 'string' || typeof v.seq !== 'number') return;
            handlers.onSnapshot({ xml: decompressFromBase64(v.c), seq: v.seq, t: v.t ?? 0 });
        });
        const unsubOps = onChildAdded(opsRef, (child) => {
            const v = child.val() as { p?: string; seq?: number; base?: number; t?: number } | null;
            if (!v || typeof v.p !== 'string' || typeof v.seq !== 'number' || typeof v.base !== 'number') return;
            handlers.onOp({ patch: v.p, seq: v.seq, base: v.base, t: v.t ?? 0 });
        });

        const unsub: Unsubscribe = () => { unsubSnapshot(); unsubOps(); };
        this.subscriptions.push(unsub);
        return unsub;
    }

    // --- outgoing (this user) ------------------------------------------------

    /** Publish this user's cursor, in **diagram coordinates**. */
    setCursor(x: number, y: number): Promise<void> {
        return set(this.cursorSelfRef, { x, y, t: Date.now() } satisfies CursorPayload);
    }

    /** Remove this user's cursor (e.g. pointer left the canvas). */
    clearCursor(): Promise<void> {
        return remove(this.cursorSelfRef);
    }

    /** Publish this user's current selection of element ids. */
    setSelection(ids: string[]): Promise<void> {
        return set(this.selectionSelfRef, { ids, t: Date.now() } satisfies SelectionPayload);
    }

    /** Publish this user's viewbox (for follow mode, Phase 3). */
    setViewport(v: Omit<ViewportPayload, 't'>): Promise<void> {
        return set(this.viewportSelfRef, { ...v, t: Date.now() } satisfies ViewportPayload);
    }

    /** Bump `lastActive` without rewriting the whole presence node. */
    touch(): Promise<void> {
        return update(this.presenceSelfRef, { lastActive: serverTimestamp() });
    }

    // --- incoming (other users) ----------------------------------------------

    /**
     * Subscribe to the peer list (everyone present except this user). Presence is
     * small and low-churn, so a single `onValue` is appropriate here.
     */
    onPeers(callback: (peers: Peer[]) => void): Unsubscribe {
        const presenceRef = ref(this.db, `${this.base}/presence`);
        const unsub = onValue(presenceRef, (snapshot) => {
            const value = (snapshot.val() ?? {}) as Record<string, Omit<Peer, 'uid'>>;
            const peers: Peer[] = Object.entries(value)
                .filter(([uid]) => uid !== this.identity.uid)
                .map(([uid, data]) => ({ uid, ...data }));
            callback(peers);
        });
        this.subscriptions.push(unsub);
        return unsub;
    }

    /**
     * Subscribe to peer cursors via per-child listeners. `onChange` fires for
     * added/changed cursors; `onRemove` fires when a peer's cursor disappears.
     * Our own uid is filtered out of every callback.
     */
    onCursors(
        onChange: (uid: string, cursor: CursorPayload) => void,
        onRemove: (uid: string) => void,
    ): Unsubscribe {
        const cursorsRef = ref(this.db, `${this.base}/cursors`);
        const handleUpsert = (snapshot: { key: string | null; val: () => unknown }) => {
            const uid = snapshot.key;
            if (!uid || uid === this.identity.uid) return;
            onChange(uid, snapshot.val() as CursorPayload);
        };
        const unsubs = [
            onChildAdded(cursorsRef, handleUpsert),
            onChildChanged(cursorsRef, handleUpsert),
            onChildRemoved(cursorsRef, (snapshot) => {
                const uid = snapshot.key;
                if (!uid || uid === this.identity.uid) return;
                onRemove(uid);
            }),
        ];
        const unsub: Unsubscribe = () => unsubs.forEach((u) => u());
        this.subscriptions.push(unsub);
        return unsub;
    }

    /**
     * Subscribe to peer selections. `onChange` fires for added/changed
     * selections; `onRemove` fires when a peer clears or leaves.
     */
    onSelections(
        onChange: (uid: string, selection: SelectionPayload) => void,
        onRemove: (uid: string) => void,
    ): Unsubscribe {
        const selectionsRef = ref(this.db, `${this.base}/selections`);
        const handleUpsert = (snapshot: { key: string | null; val: () => unknown }) => {
            const uid = snapshot.key;
            if (!uid || uid === this.identity.uid) return;
            onChange(uid, snapshot.val() as SelectionPayload);
        };
        const unsubs = [
            onChildAdded(selectionsRef, handleUpsert),
            onChildChanged(selectionsRef, handleUpsert),
            onChildRemoved(selectionsRef, (snapshot) => {
                const uid = snapshot.key;
                if (!uid || uid === this.identity.uid) return;
                onRemove(uid);
            }),
        ];
        const unsub: Unsubscribe = () => unsubs.forEach((u) => u());
        this.subscriptions.push(unsub);
        return unsub;
    }
}
