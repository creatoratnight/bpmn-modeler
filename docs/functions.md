# Data Dictionary — Cloud Functions

## Context

The `functions/` package contains two Firebase Cloud Functions v2 that protect the project from runaway GCP spend. Both are triggered by Google Cloud Budget Alert Pub/Sub messages and act as escalating guards: the first locks the Firebase Realtime Database (blocking all reads and writes); the second, if a harder threshold is crossed, removes the GCP billing account entirely and stops all billable resources.

---

## 1. `limitOnBudgetAlert`

Pub/Sub-triggered function that overwrites Firebase RTDB security rules with a deny-all policy when a budget threshold is reached.

**Source:** `functions/src/billingGuard.ts`

| Attribute | Value |
|-----------|-------|
| Export name | `limitOnBudgetAlert` |
| Trigger | `onMessagePublished` (Firebase Functions v2) |
| Pub/Sub topic | `billing-resource-limit` |
| Runtime env var | `DATABASE_URL` — base URL of the Firebase Realtime Database |

**Incoming Pub/Sub message payload** (base64-encoded JSON in `event.data.message.data`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `costAmount` | `number` | Yes | USD amount spent in the billing period. |
| `budgetAmount` | `number` | No | Budget threshold in USD. Defaults to `0` if absent. |

**Action (when `costAmount >= budgetAmount`):**

1. Authenticates via `GoogleAuth` with scope `https://www.googleapis.com/auth/firebase`.
2. Issues a `PUT` request to `${DATABASE_URL}/.settings/rules.json` with body `{ ".read": false, ".write": false }`.
3. All Firebase RTDB reads and writes are blocked immediately.

**Validation / edge cases:**
- If `budgetAmount` is missing from the payload, it defaults to `0`. Any positive `costAmount` therefore triggers the lock.
- `0 >= 0` evaluates to `true`, so a `{ costAmount: 0, budgetAmount: 0 }` (or a payload with both values absent/zero) also triggers the lock. This edge case is documented in the test suite.
- If `costAmount < budgetAmount`, no action is taken and the function returns silently.

---

## 2. `disableOnBudgetAlert`

Pub/Sub-triggered function that removes the project's GCP billing account, stopping all billable GCP resources.

**Source:** `functions/src/disableBilling.ts`

| Attribute | Value |
|-----------|-------|
| Export name | `disableOnBudgetAlert` |
| Trigger | `onMessagePublished` (Firebase Functions v2) |
| Pub/Sub topic | `billing-disable-cutoff` |
| Runtime env var | `GCLOUD_PROJECT` — the GCP project ID |

**Incoming Pub/Sub message payload** (same structure as `limitOnBudgetAlert`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `costAmount` | `number` | No | USD amount spent. Defaults to `0` if absent. |
| `budgetAmount` | `number` | No | Budget threshold in USD. Defaults to `0` if absent. |

**Action (when `costAmount >= budgetAmount`):**

1. Calls `billing.getProjectBillingInfo({ name: "projects/${PROJECT_ID}" })`.
2. If `billingEnabled` is already `false`, exits without further action (idempotent).
3. Otherwise calls `billing.updateProjectBillingInfo` with `billingAccountName: ""` (empty string removes the billing account from the project).
4. All billable GCP resources are stopped.

**Validation / edge cases:**
- When `costAmount < budgetAmount`, the function exits before calling any billing API.
- The idempotency check (`billingEnabled === false`) prevents redundant API calls on repeated alert messages.

---

## 3. Configuration & environment

Both functions rely on two environment variables that are resolved from `src/config/.firebase.js` at build / deploy / test time by `functions/scripts/read-firebase-config.js`.

| Variable | Source | Used by |
|----------|--------|---------|
| `DATABASE_URL` | `databaseURL` field in `src/config/.firebase.js` | `limitOnBudgetAlert` (RTDB rules PUT endpoint) |
| `GCLOUD_PROJECT` | `projectId` field in `src/config/.firebase.js` | `disableOnBudgetAlert` (billing API resource name) |

`src/config/.firebase.js` is the single source of truth for Firebase environment values across the frontend, the functions, and the test runner.

---

## 4. Build, deploy & emulate

| npm script | What it does |
|------------|-------------|
| `npm run build` | Compiles TypeScript → `lib/` via `tsc` |
| `npm run deploy` | Reads `projectId` from config, runs `firebase deploy --only functions --project {projectId}` |
| `npm run emulate` | Runs `sync-config` then builds and starts the local Firebase Emulator |
| `npm run test` | Runs `sync-config` (to inject env vars) then Jest |
| `npm run migrate-milestones` | Runs the milestone data migration (see section 5) |
| `npm run migrate-security-backfill` | Runs the security-rules backfill (see section 6) |

**Source:** `functions/scripts/deploy.js`, `functions/scripts/sync-config.js`, `functions/scripts/start-emulator.js`

---

## 5. Milestone data migration

A one-off data migration that moves milestones from the legacy layout (everything, including the XML snapshot, grouped under the model at `milestones/{modelId}/{milestoneId}`) to the split layout used by the app:

| Path | Contents |
|------|----------|
| `bpmnModels/{modelId}/milestones/{milestoneId}` | Metadata: `name`, `description`, `createdBy`, `createdAt` |
| `milestoneData/{milestoneId}` | `modelId` + the XML snapshot, keyed by the same milestone ID |

**Source:** `functions/scripts/migrate-milestones.js`

- Uses `firebase-admin`; `projectId` / `databaseURL` are read from `src/config/.firebase.js` via `read-firebase-config.js`.
- **Target:** set `FIREBASE_DATABASE_EMULATOR_HOST` to run against the emulator; otherwise provide Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`) to run against production.
- **Idempotent:** milestone IDs are preserved, so re-running rewrites the same data; once the legacy `milestones/` node is gone a re-run is a no-op.

| Flag | Effect |
|------|--------|
| `--dry-run` | Report the paths that would be written/deleted without writing anything. |
| `--keep-legacy` | Leave the old `milestones/` node in place (default deletes it after copying). |

---

## 6. Security-rules backfill

A one-off migration for data that predates what the tightened security rules resolve access through. Without it, that data is unreachable — the rules cannot authorise what they cannot resolve.

**Source:** `functions/scripts/migrate-security-backfill.js`

| Step | Change | Why |
|------|--------|-----|
| 1 | `milestoneData/{milestoneId}` gains `modelId`, recovered from `bpmnModels/{modelId}/milestones` | A snapshot keyed by its own id alone cannot be tied to a project. |
| 2 | Invitations move from push ids to `{projectId}_{encoded email}` | Accepting an invitation adds you to a project's members, and the rules must find the invitation that authorises it. Rules cannot search, so the key has to be derivable from the project and `auth.token.email`. |

- Uses `firebase-admin`; `projectId` / `databaseURL` are read from `src/config/.firebase.js` via `read-firebase-config.js`.
- **Target:** same as section 5 — `FIREBASE_DATABASE_EMULATOR_HOST` for the emulator, otherwise Application Default Credentials.
- **Run it before deploying the rules.** It only adds and re-keys data, so it is safe against the old rules and leaves the database ready for the new ones.
- **Idempotent:** a re-run finds nothing left to do.
- Snapshots belonging to no model are reported and left untouched — they were already unreachable through the app.
- Where several invitations exist for one project + address, a `Pending` one wins, otherwise the most recent; the rest are deleted as duplicates.
- The email escaping mirrors `src/services/invites.service.tsx` and the `.replace()` chains in `database.rules.json`; all three must change together.

| Flag | Effect |
|------|--------|
| `--dry-run` | Report the paths that would be written/deleted without writing anything. |

---

## How it fits together

```mermaid
flowchart TD
    A["GCP Budget Alert\n(Cloud Billing)"] -->|Pub/Sub| B["billing-resource-limit"]
    A -->|Pub/Sub| C["billing-disable-cutoff"]

    B --> D["limitOnBudgetAlert\n(billingGuard.ts)"]
    D --> E{"costAmount\n>= budgetAmount?"}
    E -- No --> F["Exit — no action"]
    E -- Yes --> G["GoogleAuth.getClient()"]
    G --> H["PUT /.settings/rules.json\ndeny-all rules"]
    H --> I["RTDB: all reads &\nwrites blocked"]

    C --> J["disableOnBudgetAlert\n(disableBilling.ts)"]
    J --> K{"costAmount\n>= budgetAmount?"}
    K -- No --> L["Exit — no action"]
    K -- Yes --> M["getProjectBillingInfo()"]
    M --> N{"billingEnabled?"}
    N -- No --> O["Exit — already disabled"]
    N -- Yes --> P["updateProjectBillingInfo\nbillingAccountName: ''"]
    P --> Q["All GCP billing\ndisabled"]
```

---

## Related code

### Functions
- `functions/src/billingGuard.ts`
- `functions/src/disableBilling.ts`
- `functions/src/index.ts`

### Tests
- `functions/src/billingGuard.test.ts`
- `functions/src/disableBilling.test.ts`

### Scripts & config
- `functions/scripts/deploy.js`
- `functions/scripts/read-firebase-config.js`
- `functions/scripts/sync-config.js`
- `functions/scripts/start-emulator.js`
- `functions/scripts/migrate-milestones.js`
- `functions/scripts/migrate-security-backfill.js`
- `functions/jest.setup.js`
