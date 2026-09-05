import * as Y from 'yjs';
import {
    type ElementSnapshot,
    type Waypoint,
    elementsMap,
    readSnapshot,
    writeSnapshot,
    snapshotMatches,
    copyWaypoint,
} from './YModel';

// ---------------------------------------------------------------------------
// Minimal structural types for the bpmn-js / diagram-js services we touch.
// The libraries ship no usable types for these, so we declare exactly what we
// use — the same approach the presence binding (CollabBinding) takes.
// ---------------------------------------------------------------------------

interface Bounds { x: number; y: number; width: number; height: number }

interface DiElement {
    id: string;
    type: string;
    parent?: DiElement | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    source?: DiElement;
    target?: DiElement;
    waypoints?: Waypoint[];
    /** Present on labels — which we never sync (bpmn-js manages them). */
    labelTarget?: unknown;
    businessObject?: { name?: string };
    di?: { get(name: string): unknown };
}

interface Modeling {
    createShape(shape: unknown, bounds: Bounds, parent: DiElement): DiElement;
    createConnection(source: DiElement, target: DiElement, connection: unknown, parent: DiElement): DiElement;
    moveShape(shape: DiElement, delta: { x: number; y: number }, newParent?: DiElement | null): void;
    resizeShape(shape: DiElement, newBounds: Bounds): void;
    updateWaypoints(connection: DiElement, waypoints: Waypoint[]): void;
    updateProperties(element: DiElement, properties: Record<string, unknown>): void;
    removeElements(elements: DiElement[]): void;
    setColor(elements: DiElement[], colors: { fill?: string; stroke?: string }): void;
}

interface ElementFactory {
    create(elementType: 'shape' | 'connection', attrs: Record<string, unknown>): unknown;
}

interface BpmnFactory {
    create(type: string, attrs?: Record<string, unknown>): { name?: string };
}

interface ElementRegistry {
    getAll(): DiElement[];
    get(id: string): DiElement | undefined;
}

interface EventBus {
    on<E>(event: string, callback: (event: E) => void): void;
    off<E>(event: string, callback: (event: E) => void): void;
}

interface Canvas {
    getRootElement(): DiElement;
}

export interface BindingModeler {
    get(service: 'modeling'): Modeling;
    get(service: 'elementFactory'): ElementFactory;
    get(service: 'bpmnFactory'): BpmnFactory;
    get(service: 'elementRegistry'): ElementRegistry;
    get(service: 'eventBus'): EventBus;
    get(service: 'canvas'): Canvas;
}

// diagram-js signals a content change through one of these; which one fires for a
// given (especially programmatic) edit depends on the bpmn-js build, so we listen
// to both. Duplicates are harmless — pushLocalState is a diff, and a burst
// coalesces into a single network update downstream.
const CHANGE_EVENTS = ['commandStack.changed', 'elements.changed'];

/**
 * Two-way binding between one bpmn-js modeler and a shared Yjs document.
 *
 * - **Local → shared:** on every local command, the diagram is reconciled into
 *   the shared `elements` map field-by-field, so an edit writes only what it
 *   changed. This runs in a Yjs transaction tagged with `localOrigin`.
 * - **Shared → local:** when the shared map changes because of a *remote*
 *   update, the diagram is reconciled to match — creating, moving, updating and
 *   removing elements through the modeling API. This is the merge: because the
 *   shared map already merged the two writers' changes per-field, applying it
 *   reproduces *both* people's edits, not just the last one.
 *
 * Loops are prevented two ways: the shared→local reconcile runs under an
 * `applyingRemote` guard so the commands it issues are not written back, and the
 * local→shared observer ignores transactions carrying `localOrigin`.
 */
export class BpmnYjsBinding {
    private readonly modeling: Modeling;
    private readonly elementFactory: ElementFactory;
    private readonly bpmnFactory: BpmnFactory;
    private readonly elementRegistry: ElementRegistry;
    private readonly eventBus: EventBus;
    private readonly canvas: Canvas;
    private readonly elements: Y.Map<Y.Map<unknown>>;

    private applyingRemote = false;
    private started = false;
    private applyScheduled = false;

