import { test as base } from '@playwright/test';
import {
  expect,
  signIn,
  uniqueName,
  createProject,
  openProject,
  addFolder,
  addBpmnModel,
  openModelEditor,
} from './fixtures';

/**
 * Guard against a runaway loop hammering the database (we once shipped a render
 * loop that fired millions of RTDB requests).
 *
 * The Firebase RTDB SDK talks to the emulator over a WebSocket; every read/write
 * is a sent frame. A healthy app is essentially silent once idle, whereas a loop
 * keeps firing frames continuously. So we drive the app through the navigation
 * flows most prone to render/effect loops, let legitimate traffic settle, then
 * assert almost no DB frames are sent during an idle window.
 *
 * Uses the base test (not the auto sign-in fixture) so the frame counter is
 * attached before the WebSocket opens during sign-in.
 */
base('does not flood the database with requests', async ({ page }) => {
  let dbFrames = 0;
  page.on('websocket', (ws) => {
    // The RTDB emulator runs on :9000; ignore the Vite HMR socket on the dev port.
    if (ws.url().includes(':9000')) {
      ws.on('framesent', () => {
        dbFrames++;
      });
    }
  });

  await signIn(page);

  // Exercise the flows most likely to trigger an effect/render loop: project ↔
  // editor routing, breadcrumb navigation, and side-panel quick navigation.
  const project = uniqueName('LoopGuard');
  await createProject(page, project);
  await openProject(page, project);
  await addFolder(page, 'Sub');
  await addBpmnModel(page, 'RootDoc');
  await page.getByText('Sub', { exact: true }).first().click();
  await addBpmnModel(page, 'SubDoc');
  await page.getByText(/\.\. \//).first().click();

  await openModelEditor(page, 'RootDoc');

  // Breadcrumb back to the project view, then re-open the model.
  await page.locator('.nav-project', { hasText: project }).click();
  await openModelEditor(page, 'RootDoc');

  // Side-panel quick navigation (re-scope to a folder, then open its model).
  await page.getByRole('button', { name: 'Open project panel' }).click();
  await page.getByTitle('Sub', { exact: true }).click();
  await page.getByTitle('SubDoc', { exact: true }).click();

  // Confirm we are actually observing DB WebSocket traffic (otherwise the guard
  // would silently pass). Then let any legitimate trailing requests settle.
  await page.waitForTimeout(1000);
  const framesAfterInteraction = dbFrames;
  expect(
    framesAfterInteraction,
    'expected to observe RTDB WebSocket frames during the interaction',
  ).toBeGreaterThan(0);

  // The app should now be idle. A loop would keep sending frames here.
  await page.waitForTimeout(3000);
  const idleFrames = dbFrames - framesAfterInteraction;
  expect(
    idleFrames,
    `app sent ${idleFrames} RTDB frames during a 3s idle window (a loop would send thousands)`,
  ).toBeLessThan(15);
});
