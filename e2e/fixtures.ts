import { test as base, expect, type Page } from '@playwright/test';

export type TestUser = { email: string; password: string };

/**
 * Default test user. Used by callers that don't need isolation (e.g. the
 * documentation screenshots). The credentials are meaningless — they only exist
 * inside the local Firebase Auth emulator, which is wiped at the start of every
 * `npm run test:e2e` / `npm run screenshots` run.
 */
export const TEST_USER: TestUser = {
  email: 'e2e@example.com',
  password: 'test-password-123',
};

/**
 * Signs in against the Auth emulator using the `window.__E2E_AUTH__` hook that
 * `src/config/.firebase.js` exposes in e2e mode. Creates the user on first use
 * and falls back to a plain sign-in if it already exists. No OAuth popup is
 * involved, so this is fully deterministic and offline.
 */
export async function signIn(page: Page, user: TestUser = TEST_USER) {
  await page.goto('/');

  // Wait until the app has booted and exposed the emulator sign-in hook.
  await page.waitForFunction(() => (window as any).__E2E_AUTH__ !== undefined);

  await page.evaluate(async ({ email, password }) => {
    const { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = (window as any).__E2E_AUTH__;
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        throw err;
      }
    }
  }, user);

  // The app reacts to onAuthStateChanged and swaps the sign-in buttons for the
  // authenticated project view.
  await expect(page.getByRole('button', { name: /Sign in with Google/i })).toHaveCount(0);
}

/**
 * `test` from this module yields a `page` that is already authenticated **as a
 * unique user per test**. Because projects are scoped per user
 * (`users/{uid}/projects`), each test starts from an empty, isolated dataset
 * even though all tests share one emulator database and run in parallel. Import
 * this `test` instead of `@playwright/test` in specs that need a logged-in user.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    // `testId` is unique per test; `retry` keeps retries on a fresh user too.
    const safeId = testInfo.testId.replace(/[^a-z0-9]/gi, '');
    const user: TestUser = {
      email: `e2e-${safeId}-${testInfo.retry}@example.com`,
      password: 'test-password-123',
    };
    await signIn(page, user);
    await use(page);
  },
});

/**
 * A unique, human-readable name. With per-test user isolation this is no longer
 * required for correctness, but it keeps entity names distinct in traces and
 * guards against any accidental reuse within a single test.
 */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Creates a project from the "Your Projects" view and waits for its row. */
export async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: /Add Project/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Opens a project by name and waits for the project (PROJECT view) to load. */
export async function openProject(page: Page, name: string) {
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  // "Add BPMN" appears both in the toolbar and in the empty-state; the first is the toolbar.
  await expect(page.getByRole('button', { name: /Add BPMN/i }).first()).toBeVisible();
}

/** In the open project, create a BPMN model and wait for its row. */
export async function addBpmnModel(page: Page, name: string) {
  await page.getByRole('button', { name: /Add BPMN/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Model name').fill(name);
  await dialog.getByRole('button', { name: 'Add model' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Opens a model row in the editor and waits for the bpmn-js canvas + modeler hook. */
export async function openModelEditor(page: Page, modelName: string) {
  await page.getByText(modelName, { exact: true }).first().click();
  await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
  await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);
}

/** In the open project (at the root), create a folder and wait for its row. */
export async function addFolder(page: Page, name: string) {
  await page.getByRole('button', { name: /Add Folder/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Add folder' }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

/** Opens the overflow (⋮) action menu for the table row containing `name`. */
export async function openRowMenu(page: Page, name: string) {
  await page.getByRole('row').filter({ hasText: name }).locator('.cds--overflow-menu').click();
}

export { expect };
