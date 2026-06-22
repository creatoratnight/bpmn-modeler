import {
  test,
  expect,
  uniqueName,
  createProject,
  openProject,
  addBpmnModel,
  openModelEditor,
} from './fixtures';

/**
 * Core authenticated user journeys that go beyond creation: deleting a project,
 * commenting, and milestone version history. Each test runs as its own user
 * (per-test isolation in ./fixtures), so assertions can be absolute.
 */
test.describe('Core flows', () => {
  test('deletes a project', async ({ page }) => {
    const name = uniqueName('ToDelete');
    await createProject(page, name);
    await openProject(page, name);

    await page.locator('.project-heading .cds--overflow-menu').click();
    await page.getByText('Delete Project', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

    // Deletion navigates home; the fresh user now has no projects.
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/No projects yet/i)).toBeVisible();
  });

  test('adds and deletes a comment', async ({ page }) => {
    const project = uniqueName('Commented');
    const model = uniqueName('Process');
    const comment = 'This step needs review';

    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, model);
    await openModelEditor(page, model);

    await page.getByRole('button', { name: 'Open comments panel' }).click();
    await page.getByRole('button', { name: 'Add Comment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Comment').fill(comment);
    await dialog.getByRole('button', { name: 'Save Comment' }).click();

    await expect(page.getByText(comment)).toBeVisible();

    // Own comments show a trash icon; deletion is immediate (no confirm).
    await page.getByTitle('Delete comment').click();
    await expect(page.getByText(comment)).toHaveCount(0);
    await expect(page.getByText('No comments yet.')).toBeVisible();
  });

  test('saves and deletes a milestone', async ({ page }) => {
    const project = uniqueName('Versioned');
    const model = uniqueName('Process');
    const milestone = uniqueName('v1');

    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, model);
    await openModelEditor(page, model);

    await page.getByRole('button', { name: /Milestones/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('New Milestone Name').fill(milestone);
    await dialog.getByRole('button', { name: 'Save Milestone' }).click();
    await expect(dialog.getByText(milestone, { exact: true })).toBeVisible();

    await dialog.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('No milestones saved yet.')).toBeVisible();
  });

  test('loads a milestone and backs up the current state', async ({ page }) => {
    const project = uniqueName('Loadable');
    const model = uniqueName('Process');
    const milestone = uniqueName('Checkpoint');

    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, model);
    await openModelEditor(page, model);

    // Save a milestone of the initial state.
    await page.getByRole('button', { name: /Milestones/i }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('New Milestone Name').fill(milestone);
    await dialog.getByRole('button', { name: 'Save Milestone' }).click();
    await expect(dialog.getByText(milestone, { exact: true })).toBeVisible();

    // Load it; the backup toggle defaults on, so loading saves the current state
    // as a new milestone named "State before loading '<name>'".
    await dialog.getByRole('button', { name: 'Load' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Load Milestone' }).click();

    // Reopen the dialog and confirm the auto-backup milestone was created.
    await page.getByRole('button', { name: /Milestones/i }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`State before loading '${milestone}'`, { exact: true })).toBeVisible();
  });
});
