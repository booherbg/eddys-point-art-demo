// The bench's rules (plan 2026-11-18-live-sharp-art, Task 4), plain ES module with no DOM so node tests run it. The page
// (`bench-page.js`) draws a game view's names at 2x or 3x through the demo's pool and store, lands each copy on a stand-in
// page inside the design's slice, and logs the rows below for the still things and the motions apart.
//
// A view is the pair of lists Task 3 wrote (`views/<park>-<size>-z<zoom>-{still,moving}.txt`, one `family<TAB>name` a line):
// `still` is what one frame draws, `moving` is those plus every frame of each motion in view.

/** The most a frame spends landing copies (the design's land slice): a laptop 3 ms, a phone 4 ms. */
export const SLICE_LAPTOP_MS = 3;
export const SLICE_PHONE_MS = 4;
/** A frame past 16.7 ms misses a 60 Hz screen; a frame must pass it by this much to count, since vsync itself wobbles. */
export const FRAME_MS = 16.7;
export const FRAME_SLOP_MS = 1;
/** The fixed work a frame carries beside the landing, standing in for the game's own frame (the design's 6 ms). */
export const STAND_IN_LOAD_MS = 6;

/** A list file's text as `[{family, name}]`. */
export function parseList(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [family, name] = line.split("\t");
      return { family, name };
    });
}

/**
 * The key a name's motion goes by, or the name itself for a still thing. The frames of one motion share it:
 * a guest's walk (and her hair's) is four frames a facing, a ride's turn is its frames and each frame's fronts, a car's
 * fronts are one set a pitch. Only these kinds of motion are in the game's views today; a new kind adds its line here.
 */
export function motionKey(name) {
  let m = /^(.*_d\d+)_w\d+$/.exec(name);
  if (m) return `${m[1]}_w*`;
  m = /^(.+?)_f\d+(_front\d+)?$/.exec(name);
  if (m) return `${m[1]}_f*`;
  m = /^(.+_p\d+)_front(_hold)?\d+$/.exec(name);
  if (m) return `${m[1]}_front*`;
  return name;
}

/** The motions of a `moving` list: `[{key, family, names}]`, each holding more than one name, its names sorted. */
export function motionsOf(moving) {
  const by = new Map();
  for (const { family, name } of moving) {
    const key = motionKey(name);
    const id = `${family}/${key}`;
    if (!by.has(id)) by.set(id, { key, family, names: [] });
    by.get(id).names.push(name);
  }
  return [...by.values()].filter((m) => m.names.length > 1).map((m) => ({ ...m, names: [...new Set(m.names)].sort(naturally) }));
}

const naturally = (a, b) => a.localeCompare(b, "en", { numeric: true });

/**
 * The pool's asks for a view, one for each name of `moving` (a name in `still` is shown, so it carries no frame). A frame
 * of a motion that is not showing says which of the motion's frames it is, how many there are and which one shows, so the
 * `Order` puts it after every still thing and then coarse to fine. Every ask sits at the view's center, `(0, 0)`: the lists
 * hold no places, so nearness cannot order them and the order is the lists' own.
 */
export function requestsFor({ still, moving, density, style }) {
  const shown = new Set(still.map((s) => s.name));
  const frameOf = new Map();
  for (const m of motionsOf(moving)) {
    const showing = Math.max(0, m.names.findIndex((n) => shown.has(n)));
    m.names.forEach((n, index) => frameOf.set(`${m.family}/${n}`, { index, count: m.names.length, shown: showing }));
  }
  const seen = new Set();
  const asks = [];
  for (const { family, name } of [...still, ...moving]) {
    if (seen.has(`${family}/${name}`)) continue;
    seen.add(`${family}/${name}`);
    const ask = { family, name, density, x: 0, y: 0 };
    if (style) ask.style = style;
    const frame = !shown.has(name) && frameOf.get(`${family}/${name}`);
    if (frame) ask.frame = frame;
    asks.push(ask);
  }
  return asks;
}

/**
 * The stand-in for the game's land: copies wait in a queue and a frame lands them one after another while the frame has
 * slice left. The first copy of a frame always lands, so a copy bigger than the slice lands alone; a later copy starts only
 * when its estimate (its pixels at the milliseconds a pixel the copies so far took) fits what is left. `land(copy)` does the
 * work (decode, write color numbers, upload); `clock()` is milliseconds on any steady clock.
 */
