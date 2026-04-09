/**
 * read-firebase-config.js
 *
 * Reads projectId and databaseURL out of src/config/.firebase.js so that
 * functions, tests, and the emulator all share the same values.
 *
 * Change src/config/.firebase.js to switch Firebase environments —
 * everything else picks up the new values automatically.
 */

const fs   = require("fs");
const path = require("path");

function readFirebaseConfig() {
  const configPath = path.resolve(__dirname, "../../src/config/.firebase.js");
  const content    = fs.readFileSync(configPath, "utf8");

  const projectIdMatch  = content.match(/projectId:\s*["']([^"']+)["']/);
  const databaseUrlMatch = content.match(/databaseURL:\s*["']([^"']+)["']/);

  if (!projectIdMatch)   throw new Error("Could not find projectId in src/config/.firebase.js");
  if (!databaseUrlMatch) throw new Error("Could not find databaseURL in src/config/.firebase.js");

  return {
    projectId:   projectIdMatch[1],
    databaseURL: databaseUrlMatch[1],
  };
}

module.exports = { readFirebaseConfig };
