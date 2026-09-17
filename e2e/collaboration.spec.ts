import { test, expect, chromium, type Page } from '@playwright/test';
import {
    signIn,
    createProject,
    openProject,
    addBpmnModel,
    openModelEditor,
    uniqueName,
    type TestUser,
} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Two-client real-time collaboration test against the local Firebase emulators.
 *
 * Two users (each in their own headed browser window, side by side so you can
 * watch) open the *same* BPMN model. The first test has one build a large model
 * while the other watches it sync live; the second has both edit at the same
 * time and checks that the shared Yjs document *merges* their changes rather than
 * letting one overwrite the other. Throughout, we meter the Realtime Database
 * WebSocket on each client — bytes received is the billable egress — and break
 * the totals down by phase, so the steady-state cost of editing a *large* model
 * over the collaboration channel is isolated from one-off startup traffic.
 *
 * Run with `npm run test:collab`. Set HEADLESS=1 to run without the windows.
 * A visual report is written to e2e/.collab-report/index.html.
 */

const HEADLESS = process.env.HEADLESS === '1';
const BASE_URL = 'http://localhost:5174';

// Model-size knobs. GROW_BATCHES * GROW_BATCH_SIZE tasks are created (each with
// a name + a sequence flow), which produces a genuinely large diagram.
const GROW_BATCHES = Number(process.env.GROW_BATCHES ?? 10);
const GROW_BATCH_SIZE = Number(process.env.GROW_BATCH_SIZE ?? 15);
const STEADY_EDITS = Number(process.env.STEADY_EDITS ?? 20); // edits on the *finished* large model

// ---------------------------------------------------------------------------
// Byte metering: sum the payload of every WebSocket frame to/from the database
// emulator (port 9000). `recv` is what Firebase bills as egress.
// ---------------------------------------------------------------------------

interface Meter { sent: number; recv: number }

function byteLength(payload: string | Buffer): number {
    return typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.length;
}

function attachMeter(page: Page): Meter {
    const meter: Meter = { sent: 0, recv: 0 };
    page.on('websocket', (ws) => {
        if (!ws.url().includes(':9000')) return; // database emulator only
        ws.on('framesent', (f) => { meter.sent += byteLength(f.payload); });
        ws.on('framereceived', (f) => { meter.recv += byteLength(f.payload); });
    });
    return meter;
}

interface Snapshot { aSent: number; aRecv: number; bSent: number; bRecv: number }
function snap(a: Meter, b: Meter): Snapshot {
    return { aSent: a.sent, aRecv: a.recv, bSent: b.sent, bRecv: b.recv };
}
/** recv-only delta between two snapshots, summed over both clients (billable egress). */
function recvDelta(from: Snapshot, to: Snapshot): number {
    return (to.aRecv - from.aRecv) + (to.bRecv - from.bRecv);
}

// ---------------------------------------------------------------------------
// Page-side helpers (run inside the browser via the __E2E_* hooks).
// ---------------------------------------------------------------------------

function getUid(page: Page): Promise<string> {
    return page.evaluate(() => (window as any).__E2E_AUTH__.auth.currentUser.uid);
}

function elementCount(page: Page): Promise<number> {
    return page.evaluate(() => (window as any).__E2E_BPMN__.get('elementRegistry').getAll().length);
}

/** Create `count` named tasks (chained with sequence flows) starting at index. Returns total element count. */
function addTasks(page: Page, count: number, startIndex: number): Promise<number> {
    return page.evaluate(({ count, startIndex }) => {
        const m = (window as any).__E2E_BPMN__;
        const modeling = m.get('modeling');
        const factory = m.get('elementFactory');
        const canvas = m.get('canvas');
        const registry = m.get('elementRegistry');
        const root = canvas.getRootElement();
        let last = (window as any).__collabLast__ || null;

        if (startIndex === 0 && !last) {
            const start = factory.createShape({ type: 'bpmn:StartEvent' });
            modeling.createShape(start, { x: 120, y: 160 }, root);
            last = start;
        }
        for (let k = 0; k < count; k++) {
            const i = startIndex + k;
            const x = 280 + (i % 10) * 150;
            const y = 160 + Math.floor(i / 10) * 130;
            const task = factory.createShape({ type: 'bpmn:Task' });
            modeling.createShape(task, { x, y }, root);
            modeling.updateProperties(task, {
                name: `Collaborative task ${i + 1} — lorem ipsum dolor sit amet consectetur`,
            });
            if (last) { try { modeling.connect(last, task); } catch { /* skip */ } }
            last = task;
        }
        (window as any).__collabLast__ = last;
        return registry.getAll().length;
    }, { count, startIndex });
}

/** Nudge one existing task, producing a single edit that broadcasts the whole document. */
function nudgeShape(page: Page, i: number): Promise<void> {
    return page.evaluate((i) => {
        const m = (window as any).__E2E_BPMN__;
        const modeling = m.get('modeling');
        const tasks = m.get('elementRegistry').getAll().filter((el: any) => el.type === 'bpmn:Task');
        const t = tasks[i % tasks.length];
        if (t) modeling.moveShape(t, { x: i % 2 === 0 ? 12 : -12, y: 6 }, t.parent);
    }, i);
}

function currentXml(page: Page): Promise<string> {
    return page.evaluate(async () => (await (window as any).__E2E_BPMN__.saveXML({ format: true })).xml);
}