    constructor(
        modeler: BindingModeler,
        private readonly doc: Y.Doc,
        private readonly localOrigin: object,
    ) {
        this.modeling = modeler.get('modeling');
        this.elementFactory = modeler.get('elementFactory');
        this.bpmnFactory = modeler.get('bpmnFactory');
        this.elementRegistry = modeler.get('elementRegistry');
        this.eventBus = modeler.get('eventBus');
        this.canvas = modeler.get('canvas');
        this.elements = elementsMap(doc);
    }

    /** Attach both directions. Call after the shared doc has been loaded/seeded. */
    start(): void {
        if (this.started) return;
        this.started = true;
        for (const ev of CHANGE_EVENTS) this.eventBus.on(ev, this.onLocalChange);
        this.elements.observeDeep(this.onRemoteChange);
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        try { for (const ev of CHANGE_EVENTS) this.eventBus.off(ev, this.onLocalChange); } catch { /* destroyed */ }
        try { this.elements.unobserveDeep(this.onRemoteChange); } catch { /* detached */ }
    }

    // --- local → shared ------------------------------------------------------

    private onLocalChange = (): void => {
        if (this.applyingRemote) return;
        this.pushLocalState();
    };

    /**
     * Reconcile the whole diagram into the shared map. Diff-based: unchanged
     * fields and elements are left untouched, so a peer's concurrent edit to a
     * different element/field is never overwritten.
     */
    pushLocalState(): void {
        const root = this.canvas.getRootElement();
        this.doc.transact(() => {
            const seen = new Set<string>();
            for (const el of this.elementRegistry.getAll()) {
                if (!this.isSyncable(el, root)) continue;
                seen.add(el.id);
                const snap = this.snapshot(el);
                const existing = this.elements.get(el.id);
                if (!existing || !snapshotMatches(existing, snap)) {
                    writeSnapshot(this.elements, el.id, snap);
                }
            }
            // Elements deleted locally: drop them from the shared map.
            for (const id of [...this.elements.keys()]) {
                if (!seen.has(id)) this.elements.delete(id);
            }
        }, this.localOrigin);
    }

    /** Whether an element participates in sync (skip roots and managed labels). */
    private isSyncable(el: DiElement, root: DiElement): boolean {
        if (el === root || !el.parent) return false; // roots have no parent
        if (el.type === 'label' || el.labelTarget) return false; // auto-managed
        return true;
    }

    private snapshot(el: DiElement): ElementSnapshot {
        const snap: ElementSnapshot = { type: el.type, parent: el.parent?.id ?? null };
        if (typeof el.x === 'number' && typeof el.y === 'number') {
            snap.x = el.x;
            snap.y = el.y;
            snap.width = el.width;
            snap.height = el.height;
        }
        if (Array.isArray(el.waypoints)) snap.waypoints = el.waypoints.map(copyWaypoint);
        if (el.source) snap.source = el.source.id;
        if (el.target) snap.target = el.target.id;
        const name = el.businessObject?.name;
        if (name) snap.name = name;
        const fill = el.di?.get('background-color');
        if (typeof fill === 'string') snap.fill = fill;
        const stroke = el.di?.get('border-color');
        if (typeof stroke === 'string') snap.stroke = stroke;
        return snap;
    }

    // --- shared → local ------------------------------------------------------

    private onRemoteChange = (_events: Array<Y.YEvent<Y.AbstractType<unknown>>>, txn: Y.Transaction): void => {
        if (txn.origin === this.localOrigin) return; // our own write; diagram already matches
        this.scheduleApply();
    };

    /** Coalesce a burst of remote updates into a single diagram reconcile. */
    private scheduleApply(): void {
        if (this.applyScheduled) return;
        this.applyScheduled = true;
        queueMicrotask(() => {
            this.applyScheduled = false;
            if (this.started && !this.applyingRemote) this.applyToDiagram();
        });
    }

