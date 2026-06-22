import { test, expect, uniqueName, createProject, openProject } from './fixtures';

/**
 * Exercises the BPMN editor end to end: create a model, draw a simple diagram
 * (append a task to the start event, which also adds a sequence flow), save it,
 * and confirm the change persisted by reloading and re-reading the saved XML.
 *
 * Drawing is done through the bpmn-js modeling API (exposed on
 * window.__E2E_BPMN__ in e2e mode) rather than palette drag-and-drop, which is
 * unreliable to simulate. The save and persistence paths are the real ones.
 */
test.describe('BPMN editor', () => {
  test('draws a task and saves it', async ({ page }) => {
    const project = uniqueName('EditorProj');
    const model = uniqueName('Diagram');

    await createProject(page, project);
    await openProject(page, project);

    // Create a BPMN model, then open it in the editor.
    await page.getByRole('button', { name: /Add BPMN/i }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model name').fill(model);
    await dialog.getByRole('button', { name: 'Add model' }).click();
    await page.getByText(model, { exact: true }).first().click();

    // Wait for the bpmn-js canvas and the ready modeler hook.
    await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
    await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);

    // Draw: append a Task to the existing StartEvent. appendShape also creates a
    // connecting sequence flow, so this produces a small but complete diagram.
    await page.evaluate(() => {
      const modeler = (window as any).__E2E_BPMN__;
      const elementRegistry = modeler.get('elementRegistry');
      const modeling = modeler.get('modeling');
      const elementFactory = modeler.get('elementFactory');
      const start = elementRegistry.get('StartEvent_1');
      const task = elementFactory.createShape({ type: 'bpmn:Task' });
      modeling.appendShape(start, task, { x: 350, y: 100 });
    });

    // The diagram change enables the Save button; save the model.
    const save = page.getByRole('button', { name: /^Save$/ });
    await expect(save).toBeEnabled();
    await save.click();

    // Reload the editor URL and confirm the task is in the persisted XML.
    await page.reload();
    await expect(page.locator('.bpmn-modeler .djs-container')).toBeVisible();
    await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);

    const savedXml: string = await page.evaluate(async () => {
      const modeler = (window as any).__E2E_BPMN__;
      const { xml } = await modeler.saveXML({ format: true });
      return xml;
    });

    expect(savedXml).toMatch(/bpmn:task/i);
  });
});