/** Create a single named task at (x, y) on the root. Returns its element id. */
function addNamedTask(page: Page, name: string, x: number, y: number): Promise<string> {
    return page.evaluate(({ name, x, y }) => {
        const m = (window as any).__E2E_BPMN__;
        const modeling = m.get('modeling');
        const factory = m.get('elementFactory');
        const root = m.get('canvas').getRootElement();
        const task = factory.createShape({ type: 'bpmn:Task' });
        modeling.createShape(task, { x, y }, root);
        modeling.updateProperties(task, { name });
        return task.id;
    }, { name, x, y });
}

/** Rename an existing element by id. */
function renameElement(page: Page, id: string, name: string): Promise<void> {
    return page.evaluate(({ id, name }) => {
        const m = (window as any).__E2E_BPMN__;
        m.get('modeling').updateProperties(m.get('elementRegistry').get(id), { name });
    }, { id, name });
}

/** All task names currently in the diagram, sorted (order-independent compare). */
function taskNames(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as any).__E2E_BPMN__.get('elementRegistry').getAll()
        .filter((el: any) => el.type === 'bpmn:Task')
        .map((el: any) => el.businessObject?.name ?? '')
        .sort());
}

/** The businessObject name of one element by id. */
function nameOf(page: Page, id: string): Promise<string> {
    return page.evaluate((id) => {
        const el = (window as any).__E2E_BPMN__.get('elementRegistry').get(id);
        return el?.businessObject?.name ?? '';
    }, id);
}

// ---------------------------------------------------------------------------

test('two users collaborate on a large model, within a data budget', async () => {
    test.setTimeout(300_000);
    const t0 = Date.now();

    const launchArgs = (x: number) => ({
        headless: HEADLESS,
        args: [`--window-position=${x},0`, '--window-size=955,940'],
    });
    const browserA = await chromium.launch(launchArgs(0));
    const browserB = await chromium.launch(launchArgs(965));
    const ctxA = await browserA.newContext({ baseURL: BASE_URL, viewport: { width: 935, height: 840 } });
    const ctxB = await browserB.newContext({ baseURL: BASE_URL, viewport: { width: 935, height: 840 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const meterA = attachMeter(pageA);
    const meterB = attachMeter(pageB);

    // Time series for the chart.
    const samples: Array<{ t: number; aR: number; aS: number; bR: number; bS: number }> = [];
    const sampler = setInterval(() => {
        samples.push({ t: Date.now() - t0, aR: meterA.recv, aS: meterA.sent, bR: meterB.recv, bS: meterB.sent });
    }, 250);
    const marks: Array<{ t: number; label: string }> = [];
    const mark = (label: string) => marks.push({ t: Date.now() - t0, label });

    try {
        const alice: TestUser = { email: 'alice@example.com', password: 'test-password-123' };
        const bob: TestUser = { email: 'bob@example.com', password: 'test-password-123' };

        // --- setup: sign in, A creates project + model, B is made a member ---
        mark('setup');
        await signIn(pageA, alice);
        await signIn(pageB, bob);
        const uidB = await getUid(pageB);

        const projectName = uniqueName('Collab Project');
        const modelName = uniqueName('Collab Model');
        await createProject(pageA, projectName);
        await openProject(pageA, projectName);
        await addBpmnModel(pageA, modelName);
        await openModelEditor(pageA, modelName);

        const modelId = pageA.url().split('/model/')[1];
        expect(modelId, 'model id parsed from URL').toBeTruthy();
        const projectId = await pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `bpmnModels/${mid}/projectId`)).then((s: any) => s.val());
        }, modelId);

        // A (owner) grants B membership; B adds the project to its own index and
        // registers a user node. This is the same data the invite/accept flow writes.
        await pageA.evaluate(({ projectId, uidB }) => {
            const { getDatabase, ref, set } = (window as any).__E2E_DB__;
            return set(ref(getDatabase(), `projects/${projectId}/members/${uidB}`), 'editor');
        }, { projectId, uidB });
        await pageB.evaluate(({ uidB, projectId }) => {
            const { getDatabase, ref, set, update } = (window as any).__E2E_DB__;
            const db = getDatabase();
            return Promise.all([
                set(ref(db, `users/${uidB}/projects/${projectId}`), true),
                update(ref(db, `users/${uidB}`), { email: 'bob@example.com', displayName: 'Bob' }),
            ]);
        }, { uidB, projectId });

        // B reloads to pick up its new membership, then opens the same model.
        await pageB.reload();
        await pageB.waitForFunction(() => (window as any).__E2E_AUTH__?.auth?.currentUser != null);
        await pageB.goto(`/project/${encodeURIComponent(projectName)}/model/${modelId}`);
        await expect(pageB.locator('.bpmn-modeler .djs-container')).toBeVisible({ timeout: 30_000 });
        await pageB.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);

        // Both are in the editor: presence should show the other person.
        await expect(pageA.locator('.collab-presence-bar')).toBeVisible({ timeout: 15_000 });
        await expect(pageB.locator('.collab-presence-bar')).toBeVisible({ timeout: 15_000 });
        const presenceCount = await pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `sessions/${mid}/presence`)).then((s: any) => (s.exists() ? Object.keys(s.val()).length : 0));
        }, modelId);
        expect(presenceCount, 'both users present in session').toBe(2);
        const afterSetup = snap(meterA, meterB);

        // --- grow: A builds a large model in batches; B must converge live ---
        mark('grow');
        let total = 0;
        for (let b = 0; b < GROW_BATCHES; b++) {
            total = await addTasks(pageA, GROW_BATCH_SIZE, b * GROW_BATCH_SIZE);
            await pageA.waitForTimeout(500);
        }
        // A must have published to the shared Yjs document (log and/or state).
        await expect.poll(() => pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `sessions/${mid}/ydoc`)).then((s: any) => (s.exists() ? Object.keys(s.val()).length : 0));
        }, modelId), { timeout: 15_000 }).toBeGreaterThan(0);

        // B must converge to A's full model, live over the collaboration channel.
        await pageB.waitForFunction((n) => (window as any).__E2E_BPMN__.get('elementRegistry').getAll().length >= n, total, { timeout: 40_000 });
        const afterGrow = snap(meterA, meterB);

        // --- steady: edit the finished large model; each edit ships the full doc ---
        // Space edits above the broadcast debounce so each produces its own sync —
        // this measures the *worst case* (deliberate edits), not coalesced bursts.
        mark('steady-edit');
        for (let e = 0; e < STEADY_EDITS; e++) {
            await nudgeShape(pageA, e);
            await pageA.waitForTimeout(1000);
        }
        await pageA.waitForTimeout(1500);
        const afterSteady = snap(meterA, meterB);

        // --- cursors: measure the (Phase 1) cursor channel on its own ---
        mark('cursors');
        const box = await pageA.locator('.bpmn-modeler .djs-container').boundingBox();
        if (box) {
            for (let i = 0; i < 40; i++) {
                await pageA.mouse.move(box.x + 120 + i * 8, box.y + 160 + (i % 6) * 22);
                await pageA.waitForTimeout(60);
            }
        }
        await pageA.waitForTimeout(800);
        const afterCursors = snap(meterA, meterB);
        mark('end');

        // --- assertions: functionality + convergence + a runaway-cost guard ---
        const [countA, countB] = await Promise.all([elementCount(pageA), elementCount(pageB)]);
        expect(countB, 'B converged to the same element count as A').toBe(countA);
        expect(countA, 'a genuinely large model was built').toBeGreaterThan(GROW_BATCHES * GROW_BATCH_SIZE);

        const xml = await currentXml(pageA);
        const modelBytes = Buffer.byteLength(xml, 'utf8');

        const steadyRecv = recvDelta(afterGrow, afterSteady);
        const steadyPerEdit = steadyRecv / STEADY_EDITS;
        // Cost-regression guard. Each edit ships a small binary Yjs update whose
        // size tracks the edit, not the model, so per-edit egress stays small and
        // ~independent of model size. A regression to full-document sync would push
        // this toward the compressed model size and grow with the model, so this
        // budget catches it — and stays valid as the test model grows, precisely
        // because Yjs updates do not scale with model size. Deliberately generous
        // to avoid CI flakiness (and it absorbs the small own-update echo of the
        // shared log).
        const PER_EDIT_EGRESS_BUDGET = 6 * 1024;
        expect(steadyPerEdit, 'per-edit egress within the Yjs update budget (cost-regression guard)')
            .toBeLessThan(PER_EDIT_EGRESS_BUDGET);
        // Sanity floor: guard against the meter silently measuring nothing.
        expect(steadyPerEdit, 'per-edit egress is actually being measured').toBeGreaterThan(0);

        // --- report ---
        writeReport({
            durationMs: Date.now() - t0,
            modelBytes,
            elements: countA,
            phases: {
                setup: recvDelta({ aSent: 0, aRecv: 0, bSent: 0, bRecv: 0 }, afterSetup),
                grow: recvDelta(afterSetup, afterGrow),
                steady: steadyRecv,
                cursors: recvDelta(afterSteady, afterCursors),
            },
            totals: afterCursors,
            steadyEdits: STEADY_EDITS,
            steadyPerEdit,
            samples,
            marks,
        });
    } finally {
        clearInterval(sampler);
        await ctxA.close().catch(() => {});
        await ctxB.close().catch(() => {});
        await browserA.close().catch(() => {});
        await browserB.close().catch(() => {});
    }
});

