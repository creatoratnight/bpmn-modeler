/**
 * The security-rules backfill, as a pure transform over a plain database tree.
 *
 * Shared by the two entry points so they can never drift:
 *   - scripts/migrate-security-backfill.js  — applies it to a live database
 *   - scripts/migrate-export-file.js        — applies it to an exported JSON file
 *
 * `planBackfill` only decides what should change; nothing here touches Firebase.
 */

// Mirrors src/services/invites.service.tsx and the `.replace()` chains in
// database.rules.json — including the order, which is what keeps `%` from being
// escaped twice. Change one, change all three.
const KEY_ESCAPES = [
  ["%", "%25"],
  [".", ","],
  ["#", "%23"],
  ["$", "%24"],
  ["[", "%5B"],
  ["]", "%5D"],
  ["/", "%2F"],
];

function encodeEmailKey(email) {
  let key = String(email).toLowerCase();
  for (const [char, escaped] of KEY_ESCAPES) key = key.split(char).join(escaped);
  return key;
}

const invitationKey = (projectId, email) => `${projectId}_${encodeEmailKey(email)}`;

const entries = (node) => (node && typeof node === "object" ? Object.entries(node) : []);

// ── 1. milestoneData.modelId ────────────────────────────────────────────────────

function backfillMilestoneModelIds(root, updates, stats) {
  const milestoneData = root.milestoneData;
  if (!milestoneData) return;

  // milestoneId -> modelId, from the metadata that lives under each model.
  const owner = new Map();
  for (const [modelId, model] of entries(root.bpmnModels)) {
    for (const [milestoneId] of entries(model && model.milestones)) {
      owner.set(milestoneId, modelId);
    }
  }

  for (const [milestoneId, snapshot] of entries(milestoneData)) {
    if (snapshot && snapshot.modelId) {
      stats.milestonesAlready += 1;
      continue;
    }
    const modelId = owner.get(milestoneId);
    if (!modelId) {
      // Belongs to no model: it was already unreachable through the app, and
      // there is nothing to resolve access through. Left exactly as it is.
      stats.milestoneOrphans.push(milestoneId);
      continue;
    }
    updates[`milestoneData/${milestoneId}/modelId`] = modelId;
    stats.milestonesBackfilled += 1;
  }
}

// ── 2. invitation keys ──────────────────────────────────────────────────────────

function rekeyInvitations(root, updates, stats) {
  if (!root.invitations) return;

  // Group by target key so duplicates for one project + address are resolved
  // rather than silently overwriting each other.
  const groups = new Map();
  for (const [id, invitation] of entries(root.invitations)) {
    if (!invitation || !invitation.projectId || !invitation.invitedEmail) {
      stats.invitationsSkipped.push(id);
      continue;
    }
    const key = invitationKey(invitation.projectId, invitation.invitedEmail);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id, invitation });
  }

  for (const [key, group] of groups) {
    // Pending beats resolved; otherwise the most recently sent wins.
    group.sort((a, b) => {
      const pending = Number(b.invitation.status === "Pending") - Number(a.invitation.status === "Pending");
      if (pending !== 0) return pending;
      return String(b.invitation.sentAt ?? "").localeCompare(String(a.invitation.sentAt ?? ""));
    });
    const [winner, ...rest] = group;

    for (const loser of rest) {
      updates[`invitations/${loser.id}`] = null;
      stats.invitationDuplicates += 1;
    }

    if (winner.id === key) {
      stats.invitationsInPlace += 1;
      continue;
    }
    updates[`invitations/${key}`] = {
      ...winner.invitation,
      invitedEmail: String(winner.invitation.invitedEmail).toLowerCase(),
    };
    updates[`invitations/${winner.id}`] = null;
    stats.invitationsMoved += 1;
  }
}

// ── Plan / apply ────────────────────────────────────────────────────────────────

/**
 * Decide what the backfill should change, given the whole database tree.
 * Returns flat `path -> value` updates (a `null` value means delete), which is
 * both what a multi-path `update()` takes and what `applyUpdates` understands.
 */
function planBackfill(root) {
  const updates = {};
  const stats = {
    milestonesBackfilled: 0,
    milestonesAlready: 0,
    milestoneOrphans: [],
    invitationsMoved: 0,
    invitationsInPlace: 0,
    invitationDuplicates: 0,
    invitationsSkipped: [],
  };
  backfillMilestoneModelIds(root || {}, updates, stats);
  rekeyInvitations(root || {}, updates, stats);
  return { updates, stats };
}

/** Apply a flat update plan to a tree in memory, pruning nodes it empties. */
function applyUpdates(root, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const segments = path.split("/").filter(Boolean);
    const leaf = segments.pop();

    let node = root;
    let ok = true;
    for (const segment of segments) {
      if (node[segment] == null || typeof node[segment] !== "object") {
        if (value === null) { ok = false; break; } // nothing to delete
        node[segment] = {};
      }
      node = node[segment];
    }
    if (!ok) continue;

    if (value === null) delete node[leaf];
    else node[leaf] = value;
  }
  prune(root);
  return root;
}

/** Drop empty objects: the database does not store them, so neither should a file. */
function prune(node) {
  for (const [key, child] of entries(node)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      prune(child);
      if (Object.keys(child).length === 0) delete node[key];
    }
  }
}

/** One-line-per-item summary of a plan, for the console. */
function describe(stats) {
  const lines = [
    `milestoneData: ${stats.milestonesBackfilled} to backfill, ${stats.milestonesAlready} already carry modelId.`,
    `invitations: ${stats.invitationsMoved} to re-key, ${stats.invitationsInPlace} already keyed correctly, ` +
    `${stats.invitationDuplicates} duplicate(s) to drop.`,
  ];
  if (stats.milestoneOrphans.length) {
    lines.push(
      `milestoneData: ${stats.milestoneOrphans.length} snapshot(s) belong to no model and are left untouched ` +
      `(they were already unreachable through the app): ${preview(stats.milestoneOrphans)}`
    );
  }
  if (stats.invitationsSkipped.length) {
    lines.push(
      `invitations: ${stats.invitationsSkipped.length} record(s) have no projectId/invitedEmail and are left ` +
      `untouched: ${preview(stats.invitationsSkipped)}`
    );
  }
  return lines;
}

const preview = (ids) => `${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}`;

module.exports = { planBackfill, applyUpdates, describe, encodeEmailKey, invitationKey };
