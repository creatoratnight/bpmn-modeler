# Data Dictionary — Config

## Context

The `src/config/` directory holds the runtime configuration files consumed by the React frontend and the Cloud Functions build scripts. Two project-root files, `firebase.json` and `database.rules.json`, drive the Firebase CLI for deployments, the local emulator, and the Realtime Database security rules. Application code imports only from `src/config/` — nothing reads from `firebase.json` or `database.rules.json` at runtime.

---

## 1. Application config

A single exported object in `src/config/config.js` that controls feature flags and the application version string. It is a plain JS object with no external dependencies.

**Source:** `src/config/config.js`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bpmnModelerVersion` | `string` | `"0.5.1"` | Human-readable application version, displayed in the UI header. |
| `enableGoogleSignIn` | `boolean` | `true` | When `true`, the "Sign in with Google" button is rendered in the sign-in view. |
| `enableMicrosoftSignIn` | `boolean` | `true` | When `true`, the "Sign in with Microsoft" button is rendered in the sign-in view. |

**Validation:**
- All three fields have no runtime validation — they are read directly wherever needed.
- Setting both `enableGoogleSignIn` and `enableMicrosoftSignIn` to `false` results in no sign-in options being shown.

---

## 2. Firebase config

`src/config/.firebase.js` initialises the Firebase application and exports the auth primitives used throughout `src/services/`. The file is **gitignored** (it may contain API keys). A placeholder template is committed as `src/config/.example.firebase.js` — copy it to `.firebase.js` and fill in real values before running or deploying.

**Source:** `src/config/.example.firebase.js` (template), `src/config/.firebase.js` (gitignored, actual)

### firebaseConfig shape

The `firebaseConfig` object is passed to `initializeApp()`. All fields are strings.

| Field | Description | Example (from template) |
|-------|-------------|------------------------|
| `apiKey` | Firebase Web API key. | `""` |
| `authDomain` | Firebase Auth domain. | `""` (typically `{projectId}.firebaseapp.com`) |
| `databaseURL` | Firebase Realtime Database base URL. Used by RTDB SDK and read by the Cloud Functions build scripts via `functions/scripts/read-firebase-config.js`. | `""` (europe-west1 region in the live config) |
| `projectId` | GCP / Firebase project ID. Used by the Cloud Functions deploy script. | `""` |
| `storageBucket` | Firebase Storage bucket. Present in the config but **not currently used** by the application. | `""` |
| `messagingSenderId` | Firebase Cloud Messaging sender ID. Present in the config but not used at runtime. | `""` |
| `appId` | Firebase Web App ID. | `""` |
| `measurementId` | Google Analytics measurement ID. Present in config but not explicitly used in app code. | `""` |

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `auth` | `Auth` | Firebase Auth instance created from the initialised app. Imported by `user.service.tsx`. |
| `GoogleAuthProvider` | class | Re-exported from `firebase/auth`. Used in `user.service.tsx` for Google OAuth. |
| `microsoftProvider` | `OAuthProvider` | `new OAuthProvider('microsoft.com')`. Used in `user.service.tsx` for Microsoft OAuth. |
| `signInWithPopup` | function | Re-exported from `firebase/auth`. Imported in `user.service.tsx`. |

**Validation:**
- No runtime validation of config values — a missing `databaseURL` will cause all RTDB operations to fail silently or throw at the SDK level.
- The template enforces the shape; all fields must be non-empty strings in a production deployment.

### End-to-end test mode (emulators)

When the app is started with `VITE_FIREBASE_EMULATOR=true` (set by `vite --mode e2e` via `.env.e2e`), the config file points the SDK at the local Firebase emulators and exposes a test hook. The block is guarded so it is stripped from production builds.

| Action | Detail |
|--------|--------|
| `connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })` | Routes all Firebase Auth calls to the local Auth emulator. |
| `connectDatabaseEmulator(getDatabase(app), '127.0.0.1', 9000)` | Routes all RTDB calls to the local Database emulator. |
| `window.__E2E_AUTH__ = { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword }` | Test-only hook used by the Playwright fixture (`e2e/fixtures.ts`) to sign in without the OAuth popup. |

The block adds these imports from `firebase/auth` (`connectAuthEmulator`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`) and `firebase/database` (`connectDatabaseEmulator`). It is present in both `.example.firebase.js` (committed) and `.firebase.js` (gitignored, actual).

### End-to-end database hook (e2e-hooks.ts)

`src/config/e2e-hooks.ts` is a committed side-effect module imported by `src/main.tsx`. Guarded by the same `VITE_FIREBASE_EMULATOR` flag (so it is stripped from production builds), it exposes a second test hook alongside `__E2E_AUTH__`:

