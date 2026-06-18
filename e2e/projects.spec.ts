import { test, expect } from './fixtures';

/**
 * Authenticated smoke tests. The `page` fixture from ./fixtures signs in
 * against the Auth emulator before each test, so these run as a logged-in user
 * with an empty (freshly emulated) database.
 */
test.describe('Authenticated project view', () => {
  test('shows the "Your Projects" view after sign-in', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Your Projects/i })).toBeVisible();
  });

  test('offers an Add Project action for a new user', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Add Project/i }).first()).toBeVisible();
  });
});
