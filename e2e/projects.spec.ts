import { test, expect } from './fixtures';

/**
 * Authenticated smoke tests. The `page` fixture from ./fixtures signs in as a
 * unique user per test, so each test runs against an empty, isolated dataset.
 */
test.describe('Authenticated project view', () => {
  test('shows the "Your Projects" view after sign-in', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Your Projects/i })).toBeVisible();
  });

  test('offers an Add Project action for a new user', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Add Project/i }).first()).toBeVisible();
  });

  test('a fresh user starts with no projects', async ({ page }) => {
    // Per-test isolation means this empty-state assertion is reliable: another
    // parallel test's projects belong to a different user and never appear here.
    await expect(page.getByText(/No projects yet/i)).toBeVisible();
  });
});
