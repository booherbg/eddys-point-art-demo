// The worker pool (Study 115, plan 2026-11-18-live-forge, Task 2, rulings 2, 3 and 6): N drawing workers, each given the
// one compiled module, dealt jobs by the order. No DOM at load, so node imports it for its tests; the page passes the
// real `Worker` factory.
import { groupKey } from "./core.js";
import { picture } from "./draw-job.js";
import { lookOf } from "./detail.js";

/**
 * How many workers (ruling 6): the machine's cores minus one, at most seven, on a phone as on a laptop (Blaine, 2026-11-26:
 * "Let the phone deal with it"; it was three at most on a phone). A core count above the cap is never trusted (a browser that
 * hides its machine reports a made-up one).
 */
export function workerCount({ cores }) {
  const spare = Math.max(1, (Number.isFinite(cores) ? cores : 1) - 1);
  return Math.min(MAX_SUGGESTED, spare);
}

/** How often, in seconds, the pool sweeps the queue for jobs off screen too long. */
const SWEEP_EVERY_S = 0.5;
/** The most workers `workerCount` gives any machine. */
export const MAX_SUGGESTED = 7;
/** The Workers panel's range for a count she sets (Task 28): past the core count the workers share cores, and the panel's numbers show it. */
export const MIN_WORKERS = 1;
export const MAX_WORKERS = 12;
/** `workerCount`'s rule as the Workers panel says it (Task 28); built from its cap, so the sentence and the rule change together. */
export const WORKER_RULE = `One worker per core, less one for the game, at most ${MAX_SUGGESTED}.`;

/** The phone rule (ruling 6): a coarse pointer and a short side under 700 CSS px. Only the bench reads it now (its frame slice); nothing
 * that shapes the park's pictures does. */
export function isPhone({ coarse, width, height }) {
  return !!coarse && Math.min(width, height) < 700;
}

/** Whether this browser is a phone. */
export function detectPhone() {
  return isPhone({ coarse: matchMedia("(pointer: coarse)").matches, width: innerWidth, height: innerHeight });
}

/** The count for this browser. */
export function detectWorkerCount() {
  return workerCount({ cores: navigator.hardwareConcurrency });
}

export class Pool {
  /**
   * `module`: the compiled forge module (posted to each worker once). `count`: workers. `makeWorker(id)`: a worker whose
   * messages follow `pool-worker.js`. `order`: the `Order`. `slow`: ms each job waits first (a test page's way to show a slow machine), `onDrawn(result)`: each sprite as it lands, `{name, family, density,
   * bitmap, w, h, ax, ay, ms}`, the bitmap made by the worker and transferred. `now()`: seconds on any steady clock (the Workers panel's bars read each job's age from it).
   *
   * The count can change while it runs (`resize`, Task 28): a worker is added with no reload, and one taken away finishes the sprite it is
   * drawing first, so no job is lost or drawn twice. Each worker keeps its id for good (a taken one's id is never reused).
   */
  constructor({ module, count, makeWorker, order, onDrawn, onError, onDropped, store, stamps, slow = 0, wantFrg = false, now = () => performance.now() / 1000 }) {
    this.order = order;
    order.keepStyle("classic@day"); // the look the pool starts in, so the order's current look and the jobs' agree
    /** Whether each landed copy carries its one-sprite `FRG1` bytes (`frg`) too: the bench lands them itself. */
    this.wantFrg = wantFrg;
    this.style = "classic@day";
    this.slow = slow;
    this.module = module;
    this.store = store;
    this.stamps = stamps;
    this.cache = { hits: 0, misses: 0 };
    this.epochs = new Map();
    this.clearing = new Map();
    this.makeWorker = makeWorker;
    this.now = now;
    this.onDrawn = onDrawn || (() => {});
    this.onError = onError || (() => {});
    /** A queued job that waited off screen too long and was dropped (`Order.sweep`): the page ends its reserve. */
    this.onDropped = onDropped || (() => {});
    this.sweptAt = -Infinity;
    /** id -> `{id, w, job, retiring}`: `job` is `{name, family, density, at}` while it draws, `retiring` once it is to go. */
    this.slots = new Map();
    this.nextId = 0;
    this.idle = [];
    this.pumping = false;
    this.stats = { drawn: 0, ms: 0, failed: 0 };
    /** Jobs a worker has finished, drawn or read from the cache or failed; only ever goes up (the top bar's tick bar). */
    this.finished = 0;
    /** family@density -> `{n, ms}`: what each kind of job took, for the Workers panel's bars. */
    this.means = new Map();
    /** The current burst of work: `have` sprites landed of the `of` asked since the pool last sat idle (or since `newBurst`). */
    this.burst = { have: 0, of: 0 };
    this.ready = Promise.all(Array.from({ length: count }, () => this.#add())).then(() => this.#schedule());
  }

  /** Starts one worker; the promise is for its first message. */
  #add() {
    const id = this.nextId++;
    const w = this.makeWorker(id);
    const slot = { id, w, job: null, retiring: false };
    this.slots.set(id, slot);
    this.order.looks.set(id, "classic@day"); // a worker starts in the first look, whatever the page shows
    return new Promise((res) => {
      slot.res = res;
      w.onmessage = (e) => {
        if (e.data.kind === "ready") {
          w.onmessage = (ev) => this.#message(id, ev.data);
          this.idle.push(id);
          this.#schedule();
          res();
        }
      };
      w.postMessage({ kind: "init", id, module: this.module, stamps: this.stamps });
    });
  }

  /** The workers that are here to stay (not yet told to go). */
  get size() {
    let n = 0;
    for (const s of this.slots.values()) if (!s.retiring) n++;
    return n;
  }

  /**
   * Makes the count `n`: more are started, fewer are taken away from the highest id down, an idle one first; a busy one is told to go and
   * is gone when its sprite lands. A family only a taken worker held is open to the rest again (`Order.dropWorker`).
   */
  resize(n) {
    n = Math.max(1, Math.floor(n));
    while (this.size < n) {
      const gone = [...this.slots.values()].filter((s) => s.retiring).sort((a, b) => b.id - a.id)[0];
      if (gone && gone.job) gone.retiring = false; // a worker still finishing its sprite is kept rather than replaced
      else this.#add();
    }
    while (this.size > n) {
      const keep = [...this.slots.values()].filter((s) => !s.retiring).sort((a, b) => b.id - a.id);
      const s = keep.find((k) => !k.job) || keep[0];
      s.retiring = true;
      if (!s.job) this.#drop(s);
    }
    this.#schedule();
  }

  #drop(slot) {
    this.slots.delete(slot.id);
    const at = this.idle.indexOf(slot.id);
    if (at >= 0) this.idle.splice(at, 1);
    this.order.dropWorker(slot.id);
    slot.w.terminate();
    if (slot.res) slot.res(); // a worker taken away before it was ready no longer holds `ready` back
  }

