# Changelog

A dated history of documentation changes, newest first.

## 2026-09-17 (security rules)

### config.md
- **Rewritten (§4 security rules):** every row of the access table changed. Documented that rules cascade downward as grants (so a restriction under a permissive ancestor is unreachable), and that access is resolved through project membership. New rows for `users/{uid}/projects/{projectId}`, `projects/{projectId}/name`, `projects/{projectId}/members/{uid}`, `modelXmlData`, `milestoneData` and `invitations`; collection reads are now query-scoped.
- **Changed:** `window.__E2E_DB__` also exposes `query`, `orderByChild` and `equalTo`.
- **New test coverage:** `e2e/security-rules.spec.ts` — what the rules deny, plus the full invitation path.

### services.md
- **Renamed:** `deleteModelsAndInvites(projectId)` → `deleteProjectCascade(projectId, userId)`; now one atomic multi-path update that also removes the project node and the members' reverse-index entries. Dropped the stale "fire-and-forget removes" note.
- **Changed path:** `saveMilestone` writes `/milestoneData/{milestoneId}` as `{ modelId, xmlData }` (was `/milestoneData/{milestoneId}/xmlData`).
- **New section (§5 invites.service.tsx):** `encodeEmailKey` and `invitationKey` — the deterministic invitation key and its escaping table.
- **Corrected:** `invites.service.tsx` is no longer an empty stub; §6 lists only `download.service.tsx`.

### projects.md
- **New field:** `milestoneData.modelId` (`string`) — the back-reference access is resolved through; RTDB path is now `milestoneData/{milestoneId}`.
- **Changed key:** `Invitation` lives at `invitations/{projectId}_{encoded invitedEmail}`, not a push id. Documented the key-matches-content rule, the project-scoped duplicate check, and that self-service membership is what an accepted invitation authorises.
- **New migration notes:** both entities reference `functions/scripts/migrate-security-backfill.js`.

### functions.md
- **New section (§6):** the security-rules backfill script — what it changes, why, that it must run before the rules are deployed, and its duplicate-resolution rule.
- **New npm script:** `migrate-security-backfill`.
- **Changed:** the milestone migration writes `milestoneData/{milestoneId}` with `modelId`.

## 2026-09-17

### components.md
- **Changed behaviour note:** the BpmnModeler collaboration binding now attaches three helpers instead of two — `CollabBinding`, `CollabDoc`, and a single `IdleDetector` shared by both, so the presence overlay and the shared document step away from and return to the session together.
- **New E2E hooks:** `window.__E2E_IDLE__` (the activity detector) and `window.__E2E_IDLE_MS__` (threshold override), both guarded by `VITE_FIREBASE_EMULATOR` like `__E2E_BPMN__`.
- **New behaviour (§7 PresenceBar):** a peer flagged `idle` renders dimmed and greyscaled with a `<name> (away)` title.
- **Updated engine note:** the collaboration engine list now also names `IdleDetector`.

### config.md
- **Corrected (§4 security rules):** the `sessions/{modelId}` subtree no longer has `ops` or a shared live `doc` — it is `ydoc` (append-only update `log` + leader-compacted `state`), as of the Yjs rewrite.
- **New field:** `presence/{uid}/idle` (`boolean`) — set while that user has stepped away from their window.
- **Updated test coverage:** `e2e/collaboration.spec.ts` also covers the idle tiers (a parked window is flagged away, clears its cursor, gives up the persistence leadership, downloads no peer edits, and catches up on return).

## 2026-09-10

### config.md
- **New Playwright project:** `demo` (`playwright.config.ts`) — runs only `e2e/demo-vergunningsaanvraag.spec.ts`; the `chromium` project's `testIgnore` now excludes this spec as well as `collaboration.spec.ts`.
- **New npm script:** `demo` — `firebase emulators:exec ... "playwright test --project=demo"`; runs the four-user live-collaboration demo choreography in four tiled headed windows (env vars `SPEED`, `SCREEN_W`/`SCREEN_H`, `HOLD_MS`; `HEADLESS=1` to hide).
- **New test coverage:** `e2e/demo-vergunningsaanvraag.spec.ts` — four users collaboratively build a Dutch *vergunningsaanvraag* BPMN process for screen-recording, with concurrent drawing and live remote cursors.

