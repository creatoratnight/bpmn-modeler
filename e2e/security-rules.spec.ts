import { test, expect, type Page } from '@playwright/test';
import {
    signIn,
    createProject,
    openProject,
    addBpmnModel,
    openModelEditor,
    uniqueName,
    type TestUser,
} from './fixtures';

/**
 * What the Realtime Database security rules actually deny.
 *
 * The rest of the suite proves the app still works; this spec proves the rules
 * bite. Every attempt runs through `window.__E2E_DB__` — the app's own database
 * connection — so these are real client reads and writes against the real rules,
 * not a simulation.
 *
 * The second test walks the whole invitation path, which is the only way to gain
 * access to someone else's project and therefore the one flow where a mistake in
 * the rules is worth the most.
 */

interface Attempt {
    ok: boolean;
    exists?: boolean;
    code?: string;
}

/** Read a path as this page's signed-in user; reports whether the rules allowed it. */
function readPath(page: Page, path: string): Promise<Attempt> {
    return page.evaluate(async (p) => {
        const { getDatabase, ref, get } = (window as any).__E2E_DB__;
        try {
            const snapshot = await get(ref(getDatabase(), p));
            return { ok: true, exists: snapshot.exists() };
        } catch (err: any) {
            return { ok: false, code: String(err?.code ?? err?.message ?? err) };
        }
    }, path);
}

/** Write a value to a path as this page's signed-in user. */
function writePath(page: Page, path: string, value: unknown): Promise<Attempt> {
    return page.evaluate(async ({ p, v }) => {
        const { getDatabase, ref, set } = (window as any).__E2E_DB__;
        try {
            await set(ref(getDatabase(), p), v);
            return { ok: true };
        } catch (err: any) {
            return { ok: false, code: String(err?.code ?? err?.message ?? err) };
        }
    }, { p: path, v: value });
}

/** Run an equality query over a collection, the shape the rules authorise by. */
function queryCollection(page: Page, path: string, child: string, value: string): Promise<Attempt> {
    return page.evaluate(async ({ p, c, v }) => {
        const { getDatabase, ref, get, query, orderByChild, equalTo } = (window as any).__E2E_DB__;
        try {
            const snapshot = await get(query(ref(getDatabase(), p), orderByChild(c), equalTo(v)));
            return { ok: true, exists: snapshot.exists() };
        } catch (err: any) {
            return { ok: false, code: String(err?.code ?? err?.message ?? err) };
        }
    }, { p: path, c: child, v: value });
}

function uid(page: Page): Promise<string> {
    return page.evaluate(() => (window as any).__E2E_AUTH__.auth.currentUser.uid);
}

/** A project with one model, owned by `page`'s user. */
async function seedProject(page: Page): Promise<{ projectId: string; modelId: string }> {
    const projectName = uniqueName('Private Project');
    const modelName = uniqueName('Private Model');
    await createProject(page, projectName);
    await openProject(page, projectName);
    await addBpmnModel(page, modelName);
    await openModelEditor(page, modelName);

    const modelId = page.url().split('/model/')[1];
    const projectId = await page.evaluate(async (mid) => {
        const { getDatabase, ref, get } = (window as any).__E2E_DB__;
        return (await get(ref(getDatabase(), `bpmnModels/${mid}/projectId`))).val();
    }, modelId);
    return { projectId, modelId };
}

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('a signed-in outsider cannot reach another user\'s project data', async ({ page, browser }) => {
    test.setTimeout(90_000);

    // The owner: a project with one model.
    const owner: TestUser = { email: `owner-${stamp()}@example.com`, password: 'test-password-123' };
    await signIn(page, owner);
    const { projectId, modelId } = await seedProject(page);
    const ownerUid = await uid(page);

    // The outsider: a perfectly valid account with no relationship to any of it.
    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    try {
        const outsiderUser: TestUser = { email: `outsider-${stamp()}@example.com`, password: 'test-password-123' };
        await signIn(outsider, outsiderUser);
        const outsiderUid = await uid(outsider);

        // --- reads ------------------------------------------------------------
        for (const path of [
            `projects/${projectId}`,
            `bpmnModels/${modelId}`,
            `modelXmlData/${modelId}`,
            `milestones/${modelId}`,
            `comments/${modelId}`,
            `sessions/${modelId}`,
        ]) {
            expect((await readPath(outsider, path)).ok, `read of ${path} is denied`).toBe(false);
        }

        // Collections cannot be listed, and a query may not be aimed at a project
        // the caller does not belong to or at someone else's address.
        for (const path of ['projects', 'bpmnModels', 'modelXmlData', 'invitations', 'users']) {
            expect((await readPath(outsider, path)).ok, `listing ${path} is denied`).toBe(false);
        }
        expect((await queryCollection(outsider, 'bpmnModels', 'projectId', projectId)).ok,
            'querying the models of someone else\'s project is denied').toBe(false);
        expect((await queryCollection(outsider, 'invitations', 'projectId', projectId)).ok,
            'querying someone else\'s project invitations is denied').toBe(false);
        expect((await queryCollection(outsider, 'invitations', 'invitedEmail', owner.email)).ok,
            'querying someone else\'s invitations is denied').toBe(false);

        // Your own invitations are readable — that is how the invite list works.
        expect((await queryCollection(outsider, 'invitations', 'invitedEmail', outsiderUser.email)).ok,
            'your own invitations are readable').toBe(true);

        // --- writes -----------------------------------------------------------
        expect((await writePath(outsider, `bpmnModels/${modelId}/name`, 'Hijacked')).ok,
            'renaming someone else\'s model is denied').toBe(false);
        expect((await writePath(outsider, `modelXmlData/${modelId}/xmlData`, '<nonsense/>')).ok,
            'overwriting someone else\'s model XML is denied').toBe(false);
        expect((await writePath(outsider, `bpmnModels/${modelId}`, null)).ok,
            'deleting someone else\'s model is denied').toBe(false);
        expect((await writePath(outsider, `projects/${projectId}/name`, 'Hijacked')).ok,
            'renaming someone else\'s project is denied').toBe(false);

        // The one that matters most: joining a project uninvited.
        expect((await writePath(outsider, `projects/${projectId}/members/${outsiderUid}`, 'editor')).ok,
            'adding yourself to a project without an invitation is denied').toBe(false);
        // ...including by forging the index entry that lists it.
        expect((await writePath(outsider, `users/${ownerUid}/projects/${projectId}`, null)).ok,
            'writing another user\'s project index is denied').toBe(false);

        // An invitation may only be created by a member of the project it is for.
        expect((await writePath(outsider, `invitations/${projectId}_forged@example,com`, {
            projectId, invitedEmail: 'forged@example.com', senderId: outsiderUid, status: 'Pending',
        })).ok, 'inviting yourself to someone else\'s project is denied').toBe(false);

        // The owner is unaffected throughout.
        expect((await readPath(page, `modelXmlData/${modelId}`)).ok, 'the owner still reads their own model').toBe(true);
    } finally {
        await outsiderContext.close();
    }
});