  /** Pictures asked for and not yet handed to a worker. */
  get waiting() {
    return this.order.waiting();
  }

  /** Workers with a job in flight. */
  get working() {
    let n = 0;
    for (const s of this.slots.values()) if (s.job) n++;
    return n;
  }

  /**
   * What the Workers panel shows of each worker still here, in id order: `{n, job}` with `n` its place (1 up) and `job` null when idle, else
   * `{name, family, density, elapsed, mean}` (seconds in flight, and ms the kind of job takes, `meanMs`). Read only when the panel is open.
   */
  view() {
    const t = this.now();
    const out = [];
    for (const s of [...this.slots.values()].filter((x) => !x.retiring).sort((a, b) => a.id - b.id)) {
      out.push({ n: out.length + 1, job: s.job && { name: s.job.name, family: s.job.family, density: s.job.density, elapsed: t - s.job.at, mean: this.meanMs(s.job.family, s.job.density) } });
    }
    return out;
  }

  /** How long a job of `family` at `density` takes, in ms: that kind's mean, else the whole pool's, else 0 before any sprite has landed. */
  meanMs(family, density = 1) {
    const m = this.means.get(`${family}@${density > 1 ? density : 1}`);
    if (m && m.n) return m.ms / m.n;
    return this.stats.drawn ? this.stats.ms / this.stats.drawn : 0;
  }

  /** The panel's "Drawn" counts start again from now: what still waits or draws is the whole of the burst. */
  newBurst() {
    this.burst = { have: 0, of: this.order.waiting() + this.working };
  }

  /** True when nothing waits, nothing is drawing and no name has failed (a failed name keeps its sketch, so the page is not all set). */
  settled() {
    return this.order.waiting() === 0 && this.working === 0 && this.stats.failed === 0;
  }

  setView(view) {
    this.order.setView(view);
    // Twice a second: a queued job whose sprite has been off screen for `OFF_SCREEN_S` goes, and leaves the burst's count of what was asked.
    const t = this.now();
    if (t - this.sweptAt < SWEEP_EVERY_S) return;
    this.sweptAt = t;
    for (const d of this.order.sweep(t)) {
      this.burst.of = Math.max(this.burst.have, this.burst.of - 1);
      this.onDropped(d);
    }
  }

  /** Select the look sent with new drawing work and drop queued work for older looks. */
  setStyle(style) {
    style = lookOf(style);
    this.style = style;
    const dropped = this.order.keepStyle(style);
    this.burst.of = Math.max(this.burst.have, this.burst.of - dropped);
  }

  /** The Detail step she holds now (see `Order.setDetail`). */
  setDetail(d) {
    this.order.setDetail(d);
  }

