/**
 * jest.setup.js
 *
 * Jest globalSetup — runs once before all test suites.
 * Injects GCLOUD_PROJECT and DATABASE_URL from src/config/.firebase.js
 * so tests always use the same environment as the rest of the project.
 */

const { readFirebaseConfig } = require("./scripts/read-firebase-config");

module.exports = async () => {
  const { projectId, databaseURL } = readFirebaseConfig();
  process.env.GCLOUD_PROJECT = projectId;
  process.env.DATABASE_URL   = databaseURL;
};