| Action | Detail |
|--------|--------|
| `window.__E2E_DB__ = { getDatabase, ref, get, set, update, remove, query, orderByChild, equalTo }` | The app's own (emulator-connected) Realtime Database handle plus the modular helpers. Tests use it to seed data — e.g. cross-user project membership in the collaboration test — through the exact database connection, namespace, and security rules the app itself uses. The query helpers are there because the rules authorise collection reads by query *shape*, so the security-rules test has to issue the real queries. |

**Source:** `src/config/e2e-hooks.ts`

---

## 3. Firebase project config (firebase.json)

`firebase.json` is read exclusively by the Firebase CLI (`firebase deploy`, `firebase emulators:start`). It is not imported by application code.

**Source:** `firebase.json`

### functions

| Field | Value | Description |
|-------|-------|-------------|
| `source` | `"functions"` | Directory containing the Cloud Functions package. |
| `predeploy` | `["npm --prefix functions install", "npm --prefix functions run build"]` | Steps run before every function deploy: install dependencies, then compile TypeScript → `lib/`. |

### database

| Field | Value | Description |
|-------|-------|-------------|
| `rules` | `"database.rules.json"` | Path to the Realtime Database security rules. Applied both on `firebase deploy` and by the local Database emulator, so the rules are version-controlled and enforced identically in tests. |

### hosting

| Field | Value | Description |
|-------|-------|-------------|
| `public` | `"dist"` | Directory served by Firebase Hosting (Vite build output). |
| `ignore` | `["firebase.json", "**/.*", "**/node_modules/**"]` | Files excluded from the hosting upload. |
| `rewrites` | `[{ source: "**", destination: "/index.html" }]` | Catch-all SPA rewrite — all paths serve `index.html` so client-side routing works. |

### emulators

| Emulator | Port | Description |
|----------|------|-------------|
| `auth` | `9099` | Local Firebase Auth emulator. Used by the end-to-end tests to sign in without real OAuth. |
| `database` | `9000` | Local Realtime Database emulator. Used by the end-to-end tests; loads the security rules from `database.rules.json` (the `database.rules` key above), so tests run against the same rules as production. |
| `functions` | `5001` | Local Firebase Functions emulator. |
| `pubsub` | `8085` | Local Pub/Sub emulator (used to trigger billing-guard functions in development). |
| `ui` | `4000` | Firebase Emulator UI dashboard. |
| `singleProjectMode` | `true` | Emulators operate as a single project, enabling cross-emulator calls. |

> The `database.rules` key points at `database.rules.json` (see §4), so a bare `firebase deploy` pushes the rules and the Database emulator enforces them during tests. (Historically no rules key was configured and the emulator defaulted to allow-all.)

---

## 4. Realtime Database security rules (database.rules.json)

`database.rules.json` holds the Realtime Database security rules, referenced from `firebase.json`'s `database.rules` key. It is enforced on deploy and by the local emulator. All authorization is expressed here; there is no server-side code path for it.

**Source:** `database.rules.json`

Rules **cascade downward as grants**: a rule deeper in the tree can only widen access, never narrow it, and once a node grants `.read` or `.write` every rule below it is ignored. Every restriction below therefore depends on nothing above it granting first, which is why no collection is readable as a whole.

Access is resolved through project membership: `bpmnModels/{modelId}/projectId` → `projects/{projectId}/members/{uid}`, and for data one step further out (model XML, milestone snapshots) through the model node.