export class Lander {
  constructor({ clock, land, sliceMs, onLanded = () => {} }) {
    this.clock = clock;
    this.land = land;
    this.sliceMs = sliceMs;
    this.onLanded = onLanded;
    this.queue = [];
    /** Each frame that landed something: `{landed, ms}`. */
    this.frames = [];
    this.totalMs = 0;
    this.totalPixels = 0;
    /** The copy that took longest to land: `{ms, w, h, name}`, or null before any landed. */
    this.largest = null;
  }

  push(copy) {
    this.queue.push(copy);
  }

  estimate(copy) {
    return this.totalPixels ? (copy.w * copy.h * this.totalMs) / this.totalPixels : 0;
  }

  /** One frame's landing: the copies landed. */
  frame() {
    const start = this.clock();
    const landed = [];
    while (this.queue.length) {
      const next = this.queue[0];
      if (landed.length && this.clock() - start + this.estimate(next) > this.sliceMs) break;
      this.queue.shift();
      const t0 = this.clock();
      this.land(next);
      const ms = this.clock() - t0;
      this.totalMs += ms;
      this.totalPixels += next.w * next.h;
      if (!this.largest || ms > this.largest.ms) this.largest = { ms, w: next.w, h: next.h, name: next.name };
      landed.push(next);
      this.onLanded(next, ms);
    }
    if (landed.length) this.frames.push({ landed: landed.length, ms: this.clock() - start });
    return landed;
  }

  /** Frames that landed more than one copy and still ran past the slice (an estimate that was too small). */
  overruns() {
    return this.frames.filter((f) => f.landed > 1 && f.ms > this.sliceMs).length;
  }
}

/** What has landed of a view: a still thing counts when its copy lands, a motion only once every one of its frames has. */
export class Progress {
  constructor({ still, motions }) {
    this.still = still.map((s) => s.name);
    this.motions = motions;
    this.have = new Set();
  }

  landed(name) {
    this.have.add(name);
  }

  landedCount() {
    return this.have.size;
  }

  stillDone() {
    return this.still.every((n) => this.have.has(n));
  }

  motionsDone() {
    return this.motions.filter((m) => m.names.every((n) => this.have.has(n))).length;
  }

  allDone() {
    return this.stillDone() && this.motionsDone() === this.motions.length;
  }
}

/** The frame times (ms between frames) as `{frames, slowest, over}`: `over` counts those past 16.7 ms by more than vsync's wobble. */
export function frameStats(deltas) {
  return {
    frames: deltas.length,
    slowest: deltas.reduce((m, d) => Math.max(m, d), 0),
    over: deltas.filter((d) => d > FRAME_MS + FRAME_SLOP_MS).length,
  };
}

const mb = (bytes) => Math.round(bytes / 1_000_000);
const mb1 = (bytes) => (bytes / 1_000_000).toFixed(1);
const secs = (ms) => (ms / 1000).toFixed(1);

/**
 * The log's rows for one phase of one visit, `Label: value` each, the same words everywhere. `result` is what the phase
 * measured; `storage` is what the browser says of its store (`navigator.storage.estimate()` and `persist()`).
 */
export function benchRows({ view, density, workers, visit, phase, result, storage }) {
  const r = result;
  return [
    `View: ${view}`,
    `Detail: ${density}x`,
    `Workers: ${workers}`,
    `Visit: ${visit === 1 ? "First" : "Second"}`,
    `Phase: ${phase}`,
    `Names: ${r.names}`,
    `From cache: ${r.fromCache} of ${r.names}`,
    `Time to draw: ${secs(r.timeToDrawMs)} s`,
    `Worker time: ${secs(r.workerMs)} s`,
    `Slowest frame: ${Math.round(r.frames.slowest)} ms`,
    `Frames over ${FRAME_MS} ms: ${r.frames.over} of ${r.frames.frames}`,
    r.largest ? `Largest copy: ${r.largest.ms.toFixed(1)} ms to land, ${r.largest.w} by ${r.largest.h}` : "Largest copy: none",
    `Land overruns: ${r.overruns}`,
    r.workerMemory ? `Worker memory: ${mb(r.workerMemory)} MB at most, ${r.workers} ${r.workers === 1 ? "worker" : "workers"}` : "Worker memory: none",
    `Store: ${r.store.entries} ${r.store.entries === 1 ? "entry" : "entries"}, ${mb1(r.store.bytes)} MB`,
    storage && storage.quota ? `Storage: ${mb1(storage.usage)} MB of ${mb(storage.quota)} MB` : "Storage: not known",
    `Persist: ${storage && storage.persisted ? "Yes" : "No"}`,
  ];
}
