#!/usr/bin/env node
/**
 * trigger-emulator.js
 *
 * Publishes a fake budget-alert Pub/Sub message to the local Firebase Emulator
 * so you can test limitOnBudgetAlert and disableOnBudgetAlert without touching
 * real Google Cloud resources.
 *
 * Prerequisites:
 *   - Firebase emulators must be running:
 *       npm run emulate          (from functions/)
 *     or
 *       firebase emulators:start --only functions,pubsub  (from project root)
 *
 * Usage:
 *   node scripts/trigger-emulator.js [topic] [costAmount] [budgetAmount]
 *
 * Topics:
 *   billing-resource-limit   → triggers limitOnBudgetAlert  (locks RTDB)
 *   billing-disable-cutoff   → triggers disableOnBudgetAlert (removes billing)
 *
 * Examples:
 *   # Trigger the RTDB lock (cost exceeds budget)
 *   node scripts/trigger-emulator.js billing-resource-limit 10 5
 *
 *   # Trigger the billing disable (cost exceeds budget)
 *   node scripts/trigger-emulator.js billing-disable-cutoff 10 5
 *
 *   # Under-budget message (functions should take no action)
 *   node scripts/trigger-emulator.js billing-resource-limit 2 5
 */

const http = require("http");
const { readFirebaseConfig } = require("./read-firebase-config");

// ── Configuration ──────────────────────────────────────────────────────────────
const PUBSUB_EMULATOR_HOST = "127.0.0.1";
const PUBSUB_EMULATOR_PORT = 8085;

// Read project ID from src/config/.firebase.js — change that file to switch environments.
const { projectId: PROJECT_ID } = readFirebaseConfig();

// ── Parse CLI arguments ─────────────────────────────────────────────────────────
const VALID_TOPICS = ["billing-resource-limit", "billing-disable-cutoff"];

const topic      = process.argv[2] || "billing-resource-limit";
const costAmount = parseFloat(process.argv[3] ?? "10");
const budgetAmt  = parseFloat(process.argv[4] ?? "5");

if (!VALID_TOPICS.includes(topic)) {
  console.error(`Unknown topic "${topic}". Valid options:\n  ${VALID_TOPICS.join("\n  ")}`);
  process.exit(1);
}

// ── Build the budget alert payload ─────────────────────────────────────────────
const payload = {
  costAmount,
  budgetAmount: budgetAmt,
  currencyCode: "USD",
  budgetDisplayName: "Emulator Test Budget",
  alertThresholdExceeded: costAmount >= budgetAmt ? 1.0 : costAmount / budgetAmt,
};

const encodedData = Buffer.from(JSON.stringify(payload)).toString("base64");

const body = JSON.stringify({
  messages: [{ data: encodedData }],
});

// ── Publish to the Pub/Sub emulator ────────────────────────────────────────────
const path = `/v1/projects/${PROJECT_ID}/topics/${topic}:publish`;

const options = {
  hostname: PUBSUB_EMULATOR_HOST,
  port:     PUBSUB_EMULATOR_PORT,
  path,
  method:  "POST",
  headers: {
    "Content-Type":   "application/json",
    "Content-Length": Buffer.byteLength(body),
  },
};

console.log(`\nPublishing to Pub/Sub emulator...`);
console.log(`  Topic:   ${topic}`);
console.log(`  Project: ${PROJECT_ID}`);
console.log(`  Payload: cost=$${costAmount}  budget=$${budgetAmt}`);
console.log(`  Endpoint: http://${PUBSUB_EMULATOR_HOST}:${PUBSUB_EMULATOR_PORT}${path}\n`);

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    if (res.statusCode === 200) {
      console.log("✓ Message published successfully.");
      console.log("  Check the emulator terminal for function logs.");
      console.log(`  Emulator UI: http://localhost:4000\n`);
    } else {
      console.error(`✗ Unexpected response: HTTP ${res.statusCode}`);
      console.error(data);
      process.exit(1);
    }
  });
});

req.on("error", (err) => {
  if (err.code === "ECONNREFUSED") {
    console.error("✗ Could not connect to the Pub/Sub emulator.");
    console.error(`  Is it running on port ${PUBSUB_EMULATOR_PORT}?`);
    console.error("  Start it with:  npm run emulate  (from functions/)");
  } else {
    console.error("✗ Request failed:", err.message);
  }
  process.exit(1);
});

req.write(body);
req.end();
