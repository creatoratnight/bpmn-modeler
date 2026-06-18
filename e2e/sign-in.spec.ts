import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the pre-authentication screen.
 *
 * These run against the real app but require no Firebase credentials, since the
 * sign-in options are rendered before any authentication happens. They are a
 * good starting point; authenticated flows would need a mocked or seeded auth
 * session (see the README note added with this setup).
 */
test.describe('Sign-in screen', () => {
  test('loads the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Valtimo Designer/);
  });

  test('shows the Google and Microsoft sign-in options', async ({ page }) => {
    await page.goto('/');

    // Both providers are enabled by default in src/config/config.js.
    await expect(
      page.getByRole('button', { name: /Sign in with Google/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Sign in with Microsoft/i }),
    ).toBeVisible();
  });
});
