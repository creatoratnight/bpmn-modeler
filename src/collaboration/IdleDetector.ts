/**
 * Tracks whether the person at this window is actually working, so the
 * collaboration layer can stop paying for windows that are only parked open.
 *
 * Three states, each one a cost tier:
 *
 *   - `active`  — interacted within `idleAfterMs`. Everything runs.
 *   - `idle`    — no interaction since then, or the tab is hidden. The cursor
 *                 stream stops (it is the highest-frequency channel we have) and
 *                 presence is flagged so peers can see the person stepped away.
 *   - `away`    — untouched for `awayAfterMs`, or hidden for `hiddenAwayMs`. The
 *                 heavy *incoming* subscriptions are detached as well, so a
 *                 parked window stops being a fan-out target for everyone who is
 *                 still working, and it gives up the persistence leadership.
 *
 * The detector itself does no I/O; it only reports transitions. The one timer it
 * keeps sleeps until the next state deadline rather than polling, so an `away`
 * window has no timer armed at all.
 *
 * Note on hidden tabs: browsers throttle `setTimeout` to about once a minute in
 * a background tab, so a transition can land late there. That is harmless — the
 * `visibilitychange` event already moves a hidden tab to `idle` immediately, and
 * every transition is re-evaluated against wall-clock time, never against the
 * number of ticks that fired.
 */
export type ActivityState = 'active' | 'idle' | 'away';

/** How long a window may sit untouched before it drops to each tier. */
export interface IdleThresholds {
    /** No interaction for this long → `idle` (cursor stream stops). */
    idleAfterMs: number;
    /** No interaction for this long → `away` (incoming subscriptions detach). */
    awayAfterMs: number;
    /** Hidden this long → `away`, sooner than a visible-but-untouched window. */
    hiddenAwayMs: number;
}

export const DEFAULT_IDLE_THRESHOLDS: IdleThresholds = {
    idleAfterMs: 60_000,
    awayAfterMs: 5 * 60_000,
    hiddenAwayMs: 60_000,
};

/**
 * Listened to on the document in the capture phase, so a wake-up is recorded
 * before any feature-level handler for the same event runs — the first mouse
 * move after a pause therefore publishes a cursor rather than being swallowed.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

export class IdleDetector {
    private readonly thresholds: IdleThresholds;

    private state: ActivityState = 'active';
    private lastActivityAt = Date.now();
    private hiddenSince: number | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private started = false;

    private readonly listeners = new Set<(state: ActivityState) => void>();

    /** Thresholds are overridable so tests can exercise the tiers in seconds. */
    constructor(thresholds?: Partial<IdleThresholds>) {
        this.thresholds = { ...DEFAULT_IDLE_THRESHOLDS, ...thresholds };
    }

    /** The current state; `active` until the detector is started and times out. */
    get current(): ActivityState {
        return this.state;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.lastActivityAt = Date.now();
        this.hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;
        for (const type of ACTIVITY_EVENTS) {
            document.addEventListener(type, this.onDomActivity, { passive: true, capture: true });
        }
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.applyState();
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        for (const type of ACTIVITY_EVENTS) {
            document.removeEventListener(type, this.onDomActivity, { capture: true });
        }
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.listeners.clear();
    }

    /** Subscribe to state changes; fires immediately with the current state. */
    onChange(callback: (state: ActivityState) => void): () => void {
        this.listeners.add(callback);
        callback(this.state);
        return () => this.listeners.delete(callback);
    }

    /**
     * Record activity that did not come from a DOM event — a local document
     * edit, say. An edit can only follow real input, but routing it through here
     * too means a suspended window can never end up publishing while it still
     * believes it is away.
     */
    notifyActivity(): void {
        this.lastActivityAt = Date.now();
        // A hidden tab stays idle whatever it receives: visibility is the
        // stronger signal, and `visibilitychange` wakes it the moment it is
        // shown again.
        if (this.hiddenSince !== null) return;
        // Already active: just move the deadline. The armed timer re-reads
        // `lastActivityAt` when it fires, so there is nothing to reschedule —
        // which keeps this cheap enough to call on every pointer move.
        if (this.state === 'active') return;
        this.applyState();
    }

    // --- internals -----------------------------------------------------------

    private onDomActivity = (): void => {
        this.notifyActivity();
    };

    private onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            this.hiddenSince = Date.now();
        } else {
            this.hiddenSince = null;
            this.lastActivityAt = Date.now();
        }
        this.applyState();
    };

    /** Re-evaluate the state, emit if it changed, and arm the next deadline. */
    private applyState = (): void => {
        if (!this.started) return;
        const now = Date.now();
        const next = this.computeState(now);
        if (next !== this.state) {
            this.state = next;
            for (const listener of this.listeners) listener(next);
        }
        this.schedule(now);
    };

    private computeState(now: number): ActivityState {
        const { idleAfterMs, awayAfterMs, hiddenAwayMs } = this.thresholds;
        if (this.hiddenSince !== null) {
            return now - this.hiddenSince >= hiddenAwayMs ? 'away' : 'idle';
        }
        const elapsed = now - this.lastActivityAt;
        if (elapsed >= awayAfterMs) return 'away';
        if (elapsed >= idleAfterMs) return 'idle';
        return 'active';
    }

    /** Sleep until the next possible transition — `away` needs no timer at all. */
    private schedule(now: number): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.state === 'away') return;
        const { idleAfterMs, awayAfterMs, hiddenAwayMs } = this.thresholds;
        const deadline = this.hiddenSince !== null
            ? this.hiddenSince + hiddenAwayMs
            : this.lastActivityAt + (this.state === 'active' ? idleAfterMs : awayAfterMs);
        this.timer = setTimeout(this.applyState, Math.max(0, deadline - now));
    }
}