// ---------------------------------------------------------------------------
// Two-client setup shared by the concurrent-edit test: sign both users in, have
// A create a project + model, make B a member, and open the same model in both.
// ---------------------------------------------------------------------------

interface TwoClients {
    pageA: Page;
    pageB: Page;
    modelId: string;
    cleanup: () => Promise<void>;
}

interface TwoClientOptions {
    /**
     * Runs against both pages before anything navigates — the only point where
     * `addInitScript` still reaches the app's first load, and where a byte meter
     * still catches the database WebSocket being opened.
     */
    beforeLoad?: (pageA: Page, pageB: Page) => Promise<void>;
}

async function openTwoClients(options: TwoClientOptions = {}): Promise<TwoClients> {
    const browserA = await chromium.launch({ headless: HEADLESS });
    const browserB = await chromium.launch({ headless: HEADLESS });
    const ctxA = await browserA.newContext({ baseURL: BASE_URL });
    const ctxB = await browserB.newContext({ baseURL: BASE_URL });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    if (process.env.COLLAB_DEBUG) {
        pageA.on('console', (m) => console.log(`[A:${m.type()}] ${m.text()}`));
        pageB.on('console', (m) => console.log(`[B:${m.type()}] ${m.text()}`));
        pageA.on('pageerror', (e) => console.log(`[A:pageerror] ${e.message}`));
        pageB.on('pageerror', (e) => console.log(`[B:pageerror] ${e.message}`));
    }

    const cleanup = async () => {
        await ctxA.close().catch(() => {});
        await ctxB.close().catch(() => {});
        await browserA.close().catch(() => {});
        await browserB.close().catch(() => {});
    };

    try {
        await options.beforeLoad?.(pageA, pageB);

        const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const alice: TestUser = { email: `alice-${stamp}@example.com`, password: 'test-password-123' };
        const bob: TestUser = { email: `bob-${stamp}@example.com`, password: 'test-password-123' };

        await signIn(pageA, alice);
        await signIn(pageB, bob);
        const uidB = await getUid(pageB);

        const projectName = uniqueName('Concurrent Project');
        const modelName = uniqueName('Concurrent Model');
        await createProject(pageA, projectName);
        await openProject(pageA, projectName);
        await addBpmnModel(pageA, modelName);
        await openModelEditor(pageA, modelName);

        const modelId = pageA.url().split('/model/')[1];
        const projectId = await pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `bpmnModels/${mid}/projectId`)).then((s: any) => s.val());
        }, modelId);

        await pageA.evaluate(({ projectId, uidB }) => {
            const { getDatabase, ref, set } = (window as any).__E2E_DB__;
            return set(ref(getDatabase(), `projects/${projectId}/members/${uidB}`), 'editor');
        }, { projectId, uidB });
        await pageB.evaluate(({ uidB, projectId }) => {
            const { getDatabase, ref, set, update } = (window as any).__E2E_DB__;
            const db = getDatabase();
            return Promise.all([
                set(ref(db, `users/${uidB}/projects/${projectId}`), true),
                update(ref(db, `users/${uidB}`), { email: 'bob@example.com', displayName: 'Bob' }),
            ]);
        }, { uidB, projectId });

        await pageB.reload();
        await pageB.waitForFunction(() => (window as any).__E2E_AUTH__?.auth?.currentUser != null);
        await pageB.goto(`/project/${encodeURIComponent(projectName)}/model/${modelId}`);
        await expect(pageB.locator('.bpmn-modeler .djs-container')).toBeVisible({ timeout: 30_000 });
        await pageB.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined);

        // Both present before we start editing.
        await expect(pageA.locator('.collab-presence-bar')).toBeVisible({ timeout: 15_000 });
        await expect(pageB.locator('.collab-presence-bar')).toBeVisible({ timeout: 15_000 });

        return { pageA, pageB, modelId, cleanup };
    } catch (err) {
        await cleanup();
        throw err;
    }
}

