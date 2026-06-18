import { test as base, expect, type Page } from '@playwright/test';

/**
 * Test user used for authenticated specs. The credentials are meaningless —
 * they only exist inside the local Firebase Auth emulator, which is wiped at
 * the start of every `npm run test:e2e` run.
 */
export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'test-password-123',
};

/**
 * Signs in against the Auth emulator using the `window.__E2E_AUTH__` hook that
 * `src/config/.firebase.js` exposes in e2e mode. Creates the user on first use
 * and falls back to a plain sign-in if it already exists. No OAuth popup is
 * involved, so this is fully deterministic and offline.
 */
async function signIn(page: Page) {
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
  }, TEST_USER);

  // The app reacts to onAuthStateChanged and swaps the sign-in buttons for the
  // authenticated project view.
  await expect(page.getByRole('button', { name: /Sign in with Google/i })).toHaveCount(0);
}

/**
 * `test` from this module yields a `page` that is already authenticated.
 * Import it instead of `@playwright/test` in specs that need a logged-in user.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

/**
 * A unique, human-readable name. Tests share one emulator database and one
 * test user and run in parallel, so every entity a test creates must have a
 * unique name and assertions must target only that name.
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

export { expect };
