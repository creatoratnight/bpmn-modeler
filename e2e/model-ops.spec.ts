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
import type { Page } from '@playwright/test';

/**
 * Model operations and persistence. Each test runs as its own isolated user
 * (see ./fixtures), so assertions about which rows exist are absolute.
 */

/**
 * The XML a model is *stored* with. Asserting on this rather than on the canvas
 * keeps "was it saved?" separate from "what is on screen", which the live
 * collaboration document can also repaint.
 */
function storedXml(page: Page, modelId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const { getDatabase, ref, get } = (window as any).__E2E_DB__;
    return (await get(ref(getDatabase(), `modelXmlData/${id}/xmlData`))).val() ?? '';
  }, modelId);
}
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

  test('returns to the project view from the editor breadcrumb', async ({ page }) => {
    const project = uniqueName('Breadcrumb');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'SomeModel');
    await openModelEditor(page, 'SomeModel');

    // Click the project name in the top breadcrumb to leave the editor.
    await page.locator('.nav-project', { hasText: project }).click();

    // Back in the project view: the editor is gone and the models list is shown.
    await expect(page.locator('.bpmn-modeler')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add BPMN/i }).first()).toBeVisible();
    await expect(page.getByText('SomeModel', { exact: true }).first()).toBeVisible();
  });

  test('stays in the modeler when navigating folders via the side panel', async ({ page }) => {
    const project = uniqueName('SidePanelNav');
    await createProject(page, project);
    await openProject(page, project);
    await addFolder(page, 'Sub');
    await addBpmnModel(page, 'RootDoc');
    // Add a model inside the folder.
    await page.getByText('Sub', { exact: true }).first().click();
    await addBpmnModel(page, 'SubDoc');
    await page.getByText(/\.\. \//).first().click();

    // Open the root model, then open the side panel (closed by default).
    await openModelEditor(page, 'RootDoc');
    await page.getByRole('button', { name: 'Open project panel' }).click();
    await expect(page.locator('.nav-model')).toHaveText('RootDoc');

    // Click the folder in the side panel: stay in the editor, re-scope the panel,
    // and keep the same model open.
    await page.getByTitle('Sub', { exact: true }).click();
    await expect(page.locator('.bpmn-modeler')).toBeVisible();
    await expect(page.locator('.nav-model')).toHaveText('RootDoc');
    await expect(page.getByTitle('SubDoc', { exact: true })).toBeVisible();

    // Open the folder's model via the side panel: still in the editor, model switched.
    await page.getByTitle('SubDoc', { exact: true }).click();
    await expect(page.locator('.bpmn-modeler')).toBeVisible();
    await expect(page.locator('.nav-model')).toHaveText('SubDoc');
  });

  test('switching models from the side panel offers to save unsaved changes', async ({ page }) => {
    const project = uniqueName('UnsavedNav');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'FirstDoc');
    await addBpmnModel(page, 'SecondDoc');

    await openModelEditor(page, 'FirstDoc');
    await page.getByRole('button', { name: 'Open project panel' }).click();
    await expect(page.locator('.nav-model')).toHaveText('FirstDoc');

    // Make a change without saving, then switch models from the side panel. This
    // used to be refused outright with a toast; it now asks the same question as
    // leaving the editor from the top navigation.
    const addTask = () => page.evaluate(() => {
      const m = (window as any).__E2E_BPMN__;
      const start = m.get('elementRegistry').get('StartEvent_1');
      const task = m.get('elementFactory').createShape({ type: 'bpmn:Task' });
      m.get('modeling').appendShape(start, task, { x: 350, y: 100 });
    });
    const firstId = page.url().split('/model/')[1];
    await addTask();
    await page.getByTitle('SecondDoc', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Do you want to save your changes?')).toBeVisible();

    // Discarding opens the second model and leaves the first one as it was.
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.locator('.nav-model')).toHaveText('SecondDoc');
    expect(await storedXml(page, firstId), 'the discarded change was not saved').not.toMatch(/bpmn:task/i);

    // Saving from the modal persists the change and still navigates.
    const secondId = page.url().split('/model/')[1];
    await addTask();
    await page.getByTitle('FirstDoc', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.nav-model')).toHaveText('FirstDoc');
    await expect
      .poll(() => storedXml(page, secondId), { timeout: 10_000 })
      .toMatch(/bpmn:task/i);
  });

  test('an unsaved change does not come back after reopening the model', async ({ page }) => {
    const project = uniqueName('NoResurrect');
    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, 'Ephemeral');
    await openModelEditor(page, 'Ephemeral');
    const modelId = page.url().split('/model/')[1];

    const logSize = () => page.evaluate((id) => {
      const { getDatabase, ref, get } = (window as any).__E2E_DB__;
      return get(ref(getDatabase(), `sessions/${id}/ydoc/log`))
        .then((s: any) => (s.exists() ? Object.keys(s.val()).length : 0));
    }, modelId);

    const before = await logSize();
    await page.evaluate(() => {
      const m = (window as any).__E2E_BPMN__;
      const start = m.get('elementRegistry').get('StartEvent_1');
      const task = m.get('elementFactory').createShape({ type: 'bpmn:Task' });
      m.get('modeling').appendShape(start, task, { x: 350, y: 100 });
    });

    // The edit must actually reach the shared collaboration document, or this
    // test would pass for the wrong reason. Never saved, though: auto-save is off.
    await expect.poll(logSize, { timeout: 15_000 }).toBeGreaterThan(before);
    expect(await storedXml(page, modelId), 'the edit was never saved').not.toMatch(/bpmn:task/i);

    // Reopening alone must show the saved model. The shared document is live
    // session state, not storage: once everyone has left it is residue, and
    // adopting it would paint unsaved edits back over the saved model.
    await page.reload();
    await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
    await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);
    await page.waitForTimeout(2_000); // let the collaboration layer settle

    const xml: string = await page.evaluate(async () => {
      const { xml } = await (window as any).__E2E_BPMN__.saveXML({ format: true });
      return xml;
    });
    expect(xml, 'the unsaved task did not come back').not.toMatch(/bpmn:task/i);
    expect(await storedXml(page, modelId), 'and was not written to the model either')
      .not.toMatch(/bpmn:task/i);
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