## 2026-09-05

### components.md
- **Changed behaviour note:** the BpmnModeler collaboration binding now attaches `CollabDoc` (CRDT live sync via a shared Yjs document that *merges* concurrent edits per element and field, plus leader-elected persistence) in place of the removed `DocSync` (which did full-document last-writer-wins sync).
- **Updated engine note:** the collaboration engine list now names `CollabDoc` and the Yjs binding (`BpmnYjsBinding` + `YModel`) instead of `DocSync`.

## 2026-09-01

### components.md
- **New prop:** `BpmnModeler.collabSession` (`CollaborationSession | null`) — the live collaboration session for the open model; when set, the modeler attaches the real-time collaboration bindings after the initial XML import.
- **New behaviour note:** documented the collaboration binding (`CollabBinding` for peer cursors/selection overlay, `DocSync` for full-document live sync + leader-elected persistence) attached to the modeler when a session is present.
- **New section (§7 Collaboration presence):** documented the `PresenceBar` component (`src/collaboration/PresenceBar.tsx`) — `peers` / `max` props and its avatar-stack behaviour. Noted that the collaboration engine under `src/collaboration/` (`useCollaboration`, `CollaborationSession`, `DocSync`, `CollabBinding`, `identity`, `types`) still needs its own document.

### services.md
- **New function:** `persistCollaborativeXml(modelId, xml)` — writes only `modelXmlData/{modelId}/xmlData` and touches `updatedAt`; used by the collaboration persistence leader (single writer per session), replacing the per-edit last-writer-wins auto-save while collaborating.

### config.md
- **New file (§4 Realtime Database security rules):** documented `database.rules.json` — now version-controlled and wired via `firebase.json`'s new `database.rules` key, enforced on deploy and by the local emulator. Includes the member-scoped `sessions/{modelId}` collaboration subtree (`presence`, `cursors`, `selections`, `viewports`, `ops`, `leader`, `doc`).
- **Corrected:** the emulator no longer "defaults to allow-all rules" — the `database` emulator loads `database.rules.json`; updated the `database` emulator row and replaced the stale "no deploy-level rules key" note.
- **New config file:** `src/config/e2e-hooks.ts` — the `window.__E2E_DB__` test hook (guarded by `VITE_FIREBASE_EMULATOR`) used to seed data through the app's own database connection.
- **New Playwright project & script:** `collab` project (excludes `collaboration.spec.ts` from `chromium` via `testIgnore`) and the `test:collab` npm script; added `e2e/collaboration.spec.ts` to test coverage (two-client collaboration + database data-rate report).

## 2026-08-26

### projects.md
- **Split milestone storage:** the `Milestone` entity (§5) is now stored in two parts — metadata under `bpmnModels/{modelId}/milestones/{milestoneId}` (`name`, `description`, `createdBy`, `createdAt`) and the XML snapshot separately at `milestoneData/{milestoneId}/xmlData`. Removed the inline `xmlData` field from the metadata; added a "Milestone XML data" subsection, a migration note, and a `MILESTONE_XML` entity + relationship to the ER diagram.

### services.md
- **Changed:** `saveBPMNModel` / `saveDMNodel` now write model fields individually instead of replacing the whole `bpmnModels/{id}` node, preserving the nested `milestones` child.
- **Changed:** `saveMilestone` writes split metadata + XML and returns the generated `milestoneId`; `getMilestones` reads metadata only (no `xmlData`); `deleteMilestone` removes both parts.
- **New function:** `getMilestoneXml(milestoneId)` — fetches a milestone's XML snapshot on demand.
- **New function:** `getModelMilestoneIds(modelId)` — lists a model's milestone IDs for cascade cleanup.
- **Changed:** `deleteModelsAndInvites` now also removes each model's `milestoneData/{milestoneId}` snapshots.

### components.md
- **Changed:** `MilestonesModal` lists from `bpmnModels/{model.id}/milestones` (metadata only) and fetches the XML on demand via `getMilestoneXml` when a milestone is loaded.