test('full geometry stays identical after a burst of peer edits on a chain', async () => {
    test.setTimeout(150_000);
    const { pageA, pageB, cleanup } = await openTwoClients();
    try {
        // A builds start -> t0 -> t1 -> t2 (chained with flows).
        const ids = await pageA.evaluate(() => {
            const m = (window as any).__E2E_BPMN__;
            const modeling = m.get('modeling');
            const factory = m.get('elementFactory');
            const root = m.get('canvas').getRootElement();
            const start = factory.createShape({ type: 'bpmn:StartEvent' });
            modeling.createShape(start, { x: 160, y: 200 }, root);
            let prev = start;
            const tasks: string[] = [];
            for (let i = 0; i < 3; i++) {
                const t = factory.createShape({ type: 'bpmn:Task' });
                modeling.createShape(t, { x: 320 + i * 200, y: 200 }, root);
                modeling.connect(prev, t);
                tasks.push(t.id);
                prev = t;
            }
            return { start: start.id as string, tasks };
        });

        await pageB.waitForFunction((id) => (window as any).__E2E_BPMN__.get('elementRegistry').getAll()
            .filter((e: any) => e.type === 'bpmn:Task').length >= 3 && !!(window as any).__E2E_BPMN__.get('elementRegistry').get(id),
            ids.start, { timeout: 20_000 });

        // B moves each task around and drags a flow bendpoint — a realistic burst.
        await pageB.evaluate((taskIds) => {
            const m = (window as any).__E2E_BPMN__;
            const modeling = m.get('modeling');
            const reg = m.get('elementRegistry');
            const deltas = [{ x: 60, y: 120 }, { x: -80, y: -60 }, { x: 140, y: 40 }];
            taskIds.forEach((id: string, i: number) => {
                const t = reg.get(id);
                modeling.moveShape(t, deltas[i], t.parent);
            });
        }, ids.tasks);
        await pageB.waitForTimeout(1200);

        await pageA.waitForTimeout(2000);

        // Snapshot the full geometry of every element on a page.
        const fullGeom = (page: typeof pageA) => page.evaluate(() => {
            const reg = (window as any).__E2E_BPMN__.get('elementRegistry');
            const out: Record<string, unknown> = {};
            for (const el of reg.getAll()) {
                if (el.type === 'label' || el.labelTarget || !el.parent) continue;
                out[el.id] = el.waypoints
                    ? { wp: el.waypoints.map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }
                    : { x: el.x, y: el.y, w: el.width, h: el.height };
            }
            return out;
        });

        const [ga, gb] = await Promise.all([fullGeom(pageA), fullGeom(pageB)]);
        const mismatches = Object.keys(gb).filter((id) => JSON.stringify(ga[id]) !== JSON.stringify(gb[id]))
            .map((id) => ({ id, A: ga[id], B: gb[id] }));
        if (mismatches.length) console.log('GEOM MISMATCHES:', JSON.stringify(mismatches, null, 2));
        expect(mismatches, 'A and B geometry identical after peer edit burst').toEqual([]);
    } finally {
        await cleanup();
    }
});

