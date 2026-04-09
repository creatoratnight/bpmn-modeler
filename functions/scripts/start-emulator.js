/**
 * start-emulator.js
 *
 * Starts the Firebase emulator with the project ID read from
 * src/config/.firebase.js, so the emulator topics always match
 * what the trigger script publishes to.
 */

const { execSync } = require("child_process");
const path = require("path");
const { readFirebaseConfig } = require("./read-firebase-config");

const { projectId } = readFirebaseConfig();
const projectRoot   = path.resolve(__dirname, "../..");

console.log(`Starting emulator for project: ${projectId}`);

execSync(
  `firebase emulators:start --only functions,pubsub --project ${projectId}`,
  { stdio: "inherit", cwd: projectRoot }
);
