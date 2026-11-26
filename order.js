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
// Workers: a sprite is drawn from its group's models (`groupKey`: a family's own models, or one portrait kind's pair; the forge builds
// only that group, Task 1b), and building it takes time (the fixed cost), so a group's jobs go first to a worker that holds its models.
// A worker takes the best of its own groups' jobs; else the best of a group nobody holds yet; else it steals the best of any (and
// holds that group too once its build lands, `built`).
//
// A build is a job of its own (Task 1b, b579): a worker that takes a sprite whose group it does not hold is given a build, then the
// sprite (`next` marks the job `build: true`; the worker's reply carries the build's time, `prep`, and the page calls `built`). While it builds, that group is that worker's:
// every other sprite of the group steps aside in the queue, holding no worker, and the other workers go on with the sprites of groups
// that are ready. A group that took over `SLOW_MS` to build is built by that one worker only, since each worker that held it would pay
// the whole cost and its memory again; one that built faster is open to every worker.

import { spriteKey } from "./detail.js";
import { groupKey } from "./core.js";

/** The frame's rank among `count` frames, coarsest first: the bits of `frame` reversed (count 32: 0, 16, 8, 24, ...). */
export function coarseRank(frame, count) {
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, count))));
  let r = 0;
  for (let b = 0; b < bits; b++) if (frame & (1 << b)) r |= 1 << (bits - 1 - b);
  return r;
}

/** A group whose models take longer than this to build, in ms, is slow: built once, by one worker. */
export const SLOW_MS = 1000;

export class Order {
  /** `boxes`: name -> `[w, h, ax, ay]`, a sprite's picture box about its anchor (the table's), so on screen means the box meets the view. */
  constructor({ boxes = {} } = {}) {
    this.boxes = boxes;
    /** name -> the latest ask, for names waiting. */
    this.queue = new Map();
    /** name -> "queued" | "drawing" | "done" | "failed". */
    this.states = new Map();
    /** group -> the set of workers that built its models. */
    this.holders = new Map();
    /** group -> the worker building its models now (the group's sprites wait for it). */
    this.building = new Map();
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    /** The style the workers' models are in (Task 7): a worker draws one style's models at a time. */
    this.style = "classic";
    /** The Detail step held, or null until one is set: a fine picture finer than it waits behind the current look's own. */
    this.detail = null;
    this.nextSeq = 0;
    /** worker -> the look its forge is built for; a job in another look costs it a whole rebuild. */
    this.looks = new Map();
    /** How many times a worker took a job in a look other than its own (a forge rebuild each). */
    this.rebuilds = 0;
    /** group -> ms its models took to build, as a worker measured it. */
    this.prep = new Map();
  }

  /** Worker `worker` built `group`'s models in `ms`: it holds them now, and the group's other sprites are free to go. */
  built(group, ms, worker) {
    this.prep.set(group, ms);
    this.building.delete(group);
    if (worker !== undefined) {
      if (!this.holders.has(group)) this.holders.set(group, new Set());
      this.holders.get(group).add(worker);
    }
  }

  /** A build that failed on `worker`: the group is nobody's and counts as measured (0 ms), so no sprite waits on it for good. */
  releaseBuild(group, worker) {
    if (this.building.get(group) === worker) this.building.delete(group);
  }

  buildFailed(group, worker) {
    this.releaseBuild(group, worker);
    if (!this.prep.has(group)) this.prep.set(group, 0);
  }

  /** Whether `key` is slow: a group (or any group of the family) measured over `SLOW_MS`. */
  slow(key) {
    for (const [g, ms] of this.prep) if (ms > SLOW_MS && (g === key || g.startsWith(`${key}/`))) return true;
    return false;
  }

  /** The world rectangle the screen shows now. */
  setView({ x, y, w, h }) {
    this.view = { x, y, w, h };
  }