test('moving a connected shape keeps geometry and flow attachment in sync', async () => {
    test.setTimeout(120_000);
    const { pageA, pageB, cleanup } = await openTwoClients();
    try {
        // A builds start --flow--> task.
        const ids = await pageA.evaluate(() => {
            const m = (window as any).__E2E_BPMN__;
            const modeling = m.get('modeling');
            const factory = m.get('elementFactory');
            const root = m.get('canvas').getRootElement();
            const start = factory.createShape({ type: 'bpmn:StartEvent' });
            modeling.createShape(start, { x: 200, y: 200 }, root);
            const task = factory.createShape({ type: 'bpmn:Task' });
            modeling.createShape(task, { x: 440, y: 200 }, root);
            const flow = modeling.connect(start, task);
            return { start: start.id as string, task: task.id as string, flow: flow.id as string };
        });

        await pageB.waitForFunction((id) => !!(window as any).__E2E_BPMN__.get('elementRegistry').get(id), ids.flow, { timeout: 20_000 });

        // B moves the task twice (to expose any accumulating/relative drift).
        for (const delta of [{ x: 120, y: 80 }, { x: -40, y: 60 }]) {
            await pageB.evaluate(({ taskId, delta }) => {
                const m = (window as any).__E2E_BPMN__;
                const t = m.get('elementRegistry').get(taskId);
                m.get('modeling').moveShape(t, delta, t.parent);
            }, { taskId: ids.task, delta });
            await pageB.waitForTimeout(700);
        }
        await pageA.waitForTimeout(1500);

        const geom = (page: typeof pageA) => page.evaluate((ids) => {
            const reg = (window as any).__E2E_BPMN__.get('elementRegistry');
            const task = reg.get(ids.task);
            const flow = reg.get(ids.flow);
            const last = flow.waypoints[flow.waypoints.length - 1];
            const first = flow.waypoints[0];
            const inTask = last.x >= task.x - 6 && last.x <= task.x + task.width + 6
                && last.y >= task.y - 6 && last.y <= task.y + task.height + 6;
            return {
                taskX: task.x, taskY: task.y,
                first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y },
                inTask,
                // Docking points must survive the sync, or the line stops attaching.
                firstDocked: !!first.original, lastDocked: !!last.original,
            };
        }, ids);

        const [a, b] = await Promise.all([geom(pageA), geom(pageB)]);
        // A's task landed where B put it (absolute, no drift).
        expect(a.taskX, `task X (A=${a.taskX} B=${b.taskX})`).toBe(b.taskX);
        expect(a.taskY, `task Y (A=${a.taskY} B=${b.taskY})`).toBe(b.taskY);
        // The flow's end waypoint still touches the task on BOTH clients.
        expect(b.inTask, `flow attaches to task on B (last=${JSON.stringify(b.last)})`).toBe(true);
        expect(a.inTask, `flow attaches to task on A (last=${JSON.stringify(a.last)})`).toBe(true);
        // And the whole flow matches between the two.
        expect(a.last, 'flow end waypoint matches across clients').toEqual(b.last);
        expect(a.first, 'flow start waypoint matches across clients').toEqual(b.first);
        // The docking points must be present on the receiver, not just the sender.
        expect(a.firstDocked && a.lastDocked, 'flow docking survives sync on A').toBe(true);
    } finally {
        await cleanup();
    }
});

test('idle loader (A reopened existing session) renders a peer first edit', async () => {
    test.setTimeout(120_000);
    const { pageA, pageB, modelId, cleanup } = await openTwoClients();
    try {
        // Make A a *loader*, not the seeder: A reloads, so on reopen the shared
        // ydoc state already exists and A takes the load-existing-state path while
        // making no edits of its own — the real-world "reopen an existing model".
        await pageA.reload();
        await pageA.waitForFunction(() => (window as any).__E2E_BPMN__ !== undefined, undefined, { timeout: 30_000 });
        await pageA.waitForFunction(() => (window as any).__E2E_AUTH__?.auth?.currentUser != null);
        // Give A a moment to (re)join, load state, and settle as an idle loader.
        await pageA.waitForTimeout(1500);

        // B (untouched) makes the first edit; A has still edited nothing.
        const bId = await addNamedTask(pageB, 'Loader render me', 420, 320);
        await pageA.waitForFunction(
            (id) => !!(window as any).__E2E_BPMN__.get('elementRegistry').get(id),
            bId,
            { timeout: 20_000 },
        );
        expect(await nameOf(pageA, bId)).toBe('Loader render me');
        expect(modelId).toBeTruthy();
    } finally {
        await cleanup();
    }
});

test('B can make the first edit while A stays idle (no prior A edit)', async () => {
    test.setTimeout(120_000);
    const { pageA, pageB, cleanup } = await openTwoClients();
    try {
        // A makes NO edits at all. B is the very first to edit the shared model.
        const bId = await addNamedTask(pageB, 'B first edit', 400, 300);
        // A must see B's element without A ever having edited.
        await pageA.waitForFunction(
            (id) => !!(window as any).__E2E_BPMN__.get('elementRegistry').get(id),
            bId,
            { timeout: 20_000 },
        );
        expect(await nameOf(pageA, bId)).toBe('B first edit');

        // ...and the idle leader (A) must persist B's edit to modelXmlData, even
        // though A itself never edited. (Both clients are still connected, so this
        // is the live persist path, not the flush-on-last-leaver path.)
        const modelId = pageA.url().split('/model/')[1];
        await expect.poll(() => pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `modelXmlData/${mid}/xmlData`))
                .then((s: any) => (s.val() ?? '') as string);
        }, modelId), { timeout: 15_000 }).toContain('B first edit');
    } finally {
        await cleanup();
    }
});

