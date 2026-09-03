import { test, expect, uniqueName, createProject, openProject, addBpmnModel, openModelEditor } from './fixtures';

/**
 * Regression test for issue #65 — "User context menu renders behind editor toolbar".
 *
 * The user overflow menu (the avatar dropdown in the header) opens downward into
 * the editor toolbar's row. The header had no stacking context, so the toolbar —
 * a positioned sibling rendered below it — painted over the open menu, hiding its
 * items. We assert the menu item is the topmost element at its own position,
 * which fails if the toolbar occludes it.
 */
test.describe('User menu', () => {
  test('the user menu opens above the editor toolbar (#65)', async ({ page }) => {
    const project = uniqueName('MenuProj');
    const model = uniqueName('MenuModel');

    await createProject(page, project);
    await openProject(page, project);
    await addBpmnModel(page, model);
    await openModelEditor(page, model); // editor view — the toolbar is present

    // Open the user overflow menu in the header.
    await page.locator('.header-user-signed-in .cds--overflow-menu').click();

    const item = page.locator('.cds--overflow-menu-options__btn', { hasText: 'Logout' });
    await expect(item).toBeVisible();

    // The item must be the topmost element at its own centre — i.e. not painted
    // behind the toolbar. elementFromPoint returns whatever is actually on top.
    const box = await item.boundingBox();
    expect(box, 'menu item has a bounding box').not.toBeNull();
    const onTop = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest('.cds--overflow-menu-options'));
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    expect(onTop, 'user menu item is on top, not occluded by the editor toolbar').toBe(true);
  });
});
