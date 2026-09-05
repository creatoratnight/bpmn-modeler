import * as Y from 'yjs';

/**
 * The shared-document schema for collaborative BPMN editing.
 *
 * The whole diagram is represented as a single `Y.Map` named `elements`, keyed
 * by bpmn-js element id. Each value is a nested `Y.Map` holding that one
 * element's fields (see {@link ElementSnapshot}). This structure is what makes
 * concurrent edits *merge* instead of clobbering each other:
 *
 *   - Two people editing *different elements* touch different top-level keys.
 *   - Two people editing *different fields of the same element* touch different
 *     keys of the same nested map.
 *   - Only when two people write the *same field of the same element* at once
 *     does Yjs fall back to a deterministic per-field last-writer-wins — the
 *     smallest possible unit of conflict, instead of the whole document.
 *
 * The root element (process/collaboration) and auto-managed labels are never
 * stored here: they are reconstructed by bpmn-js from the elements themselves.
 */

/** Name of the top-level shared map of elements. */
export const ELEMENTS = 'elements';

/**
 * A waypoint of a connection, in diagram coordinates. The first and last
 * waypoints of a connection also carry an `original` docking point (the point on
 * the connected shape the line docks to); diagram-js uses it to crop the line to
 * the shape's border. Dropping it makes the line stop attaching to the shape, so
 * it is part of the synced state.
 */
export interface Waypoint {
    x: number;
    y: number;
    original?: { x: number; y: number };
}

/**
 * A flat, comparable description of one diagram element (shape or connection).
 * Every field that a peer needs to reproduce the element locally lives here;
 * fields that do not apply to a given element kind are simply absent
 * (a shape has no `source`/`target`; a connection has no `x`/`y`).
 */
export interface ElementSnapshot {
    /** bpmn element type, e.g. `bpmn:Task`, `bpmn:SequenceFlow`. */
    type: string;
    /** Parent element id (the root element's id for top-level elements). */
    parent: string | null;

    // Shape geometry (top-left + size). Absent on connections.
    x?: number;
    y?: number;
    width?: number;
    height?: number;

    // Connection topology. Absent on shapes.
    source?: string;
    target?: string;
    waypoints?: Waypoint[];

    // businessObject.name (tasks, events, flows, …). Absent when unnamed.
    name?: string;

    // DI colors set via the color picker. Absent when using the default.
    fill?: string;
    stroke?: string;
}

/** The fields we track on an element, in a stable order (for diffing). */
const FIELDS: Array<keyof ElementSnapshot> = [
    'type', 'parent',
    'x', 'y', 'width', 'height',
    'source', 'target', 'waypoints',
    'name', 'fill', 'stroke',
];

/** The shared elements map of a document. Created on first access. */
export function elementsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
    return doc.getMap(ELEMENTS) as Y.Map<Y.Map<unknown>>;
}

/** Deep-equal two waypoints (coordinates plus optional `original` docking). */
function waypointEqual(a: Waypoint, b: Waypoint): boolean {
    return a.x === b.x && a.y === b.y
        && (a.original?.x ?? null) === (b.original?.x ?? null)
        && (a.original?.y ?? null) === (b.original?.y ?? null);
}

/** Two waypoint lists are equal iff same length and same waypoints in order. */
function waypointsEqual(a?: Waypoint[], b?: Waypoint[]): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!waypointEqual(a[i], b[i])) return false;
    }
    return true;
}

/** A plain, storable copy of a waypoint (drops any extra diagram-js fields). */
export function copyWaypoint(p: Waypoint): Waypoint {
    return p.original
        ? { x: p.x, y: p.y, original: { x: p.original.x, y: p.original.y } }
        : { x: p.x, y: p.y };
}

/** Compare one field of two snapshots (waypoints need a deep compare). */
function fieldEqual(field: keyof ElementSnapshot, a: unknown, b: unknown): boolean {
    if (field === 'waypoints') return waypointsEqual(a as Waypoint[], b as Waypoint[]);
    return a === b;
}

/** Read a nested element map back into a plain snapshot. */
export function readSnapshot(ymap: Y.Map<unknown>): ElementSnapshot {
    const snap: Partial<ElementSnapshot> = {};
    for (const field of FIELDS) {
        const value = ymap.get(field);
        if (value !== undefined) (snap as Record<string, unknown>)[field] = value;
    }
    return snap as ElementSnapshot;
}

/**
 * Write `next` into the element's nested map, touching only the fields that
 * actually changed (so unrelated concurrent edits are never overwritten). The
 * nested map is created if absent. Must run inside a `Y.Doc` transaction.
 */
export function writeSnapshot(
    parent: Y.Map<Y.Map<unknown>>,
    id: string,
    next: ElementSnapshot,
): void {
    let ymap = parent.get(id);
    if (!ymap) {
        ymap = new Y.Map<unknown>();
        parent.set(id, ymap);
    }
    for (const field of FIELDS) {
        const nextValue = next[field];
        const current = ymap.get(field);
        if (nextValue === undefined) {
            if (current !== undefined) ymap.delete(field);
        } else if (!fieldEqual(field, current, nextValue)) {
            // Waypoints are stored as a plain array (a value, not a nested type):
            // they change as a unit, so per-point CRDT merging buys nothing.
            ymap.set(field, field === 'waypoints'
                ? (nextValue as Waypoint[]).map(copyWaypoint)
                : nextValue);
        }
    }
}

/** True when a diagram snapshot already matches what the shared map holds. */
export function snapshotMatches(ymap: Y.Map<unknown>, snap: ElementSnapshot): boolean {
    for (const field of FIELDS) {
        if (!fieldEqual(field, ymap.get(field), snap[field])) return false;
    }
    // No extra fields lingering that the snapshot no longer sets.
    for (const key of ymap.keys()) {
        if (snap[key as keyof ElementSnapshot] === undefined) return false;
    }
    return true;
}