| Node | Access | Description |
|------|--------|-------------|
| `users/{uid}` | Readable per-uid by any authed user; writable only by that user. | User profile + reverse project index. Per-uid reads back the members panel and the "who invited you" line. The collection itself is not listable — the only collection-level read is an equality query on `email` (the invite lookup). |
| `users/{uid}/projects/{projectId}` | Addition to the above: the project's owner may also clear this entry. | Lets an owner remove a member without leaving them pointing at a project they no longer belong to. |
| `projects/{projectId}` | Owner or member; creation requires `ownerId` to be the caller. | The collection is not listable; clients read projects by id from their own `users/{uid}/projects` index. |
| `projects/{projectId}/name` | Addition: also readable by someone holding a *pending* invitation to that project. | So an invite can say which project it is for, without opening the project. |
| `projects/{projectId}/members/{uid}` | Addition: a user may add **themselves** when a pending invitation exists at `invitations/{projectId}_{encoded email}`. | The one way to gain access to someone else's project. The key is derived from the project and `auth.token.email`, because rules cannot search. |
| `bpmnModels/{modelId}` | Member of the model's project. | Collection reads are query-scoped: only `orderByChild('projectId')` on a project you belong to (used when deleting a project). |
| `modelXmlData/{modelId}` | Member of the model's project. | A model and its XML are created in one multi-path update and `root` is the pre-write state, so creation is additionally allowed where no model node exists yet — that can only create an orphan under an unused push id. |
| `milestoneData/{milestoneId}` | Member of the project owning `modelId`. | Requires the `modelId` back-reference; without it a snapshot cannot be tied to a project at all. |
| `invitations/{invitationId}` | The invited address, or a member of the project. | Two query shapes only: `invitedEmail` equal to your own verified address, and `projectId` of a project you belong to. The key must match the `projectId` + `invitedEmail` the record claims. |
| `milestones/{modelId}`, `comments/{modelId}` | Members of the model's project only. | Milestone metadata and comments. |
| `sessions/{modelId}` | Members of the model's project only. | Ephemeral real-time collaboration state — `presence` (name, color, avatar, `joinedAt`/`lastActive`, and an `idle` flag set while that user has stepped away), `cursors`, `selections`, `viewports`, `leader`, and the shared Yjs document under `ydoc` (an append-only update `log` plus the leader-compacted `state`). Per-user child nodes are writable only by that user (`auth.uid === $uid`); a `leader` claim must be self-attributed. |

---

## 5. Build config (vite.config.ts)

`vite.config.ts` contains the Vite build configuration for the frontend. It is minimal — only the React plugin is registered. No aliases, proxy rules, or environment-variable transforms are configured.

**Source:** `vite.config.ts`

| Setting | Value | Description |
|---------|-------|-------------|
| `plugins` | `[react()]` | `@vitejs/plugin-react` — enables JSX transform and React Fast Refresh in development. |

---

## 6. End-to-end test config (playwright.config.ts)

`playwright.config.ts` configures the Playwright end-to-end test runner. Tests live in `e2e/`. The config auto-starts the Vite dev server (in e2e mode) on a dedicated port before the suite; the Firebase emulators are started around the run by the `test:e2e` / `test:e2e:ui` scripts.

**Source:** `playwright.config.ts`

| Setting | Value | Description |
|---------|-------|-------------|
| `testDir` | `'./e2e'` | Directory containing the `*.spec.ts` test files. |
| `fullyParallel` | `true` | Runs tests across files in parallel. |
| `forbidOnly` | `!!process.env.CI` | Fails the run if `test.only` is left in the source when running on CI. |
| `retries` | `2` on CI, `0` locally | Retry count for failed tests. |
| `workers` | `1` on CI, default locally | Parallel worker count. |
| `reporter` | `'html'` | Generates an HTML report (opened via `npm run test:e2e:report`). |
| `use.baseURL` | `'http://localhost:5174'` | Base URL tests navigate against — a dedicated e2e port so the test server is never confused with a normal `npm run dev` on 5173. |
| `use.trace` | `'on-first-retry'` | Captures a Playwright trace when a test is retried. |
| `projects` | `[chromium, screenshots, collab, demo]` | `chromium` runs the `*.spec.ts` tests (Desktop Chrome; Firefox/WebKit commented out) but **excludes** both `collaboration.spec.ts` and `demo-vergunningsaanvraag.spec.ts` via `testIgnore`. `screenshots` runs only `*.shots.ts` at a 1440×900 viewport for documentation captures. `collab` runs only `collaboration.spec.ts` — the heavy, multi-window two-client collaboration test — opt-in via `npm run test:collab`. `demo` runs only `demo-vergunningsaanvraag.spec.ts` — the four-window live-collaboration demo choreography — opt-in via `npm run demo`. The three extra projects are all excluded from the normal test run. |
| `webServer.command` | `'npm run dev:e2e'` | Command started before the suite (`vite --mode e2e`, loads `.env.e2e`). |
| `webServer.url` | `'http://localhost:5174'` | URL polled until the dev server is ready. |
| `webServer.reuseExistingServer` | `!process.env.CI` | Reuses an already-running dev server locally; always starts fresh on CI. |
| `webServer.timeout` | `120000` | Milliseconds to wait for the dev server to boot. |

**npm scripts (from `package.json`):**

