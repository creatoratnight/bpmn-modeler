import {
    getDatabase,
    ref,
    set,
    push,
    get,
    remove,
    update,
    query,
    orderByKey,
    endAt,
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
import { gzipBytesToBase64, base64ToGunzipBytes } from './compression';

/** A leader-compacted full snapshot of the shared Yjs document. */
export interface SharedState {
    /** gzip+base64 of `Y.encodeStateAsUpdate(doc)`. */
    update: Uint8Array;
    /** Monotonic version, incremented on each compaction. */
    v: number;
    /** Server timestamp of the compaction. */
    t: number;
}

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
    /** The shared, append-only Yjs update log: `sessions/{modelId}/ydoc/log`. */
    private readonly logRef: DatabaseReference;
    private readonly stateRef: DatabaseReference;

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
        this.logRef = ref(this.db, `${this.base}/ydoc/log`);
        this.stateRef = ref(this.db, `${this.base}/ydoc/state`);
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
        ]).catch(() => { /* offline: server clears via the armed handlers anyway */ });

        await Promise.all([
            remove(this.presenceSelfRef),
            remove(this.cursorSelfRef),
            remove(this.selectionSelfRef),
            remove(this.viewportSelfRef),
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

    // --- shared document (Yjs) -----------------------------------------------
    //
    // The document is one shared Yjs doc. All clients append their binary Yjs
    // updates to a single append-only log (`ydoc/log`) and subscribe to the whole
    // log, so every update reaches everyone. Yjs updates are idempotent and
    // commutative, so applying them in any order — including one's own echo, which
    // is a no-op — always converges, merging concurrent edits per-field instead of
    // overwriting the whole document.
    //
    // A joiner first loads the leader-compacted full state (`ydoc/state`) and then
    // follows the log, which the leader keeps short by pruning entries it has
    // already folded into a freshly published state (see pruneLog). Pruning is
    // keyed on the log's own push ids (chronologically ordered), never on a clock,
    // so an in-flight edit newer than the compaction is never dropped.

    /** Append one binary Yjs update to the shared log; resolves with its key. */
    appendUpdate(bytes: Uint8Array): Promise<string> {
        const child = push(this.logRef);
        return set(child, { u: gzipBytesToBase64(bytes), t: serverTimestamp() })
            .then(() => child.key as string);
    }

    /**
     * Subscribe to the shared log. `onChildAdded` replays the current
     * (post-prune) entries and then streams new ones; `key` is each entry's push
     * id, so the leader can prune everything up to the last one it has applied.
     */
    subscribeUpdates(onUpdate: (bytes: Uint8Array, key: string) => void): Unsubscribe {
        const unsub = onChildAdded(this.logRef, (child) => {
            const v = child.val() as { u?: string } | null;
            if (!v || typeof v.u !== 'string' || !child.key) return;
            onUpdate(base64ToGunzipBytes(v.u), child.key);
        });
        this.subscriptions.push(unsub);
        return unsub;
    }

    /**
     * Publish the leader-compacted full document state at version `v`. Resolves
     * with the stored (compressed) byte size, so the caller can size its adaptive
     * compaction cadence against the real download cost a joiner pays.
     */
    publishState(bytes: Uint8Array, v: number): Promise<number> {
        const u = gzipBytesToBase64(bytes);
        return set(this.stateRef, { u, v, t: serverTimestamp() }).then(() => u.length);
    }

    /** Read the current compacted state, or null if none has been published. */
    async readState(): Promise<SharedState | null> {
        const snapshot = await get(this.stateRef);
        const val = snapshot.val() as { u?: string; v?: number; t?: number } | null;
        if (!val || typeof val.u !== 'string') return null;
        return { update: base64ToGunzipBytes(val.u), v: val.v ?? 0, t: val.t ?? 0 };
    }

    /** Subscribe to compacted-state publications (fires with the latest each time). */
    onState(callback: (state: SharedState) => void): Unsubscribe {
        const unsub = onValue(this.stateRef, (snapshot) => {
            const val = snapshot.val() as { u?: string; v?: number; t?: number } | null;
            if (!val || typeof val.u !== 'string') return;
            callback({ update: base64ToGunzipBytes(val.u), v: val.v ?? 0, t: val.t ?? 0 });
        });
        this.subscriptions.push(unsub);
        return unsub;
    }

    /**
     * Prune shared-log entries up to and including `upToKey` — the last entry the
     * leader had applied when it encoded the state it just published. Those
     * entries are all captured in that state, so no joiner needs them; anything
     * newer (a larger push id) is left in place. Leader-only.
     */
    async pruneLog(upToKey: string): Promise<void> {
        const stale = await get(query(this.logRef, orderByKey(), endAt(upToKey)));
        if (!stale.exists()) return;
        const updates: Record<string, null> = {};
        stale.forEach((child) => { updates[child.key as string] = null; });
        await update(this.logRef, updates);
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