  /**
   * Ask for a sprite: `{name, family, style?, density?, x, y, frame?: {index, count, shown}, prefetch?}`. A name, style and
   * density already waiting keep their place in the queue but take the newer ask (the frame showing now moves; so does a guest).
   */
  request(r) {
    if (!r.family) throw new Error(`no family for sprite ${r.name}`);
    const id = jobKey(r.name, r.style, r.density);
    const s = this.states.get(id);
    if (s === "drawing" || s === "done" || s === "failed") return;
    this.states.set(id, "queued");
    const prior = this.queue.get(id);
    this.queue.set(id, { ...r, seq: prior ? prior.seq : this.nextSeq++ });
  }

  /** "queued", "drawing", "done", or undefined for a sprite in a style and density. A number in the second place means density. */
  state(name, styleOrDensity = "classic", density = 1) {
    const style = typeof styleOrDensity === "string" ? styleOrDensity : "classic";
    const d = typeof styleOrDensity === "number" ? styleOrDensity : density;
    return this.states.get(jobKey(name, style, d));
  }

  /**
   * A new look is selected: nothing queued is dropped (Blaine, 2026-11-26: "don't remove anything from the queue"). The current look's jobs
   * go first (`#key`'s band 0), every other look's after them in the order they were asked, so a look she left finishes in the
   * background; a worker's in-flight job finishes as ever. A new style also forgets
   * which workers hold which groups (a worker's models are one style's, and it builds the next style's afresh, group by group,
   * as its sprites are asked for), so a group built in one style is never taken for another's. The groups' build times stay: how
   * long a group takes does not depend on its look.
   */
  keepStyle(style) {
    if (style !== this.style) {
      this.style = style;
      this.holders.clear();
      this.building.clear();
    }
    return 0;
  }

  /** The Detail step she holds now: a queued fine picture finer than it waits behind the current look's own. */
  setDetail(d) {
    this.detail = d;
  }

  /** How many names wait for a worker. */
  waiting() {
    return this.queue.size;
  }