| Script | Command | Description |
|--------|---------|-------------|
| `dev:e2e` | `vite --mode e2e --port 5174 --strictPort` | Dev server in e2e mode on the dedicated port 5174; loads `.env.e2e` (`VITE_FIREBASE_EMULATOR=true`). |
| `emulators` | `firebase emulators:start --only auth,database --project demo-bpmn` | Starts the Auth + Database emulators (for a manual two-terminal UI run). |
| `test:e2e` | `firebase emulators:exec --only auth,database --project demo-bpmn "playwright test --project=chromium"` | Boots the emulators, runs the test suite headless (chromium project only — never the screenshot captures), tears them down. |
| `test:e2e:ui` | `firebase emulators:exec --only auth,database --project demo-bpmn "playwright test --project=chromium --ui"` | Interactive Playwright UI mode; boots the emulators automatically (no separate `npm run emulators` needed). |
| `test:e2e:report` | `playwright show-report` | Opens the last HTML report. |
| `test:collab` | `firebase emulators:exec --only auth,database --project demo-bpmn "playwright test --project=collab"` | Boots the emulators and runs only the two-client real-time collaboration + data-rate test. Launches two side-by-side headed browser windows by default (set `HEADLESS=1` to hide them) and writes a report to `e2e/.collab-report/index.html`. |
| `demo` | `firebase emulators:exec --only auth,database --project demo-bpmn "playwright test --project=demo"` | Boots the emulators and runs the four-user live-collaboration demo choreography, meant for screen-recording. Launches four tiled, headed browser windows by default (set `HEADLESS=1` to hide them). Tuning env vars: `SPEED` (playback speed multiplier), `SCREEN_W`/`SCREEN_H` (screen resolution used to tile the windows), `HOLD_MS` (how long to hold on the finished diagram). |
| `screenshots` | `firebase emulators:exec --only auth,database --project demo-bpmn "playwright test --project=screenshots"` | Captures documentation screenshots (the `screenshots` project) into `docs/assets/screenshots/`. Managed by the `capture-screenshots` skill. |

**Authentication for tests:** the `demo-bpmn` project ID runs the emulators fully offline (no real credentials). The Playwright fixture `e2e/fixtures.ts` signs in via the `window.__E2E_AUTH__` hook (see §2), creating a **unique throwaway user per test** (derived from the test ID). Because projects are scoped per user (`users/{uid}/projects`), each test runs against an empty, isolated dataset while keeping full parallelism; the emulator database is reset each run. The pre-auth smoke tests (`e2e/sign-in.spec.ts`) need no sign-in.

**Test coverage:**

