import type { PeerIdentity } from './types';

// Fixed saturation/lightness for peer colors. Tuned to stay vivid and legible
// over the light BPMN canvas and, at 45% lightness, dark enough for the white
// cursor label text to read against.
const COLOR_SATURATION = 70;
const COLOR_LIGHTNESS = 45;

/**
 * Maps a Firebase uid to a stable color. A deterministic string hash (djb2-ish)
 * of the uid picks a hue anywhere on the 0–359° wheel, so the same user always
 * gets the same color within and across sessions ("the teal cursor is Sam") and
 * the odds of two distinct users sharing a hue are ~1/360.
 */
export function colorForUid(uid: string): string {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    return `hsl(${hue}, ${COLOR_SATURATION}%, ${COLOR_LIGHTNESS}%)`;
}

/** The minimal shape we need from a Firebase auth user (or our RTDB user node). */
export interface UserLike {
    uid: string;
    displayName?: string | null;
    email?: string | null;
    /** Firebase Auth avatar. */
    photoURL?: string | null;
    /** Avatar as stored under `users/{uid}` in the RTDB. */
    imageUrl?: string | null;
}

/**
 * Builds the identity we publish into a collaboration session from a signed-in
 * user. Name falls back through displayName → email → "Anonymous"; avatar
 * accepts either the Auth `photoURL` or our stored `imageUrl`.
 */
export function toPeerIdentity(user: UserLike): PeerIdentity {
    return {
        uid: user.uid,
        name: user.displayName || user.email || 'Anonymous',
        color: colorForUid(user.uid),
        avatarUrl: user.photoURL || user.imageUrl || undefined,
    };
}
