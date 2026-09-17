import { test, expect } from '@playwright/test';
import config from '../src/config/config';

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
    // Both the tab title and the sign-in heading come from `appTitle`, so
    // rebranding the app is a one-line config change and not a test failure.
    await expect(page).toHaveTitle(config.appTitle);
    await expect(page.getByText(`Welcome to ${config.appTitle}!`)).toBeVisible();
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