test('an invitation grants access, and only after it is accepted', async ({ page, browser }) => {
    test.setTimeout(120_000);

    const owner: TestUser = { email: `inviter-${stamp()}@example.com`, password: 'test-password-123' };
    await signIn(page, owner);
    const projectName = uniqueName('Shared Project');
    const modelName = uniqueName('Shared Model');
    await createProject(page, projectName);
    await openProject(page, projectName);
    await addBpmnModel(page, modelName);
    await openModelEditor(page, modelName);
    const modelId = page.url().split('/model/')[1];
    const projectId = await page.evaluate(async (mid) => {
        const { getDatabase, ref, get } = (window as any).__E2E_DB__;
        return (await get(ref(getDatabase(), `bpmnModels/${mid}/projectId`))).val();
    }, modelId);

    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    try {
        const inviteeUser: TestUser = { email: `invitee-${stamp()}@example.com`, password: 'test-password-123' };
        await signIn(invitee, inviteeUser);

        // Before the invitation: no access.
        expect((await readPath(invitee, `bpmnModels/${modelId}`)).ok, 'no access before the invitation').toBe(false);

        // The owner invites them through the UI (we are in the editor at this point).
        await page.goto('/');
        await openProject(page, projectName);
        if (!(await page.getByLabel('Members').isVisible().catch(() => false))) {
            await page.locator('.open-members-panel-button').click();
        }
        await page.getByLabel('Members').getByRole('button', { name: /^Invite$/ }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/Email address/i).fill(inviteeUser.email);
        await dialog.getByRole('button', { name: 'Invite member' }).click();
        await expect(dialog).toHaveCount(0);

        // A pending invitation lets the invitee see the project's *name* — the
        // invite has to say what it is for — but nothing else about the project.
        await expect
            .poll(() => readPath(invitee, `projects/${projectId}/name`).then((r) => r.ok), { timeout: 10_000 })
            .toBe(true);
        expect((await readPath(invitee, `projects/${projectId}`)).ok,
            'a pending invitation does not open the project itself').toBe(false);
        expect((await readPath(invitee, `bpmnModels/${modelId}`)).ok,
            'a pending invitation does not open the project\'s models').toBe(false);

        // Accepting it through the UI is what grants access.
        await invitee.reload();
        await invitee.getByRole('button', { name: /Accept Invite/i }).click();
        await expect(invitee.getByText(projectName, { exact: true })).toBeVisible({ timeout: 15_000 });

        expect((await readPath(invitee, `projects/${projectId}`)).ok, 'the project opens up').toBe(true);
        expect((await readPath(invitee, `bpmnModels/${modelId}`)).ok, 'the models open up').toBe(true);
        expect((await readPath(invitee, `modelXmlData/${modelId}`)).ok, 'the model XML opens up').toBe(true);
    } finally {
        await inviteeContext.close();
    }
});