| Spec | What it covers |
|------|----------------|
| `e2e/sign-in.spec.ts` | Pre-auth screen: app shell loads, Google/Microsoft sign-in buttons render. |
| `e2e/projects.spec.ts` | After sign-in: the "Your Projects" view and Add Project action render, and a fresh user starts with no projects (empty state) — relying on per-test user isolation. |
| `e2e/project-crud.spec.ts` | Authenticated CRUD: create a project, open it, rename it (verified via the list), add a folder, add a BPMN model. Each test runs as its own user (per-test isolation, see below) so tests stay independent. |
| `e2e/editor.spec.ts` | BPMN editor: open a model, draw a task off the start event via the modeling API (exposed on `window.__E2E_BPMN__`), save it, and confirm the task persisted by reloading and re-reading the saved XML. |
| `e2e/core-flows.spec.ts` | Core authenticated journeys: delete a project (→ empty list), add and delete a comment, save and delete a milestone, and load a milestone (verifying the auto-backup `State before loading '<name>'` milestone is created). |
| `e2e/validation.spec.ts` | Validation guards: invalid model name blocked (QName rule), "Delete Folder" disabled while the folder is non-empty (enabled when empty), and "Invite member" disabled until a valid email is entered. |
| `e2e/model-ops.spec.ts` | Model operations & persistence: rename, duplicate, move-to-folder, create DMN, folder navigation (in/out via `.. / <folder>`), download a `.bpmn` file, deep-link reload restores the editor, and auto-save persists a change without clicking Save (and sets the `autoSave` localStorage key). |
| `e2e/security-rules.spec.ts` | What the security rules deny. An outsider account attempts node reads, collection listings, cross-tenant queries and writes against another user's project — including adding themselves to it and forging an invitation — and every attempt must fail; the owner's own access is unaffected. A second test walks the whole invitation path: no access → invited (the project's *name* becomes readable, nothing else) → accepted → access. Every attempt runs through `window.__E2E_DB__`, so these are real client operations against the real rules. |
| `e2e/collaboration.spec.ts` | Two-client real-time collaboration (opt-in, `collab` project). Two users open the same model; one builds a large diagram while the other converges live; asserts presence, shared-document propagation, and convergence. Also covers the idle tiers: a window left untouched is flagged away, has its cursor cleared, gives up the persistence leadership, and downloads none of the peer's edits until a single mouse move brings it back and it catches up. Meters the Realtime Database WebSocket on each client (received bytes = billable egress), breaks it down by phase, and writes a data-rate report with a cost projection to `e2e/.collab-report/`. |
| `e2e/demo-vergunningsaanvraag.spec.ts` | Four-user live-collaboration demo choreography (opt-in, `demo` project), meant for screen-recording rather than as a pass/fail gate. Four users (Dutch names) in four tiled, headed windows collaboratively build a Dutch *vergunningsaanvraag* (permit-application) BPMN process; actions are human-paced, mice drift over the canvas to drive live remote cursors, and two users deliberately draw at the same time to show concurrent editing merges. Ends with a light convergence check that all four windows hold the identical diagram. |

**Documentation screenshots:** the `screenshots` Playwright project (run via `npm run screenshots`) captures UI images into `docs/assets/screenshots/`. Shots are defined in `e2e/screenshots/manifest.ts` and captured serially by `e2e/screenshots/capture.shots.ts` (toasts hidden, fixed names for deterministic images). This is driven by the `capture-screenshots` skill; the images are committed and embedded in the Markdown docs and their HTML twins.

**Notes:**
- The dev server requires a valid `src/config/.firebase.js` to boot (Firebase is initialised at module load). In CI, generate it from `.example.firebase.js` with dummy values — the emulators run in demo mode and need no real keys.
- The Firebase CLI requires Node.js ≥ 20 (the repo pins 22 in `.nvmrc`); the emulators require a JVM (Java) on the `PATH`.
- Browser binaries are installed separately via `npx playwright install chromium`.

---

## How it fits together

```mermaid
flowchart TD
    A["src/config/config.js\nbpmnModelerVersion\nenableGoogleSignIn\nenableMicrosoftSignIn"] --> B["App.tsx / header\nconditional sign-in buttons"]

    C["src/config/.example.firebase.js\n(template, committed)"]
    D["src/config/.firebase.js\n(gitignored, fill from example)"]
    C -.->|"copy & fill"| D

    D --> E["user.service.tsx\nauth, GoogleAuthProvider,\nmicrosoftProvider, signInWithPopup"]
    D --> F["models.service.tsx\ngetDatabase()"]
    D --> G["projects.service.tsx\ngetDatabase()"]
    D --> H["functions/scripts/read-firebase-config.js\nextracts databaseURL → DATABASE_URL\nextracts projectId → GCLOUD_PROJECT"]

    I["firebase.json\n(Firebase CLI only)"] --> J["firebase deploy\n(Functions + Hosting)"]
    I --> K["firebase emulators\nauth :9099 / database :9000\nfunctions :5001 / pubsub :8085 / UI :4000"]
    S["database.rules.json\n(RTDB security rules)"] --> J
    S --> K

    L["vite.config.ts\n(Vite build tool)"] --> M["npm run build\n→ dist/"]
    M --> J

    N["playwright.config.ts\n(E2E test runner)"] -->|"webServer: npm run dev:e2e"| O["Vite dev server :5174\n.env.e2e → VITE_FIREBASE_EMULATOR=true"]
    O --> D
    Q["npm run test:e2e\nfirebase emulators:exec"] --> K
    Q --> N
    O --> R["e2e/*.spec.ts + e2e/fixtures.ts"]
    R -->|"window.__E2E_AUTH__"| K
```

---

## Related code

### Config files
- `src/config/config.js`
- `src/config/.example.firebase.js`
- `src/config/.firebase.js`
- `src/config/e2e-hooks.ts`

### Firebase project & build
- `firebase.json`
- `database.rules.json`
- `vite.config.ts`

### Testing
- `playwright.config.ts`
- `.env.e2e`
- `e2e/fixtures.ts`
- `e2e/sign-in.spec.ts`
- `e2e/collaboration.spec.ts`
- `e2e/security-rules.spec.ts`
- `e2e/demo-vergunningsaanvraag.spec.ts`
- `e2e/projects.spec.ts`
- `e2e/project-crud.spec.ts`
- `e2e/editor.spec.ts`
- `e2e/core-flows.spec.ts`
- `e2e/validation.spec.ts`
- `e2e/model-ops.spec.ts`
- `e2e/screenshots/manifest.ts`
- `e2e/screenshots/capture.shots.ts`

### Consumers
- `src/services/user.service.tsx`
- `src/services/models.service.tsx`
- `src/services/projects.service.tsx`
- `functions/scripts/read-firebase-config.js`
