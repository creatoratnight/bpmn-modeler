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
 * watch) open the *same* BPMN model. One builds a large model while the other
 * watches it sync live. Throughout, we meter the Realtime Database WebSocket on
 * each client — bytes received is the billable egress — and break the totals
 * down by phase, so the steady-state cost of editing a *large* model over the
 * collaboration channel is isolated from one-off startup traffic.
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
        // A must have published its document channel.
        await expect.poll(() => pageA.evaluate((mid) => {
            const { getDatabase, ref, get } = (window as any).__E2E_DB__;
            return get(ref(getDatabase(), `sessions/${mid}/docs`)).then((s: any) => (s.exists() ? Object.keys(s.val()).length : 0));
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
        // Cost-regression guard. The delta protocol keeps per-edit egress small and
        // ~independent of model size (measured ~2 KB on this ~106 KB model). A
        // regression to full-document sync would push this to the compressed model
        // size (~14 KB here) and grow with the model, so this budget catches it —
        // and it stays valid as the test model grows, precisely because deltas do
        // not scale with model size. Deliberately generous to avoid CI flakiness.
        const PER_EDIT_EGRESS_BUDGET = 6 * 1024;
        expect(steadyPerEdit, 'per-edit egress within the delta budget (cost-regression guard)')
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
<p class="note"><b>How to read this:</b> each edit is sent as a small text-diff patch on the editor's own
per-writer channel (with an occasional gzip-compressed full snapshot on an adaptive cadence, and no self-echo), so the
per-edit download is roughly <b>constant regardless of model size</b> — a big diagram costs about the same
per edit as a small one. Rapid bursts coalesce behind the ${(700)}ms debounce. Cost scales with
<b>editors × (editors−1)</b>; large models mainly affect the occasional snapshot and the one-time load on join.</p>
</body></html>`;
}
