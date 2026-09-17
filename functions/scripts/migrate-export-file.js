#!/usr/bin/env node
/**
 * migrate-export-file.js
 *
 * Applies the security-rules backfill to a **Realtime Database JSON export**,
 * offline. Export the database, run this, review, re-import. Same transform as
 * scripts/migrate-security-backfill.js (see lib/security-backfill.js) — that one
 * writes to a live database; this one only reads and writes files, so it can
 * neither reach nor damage anything.
 *
 * What it changes is described in migrate-security-backfill.js. In short:
 *   1. milestoneData/{id} gains `modelId`, recovered from the model that lists it.
 *   2. invitations move to the deterministic key {projectId}_{encoded email},
 *      keeping one record per project + address.
 * It also drops the ephemeral `sessions/` subtree by default (live collaboration
 * state: presence, cursors and the shared Yjs document). That data is recreated
 * as people open models, and stale session state is actively harmful — a shared
 * document that outlives its editors is applied over the stored model when the
 * model is next opened. Pass --keep-sessions to leave it in place.
 *
 * ⚠ Importing replaces the node you import into — it is a set, not a merge. So
 * anything written between the export and the import is lost. Export, migrate and
 * import back-to-back, with nobody editing.
 *
 * Usage:
 *   node scripts/migrate-export-file.js <export.json> [migrated.json] [--dry-run] [--keep-sessions]
 *
 *   <export.json>      The file from the Firebase console (Database → ⋮ → Export JSON).
 *   [migrated.json]    Output path. Defaults to <export>.migrated.json.
 *   --dry-run          Report what would change; write nothing.
 *   --keep-sessions    Keep the ephemeral sessions/ subtree.
 *
 * The input file is never modified.
 */

const fs = require("node:fs");
const path = require("node:path");
const { planBackfill, applyUpdates, describe } = require("./lib/security-backfill");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const KEEP_SESSIONS = args.includes("--keep-sessions");
const files = args.filter((a) => !a.startsWith("--"));

const inputPath = files[0];
if (!inputPath) {
  console.error("Usage: node scripts/migrate-export-file.js <export.json> [migrated.json] [--dry-run] [--keep-sessions]");
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`No such file: ${inputPath}`);
  process.exit(1);
}

const outputPath = files[1] || inputPath.replace(/(\.json)?$/i, ".migrated.json");

const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;

function main() {
  const raw = fs.readFileSync(inputPath, "utf8");

  console.log("\nSecurity-rules backfill (export file)");
  console.log(`  Input:  ${path.resolve(inputPath)} (${mb(Buffer.byteLength(raw))})`);
  console.log(`  Output: ${DRY_RUN ? "(dry run — nothing written)" : path.resolve(outputPath)}`);
  console.log(`  Mode:   ${DRY_RUN ? "DRY RUN" : "WRITE"}${KEEP_SESSIONS ? ", keeping sessions/" : ""}\n`);

  let root;
  try {
    root = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not parse ${inputPath} as JSON: ${err.message}`);
    process.exit(1);
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    console.error("Expected the export to be a JSON object at the database root.");
    process.exit(1);
  }

  // A root export should carry the app's top-level nodes. Warn rather than fail:
  // a partial export is still migratable, it just may have nothing to do.
  const known = ["users", "projects", "bpmnModels", "modelXmlData", "milestoneData", "invitations"];
  const present = known.filter((key) => root[key]);
  if (present.length === 0) {
    console.log("None of the app's top-level nodes are present — is this an export of the database root?");
  } else {
    console.log(`Top-level nodes found: ${present.join(", ")}\n`);
  }

  const { updates, stats } = planBackfill(root);
  describe(stats).forEach((line) => console.log(line));

  if (!KEEP_SESSIONS && root.sessions) {
    const count = Object.keys(root.sessions).length;
    updates["sessions"] = null;
    console.log(`sessions: dropping ephemeral collaboration state for ${count} model(s).`);
  }

  const paths = Object.keys(updates);
  if (paths.length === 0) {
    console.log("\nNothing to do — the export is already migrated.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — the following paths would change:");
    paths.forEach((p) => console.log(`  ${updates[p] === null ? "DELETE" : "WRITE "} ${p}`));
    console.log("\nNo file was written.");
    return;
  }

  applyUpdates(root, updates);
  const out = JSON.stringify(root, null, 2);
  fs.writeFileSync(outputPath, out);

  console.log(`\nChanged ${paths.length} path(s).`);
  console.log(`Wrote ${path.resolve(outputPath)} (${mb(Buffer.byteLength(out))}).`);
  console.log(`The input file is unchanged — keep it as your rollback.`);
}

try {
  main();
} catch (err) {
  console.error("\nMigration failed:", err);
  process.exit(1);
}