### functions.md
- **New section:** documented the `functions/scripts/migrate-milestones.js` data migration (legacy → split milestone layout), its `--dry-run` / `--keep-legacy` flags, target selection, idempotency, and the `npm run migrate-milestones` script.

## 2026-06-19

### config.md
- **New coverage:** added `e2e/validation.spec.ts` (invalid model name, folder-delete-disabled, invite email validation) and `e2e/model-ops.spec.ts` (rename/duplicate/move model, create DMN, folder navigation, download, deep-link reload, auto-save) to the test-coverage table and "Related code".
- **New coverage:** added `e2e/core-flows.spec.ts` (delete project, add/delete comment, save/delete milestone, load milestone with auto-backup) to the test-coverage table and "Related code".
- **Per-test isolation:** the Playwright fixture now signs in a unique throwaway user per test (was a single shared user), so each test runs against an empty, isolated dataset while staying parallel. Updated the §5 "Authentication for tests" note and the `project-crud.spec.ts` coverage row, and noted the new `projects.spec.ts` empty-state ("a fresh user starts with no projects") test.

### guide.md
- **UI screenshots:** embedded nine captured screenshots (sign-in, projects list, Add Project dialog, project view, Add model dialog, BPMN editor, Milestones dialog, comments panel, Invite Member dialog) across §1–§9 to make it an end-user friendly visual guide. Images live in `docs/assets/screenshots/`, generated by the `capture-screenshots` skill from `e2e/screenshots/manifest.ts`; added a "Screenshots" note to "Related code". Added responsive `figure`/`img` styling to `docs/html/assets/styles.css`.

### config.md
- **New script & project:** documented `npm run screenshots` and the `screenshots` Playwright project (1440×900, `*.shots.ts` only, excluded from the test run) for documentation captures, plus the `e2e/screenshots/manifest.ts` / `capture.shots.ts` harness and the `capture-screenshots` skill.
- **Updated:** `test:e2e` and `test:e2e:ui` now pin `--project=chromium`; `projects` row lists `[chromium, screenshots]`.
- **New coverage:** added `e2e/editor.spec.ts` (draw-a-task-and-save) to the test-coverage table and "Related code".

### components.md
- **New behaviour:** `BpmnModeler` exposes the underlying `bpmn-js` modeler on `window.__E2E_BPMN__` in e2e mode (set after the initial XML import resolves, removed on unmount) so the Playwright editor test can drive the modeling API. Guarded out of production builds.

### config.md
- **Updated:** E2E dev server moved to a dedicated port. `use.baseURL` and `webServer.url` are now `http://localhost:5174` (was 5173); `dev:e2e` is `vite --mode e2e --port 5174 --strictPort`; updated the "How it fits together" diagram port.
- **Updated:** `test:e2e:ui` now wraps Playwright in `firebase emulators:exec`, so UI mode boots the emulators automatically; revised the script row and the §5 intro accordingly.
- **Updated:** Added authenticated CRUD end-to-end coverage. Documented the new `e2e/project-crud.spec.ts` spec (create/open/rename project, add folder, add BPMN model) with a "Test coverage" table in §5 and added it to "Related code".

## 2026-06-18

### config.md
- **Updated:** Firebase emulator-based authentication for end-to-end tests. Added an "End-to-end test mode (emulators)" subsection to §2 (the `VITE_FIREBASE_EMULATOR` guard, `connectAuthEmulator`/`connectDatabaseEmulator`, and the `window.__E2E_AUTH__` hook); added `auth` (9099) and `database` (9000) emulators to §3 with the no-deploy-rules note; revised §5 for the `npm run dev:e2e` web server, the `firebase emulators:exec`-wrapped `test:e2e`, the new `dev:e2e`/`emulators` scripts, the programmatic sign-in fixture, and the Node ≥ 20 / JVM prerequisites. Added `.env.e2e`, `e2e/fixtures.ts`, and `e2e/projects.spec.ts` to "Related code".
- **New section:** End-to-end test config (`playwright.config.ts`) — documents the Playwright runner settings, the `webServer` dev-server hook, the `test:e2e*` npm scripts, and the `src/config/.firebase.js` boot dependency. Added `playwright.config.ts` and `e2e/sign-in.spec.ts` to "Related code".
