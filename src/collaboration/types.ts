// Shared types for the real-time collaboration layer.
//
// All of this data lives in the ephemeral `sessions/{modelId}` subtree in the
// Realtime Database (see database.rules.json) — never mixed into the persisted
// model data. It is removed automatically on disconnect.

/** A collaborator's stable identity within a session. */
export interface PeerIdentity {
    uid: string;
    /** Display name shown next to the cursor. */
    name: string;
    /** Deterministic per-user color (hex), derived from the uid. */
    color: string;
    /** Optional avatar URL for the presence bar. */
    avatarUrl?: string;
}

/** A peer as stored under `sessions/{modelId}/presence/{uid}`. */
export interface Peer extends PeerIdentity {
    joinedAt?: number;
    lastActive?: number;
}

/**
 * A cursor position, in **diagram coordinates** (not screen pixels), so every
 * client can re-project it through its own viewbox regardless of pan/zoom.
 * Stored under `sessions/{modelId}/cursors/{uid}`.
 */
export interface CursorPayload {
    x: number;
    y: number;
    /** Client timestamp (ms), used to order and interpolate updates. */
    t: number;
}

/** The set of element ids a peer currently has selected. */
export interface SelectionPayload {
    ids: string[];
    t: number;
}

/** A peer's visible viewbox, used for "follow" mode (Phase 3). */
export interface ViewportPayload {
    x: number;
    y: number;
    w: number;
    h: number;
    t: number;
}