    /** Make the diagram match the shared document. Runs under the remote guard. */
    applyToDiagram(): void {
        const root = this.canvas.getRootElement();
        const desired = new Map<string, ElementSnapshot>();
        for (const [id, ymap] of this.elements.entries()) desired.set(id, readSnapshot(ymap));

        this.applyingRemote = true;
        try {
            this.applyRemovals(desired, root);
            this.applyCreations(desired, root);
            this.applyUpdates(desired);
        } finally {
            this.applyingRemote = false;
        }
    }

    /** Remove elements gone from the shared map, or whose identity changed. */
    private applyRemovals(desired: Map<string, ElementSnapshot>, root: DiElement): void {
        const toRemove: DiElement[] = [];
        for (const el of this.elementRegistry.getAll()) {
            if (!this.isSyncable(el, root)) continue;
            const want = desired.get(el.id);
            if (!want || want.type !== el.type || this.endpointsChanged(el, want)) {
                toRemove.push(el);
            }
        }
        for (const el of toRemove) {
            // removeElements cascades to connections; re-check the element is still present.
            if (!this.elementRegistry.get(el.id)) continue;
            try { this.modeling.removeElements([el]); } catch (err) {
                console.error('BpmnYjsBinding: remove failed', el.id, err);
            }
        }
    }

    private endpointsChanged(el: DiElement, want: ElementSnapshot): boolean {
        if (want.source === undefined && want.target === undefined) return false;
        return el.source?.id !== want.source || el.target?.id !== want.target;
    }

    /** Create shapes (parents first), then connections (once endpoints exist). */
    private applyCreations(desired: Map<string, ElementSnapshot>, root: DiElement): void {
        const missingShapes: Array<[string, ElementSnapshot]> = [];
        const missingConnections: Array<[string, ElementSnapshot]> = [];
        for (const [id, snap] of desired) {
            if (this.elementRegistry.get(id)) continue;
            if (snap.source !== undefined || snap.target !== undefined) missingConnections.push([id, snap]);
            else if (snap.x !== undefined) missingShapes.push([id, snap]);
        }

        // Shapes shallowest-first so a parent exists before its children.
        missingShapes.sort((a, b) => this.depth(a[1], desired) - this.depth(b[1], desired));
        for (const [id, snap] of missingShapes) this.createShape(id, snap, root);

        // Connections may depend on freshly created shapes (or each other); keep
        // passing until no further progress is possible.
        let remaining = missingConnections;
        while (remaining.length) {
            const next: Array<[string, ElementSnapshot]> = [];
            for (const [id, snap] of remaining) {
                if (!this.createConnection(id, snap, root)) next.push([id, snap]);
            }
            if (next.length === remaining.length) break; // no progress — give up on these
            remaining = next;
        }
    }

    /** Depth of an element's parent chain within the desired set (root = 0). */
    private depth(snap: ElementSnapshot, desired: Map<string, ElementSnapshot>): number {
        let d = 0;
        let parent = snap.parent;
        while (parent && desired.has(parent) && d < 100) {
            d += 1;
            parent = desired.get(parent)!.parent;
        }
        return d;
    }

    private createShape(id: string, snap: ElementSnapshot, root: DiElement): void {
        try {
            const parentEl = (snap.parent && this.elementRegistry.get(snap.parent)) || root;
            const bo = this.bpmnFactory.create(snap.type, { id });
            if (snap.name !== undefined) bo.name = snap.name;
            const shape = this.elementFactory.create('shape', {
                type: snap.type,
                businessObject: bo,
                width: snap.width,
                height: snap.height,
            });
            const created = this.modeling.createShape(
                shape,
                { x: snap.x!, y: snap.y!, width: snap.width!, height: snap.height! },
                parentEl,
            );
            this.applyColor(created, snap);
        } catch (err) {
            console.error('BpmnYjsBinding: createShape failed', id, err);
        }
    }

