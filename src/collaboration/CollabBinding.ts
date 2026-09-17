import type { CollaborationSession } from './CollaborationSession';
import type { ActivityState, IdleDetector } from './IdleDetector';
import type { CursorPayload, Peer, SelectionPayload } from './types';

// How often we publish our own cursor while the pointer is moving. ~15/s is
// smooth once the receiver interpolates, while keeping Firebase egress modest
// (each update is ~30 bytes). Idle-stop is automatic: no mousemove → no writes.
const CURSOR_THROTTLE_MS = 66;

// Interpolation factor for remote cursors. Each animation frame we move the
// rendered position this fraction of the way toward the latest received target,
// which smooths out the throttled/janky network updates into fluid motion.
const LERP = 0.28;

const DEFAULT_COLOR = '#8d8d8d';

interface PeerCursorView {
    /** Latest received target, in diagram coordinates. */
    targetX: number;
    targetY: number;
    /** Currently rendered position, in diagram coordinates (lerped toward target). */
    x: number;
    y: number;
    initialised: boolean;
    root: HTMLDivElement;
    label: HTMLDivElement;
    path: SVGPathElement;
}

interface PeerSelectionView {
    ids: string[];
    color: string;
    /** One outline box per selected element, reused across frames. */
    boxes: HTMLDivElement[];
}

// Minimal structural types for the bpmn-js/diagram-js services we touch. The
// library ships no usable types for these, so we declare exactly what we use.
interface DiagramCanvas {
    getContainer(): HTMLElement;
    viewbox(): { x: number; y: number; width: number; height: number };
    zoom(): number;
}

interface DiagramEventBus {
    on<E>(event: string, callback: (event: E) => void): void;
    off<E>(event: string, callback: (event: E) => void): void;
}

interface DiagramElement {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    waypoints?: Array<{ x: number; y: number }>;
}

interface DiagramElementRegistry {
    get(id: string): DiagramElement | undefined;
}

interface Modeler {
    get(service: 'canvas'): DiagramCanvas;
    get(service: 'eventBus'): DiagramEventBus;
    get(service: 'elementRegistry'): DiagramElementRegistry;
    get(service: string): unknown;
}

/**
 * Binds a live collaboration session to a bpmn-js modeler instance: it captures
 * this user's pointer and selection and publishes them, and renders every peer's
 * cursor (with name) and selection outlines as an HTML overlay above the canvas.
 *
 * All bpmn-js/DOM coupling lives here; the React layer only creates the session
 * and mounts/unmounts this binding. Everything is drawn in **diagram
 * coordinates** and re-projected through the local viewbox every frame, so peers
 * stay correctly placed no matter how each person has panned or zoomed.
 *
 * Presence traffic is the most expensive channel in the session, so it follows
 * the window's activity state ({@link IdleDetector}):
 *   - `idle` — we stop publishing our own cursor and selection, and take our
 *     cursor off everyone else's canvas.
 *   - `away` — we additionally unsubscribe from peer cursors and selections, so
 *     a parked window stops downloading ~15 cursor updates a second from every
 *     peer who *is* working. Peer presence stays subscribed (it is small and
 *     low-churn) and the streams re-attach on the first sign of activity.
 */
export class CollabBinding {
    private readonly canvas: DiagramCanvas;
    private readonly eventBus: DiagramEventBus;
    private readonly elementRegistry: DiagramElementRegistry;
    private readonly container: HTMLElement;

    private layer: HTMLDivElement | null = null;
    private readonly cursors = new Map<string, PeerCursorView>();
    private readonly selections = new Map<string, PeerSelectionView>();
    private readonly identities = new Map<string, Peer>();

    private readonly unsubscribes: Array<() => void> = [];
    /** Peer cursor/selection subscriptions — detached while `away`, else non-null. */
    private peerSubs: Array<() => void> | null = null;
    private rafId: number | null = null;
    private stopped = false;

    /** Latest activity state; we only publish while it is `active`. */
    private activity: ActivityState = 'active';
    /** Last `idle` flag written to presence — `join()` publishes us as active. */
    private publishedIdle = false;

