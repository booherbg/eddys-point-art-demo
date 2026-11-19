// The order a live forge draws in (Study 115, plan 2026-11-18-live-forge, Task 2, ruling 3). A pure module: no DOM, no
// timers, no workers, so its tests run in node.
//
// The page asks for a sprite by name every frame it needs one; each ask says where the sprite is (a world pixel, its
// center) and, for an animation, which frame it is and which frame is showing now. The order keeps one entry a name
// (a name asked five times is drawn once), and gives the next job to a worker when it is free. Urgency, most first:
//   1. on screen, then off screen, then the build bar's items (`prefetch`);
//   2. the frame showing now (and every sprite with no frames), then later frames coarse to fine: 0, 16, 8, 24, 4, 20,
//      12, 28, 2, ... (the bits of the frame number, reversed), so an animation first turns coarse and then smooth;
//   3. nearest the center of the view.
// A fine picture (the Detail dial's density above 1, Task 18) is asked under its own key `name@d` and comes after the game's size
// within its bucket, so the enlarged lower step is there to stand in before any fine picture is drawn.
// Keys are worked out at `next`, against the view as it is then, so a pan re-sorts the queue with no extra step.
//
// Workers: a family's models take time to build (the fixed cost), so a family's jobs go first to a worker that holds
// its models. A worker takes the best of its own families' jobs; else the best of a family nobody holds yet; else it
// steals the best of any (and holds that family too from then on).
//
// Slow families (Task 13, ruling 10): a family whose models take over `SLOW_MS` to build (the animals', 27 s in the wasm)
// is built by one worker only, since every worker that held it would pay the whole cost and its memory again, and it is
// drawn after the rest: a slow family's job is offered only when the first screen is done (`setFirstDone`) or no job of
// any other family waits. A family not yet measured is built by the one worker that took its first job; the others skip
// its jobs until that worker reports how long the build took (`prepared`). A family that built in under `SLOW_MS` is open
// to every worker, as before.

import { spriteKey } from "./detail.js";

/** The frame's rank among `count` frames, coarsest first: the bits of `frame` reversed (count 32: 0, 16, 8, 24, ...). */
export function coarseRank(frame, count) {
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, count))));
  let r = 0;
  for (let b = 0; b < bits; b++) if (frame & (1 << b)) r |= 1 << (bits - 1 - b);
  return r;
}

/** A family whose models take longer than this to build, in ms, is slow. */
export const SLOW_MS = 100;

export class Order {
  /** `prep`: family -> ms from a past run, so a slow family is known slow before its first build (a worker's own measure replaces it). `boxes`: name -> `[w, h, ax, ay]`, a sprite's picture box about its anchor (the table's), so on screen means the box meets the view. */
  constructor({ boxes = {}, prep = {} } = {}) {
    this.boxes = boxes;
    /** name -> the latest ask, for names waiting. */
    this.queue = new Map();
    /** name -> "queued" | "drawing" | "done" | "failed". */
    this.states = new Map();
    /** family -> the set of workers that built its models. */
    this.holders = new Map();
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    /** family -> ms its models took to build: what `prep` (a past run's measure, `prep.json`) says, then what a worker measures. */
    this.prep = new Map(Object.entries(prep));
    /** Whether the first screen's sprites are all in (the page says so; slow families wait for it). */
    this.firstDone = false;
  }

  /** The page says the first screen is done: the slow families may be drawn now. */
  setFirstDone(done = true) {
    this.firstDone = done;
  }

  /** A worker built `family`'s models in `ms`: kept, in place of any earlier figure for it. */
  prepared(family, ms) {
    this.prep.set(family, ms);
  }

  /** Whether `family` is slow: measured over `SLOW_MS`. */
  slow(family) {
    return (this.prep.get(family) || 0) > SLOW_MS;
  }

  /** The world rectangle the screen shows now. */
  setView({ x, y, w, h }) {
    this.view = { x, y, w, h };
  }

  /**
   * Ask for a sprite: `{name, family, x, y, frame?: {index, count, shown}, prefetch?}`. A name already waiting keeps its
   * place in the queue but takes the newer ask (the frame showing now moves; so does a guest); one drawing or drawn is
   * ignored.
   */
  request(r) {
    if (!r.family) throw new Error(`no family for sprite ${r.name}`);
    const id = spriteKey(r.name, r.density);
    const s = this.states.get(id);
    if (s === "drawing" || s === "done" || s === "failed") return;
    this.states.set(id, "queued");
    this.queue.set(id, r);
  }

