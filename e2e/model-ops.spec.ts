import {
  test,
  expect,
  uniqueName,
  createProject,
  openProject,
  addFolder,
  addBpmnModel,
  openModelEditor,
  openRowMenu,
} from './fixtures';

/**
 * Model operations and persistence. Each test runs as its own isolated user
 * (see ./fixtures), so assertions about which rows exist are absolute.
 */
test.describe('Model operations', () => {
  test('renames a model', async ({ page }) => {
    const project = uniqueName('Renamer');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'Original');

    await openRowMenu(page, 'Original');
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model name').fill('Renamed');
    await dialog.getByRole('button', { name: 'Rename model' }).click();

    await expect(page.getByText('Renamed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Original' })).toHaveCount(0);
  });

  test('duplicates a model', async ({ page }) => {
    const project = uniqueName('Duplicator');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'Source');

    await openRowMenu(page, 'Source');
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();

    await expect(page.getByText('Source Copy', { exact: true }).first()).toBeVisible();
  });

  test('moves a model into a folder', async ({ page }) => {
    const project = uniqueName('Mover');
    await createProject(page, project);
    await openProject(page, project);
    await addFolder(page, 'Archive');
    await addBpmnModel(page, 'Movable');

    await openRowMenu(page, 'Movable');
    await page.getByRole('menuitem', { name: 'Move to...' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Select Folder').selectOption({ label: 'Archive' });
    await dialog.getByRole('button', { name: 'Move' }).click();

    // Gone from the project root...
    await expect(page.getByRole('row').filter({ hasText: 'Movable' })).toHaveCount(0);
    // ...and present inside the folder.
    await page.getByText('Archive', { exact: true }).first().click();
    await expect(page.getByText('Movable', { exact: true }).first()).toBeVisible();
  });

  test('creates a DMN model', async ({ page }) => {
    const project = uniqueName('Decisions');
    await createProject(page, project);
    await openProject(page, project);

    await page.getByRole('button', { name: /Add DMN/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model name').fill('Decision1');
    await dialog.getByRole('button', { name: 'Add model' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Decision1' })).toContainText('dmn');
  });

  test('navigates into and back out of a folder', async ({ page }) => {
    const project = uniqueName('Navigator');
    await createProject(page, project);
    await openProject(page, project);
    await addFolder(page, 'Docs');
    await addBpmnModel(page, 'RootModel');

    // Enter the folder and add a model inside it.
    await page.getByText('Docs', { exact: true }).first().click();
    await addBpmnModel(page, 'NestedModel');
    await expect(page.getByText(/\.\. \//)).toBeVisible();
    await expect(page.getByText('NestedModel', { exact: true }).first()).toBeVisible();
    // The root model is not shown inside the folder.
    await expect(page.getByRole('row').filter({ hasText: 'RootModel' })).toHaveCount(0);

    // Back to the root via the up-navigation (".. / <folder>") entry.
    await page.getByText(/\.\. \//).first().click();
    await expect(page.getByText('RootModel', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'NestedModel' })).toHaveCount(0);
  });

  test('downloads a model as a .bpmn file', async ({ page }) => {
    const project = uniqueName('Downloader');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'Downloadable');

    await openRowMenu(page, 'Downloadable');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.bpmn$/i);
  });

  test('restores the editor on a deep-link reload', async ({ page }) => {
    const project = uniqueName('Deeplink');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'Persisted');
    await openModelEditor(page, 'Persisted');

    expect(page.url()).toMatch(/\/model\//);

    await page.reload();
    await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
    await expect(page.getByText('Persisted').first()).toBeVisible();
  });

  test('auto-save persists a change without clicking Save', async ({ page }) => {
    const project = uniqueName('AutoSaver');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'AutoSaved');
    await openModelEditor(page, 'AutoSaved');

    // Enable auto-save, then draw a task — no Save click. The Carbon toggle's
    // visible switch lives in the label, which overlays the role=switch button.
    await page.locator('label[for="auto-save"]').click();
    await page.evaluate(() => {
      const m = (window as any).__E2E_BPMN__;
      const start = m.get('elementRegistry').get('StartEvent_1');
      const task = m.get('elementFactory').createShape({ type: 'bpmn:Task' });
      m.get('modeling').appendShape(start, task, { x: 350, y: 100 });
    });
    // With auto-save on, the change is saved and the Save button stays disabled.
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeDisabled();
    // Allow the fire-and-forget RTDB write to settle before reloading.
    await page.waitForTimeout(750);

    await page.reload();
    await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
    await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);
    const xml: string = await page.evaluate(async () => {
      const { xml } = await (window as any).__E2E_BPMN__.saveXML({ format: true });
      return xml;
    });
    expect(xml).toMatch(/bpmn:task/i);

    // The preference is persisted to localStorage.
    expect(await page.evaluate(() => localStorage.getItem('autoSave'))).toBe('true');
  });
});