test('concurrent edits to different elements all survive (CRDT merge)', async () => {
    test.setTimeout(180_000);
    const { pageA, pageB, cleanup } = await openTwoClients();
    try {
        // A shared, already-synced task so we also exercise edits to a common base.
        const seedId = await addNamedTask(pageA, 'Seed', 300, 160);
        await pageB.waitForFunction(
            (id) => !!(window as any).__E2E_BPMN__.get('elementRegistry').get(id),
            seedId,
            { timeout: 25_000 },
        );

        // --- concurrent CREATION: both add a task at the same instant. Under the
        // old whole-document last-writer-wins one of these was silently dropped. ---
        await Promise.all([
            addNamedTask(pageA, 'Alice only', 300, 320),
            addNamedTask(pageB, 'Bob only', 620, 320),
        ]);

        for (const page of [pageA, pageB]) {
            await expect.poll(() => taskNames(page), { timeout: 25_000 })
                .toEqual(['Alice only', 'Bob only', 'Seed']);
        }

        // --- concurrent RENAME of two different existing tasks. Both edits must
        // land, because they touch different elements' fields in the shared doc. ---
        const [aliceId, bobId] = await Promise.all([
            pageA.evaluate(() => (window as any).__E2E_BPMN__.get('elementRegistry').getAll()
                .find((el: any) => el.businessObject?.name === 'Alice only')?.id as string),
            pageB.evaluate(() => (window as any).__E2E_BPMN__.get('elementRegistry').getAll()
                .find((el: any) => el.businessObject?.name === 'Bob only')?.id as string),
        ]);
        await Promise.all([
            renameElement(pageA, aliceId, 'Alice renamed'),
            renameElement(pageB, bobId, 'Bob renamed'),
        ]);

        for (const page of [pageA, pageB]) {
            await expect.poll(() => nameOf(page, aliceId), { timeout: 25_000 }).toBe('Alice renamed');
            await expect.poll(() => nameOf(page, bobId), { timeout: 25_000 }).toBe('Bob renamed');
        }

        // Both clients converged to the same element set.
        const [countA, countB] = await Promise.all([elementCount(pageA), elementCount(pageB)]);
        expect(countB, 'both clients hold the same number of elements').toBe(countA);
    } finally {
        await cleanup();
    }
});

/**
 * Drive the tab's visibility. Headless Chromium reports every page as visible
 * whatever is in front, so the browser's own signal cannot be produced here; the
 * value is overridden and the real `visibilitychange` event dispatched, which is
 * exactly what the app listens to.
 */
async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: h, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

test('a hidden window stops costing the session, and catches up on return', async () => {
    test.setTimeout(180_000);

    // Only B parks. Its tiers are shortened to seconds; A keeps the production
    // thresholds, and its own edits count as activity, so A never steps away.
    const IDLE_AFTER_MS = 1_500;
    const HIDDEN_AWAY_MS = 2_000;

    const meters: Meter[] = [];
    const { pageA, pageB, modelId, cleanup } = await openTwoClients({
        beforeLoad: async (_a, b) => {
            meters.push(attachMeter(b));
            await b.addInitScript((ms) => {
                (window as any).__E2E_IDLE_MS__ = ms;
            }, { idleAfterMs: IDLE_AFTER_MS, hiddenAwayMs: HIDDEN_AWAY_MS });
        },
    });
    const meter = meters[0];

    const readDb = (page: Page, path: string) => page.evaluate((p) => {
        const { getDatabase, ref, get } = (window as any).__E2E_DB__;
        return get(ref(getDatabase(), p)).then((s: any) => s.val());
    }, path);

    try {
        const uidB = await getUid(pageB);

        // --- while B is working, everything flows -----------------------------
        const box = await pageB.locator('.bpmn-modeler .djs-container').boundingBox();
        if (!box) throw new Error('no canvas on B');
        await pageB.mouse.move(box.x + 200, box.y + 200);
        await expect
            .poll(() => readDb(pageA, `sessions/${modelId}/cursors/${uidB}`), { timeout: 15_000 })
            .not.toBeNull();

        await addNamedTask(pageA, 'Before the pause', 300, 200);
        await expect.poll(() => taskNames(pageB), { timeout: 25_000 }).toContain('Before the pause');
        const baseline = await elementCount(pageB);

        // --- B's tab is backgrounded ------------------------------------------
        // Being untouched is deliberately *not* enough: a window on screen keeps
        // receiving edits however long it sits (see the sibling test). Only
        // hiding it, where nobody can see it, detaches the session.
        await pageB.waitForFunction(() => (window as any).__E2E_IDLE__?.current === 'idle', undefined,
            { timeout: 20_000 });
        expect(await pageB.evaluate(() => (window as any).__E2E_IDLE__.current),
            'untouched but visible is idle, never away').toBe('idle');

        await setTabHidden(pageB, true);
        await pageB.waitForFunction(() => (window as any).__E2E_IDLE__?.current === 'away', undefined,
            { timeout: 20_000 });

        // Presence says away, and B's cursor is off everyone's canvas.
        await expect
            .poll(() => readDb(pageA, `sessions/${modelId}/presence/${uidB}/idle`), { timeout: 15_000 })
            .toBe(true);
        await expect
            .poll(() => readDb(pageA, `sessions/${modelId}/cursors/${uidB}`), { timeout: 15_000 })
            .toBeNull();

        // --- A works on; B must not pay for it --------------------------------
        const recvBefore = meter.recv;
        for (let i = 0; i < 6; i++) {
            await addNamedTask(pageA, `During the pause ${i}`, 300 + i * 140, 340);
            await pageA.waitForTimeout(600);
        }
        await pageA.waitForTimeout(2_000);
        const parkedRecv = meter.recv - recvBefore;

        // The real assertion: B did not follow the edits at all.
        expect(await elementCount(pageB), 'a parked window stops applying peer edits')
            .toBe(baseline);
        // And it downloaded next to nothing while they happened — WebSocket
        // keepalives only, orders of magnitude below the ~1 KB per edit an
        // attached client pays. Generous, to stay robust in CI.
        expect(parkedRecv, 'a parked window downloads no edit traffic').toBeLessThan(2_048);

        // B is no longer the persistence leader — whoever is awake owns it.
        const leader = await readDb(pageA, `sessions/${modelId}/leader`);
        expect(leader?.uid, 'a parked window does not hold the persistence leadership')
            .not.toBe(uidB);

        // --- showing the tab again brings B back ------------------------------
        await setTabHidden(pageB, false);
        await pageB.mouse.move(box.x + 240, box.y + 240);
        await pageB.waitForFunction(() => (window as any).__E2E_IDLE__?.current === 'active', undefined,
            { timeout: 10_000 });
        await expect
            .poll(() => readDb(pageA, `sessions/${modelId}/presence/${uidB}/idle`), { timeout: 15_000 })
            .toBe(false);

        // Everything it missed arrives, and it can edit into the session again.
        await expect.poll(() => elementCount(pageB), { timeout: 30_000 })
            .toBe(await elementCount(pageA));
        await expect.poll(() => taskNames(pageB), { timeout: 30_000 }).toContain('During the pause 5');

        await addNamedTask(pageB, 'After the pause', 300, 480);
        await expect.poll(() => taskNames(pageA), { timeout: 25_000 }).toContain('After the pause');
    } finally {
        await cleanup();
    }
});

