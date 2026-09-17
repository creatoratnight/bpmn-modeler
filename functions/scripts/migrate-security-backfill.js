#!/usr/bin/env node
/**
 * migrate-security-backfill.js
 *
 * One-off data migration for the tightened Realtime Database security rules,
 * applied to a **live database**. To migrate an exported JSON file instead (edit
 * offline, re-import), use scripts/migrate-export-file.js — both share the same
 * transform in lib/security-backfill.js.
 *
 * Existing data predates two things the rules now resolve access through, and
 * without this backfill that data becomes unreachable — the rules cannot
 * authorise what they cannot resolve.
 *
 * 1. milestoneData/{milestoneId} gains `modelId`.
 *
 *    A milestone snapshot used to be keyed by its own id alone, with no way back
 *    to its model, so it could only ever be "readable by any signed-in user".
 *    The owning model is recovered from bpmnModels/{modelId}/milestones.
 *
 * 2. invitations move from push ids to {projectId}_{encoded email}.
 *
 *    Accepting an invitation means adding yourself to a project's members, and
 *    the rules have to find the invitation that authorises it. Rules cannot
 *    search, so the invitation has to sit at a key derived from the project and
 *    the caller's verified email. Where several invitations exist for the same
 *    project and address, a Pending one wins, otherwise the most recent; the
 *    others are dropped as duplicates.
 *
 * Both steps are idempotent: re-running finds nothing left to do.
 *
 * Target environment:
 *   - Emulator: set FIREBASE_DATABASE_EMULATOR_HOST (e.g. 127.0.0.1:9000). The
 *     admin SDK then talks to the local emulator; no credentials are needed.
 *   - Production: provide Application Default Credentials, e.g.
 *       export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Run this BEFORE deploying the rules: it only adds and re-keys data, so it is
 * safe against the old rules, and it leaves the database ready for the new ones.
 *
 * Usage:
 *   node scripts/migrate-security-backfill.js [--dry-run]
 *
 * Examples:
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 node scripts/migrate-security-backfill.js --dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-security-backfill.js
 */

const admin = require("firebase-admin");
const { readFirebaseConfig } = require("./read-firebase-config");
const { planBackfill, describe } = require("./lib/security-backfill");

const DRY_RUN = process.argv.includes("--dry-run");

const { projectId, databaseURL } = readFirebaseConfig();
admin.initializeApp({ projectId, databaseURL });
const db = admin.database();

const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);

async function main() {
  console.log("\nSecurity-rules backfill");
  console.log(`  Project:      ${projectId}`);
  console.log(`  Database URL: ${databaseURL}`);
  console.log(`  Target:       ${usingEmulator ? `emulator (${process.env.FIREBASE_DATABASE_EMULATOR_HOST})` : "production"}`);
  console.log(`  Mode:         ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  // Only the subtrees the transform reads — the model XML is by far the biggest
  // part of the database and is not involved.
  const [bpmnModels, milestoneData, invitations] = await Promise.all([
    db.ref("bpmnModels").get().then((s) => s.val()),
    db.ref("milestoneData").get().then((s) => s.val()),
    db.ref("invitations").get().then((s) => s.val()),
  ]);

  const { updates, stats } = planBackfill({ bpmnModels, milestoneData, invitations });
  describe(stats).forEach((line) => console.log(line));

  const paths = Object.keys(updates);
  if (paths.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — the following paths would be written:");
    paths.forEach((path) => console.log(`  ${updates[path] === null ? "DELETE" : "WRITE "} ${path}`));
    console.log("\nNo changes were made.");
    return;
  }

  await db.ref().update(updates);
  console.log(`\nWrote ${paths.length} path(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nMigration failed:", err);
    process.exit(1);
  });
