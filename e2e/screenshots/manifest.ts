import { type Page, type Locator } from '@playwright/test';
import { signIn, createProject, openProject } from '../fixtures';

/**
 * A documentation screenshot definition.
 *
 * Each shot drives the real app (against the Firebase emulators) into a UI
 * state and is captured to `docs/assets/screenshots/<id>.png` by
 * `capture.shots.ts`. Docs reference the images relatively:
 *   - Markdown (`docs/<area>.md`):   `![alt](assets/screenshots/<id>.png)`
 *   - HTML     (`docs/html/<area>.html`): `<img src="../assets/screenshots/<id>.png" alt="...">`
 *
 * Shots run serially against a database that is fresh each run, so fixed names
 * are stable. Use a DISTINCT project/model name per shot — they share one
 * database and one user, so reused names would make `getByText` ambiguous.
 * Keep `projects-list` before the shots that create extra projects so the list
 * it captures stays clean.
 */
export type Shot = {
  /** File name (without extension) and Playwright test title. */
  id: string;
  /** Human-readable caption — reuse as the image alt text in the docs. */
  title: string;
  /** Capture the full scrollable page instead of just the viewport. */
  fullPage?: boolean;
  /**
   * Drive the app into the desired state. Call `signIn(page)` for any
   * authenticated screen. Return a Locator to clip the screenshot to that
   * element (e.g. a modal dialog); return nothing to capture the page.
   */
  setup: (page: Page) => Promise<Locator | void>;
};

/** Create a BPMN model in the open project and wait for its row. */
async function addBpmnModel(page: Page, name: string) {
  await page.getByRole('button', { name: /Add BPMN/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Model name').fill(name);
  await dialog.getByRole('button', { name: 'Add model' }).click();
  await page.getByText(name, { exact: true }).first().waitFor();
}

/** Create a folder in the open project and wait for its row. */
async function addFolder(page: Page, name: string) {
  await page.getByRole('button', { name: /Add Folder/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Folder name').fill(name);
  await dialog.getByRole('button', { name: 'Add folder' }).click();
  await page.getByText(name, { exact: true }).first().waitFor();
}

/** Open a model row in the editor and wait for the bpmn-js canvas. */
async function openEditor(page: Page, modelName: string) {
  await page.getByText(modelName, { exact: true }).first().click();
  await page.locator('.bpmn-modeler .djs-container').waitFor();
  await page.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);
}

/** Append a task to the start event so the editor shows a small diagram. */
async function drawTask(page: Page) {
  await page.evaluate(() => {
    const m = (window as any).__E2E_BPMN__;
    const start = m.get('elementRegistry').get('StartEvent_1');
    const task = m.get('elementFactory').createShape({ type: 'bpmn:Task' });
    m.get('modeling').appendShape(start, task, { x: 350, y: 100 });
  });
}

export const shots: Shot[] = [
  // §1 Getting started
  {
    id: 'sign-in',
    title: 'Sign-in screen with Google and Microsoft options',
    setup: async (page) => {
      await page.goto('/');
    },
  },

  // §2 Projects
  {
    id: 'projects-list',
    title: 'The "Your Projects" view',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Example Project');
    },
  },
  {
    id: 'add-project-modal',
    title: 'The Add Project dialog',
    setup: async (page) => {
      await signIn(page);
      await page.getByRole('button', { name: /Add Project/i }).first().click();
      return page.getByRole('dialog');
    },
  },

  // §3–4 Folders & models — a project containing a folder and a model
  {
    id: 'project-view',
    title: 'A project with a folder and a model',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Sales');
      await openProject(page, 'Sales');
      await addFolder(page, 'Archive');
      await addBpmnModel(page, 'Lead Intake');
    },
  },
  {
    id: 'add-model-modal',
    title: 'The Add model dialog',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'New Models');
      await openProject(page, 'New Models');
      await page.getByRole('button', { name: /Add BPMN/i }).first().click();
      return page.getByRole('dialog');
    },
  },

  // §5 The editor
  {
    id: 'bpmn-editor',
    title: 'The BPMN editor with a simple diagram',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Demo');
      await openProject(page, 'Demo');
      await addBpmnModel(page, 'Order Process');
      await openEditor(page, 'Order Process');
      await drawTask(page);
    },
  },

  // §7 Milestones
  {
    id: 'milestones-modal',
    title: 'The Milestones (version history) dialog',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Milestones Demo');
      await openProject(page, 'Milestones Demo');
      await addBpmnModel(page, 'Reviewed Process');
      await openEditor(page, 'Reviewed Process');
      await page.getByRole('button', { name: /Milestones/i }).click();
      return page.getByRole('dialog');
    },
  },

  // §8 Comments
  {
    id: 'comments-panel',
    title: 'The comments panel open in the editor',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Comments Demo');
      await openProject(page, 'Comments Demo');
      await addBpmnModel(page, 'Discussed Process');
      await openEditor(page, 'Discussed Process');
      await page.getByRole('button', { name: 'Open comments panel' }).click();
      // The panel animates open (width transition); wait until its content is visible.
      await page.getByRole('button', { name: 'Add Comment' }).waitFor();
    },
  },

  // §9 Team collaboration
  {
    id: 'invite-modal',
    title: 'The Invite Member dialog',
    setup: async (page) => {
      await signIn(page);
      await createProject(page, 'Team Project');
      await openProject(page, 'Team Project');
      // Open the Members panel if collapsed, then click its (scoped) Invite button.
      if (!(await page.getByLabel('Members').isVisible().catch(() => false))) {
        await page.locator('.open-members-panel-button').click();
      }
      await page.getByLabel('Members').getByRole('button', { name: /^Invite$/ }).click();
      return page.getByRole('dialog');
    },
  },
];
