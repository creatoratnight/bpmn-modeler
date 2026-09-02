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
| `window.__E2E_DB__ = { getDatabase, ref, get, set, update, remove }` | The app's own (emulator-connected) Realtime Database handle plus the modular helpers. Tests use it to seed data — e.g. cross-user project membership in the collaboration test — through the exact database connection, namespace, and security rules the app itself uses. |

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

| Node | Access | Description |
|------|--------|-------------|
| `users/{uid}` | Any authed user may read; a user may write only their own node (`email` is read-only). | User profile + reverse project index. |
| `projects`, `bpmnModels`, `modelXmlData`, `invitations`, `milestoneData` | Authed users. | Project/model metadata, model XML, invitations, milestone snapshots. |
| `milestones/{modelId}`, `comments/{modelId}` | Members of the model's project only (resolved via `bpmnModels/{modelId}/projectId` → `projects/{projectId}/members/{uid}`). | Milestone metadata and comments. |
| `sessions/{modelId}` | Members of the model's project only. | Ephemeral real-time collaboration state — `presence`, `cursors`, `selections`, `viewports`, `ops`, `leader`, and the shared live `doc`. Per-user child nodes are writable only by that user (`auth.uid === $uid`); `doc`/`leader` writes must be self-attributed. |

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
| `projects` | `[chromium, screenshots, collab]` | `chromium` runs the `*.spec.ts` tests (Desktop Chrome; Firefox/WebKit commented out) but **excludes** `collaboration.spec.ts` via `testIgnore`. `screenshots` runs only `*.shots.ts` at a 1440×900 viewport for documentation captures. `collab` runs only `collaboration.spec.ts` — the heavy, multi-window two-client collaboration test — opt-in via `npm run test:collab`. Both extra projects are excluded from the normal test run. |
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
| `e2e/collaboration.spec.ts` | Two-client real-time collaboration (opt-in, `collab` project). Two users open the same model; one builds a large diagram while the other converges live; asserts presence, shared-document propagation, and convergence. Meters the Realtime Database WebSocket on each client (received bytes = billable egress), breaks it down by phase, and writes a data-rate report with a cost projection to `e2e/.collab-report/`. |

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