    /** Returns true if the connection was created (or false to retry later). */
    private createConnection(id: string, snap: ElementSnapshot, root: DiElement): boolean {
        const source = snap.source ? this.elementRegistry.get(snap.source) : undefined;
        const target = snap.target ? this.elementRegistry.get(snap.target) : undefined;
        if (!source || !target) return false;
        try {
            const parentEl = (snap.parent && this.elementRegistry.get(snap.parent)) || source.parent || root;
            const bo = this.bpmnFactory.create(snap.type, { id });
            if (snap.name !== undefined) bo.name = snap.name;
            const connection = this.elementFactory.create('connection', { type: snap.type, businessObject: bo });
            const created = this.modeling.createConnection(source, target, connection, parentEl);
            if (snap.waypoints) this.modeling.updateWaypoints(created, snap.waypoints.map(copyWaypoint));
            this.applyColor(created, snap);
        } catch (err) {
            console.error('BpmnYjsBinding: createConnection failed', id, err);
        }
        return true;
    }

    /**
     * Apply geometry / waypoint / name / color diffs to existing elements, in
     * ordered passes so shape moves never clobber a connection's synced route.
     */
    private applyUpdates(desired: Map<string, ElementSnapshot>): void {
        const present = [...desired].filter(([id]) => this.elementRegistry.get(id));

        // Pass 1 — shape geometry, shallowest parent first. A container move drags
        // its children; doing the container before its children lets each child's
        // own absolute placement land last and win, so nothing is moved twice.
        const shapes = present
            .filter(([, snap]) => snap.x !== undefined)
            .sort((a, b) => this.depth(a[1], desired) - this.depth(b[1], desired));
        for (const [id, snap] of shapes) this.tryUpdate(id, (el) => this.updateGeometry(el, snap));

        // Pass 2 — connection waypoints, AFTER every shape has settled. Moving a
        // shape re-routes its connections, which would otherwise overwrite the very
        // waypoints we are restoring here.
        for (const [id, snap] of present) {
            if (snap.waypoints) this.tryUpdate(id, (el) => this.updateWaypoints(el, snap));
        }

        // Pass 3 — names and colors (order-independent).
        for (const [id, snap] of present) {
            this.tryUpdate(id, (el) => { this.updateName(el, snap); this.applyColor(el, snap); });
        }
    }

    /** Re-fetch the element (its geometry may have shifted between passes) and run `fn`. */
    private tryUpdate(id: string, fn: (el: DiElement) => void): void {
        const el = this.elementRegistry.get(id);
        if (!el) return;
        try { fn(el); } catch (err) { console.error('BpmnYjsBinding: update failed', id, err); }
    }

    private updateGeometry(el: DiElement, snap: ElementSnapshot): void {
        if (snap.x === undefined || typeof el.x !== 'number') return;
        const sizeChanged = el.width !== snap.width || el.height !== snap.height;
        if (sizeChanged) {
            this.modeling.resizeShape(el, { x: snap.x, y: snap.y!, width: snap.width!, height: snap.height! });
        } else if (el.x !== snap.x || el.y !== snap.y) {
            this.modeling.moveShape(el, { x: snap.x - el.x, y: snap.y! - (el.y as number) }, el.parent);
        }
    }

    private updateWaypoints(el: DiElement, snap: ElementSnapshot): void {
        if (!snap.waypoints || !Array.isArray(el.waypoints)) return;
        const wp = snap.waypoints;
        const same = el.waypoints.length === wp.length && el.waypoints.every((p, i) =>
            p.x === wp[i].x && p.y === wp[i].y
            && (p.original?.x ?? null) === (wp[i].original?.x ?? null)
            && (p.original?.y ?? null) === (wp[i].original?.y ?? null));
        // Restore the docking points too, or the line stops attaching to the shape.
        if (!same) this.modeling.updateWaypoints(el, wp.map(copyWaypoint));
    }

    private updateName(el: DiElement, snap: ElementSnapshot): void {
        const current = el.businessObject?.name;
        const next = snap.name;
        if ((current || undefined) !== (next || undefined)) {
            this.modeling.updateProperties(el, { name: next ?? '' });
        }
    }

    private applyColor(el: DiElement, snap: ElementSnapshot): void {
        const currentFill = el.di?.get('background-color') as string | undefined;
        const currentStroke = el.di?.get('border-color') as string | undefined;
        if ((currentFill || undefined) !== (snap.fill || undefined)
            || (currentStroke || undefined) !== (snap.stroke || undefined)) {
            this.modeling.setColor([el], { fill: snap.fill, stroke: snap.stroke });
        }
    }
}
