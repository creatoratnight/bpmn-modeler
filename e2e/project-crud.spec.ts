import { test, expect, uniqueName, createProject, openProject } from './fixtures';

/**
 * Authenticated CRUD flows against the Firebase emulators. Each test creates
 * its own uniquely-named project so they stay independent despite sharing one
 * emulator database and test user.
 */
test.describe('Project, folder and model management', () => {
  test('creates a project and lists it', async ({ page }) => {
    const name = uniqueName('Project');
    await createProject(page, name);

    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test('opens a project into the project view', async ({ page }) => {
    const name = uniqueName('Openable');
    await createProject(page, name);
    await openProject(page, name);

    // The project-view toolbar exposes the create actions.
    await expect(page.getByRole('button', { name: /Add Folder/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add DMN/i })).toBeVisible();
  });

  test('renames a project', async ({ page }) => {
    const name = uniqueName('Before');
    const renamed = uniqueName('After');
    await createProject(page, name);
    await openProject(page, name);

    // Open the project's overflow menu (scoped to the project heading, so we don't
    // hit the header user menu) and pick "Rename Project".
    await page.locator('.project-heading .cds--overflow-menu').click();
    await page.getByText('Rename Project', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Project name').fill(renamed);
    await dialog.getByRole('button', { name: 'Rename project' }).click();

    // The open project view keeps the old name until re-navigation, so verify the
    // rename persisted by returning to the project list.
    await page.goto('/');
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test('adds a folder to a project', async ({ page }) => {
    const project = uniqueName('WithFolder');
    const folder = uniqueName('Folder');
    await createProject(page, project);
    await openProject(page, project);

    await page.getByRole('button', { name: /Add Folder/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Folder name').fill(folder);
    await dialog.getByRole('button', { name: 'Add folder' }).click();

    // The folder name also appears as a hidden <option> in MoveModelModal's
    // always-rendered dropdown; the first match is the visible table row.
    await expect(page.getByText(folder, { exact: true }).first()).toBeVisible();
  });

  test('adds a BPMN model to a project', async ({ page }) => {
    const project = uniqueName('WithModel');
    // Model names must match /^[a-zA-Z_][\w-.\s]*$/ — start with a letter.
    const model = uniqueName('Process');
    await createProject(page, project);
    await openProject(page, project);

    await page.getByRole('button', { name: /Add BPMN/i }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model name').fill(model);
    await dialog.getByRole('button', { name: 'Add model' }).click();

    // The new model appears in the project's table without opening the editor.
    await expect(page.getByText(model, { exact: true })).toBeVisible();
  });
});
