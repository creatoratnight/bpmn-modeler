/**
 * deploy.js
 *
 * Deploys Cloud Functions to the project defined in src/config/.firebase.js.
 * Run via:  npm run deploy  (from functions/)
 *       or:  node scripts/deploy.js  (from functions/)
 */

const { execSync } = require("child_process");
const path = require("path");
const { readFirebaseConfig } = require("./read-firebase-config");

const { projectId } = readFirebaseConfig();
const projectRoot  = path.resolve(__dirname, "../..");

console.log(`Deploying functions to project: ${projectId}`);

execSync(
  `firebase deploy --only functions --project ${projectId}`,
  { stdio: "inherit", cwd: projectRoot }
);
