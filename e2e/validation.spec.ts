import {
  test,
  expect,
  uniqueName,
  createProject,
  openProject,
  addFolder,
  addBpmnModel,
  openRowMenu,
} from './fixtures';

/**
 * Validation guards — assert the app blocks invalid input. Each test runs as its
 * own isolated user (see ./fixtures).
 */
test.describe('Validation guards', () => {
  test('blocks an invalid model name', async ({ page }) => {
    const project = uniqueName('Validated');
    await createProject(page, project);
    await openProject(page, project);

    await page.getByRole('button', { name: /Add BPMN/i }).first().click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Add model' });

    await expect(submit).toBeDisabled(); // empty
    await dialog.getByLabel('Model name').fill('1 invalid');
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText(/must start with a letter or underscore/i)).toBeVisible();

    await dialog.getByLabel('Model name').fill('Valid Name');
    await expect(submit).toBeEnabled();
  });

  test('disables "Delete Folder" while the folder is not empty', async ({ page }) => {
    const project = uniqueName('Folders');
    await createProject(page, project);
    await openProject(page, project);

    // A non-empty folder: create it, open it, add a model inside, return to root.
    await addFolder(page, 'Full');
    await page.getByText('Full', { exact: true }).first().click();
    await addBpmnModel(page, 'Inside');
    // The up-navigation row is labelled ".. / <folder name>".
    await page.getByText(/\.\. \//).first().click();

    // An empty folder for the enabled contrast.
    await addFolder(page, 'Empty');

    await openRowMenu(page, 'Full');
    await expect(page.getByRole('menuitem', { name: 'Delete Folder' })).toBeDisabled();
    // Close the menu and blur the trigger so its "Options" tooltip stops
    // intercepting the next row's menu click.
    await page.getByRole('heading', { name: project }).click();

    await openRowMenu(page, 'Empty');
    await expect(page.getByRole('menuitem', { name: 'Delete Folder' })).toBeEnabled();
  });

  test('disables "Invite member" until a valid email is entered', async ({ page }) => {
    const project = uniqueName('Team');
    await createProject(page, project);
    await openProject(page, project);

    if (!(await page.getByLabel('Members').isVisible().catch(() => false))) {
      await page.locator('.open-members-panel-button').click();
    }
    await page.getByLabel('Members').getByRole('button', { name: /^Invite$/ }).click();

    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Invite member' });
    const email = dialog.getByLabel(/Email address/);

    await expect(submit).toBeDisabled();
    await email.fill('not-an-email');
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText('Please enter a valid email address')).toBeVisible();

    await email.fill('teammate@example.com');
    await expect(submit).toBeEnabled();
  });
});