test('a window left untouched on screen keeps receiving edits', async () => {
    test.setTimeout(150_000);

    // B is never touched after opening, and its tiers are shortened so that the
    // whole test runs well past them. Watching a colleague work is exactly this:
    // no input for minutes, on a window you are staring at.
    const { pageA, pageB, cleanup } = await openTwoClients({
        beforeLoad: async (_a, b) => {
            await b.addInitScript((ms) => {
                (window as any).__E2E_IDLE_MS__ = ms;
            }, { idleAfterMs: 500, hiddenAwayMs: 1_000 });
        },
    });

    try {
        // Let B sit well past every threshold without a single event.
        await pageB.waitForTimeout(6_000);
        expect(await pageB.evaluate(() => (window as any).__E2E_IDLE__.current),
            'an untouched but visible window is idle, never away').toBe('idle');
        expect(await pageB.evaluate(() => document.visibilityState)).toBe('visible');

        // A works. B must show it, without anyone touching B.
        await addNamedTask(pageA, 'Watcher sees this', 360, 260);
        await expect.poll(() => taskNames(pageB), { timeout: 25_000 }).toContain('Watcher sees this');

        // Still untouched, still receiving — a second edit lands too.
        await pageA.waitForTimeout(2_000);
        await addNamedTask(pageA, 'And this one', 520, 260);
        await expect.poll(() => taskNames(pageB), { timeout: 25_000 }).toContain('And this one');
        expect(await pageB.evaluate(() => (window as any).__E2E_IDLE__.current)).toBe('idle');
    } finally {
        await cleanup();
    }
});

// ---------------------------------------------------------------------------
// Report generation: a standalone HTML page with an inline SVG chart, a
// per-phase byte table, and a cost projection.
// ---------------------------------------------------------------------------

interface ReportData {
    durationMs: number;
    modelBytes: number;
    elements: number;
    phases: { setup: number; grow: number; steady: number; cursors: number };
    totals: Snapshot;
    steadyEdits: number;
    steadyPerEdit: number;
    samples: Array<{ t: number; aR: number; aS: number; bR: number; bS: number }>;
    marks: Array<{ t: number; label: string }>;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(2)} MB`;

function writeReport(data: ReportData): void {
    const outDir = path.join(process.cwd(), 'e2e', '.collab-report');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(data, null, 2));

    // Cost projection. Firebase RTDB bills downloaded (egress) bytes at ~$1/GB.
    // With per-writer channels there is no self-echo: an edit is downloaded only by
    // the *other* people present, so a session's egress grows with editors×(editors-1),
    // not editors². The measured per-edit figure (one editor + one watcher) is
    // essentially one watcher's download of one (compressed) edit.
    const perEditKB = data.steadyPerEdit / 1024;
    const perWatcherPerEdit = data.steadyPerEdit;
    const scenario = (editors: number, editsPerMinPerEditor: number, hours: number) => {
        const totalEdits = editors * editsPerMinPerEditor * 60 * hours;
        const bytes = totalEdits * Math.max(1, editors - 1) * perWatcherPerEdit;
        const gb = bytes / (1024 ** 3);
        return { editors, editsPerMinPerEditor, hours, mb: bytes / (1024 ** 2), usd: gb * 1 };
    };
    const scenarios = [scenario(2, 15, 1), scenario(5, 15, 1), scenario(5, 15, 8)];

    fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(data, perEditKB, scenarios));
    // eslint-disable-next-line no-console
    console.log(`\nCollaboration data-rate report: file://${path.join(outDir, 'index.html')}\n`);
}

