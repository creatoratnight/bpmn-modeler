#!/usr/bin/env node
/**
 * migrate-milestones.js
 *
 * One-off data migration that moves milestones from the old layout, where every
 * milestone (including its heavy XML snapshot) was grouped under the model id:
 *
 *     milestones/{modelId}/{milestoneId} = { name, description, xmlData, createdBy, createdAt }
 *
 * to the new split layout, where lightweight metadata lives under the model and
 * the XML snapshot is stored on its own so the list can be shown without loading
 * the snapshots:
 *
 *     bpmnModels/{modelId}/milestones/{milestoneId} = { name, description, createdBy, createdAt }
 *     milestoneData/{milestoneId}/xmlData           = <xml>
 *
 * The milestone ids are preserved, so the migration is idempotent: re-running it
 * simply rewrites the same data. Once the legacy `milestones/` node is removed,
 * a re-run finds nothing to do.
 *
 * Target environment:
 *   - Emulator: set FIREBASE_DATABASE_EMULATOR_HOST (e.g. 127.0.0.1:9000). The
 *     admin SDK then talks to the local emulator; no credentials are needed.
 *   - Production: provide Application Default Credentials, e.g.
 *       export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * projectId / databaseURL are read from src/config/.firebase.js (same source the
 * other scripts use).
 *
 * Usage:
 *   node scripts/migrate-milestones.js [--dry-run] [--keep-legacy]
 *
 *   --dry-run       Report what would change without writing anything.
 *   --keep-legacy   Leave the old `milestones/` node in place after migrating
 *                   (default is to delete it once the new data is written).
 *
 * Examples:
 *   # Preview against the running emulator
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 node scripts/migrate-milestones.js --dry-run
 *
 *   # Migrate production (keeping the legacy node until you've verified)
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-milestones.js --keep-legacy
 */

const admin = require("firebase-admin");
const { readFirebaseConfig } = require("./read-firebase-config");

// ── Parse CLI flags ─────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_LEGACY = process.argv.includes("--keep-legacy");

// ── Initialise the admin SDK ─────────────────────────────────────────────────────
const { projectId, databaseURL } = readFirebaseConfig();

admin.initializeApp({ projectId, databaseURL });
const db = admin.database();

const usingEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);

async function main() {
  console.log("\nMilestone migration");
  console.log(`  Project:      ${projectId}`);
  console.log(`  Database URL: ${databaseURL}`);
  console.log(`  Target:       ${usingEmulator ? `emulator (${process.env.FIREBASE_DATABASE_EMULATOR_HOST})` : "production"}`);
  console.log(`  Mode:         ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`  Legacy node:  ${KEEP_LEGACY ? "kept" : "deleted after migration"}\n`);

  const legacySnapshot = await db.ref("milestones").get();

  if (!legacySnapshot.exists()) {
    console.log("Nothing to migrate — no `milestones/` node found.");
    return;
  }

  const legacy = legacySnapshot.val();
  const updates = {};
  let modelCount = 0;
  let milestoneCount = 0;

  for (const modelId of Object.keys(legacy)) {
    const modelMilestones = legacy[modelId];
    if (!modelMilestones || typeof modelMilestones !== "object") continue;

    modelCount += 1;

    for (const milestoneId of Object.keys(modelMilestones)) {
      const { name, description, xmlData, createdBy, createdAt } = modelMilestones[milestoneId] || {};

      // Metadata under the model (no XML).
      updates[`bpmnModels/${modelId}/milestones/${milestoneId}`] = {
        name: name ?? null,
        description: description ?? null,
        createdBy: createdBy ?? null,
        createdAt: createdAt ?? null,
      };
      // XML snapshot on its own, keyed by the same milestone id.
      updates[`milestoneData/${milestoneId}/xmlData`] = xmlData ?? null;

      milestoneCount += 1;
    }

    // Remove the legacy node for this model once its milestones are copied.
    if (!KEEP_LEGACY) {
      updates[`milestones/${modelId}`] = null;
    }
  }

  console.log(`Found ${milestoneCount} milestone(s) across ${modelCount} model(s).`);

  if (milestoneCount === 0) {
    console.log("Nothing to write.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — the following paths would be written:");
    Object.keys(updates).forEach((path) => {
      console.log(`  ${updates[path] === null ? "DELETE" : "WRITE "} ${path}`);
    });
    console.log("\nNo changes were made.");
    return;
  }

  await db.ref().update(updates);
  console.log("\n✓ Migration complete.");
  console.log(`  Wrote metadata + XML for ${milestoneCount} milestone(s).`);
  if (!KEEP_LEGACY) {
    console.log("  Removed the legacy `milestones/` entries.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Migration failed:", err);
    process.exit(1);
  });