  /** "queued", "drawing", "done", or undefined for a name never asked (at density `d`, the game's own by default). */
  state(name, d = 1) {
    return this.states.get(spriteKey(name, d));
  }

  /** How many names wait for a worker. */
  waiting() {
    return this.queue.size;
  }

  /** `a` before `b`: negative when a is more urgent. */
  #key(r) {
    const v = this.view;
    const b = this.boxes[r.name];
    // The wasm culls by box, so a sprite counts as on screen when its box meets the view (its anchor alone when it has no box).
    const onScreen = b
      ? r.x - b[2] < v.x + v.w && r.x - b[2] + b[0] > v.x && r.y - b[3] < v.y + v.h && r.y - b[3] + b[1] > v.y
      : r.x >= v.x && r.x < v.x + v.w && r.y >= v.y && r.y < v.y + v.h;
    const bucket = r.prefetch ? 2 : onScreen ? 0 : 1;
    let later = 0;
    let rank = 0;
    if (r.frame && r.frame.index !== r.frame.shown) {
      later = 1;
      rank = coarseRank(r.frame.index, r.frame.count);
    }
    const dist = Math.hypot(r.x - (v.x + v.w / 2), r.y - (v.y + v.h / 2));
    return [bucket, r.density > 1 ? 1 : 0, later, rank, dist];
  }

  /**
   * The next job for `worker` (an id), or null when nothing waits; marks it drawing and the worker a holder. Urgency
   * beats affinity: a family's own or unheld job is taken only when its bucket is no worse than the best job's.
   * `mode` "mine" or "unheld" offers only that kind (null when it is not urgent enough), so the pool can give every
   * idle worker its own family first, then unheld, then "any" (a steal).
   */
  next(worker, mode = "any") {
    let mine = null, unheld = null, any = null;
    // A slow family goes last: its jobs are held back while the first screen is not done and another family's job waits.
    const others = [...this.queue.values()].some((r) => !this.slow(r.family));
    for (const r of this.queue.values()) {
      if (!this.#may(worker, r.family, others)) continue;
      const key = this.#key(r);
      const entry = { r, key };
      const held = this.holders.get(r.family);
      if (!any || less(key, any.key)) any = entry;
      if (held && held.has(worker)) {
        if (!mine || less(key, mine.key)) mine = entry;
      } else if (!held || held.size === 0) {
        if (!unheld || less(key, unheld.key)) unheld = entry;
      }
    }
    if (!any) return null;
    const ok = (e) => e && e.key[0] <= any.key[0];
    let pick;
    if (mode === "mine") pick = ok(mine) ? mine : null;
    else if (mode === "unheld") pick = ok(unheld) ? unheld : null;
    else pick = ok(mine) ? mine : ok(unheld) ? unheld : any;
    if (!pick) return null;
    const { name, family } = pick.r;
    const id = spriteKey(name, pick.r.density);
    this.queue.delete(id);
    this.states.set(id, "drawing");
    if (!this.holders.has(family)) this.holders.set(family, new Set());
    this.holders.get(family).add(worker);
    return pick.r;
  }

  /**
   * Whether `worker` may take a job of `family` now. A family not yet measured, or a slow one, is the business of the
   * worker that holds it (nobody else builds it; an unheld one goes to whoever asks first); a slow one is also held back
   * until the first screen is done or no other family's job waits (`others`).
   */
  #may(worker, family, others) {
    const held = this.holders.get(family);
    const measured = this.prep.has(family);
    if (measured && !this.slow(family)) return true;
    if (held && held.size > 0 && !held.has(worker)) return false;
    return !this.slow(family) || this.firstDone || !others;
  }

  /** The sprite is drawn (`d`: its density, the game's own by default). */
  finish(name, d = 1) {
    this.states.set(spriteKey(name, d), "done");
  }

  /** The page evicted this picture (Task 31): it may be asked for again. A name that failed stays failed. */
  forget(name, d = 1) {
    const id = spriteKey(name, d);
    if (this.states.get(id) === "done") this.states.delete(id);
  }

  /** A draw that failed: the name stays failed (not asked again; the page keeps its sketch). */
  fail(name, d = 1) {
    this.states.set(spriteKey(name, d), "failed");
  }
}

function less(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