function renderHtml(
    data: ReportData,
    perEditKB: number,
    scenarios: Array<{ editors: number; editsPerMinPerEditor: number; hours: number; mb: number; usd: number }>,
): string {
    const W = 900, H = 320, PAD = 44;
    const maxT = Math.max(1, ...data.samples.map((s) => s.t));
    const maxY = Math.max(1, ...data.samples.map((s) => Math.max(s.aR, s.bR)));
    const x = (t: number) => PAD + (t / maxT) * (W - PAD * 2);
    const y = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2);
    const line = (key: 'aR' | 'bR') => data.samples.map((s) => `${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');

    const bands = data.marks.map((m, i) => {
        const next = data.marks[i + 1]?.t ?? maxT;
        const fill = ['#eef2ff', '#ecfdf5', '#fff7ed', '#fef2f2', '#f8fafc'][i % 5];
        return `<rect x="${x(m.t).toFixed(1)}" y="${PAD}" width="${(x(next) - x(m.t)).toFixed(1)}" height="${H - PAD * 2}" fill="${fill}"/>`
            + `<text x="${(x(m.t) + 4).toFixed(1)}" y="${PAD + 14}" font-size="11" fill="#64748b">${m.label}</text>`;
    }).join('');

    const phaseRows = (Object.entries(data.phases) as Array<[string, number]>)
        .map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${kb(v)}</td></tr>`).join('');

    const scenarioRows = scenarios.map((s) =>
        `<tr><td>${s.editors} editors · ${s.editsPerMinPerEditor} edits/min · ${s.hours}h</td>`
        + `<td style="text-align:right">${mb(s.mb * 1024 * 1024)}</td>`
        + `<td style="text-align:right">$${s.usd.toFixed(3)}</td></tr>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Collaboration data rates</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:28px;color:#0f172a;background:#f8fafc}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:24px 0 8px;color:#334155}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
 .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;min-width:150px}
 .card .v{font-size:22px;font-weight:700} .card .l{color:#64748b;font-size:12px}
 table{border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
 td,th{padding:7px 14px;border-bottom:1px solid #eef2f7} th{text-align:left;background:#f1f5f9}
 .legend span{display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:12px;color:#475569}
 .sw{width:12px;height:3px;display:inline-block;border-radius:2px}
 .note{color:#64748b;font-size:12px;max-width:820px}
</style></head><body>
<h1>Real-time collaboration — database data rates</h1>
<div class="note">Bytes measured on the RTDB WebSocket of each client against the local emulator.
<b>Received</b> bytes are what Firebase bills as egress.</div>
<div class="cards">
 <div class="card"><div class="v">${kb(data.modelBytes)}</div><div class="l">final model XML</div></div>
 <div class="card"><div class="v">${data.elements}</div><div class="l">diagram elements</div></div>
 <div class="card"><div class="v">${perEditKB.toFixed(1)} KB</div><div class="l">downloads / deliberate edit (both clients ≈ 2× model)</div></div>
 <div class="card"><div class="v">${mb(data.totals.aRecv + data.totals.bRecv)}</div><div class="l">total egress (A+B)</div></div>
 <div class="card"><div class="v">${(data.durationMs / 1000).toFixed(0)} s</div><div class="l">test duration</div></div>
</div>

<h2>Cumulative downloads over time</h2>
<div class="legend"><span><i class="sw" style="background:#2563eb"></i>User A received</span><span><i class="sw" style="background:#16a34a"></i>User B received</span></div>
<svg width="${W}" height="${H}" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px">
 ${bands}
 <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#cbd5e1"/>
 <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#cbd5e1"/>
 <text x="${PAD}" y="${H - PAD + 16}" font-size="11" fill="#94a3b8">0s</text>
 <text x="${W - PAD - 20}" y="${H - PAD + 16}" font-size="11" fill="#94a3b8">${(maxT / 1000).toFixed(0)}s</text>
 <text x="6" y="${PAD + 4}" font-size="11" fill="#94a3b8">${kb(maxY)}</text>
 <polyline fill="none" stroke="#2563eb" stroke-width="2" points="${line('aR')}"/>
 <polyline fill="none" stroke="#16a34a" stroke-width="2" points="${line('bR')}"/>
</svg>

<h2>Egress by phase (both clients)</h2>
<table><tr><th>Phase</th><th style="text-align:right">Downloaded</th></tr>${phaseRows}</table>

<h2>Cost projection <span class="note">(steady-edit rate × usage; RTDB egress ~$1/GB)</span></h2>
<table><tr><th>Scenario</th><th style="text-align:right">Egress</th><th style="text-align:right">Cost</th></tr>${scenarioRows}</table>
<p class="note"><b>How to read this:</b> each edit is sent as a small binary Yjs update on a shared append-only
log (gzip+base64), so the per-edit download is roughly <b>constant regardless of model size</b> — a big diagram
costs about the same per edit as a small one. Rapid bursts coalesce behind the send debounce. Every client reads the
whole log, so cost scales with <b>editors²</b> (each update reaches everyone, including a small echo of one's own);
the leader periodically compacts the log into a full state and prunes it, which also bounds the one-time load on join.</p>
</body></html>`;
}
