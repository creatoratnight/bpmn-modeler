import { diff_match_patch } from 'diff-match-patch';

// Text-diff delta protocol. Instead of shipping the whole (compressed) document
// on every edit, a writer publishes small patches against its own previous
// state, plus an occasional full snapshot as a base. Receivers reconstruct the
// writer's document locally from snapshot + patches and import the result — so
// only a few hundred bytes cross the wire per edit instead of the whole model.

const dmp = new diff_match_patch();

/** A unified-diff-style patch turning `prev` into `next`. */
export function makePatch(prev: string, next: string): string {
    return dmp.patch_toText(dmp.patch_make(prev, next));
}

/** Apply a patch to `base`; returns the result, or null if it did not apply cleanly. */
export function applyPatch(base: string, patchText: string): string | null {
    const [result, applied] = dmp.patch_apply(dmp.patch_fromText(patchText), base);
    return applied.every(Boolean) ? (result as string) : null;
}

export interface WriterSnapshot { xml: string; seq: number; t: number }
export interface WriterOp { seq: number; base: number; patch: string; t: number }

/**
 * Reconstructs one remote writer's document from its snapshot and ordered patch
 * ops. Ops that arrive out of order (e.g. before the snapshot on join, or after
 * a gap) are buffered by their base seq and applied once the chain is contiguous.
 *
 * Every accepted update returns the writer's new full document (to import), or
 * null when nothing new could be applied (buffered, stale, or a failed patch —
 * which self-heals on the next snapshot).
 */
export class RemoteWriter {
    private xml: string | null = null;
    private seq = -1;
    private t = 0;
    /** Buffered ops keyed by their `base` seq, awaiting a contiguous chain. */
    private readonly pending = new Map<number, WriterOp>();

    /** Server timestamp of the last accepted update (for cross-writer recency). */
    get lastT(): number { return this.t; }

    onSnapshot(snap: WriterSnapshot): string | null {
        if (snap.seq <= this.seq) return null; // older than what we already have
        this.xml = snap.xml;
        this.seq = snap.seq;
        this.t = snap.t;
        for (const base of [...this.pending.keys()]) {
            if (base < this.seq) this.pending.delete(base);
        }
        this.drain();
        return this.xml;
    }

    onOp(op: WriterOp): string | null {
        if (op.seq <= this.seq) return null; // already applied
        this.pending.set(op.base, op);
        return this.drain();
    }

    private drain(): string | null {
        let applied: string | null = null;
        for (;;) {
            const op = this.pending.get(this.seq);
            if (!op || this.xml === null) break;
            this.pending.delete(op.base);
            const next = applyPatch(this.xml, op.patch);
            if (next === null) break; // desync — wait for the writer's next snapshot
            this.xml = next;
            this.seq = op.seq;
            this.t = op.t;
            applied = next;
        }
        return applied;
    }
}
