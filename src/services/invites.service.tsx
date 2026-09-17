// Invitation keys.
//
// Invitations are keyed deterministically by project + invited email rather than
// by a random push id:
//
//     invitations/{projectId}_{encoded email}
//
// Both reasons are about the security rules:
//
//   - Accepting an invitation means adding yourself to `projects/{id}/members`,
//     and the rules have to verify that a pending invitation actually exists.
//     Rules cannot search, so the invitation has to live at a key the rule can
//     *derive* from what it already knows: the project id and `auth.token.email`.
//   - A deterministic key makes inviting idempotent — re-inviting the same
//     address to the same project rewrites one node instead of piling up
//     duplicates. That removes the need for any client to read *other people's*
//     invitations to check for one, which the rules no longer allow.
//
// The encoding escapes every character the Realtime Database forbids in a key.
// `%` is escaped first so the mapping stays injective: without it `a%23b@x` and
// `a#b@x` would collide, and a collision here would hand one address the
// invitation belonging to another.
//
// This list mirrors the `.replace()` chain in `database.rules.json` exactly,
// including its order — change one and you must change the other.
const KEY_ESCAPES: ReadonlyArray<readonly [string, string]> = [
    ['%', '%25'],
    ['.', ','],
    ['#', '%23'],
    ['$', '%24'],
    ['[', '%5B'],
    [']', '%5D'],
    ['/', '%2F'],
];

/** An email address as a Realtime Database key (lower-cased and escaped). */
export const encodeEmailKey = (email: string): string => {
    let key = String(email).toLowerCase();
    for (const [char, escaped] of KEY_ESCAPES) key = key.split(char).join(escaped);
    return key;
};

/** The database key of the invitation for `email` to `projectId`. */
export const invitationKey = (projectId: string, email: string): string =>
    `${projectId}_${encodeEmailKey(email)}`;
