import { test } from '@playwright/test';
import { shots } from './manifest';

// Capture shots serially in manifest order so the shared emulator database
// evolves deterministically (e.g. the projects list shows a known set).
test.describe.configure({ mode: 'serial' });

/**
 * Documentation screenshot capture. This is NOT a normal test file — it is
 * picked up only by the `screenshots` Playwright project (see playwright.config.ts)
 * and run via `npm run screenshots`. Each shot writes a PNG into
 * `docs/assets/screenshots/`, committed and referenced from the docs.
 *
 * It reuses the e2e infrastructure: the Firebase emulators (started by the
 * `screenshots` npm script) and the sign-in helper from ../fixtures.
 */
const OUTPUT_DIR = 'docs/assets/screenshots';

for (const shot of shots) {
  test(shot.id, async ({ page }) => {
    const target = await shot.setup(page);
    // Hide transient toast notifications (incl. benign emulator indexOn warnings)
    // so they don't clutter the documentation images.
    await page.addStyleTag({ content: '#toast-container { display: none !important; }' });
    const path = `${OUTPUT_DIR}/${shot.id}.png`;
    // `animations: 'disabled'` settles CSS transitions (e.g. panel open) so
    // captures are not taken mid-animation.
    if (target) {
      await target.screenshot({ path, animations: 'disabled' });
    } else {
      await page.screenshot({ path, fullPage: shot.fullPage ?? false, animations: 'disabled' });
    }
    // Surface the produced file + caption in the report for easy reference.
    test.info().annotations.push({ type: 'screenshot', description: `${path} — ${shot.title}` });
  });
}