  /** `a` before `b`: negative when a is more urgent. */
  #key(r, worker) {
    const other = (r.style || "classic") !== this.style || (this.detail !== null && r.density > this.detail);
    // A worker keeps its look: it takes the jobs of its own look first, and changes look only when none are left.
    if (other) return [1, (r.style || "classic") === this.looks.get(worker) ? 0 : 1, 0, 0, 0, r.seq];
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
    return [0, bucket, r.density > 1 ? 1 : 0, later, rank, dist];
  }

  /**
   * The next job for `worker` (an id), or null when nothing waits; marks it drawing and the worker a holder. Urgency
   * beats affinity: a family's own or unheld job is taken only when its bucket is no worse than the best job's.
   * `mode` "mine" or "unheld" offers only that kind (null when it is not urgent enough), so the pool can give every
   * idle worker its own family first, then unheld, then "any" (a steal).
   */
  next(worker, mode = "any") {
    let mine = null, unheld = null, any = null;
    // Another look's jobs wait until the current look has none queued at all (not only none this worker may take), so a worker
    // never rebuilds its forge for an old look while a current-look job is only held back.
    let current = false;
    for (const r of this.queue.values()) if (this.#key(r, worker)[0] === 0) { current = true; break; }
    for (const r of this.queue.values()) {
      const group = groupKey(r.family, r.name);
      const key = this.#key(r, worker);
      if (key[0] === 1 && current) continue;
      const entry = { r, key, group };
      if (key[0] === 1) {
        if (!any || less(key, any.key)) any = entry; // another look's job: any worker may draw it, after the current look's
        continue;
      }
      if (!this.#may(worker, group)) continue;
      const held = this.holders.get(group);
      if (!any || less(key, any.key)) any = entry;
      if (held && held.has(worker)) {
        if (!mine || less(key, mine.key)) mine = entry;
      } else if (!held || held.size === 0) {
        if (!unheld || less(key, unheld.key)) unheld = entry;
      }
    }
    if (!any) return null;
    const ok = (e) => e && (e.key[0] < any.key[0] || (e.key[0] === any.key[0] && e.key[1] <= any.key[1]));
    let pick;
    if (mode === "mine") pick = ok(mine) ? mine : null;
    else if (mode === "unheld") pick = ok(unheld) ? unheld : null;
    else pick = ok(mine) ? mine : ok(unheld) ? unheld : any;
    if (!pick) return null;
    const { name } = pick.r;
    const id = jobKey(name, pick.r.style, pick.r.density);
    this.queue.delete(id);
    this.states.set(id, "drawing");
    const look = pick.r.style || "classic";
    const was = this.looks.get(worker);
    this.looks.set(worker, look);
    if (was !== undefined && was !== look) {
      // The worker rebuilds its forge for this look, so it holds none of another look's groups.
      this.rebuilds++;
      for (const h of this.holders.values()) h.delete(worker);
    }
    if (pick.key[0] === 1) return { ...pick.r, build: true };
    const held = this.holders.get(pick.group);
    // A group this worker does not hold is built first, as a job of its own; while it is, the group is this worker's alone.
    if (held && held.has(worker)) return pick.r;
    // The first build of a group is the one the group's sprites wait on; once a worker holds it, another's build holds nobody back.
    if (!held || held.size === 0) this.building.set(pick.group, worker);
    return { ...pick.r, build: true };
  }

  /**
   * Whether `worker` may take a job of `group` now: its own (it holds the models); else one nobody is building (the sprite steps aside while
   * another worker builds, and holds no worker), unless the group is slow and a worker already holds it (only its holders draw it).
   */
  #may(worker, group) {
    const held = this.holders.get(group);
    if (held && held.has(worker)) return true;
    if (this.building.has(group)) return this.building.get(group) === worker;
    return !(this.slow(group) && held && held.size > 0);
  }

  /**
   * Worker `worker` is gone (the Workers panel took it away, Task 28): it holds no family any more, so a family only it held is open to the
   * rest again (a slow family is built by one worker only, and would otherwise wait for one that no longer exists).
   */
  dropWorker(worker) {
    for (const held of this.holders.values()) held.delete(worker);
    for (const [group, w] of [...this.building]) if (w === worker) this.building.delete(group);
  }

  /**
   * The names waiting, next first, at most `limit` of them: `{name, density}` in the order `next` would give them to an idle worker
   * (the same keys against the view as it is now). Read only when the Workers panel is open.
   */
  upcoming(limit = 5) {
    const list = [];
    for (const r of this.queue.values()) {
      const entry = { r, key: this.#key(r, "") };
      let at = list.length;
      while (at > 0 && less(entry.key, list[at - 1].key)) at--;
      if (at < limit) {
        list.splice(at, 0, entry);
        if (list.length > limit) list.pop();
      }
    }
    return list.map(({ r }) => ({ name: r.name, density: r.density > 1 ? r.density : 1 }));
  }

  /** The sprite is drawn (`style` and `d`: its density, the game's own by default). */
  finish(name, styleOrDensity = "classic", density = 1) {
    const style = typeof styleOrDensity === "string" ? styleOrDensity : "classic";
    const d = typeof styleOrDensity === "number" ? styleOrDensity : density;
    this.states.set(jobKey(name, style, d), "done");
  }

  /** The page evicted this picture (Task 31): it may be asked for again. A name that failed stays failed. */
  forget(name, d = 1, style = "classic") {
    const id = jobKey(name, style, d);
    if (this.states.get(id) === "done") this.states.delete(id);
  }

  /** A copy cleared while it was in flight may be asked for again. */
  cancel(name, d, style) {
    const id = jobKey(name, style, d);
    if (this.states.get(id) === "drawing") this.states.delete(id);
  }

  /** A draw that failed: the name stays failed (not asked again; the page keeps its sketch). */
  fail(name, styleOrDensity = "classic", density = 1) {
    const style = typeof styleOrDensity === "string" ? styleOrDensity : "classic";
    const d = typeof styleOrDensity === "number" ? styleOrDensity : density;
    this.states.set(jobKey(name, style, d), "failed");
  }
}

const jobKey = (name, style = "classic", density = 1) => spriteKey(`${style}\0${name}`, density);

function less(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