  /** Ask for a sprite (see `Order.request`). Jobs go out together at the end of the tick, so a frame's whole ask is sorted first. */
  request(r) {
    const quiet = this.order.waiting() === 0 && this.working === 0;
    const before = this.order.waiting();
    this.order.request({ ...r, style: lookOf(r.style || this.style) });
    if (this.order.waiting() > before) {
      if (quiet) this.burst = { have: 0, of: 0 };
      this.burst.of++;
    }
    this.#schedule();
  }

  #schedule() {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      this.#pump();
    });
  }

  #pump() {
    // Each idle worker is offered its own family's jobs first, then a family nobody holds, then a steal.
    for (const mode of ["mine", "unheld", "any"]) {
      for (const id of [...this.idle]) {
        const job = this.order.next(id, mode);
        if (!job) continue;
        this.idle.splice(this.idle.indexOf(id), 1);
        const density = job.density > 1 ? job.density : 1;
        const slot = this.slots.get(id);
        const style = job.style || "classic";
        slot.job = { name: job.name, family: job.family, density, style, wantFrg: this.wantFrg, at: this.now(), epoch: this.epochs.get(density) };
        if (this.store) this.#lookUp(slot);
        else this.#draw(slot);
      }
    }
  }

  #draw(slot, cacheGeneration) {
    const { name, family, density, style, wantFrg } = slot.job;
    slot.w.postMessage({ kind: "draw", id: slot.id, name, family, density, style, wantFrg, slow: this.slow, cacheGeneration });
  }

  async #lookUp(slot) {
    const job = slot.job;
    await this.clearing.get(job.density);
    const { copy, generation } = await this.store.read(job);
    let hit;
    if (copy) {
      try {
        hit = await picture(copy, job, (rgba, w, h) => createImageBitmap(new ImageData(rgba, w, h)));
        // The worker time it took when it was drawn (a copy stored before that was kept counts none).
        hit.ms = Number.isFinite(copy.ms) ? copy.ms : 0;
      } catch {
        // A bad bundle is a miss. A successful draw will replace it.
      }
    }
    if (!this.slots.has(slot.id)) {
      hit?.bitmap.close();
      return;
    }
    if (job.epoch !== this.epochs.get(job.density) || hit) {
      this.#message(slot.id, { ...job, ...hit, cached: !!hit });
    } else {
      this.cache.misses++;
      this.#draw(slot, generation);
    }
  }

  async clearCached(density) {
    this.epochs.set(density, (this.epochs.get(density) ?? 0) + 1);
    this.cache.hits = this.cache.misses = 0;
    const pending = this.store?.clear(density);
    this.clearing.set(density, pending);
    await pending;
    if (this.clearing.get(density) === pending) this.clearing.delete(density);
  }

  #message(id, m) {
    const slot = this.slots.get(id);
    const stale = slot?.job && slot.job.epoch !== this.epochs.get(m.density);
    // A worker that built a group's models says how long it took, and holds them from then on; a failed build frees the group's
    // other sprites (and counts as measured, so none waits on it for good).
    // A reply in a style since left says nothing about the workers' models: the switch already forgot them (Task 7).
    const group = groupKey(m.family, m.name);
    if (lookOf(m.style || "classic") === this.style) {
      if (m.prep !== undefined) this.order.built(group, m.prep, id);
      else if (m.cached || stale) this.order.releaseBuild(group, id);
      else if (m.kind === "failed") this.order.buildFailed(group, id);
    }
    if (stale) {
      m.bitmap?.close();
      this.order.cancel(m.name, m.density, m.style);
      this.burst.of--;
    } else if (m.kind === "drew") {
      this.finished++;
      this.order.finish(m.name, m.style || "classic", m.density);
      if (m.cached) this.cache.hits++;
      else this.#recordDraw(m);
      this.burst.have++;
      this.onDrawn(m);
    } else if (m.kind === "failed") {
      this.finished++;
      this.order.fail(m.name, m.style || "classic", m.density);
      this.stats.failed++;
      this.burst.have++;
      this.onError(m);
    }
    if (!slot) return;
    slot.job = null;
    if (slot.retiring) {
      this.#drop(slot);
      return;
    }
    this.idle.push(id);
    this.#schedule();
  }

  #recordDraw(m) {
    this.stats.drawn++;
    this.stats.ms += m.ms || 0;
    const key = `${m.family}@${m.density > 1 ? m.density : 1}`;
    const mean = this.means.get(key) || { n: 0, ms: 0 };
    mean.n++;
    mean.ms += m.ms || 0;
    this.means.set(key, mean);
  }

  close() {
    for (const s of this.slots.values()) s.w.terminate();
    this.slots.clear();
    this.idle.length = 0;
  }
}