    // Cursor send throttling.
    private lastClient: { x: number; y: number } | null = null;
    private lastSentAt = 0;
    private trailingTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        modeler: Modeler,
        private readonly session: CollaborationSession,
        private readonly idle: IdleDetector,
    ) {
        this.canvas = modeler.get('canvas');
        this.eventBus = modeler.get('eventBus');
        this.elementRegistry = modeler.get('elementRegistry');
        this.container = this.canvas.getContainer();
    }

    start(): void {
        this.createLayer();

        // Outgoing: our pointer.
        this.container.addEventListener('mousemove', this.onMouseMove);
        this.container.addEventListener('mouseleave', this.onMouseLeave);

        // Outgoing: our selection.
        this.eventBus.on('selection.changed', this.onSelectionChanged);

        // Incoming: peer identities. Small and low-churn, so this one stays
        // subscribed even while away — it is what keeps the presence bar honest.
        this.unsubscribes.push(this.session.onPeers(this.onPeers));

        // Incoming: cursors and selections, attached only while we are not away.
        // Fires immediately with the current state, which performs the first attach.
        this.unsubscribes.push(this.idle.onChange(this.onActivityChange));
    }

    stop(): void {
        this.stopped = true;
        this.detachPeerStreams();
        if (this.trailingTimer) clearTimeout(this.trailingTimer);
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);

        try {
            this.container.removeEventListener('mousemove', this.onMouseMove);
            this.container.removeEventListener('mouseleave', this.onMouseLeave);
            this.eventBus.off('selection.changed', this.onSelectionChanged);
        } catch { /* modeler may already be destroyed */ }

        for (const unsub of this.unsubscribes.splice(0)) {
            try { unsub(); } catch { /* already detached */ }
        }
        this.session.clearCursor().catch(() => {});
        this.layer?.remove();
        this.layer = null;
        this.cursors.clear();
        this.selections.clear();
        this.identities.clear();
    }

    // --- coordinate mapping --------------------------------------------------

    /** Screen (client) pixels → diagram coordinates. */
    private toDiagram(clientX: number, clientY: number): { x: number; y: number } {
        const box = this.container.getBoundingClientRect();
        const vb = this.canvas.viewbox();
        const scale = this.canvas.zoom();
        return {
            x: vb.x + (clientX - box.left) / scale,
            y: vb.y + (clientY - box.top) / scale,
        };
    }

    /** Diagram coordinates → pixels relative to the overlay's top-left. */
    private toScreen(x: number, y: number): { x: number; y: number } {
        const vb = this.canvas.viewbox();
        const scale = this.canvas.zoom();
        return { x: (x - vb.x) * scale, y: (y - vb.y) * scale };
    }

    // --- activity ------------------------------------------------------------

    private onActivityChange = (state: ActivityState): void => {
        if (this.stopped) return;
        this.activity = state;

        // One small presence write per transition in or out of activity — not
        // per state — so peers can dim someone who has stepped away.
        const idle = state !== 'active';
        if (idle !== this.publishedIdle) {
            this.publishedIdle = idle;
            this.session.setIdle(idle).catch(() => {});
        }

        if (state === 'away') this.detachPeerStreams();
        else this.attachPeerStreams();

        if (state === 'active') return;
        // Stepped away: stop the cursor stream and take our cursor off every
        // peer's canvas, so we neither publish nor linger as a stale pointer.
        this.lastClient = null;
        if (this.trailingTimer) { clearTimeout(this.trailingTimer); this.trailingTimer = null; }
        this.session.clearCursor().catch(() => {});
    };

    /** Idempotent: subscribing twice would double every peer's cursor updates. */
    private attachPeerStreams(): void {
        if (this.peerSubs || this.stopped) return;
        this.peerSubs = [
            this.session.onCursors(this.onPeerCursor, this.onPeerGone),
            this.session.onSelections(this.onPeerSelection, this.onPeerSelectionCleared),
        ];
    }

    private detachPeerStreams(): void {
        if (!this.peerSubs) return;
        for (const unsub of this.peerSubs.splice(0)) {
            try { unsub(); } catch { /* already detached */ }
        }
        this.peerSubs = null;
        // Drop what we were rendering: without the streams these views would
        // freeze mid-motion and go stale. Re-attaching replays the current
        // cursors and selections, so nothing is lost on the way back.
        for (const uid of [...this.cursors.keys()]) this.onPeerGone(uid);
        for (const uid of [...this.selections.keys()]) this.onPeerSelectionCleared(uid);
    }

    // --- outgoing ------------------------------------------------------------

    private onMouseMove = (e: MouseEvent): void => {
        // The detector listens on the document in the capture phase, so a move
        // that ends a pause has already flipped us back to `active` by the time
        // this runs — the first move after a pause still publishes.
        if (this.activity !== 'active') return;
        this.lastClient = { x: e.clientX, y: e.clientY };
        const now = Date.now();
        const elapsed = now - this.lastSentAt;
        if (elapsed >= CURSOR_THROTTLE_MS) {
            this.flushCursor();
        } else if (!this.trailingTimer) {
            this.trailingTimer = setTimeout(() => {
                this.trailingTimer = null;
                this.flushCursor();
            }, CURSOR_THROTTLE_MS - elapsed);
        }
    };

    private flushCursor(): void {
        if (!this.lastClient || this.stopped || this.activity !== 'active') return;
        this.lastSentAt = Date.now();
        const { x, y } = this.toDiagram(this.lastClient.x, this.lastClient.y);
        this.session.setCursor(x, y).catch(() => {});
    }

    private onMouseLeave = (): void => {
        this.lastClient = null;
        if (this.trailingTimer) { clearTimeout(this.trailingTimer); this.trailingTimer = null; }
        this.session.clearCursor().catch(() => {});
    };

    private onSelectionChanged = (event: { newSelection: Array<{ id: string }> }): void => {
        // A peer's edit can change our selection without us touching anything —
        // that is their traffic to pay for, not a reason for an idle window to write.
        if (this.activity !== 'active') return;
        const ids = (event.newSelection || []).map((el) => el.id);
        this.session.setSelection(ids).catch(() => {});
    };

    // --- incoming ------------------------------------------------------------

    private onPeers = (peers: Peer[]): void => {
        const seen = new Set<string>();
        for (const peer of peers) {
            this.identities.set(peer.uid, peer);
            seen.add(peer.uid);
            // Re-style any already-rendered cursor/selection for this peer.
            const cursor = this.cursors.get(peer.uid);
            if (cursor) {
                cursor.label.textContent = peer.name;
                cursor.label.style.backgroundColor = peer.color;
                cursor.path.setAttribute('fill', peer.color);
            }
            const selection = this.selections.get(peer.uid);
            if (selection) {
                selection.color = peer.color;
                selection.boxes.forEach((b) => { b.style.borderColor = peer.color; });
            }
        }
        // Drop cursors/selections for peers who have left.
        for (const uid of [...this.cursors.keys()]) if (!seen.has(uid)) this.onPeerGone(uid);
        for (const uid of [...this.selections.keys()]) if (!seen.has(uid)) this.onPeerSelectionCleared(uid);
        for (const uid of [...this.identities.keys()]) if (!seen.has(uid)) this.identities.delete(uid);
    };

    private onPeerCursor = (uid: string, cursor: CursorPayload): void => {
        let view = this.cursors.get(uid);
        if (!view) view = this.createCursorView(uid);
        view.targetX = cursor.x;
        view.targetY = cursor.y;
        if (!view.initialised) {
            view.x = cursor.x;
            view.y = cursor.y;
            view.initialised = true;
        }
        this.ensureRaf();
    };

    private onPeerGone = (uid: string): void => {
        const view = this.cursors.get(uid);
        if (view) { view.root.remove(); this.cursors.delete(uid); }
    };

    private onPeerSelection = (uid: string, selection: SelectionPayload): void => {
        this.onPeerSelectionCleared(uid);
        const color = this.identities.get(uid)?.color ?? DEFAULT_COLOR;
        const boxes = (selection.ids || []).map(() => this.createSelectionBox(color));
        this.selections.set(uid, { ids: selection.ids || [], color, boxes });
        this.ensureRaf();
    };

    private onPeerSelectionCleared = (uid: string): void => {
        const view = this.selections.get(uid);
        if (view) { view.boxes.forEach((b) => b.remove()); this.selections.delete(uid); }
    };

    // --- rendering -----------------------------------------------------------

    private createLayer(): void {
        if (getComputedStyle(this.container).position === 'static') {
            this.container.style.position = 'relative';
        }
        const layer = document.createElement('div');
        layer.className = 'collab-layer';
        layer.style.cssText =
            'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:100;';
        this.container.appendChild(layer);
        this.layer = layer;
    }

    private createCursorView(uid: string): PeerCursorView {
        const peer = this.identities.get(uid);
        const color = peer?.color ?? DEFAULT_COLOR;

        const root = document.createElement('div');
        root.style.cssText = 'position:absolute;top:0;left:0;transform:translate(-9999px,-9999px);will-change:transform;';

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.style.cssText = 'display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.3));';
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('d', 'M5 3 L5 21 L10 16 L13 22 L16 20 L13 14 L20 14 Z');
        path.setAttribute('fill', color);
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);

        const label = document.createElement('div');
        label.textContent = peer?.name ?? '';
        label.style.cssText =
            'position:absolute;top:16px;left:14px;white-space:nowrap;padding:1px 6px;border-radius:8px;' +
            `font:600 11px/1.4 system-ui,sans-serif;color:#fff;background:${color};box-shadow:0 1px 2px rgba(0,0,0,0.25);`;

        root.appendChild(svg);
        root.appendChild(label);
        this.layer?.appendChild(root);

        const view: PeerCursorView = { targetX: 0, targetY: 0, x: 0, y: 0, initialised: false, root, label, path };
        this.cursors.set(uid, view);
        return view;
    }

    private createSelectionBox(color: string): HTMLDivElement {
        const box = document.createElement('div');
        box.style.cssText =
            'position:absolute;top:0;left:0;border:2px solid ' + color +
            ';border-radius:3px;box-sizing:border-box;transform:translate(-9999px,-9999px);will-change:transform,width,height;';
        this.layer?.appendChild(box);
        return box;
    }

    /** Bounding box of an element in diagram coordinates (shapes or connections). */
    private diagramBBox(id: string): { x: number; y: number; w: number; h: number } | null {
        const el = this.elementRegistry.get(id);
        if (!el) return null;
        if (typeof el.x === 'number' && typeof el.y === 'number'
            && typeof el.width === 'number' && typeof el.height === 'number') {
            return { x: el.x, y: el.y, w: el.width, h: el.height };
        }
        if (Array.isArray(el.waypoints) && el.waypoints.length) {
            const xs = el.waypoints.map((p: { x: number }) => p.x);
            const ys = el.waypoints.map((p: { y: number }) => p.y);
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        }
        return null;
    }

    private ensureRaf(): void {
        if (this.rafId === null && !this.stopped) {
            this.rafId = requestAnimationFrame(this.tick);
        }
    }

    private tick = (): void => {
        this.rafId = null;
        if (this.stopped) return;

        // Cursors: lerp toward target (in diagram space), then project to screen.
        for (const view of this.cursors.values()) {
            view.x += (view.targetX - view.x) * LERP;
            view.y += (view.targetY - view.y) * LERP;
            const s = this.toScreen(view.x, view.y);
            view.root.style.transform = `translate(${s.x}px, ${s.y}px)`;
        }

        // Selection outlines: re-project each element's box every frame so it
        // tracks pan/zoom.
        const scale = this.canvas.zoom();
        for (const sel of this.selections.values()) {
            sel.ids.forEach((id, i) => {
                const box = sel.boxes[i];
                if (!box) return;
                const bbox = this.diagramBBox(id);
                if (!bbox) { box.style.display = 'none'; return; }
                box.style.display = 'block';
                const s = this.toScreen(bbox.x, bbox.y);
                const pad = 3;
                box.style.transform = `translate(${s.x - pad}px, ${s.y - pad}px)`;
                box.style.width = `${bbox.w * scale + pad * 2}px`;
                box.style.height = `${bbox.h * scale + pad * 2}px`;
            });
        }

        if (this.cursors.size > 0 || this.selections.size > 0) {
            this.rafId = requestAnimationFrame(this.tick);
        }
    };
}
