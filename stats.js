// The ?stats overlay's rows and the Drawing bar's row, each a stat row (`Label: value`), and the clock behind the panel's "Time to draw".
// Pure: node tests print each whole.
import { MIB } from "./detail.js";

// The ?stats overlay's frame rate row: a stat row, `FPS: 60`, from the frame times in milliseconds the overlay keeps.
export function fpsRow(frameMs) {
  const mean = frameMs.length ? frameMs.reduce((s, v) => s + v, 0) / frameMs.length : 0;
  return `FPS: ${mean > 0 ? Math.round(1000 / mean) : 0}`;
}

/** The overlay's build-time rows, the slow families first: `Build animals: 27.4 s`, one a group a worker has built, a family or a family's one portrait kind (ms from `Order.prep`). */
export function prepRows(prep) {
  const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
  return [...prep].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).filter(([, ms]) => ms >= 1).map(([family, ms]) => `Build ${family}: ${fmt(ms)}`);
}

const mb = (bytes) => Math.round(bytes / MIB);
const mb1 = (bytes) => (Math.round((bytes / MIB) * 10) / 10).toFixed(1);
/** The park's wasm memory, whole megabytes. */
export const wasmMemoryRow = (bytes) => `Wasm memory: ${mb(bytes)} MB`;
/** The JS heap in use, or null where the browser gives none (the row is then left out). */
export const jsHeapRow = (bytes) => (bytes === null || bytes === undefined ? null : `JS heap: ${mb(bytes)} MB`);
/** The heap figure the browser gives (`performance.memory`, Chrome's), or null. */
export const jsHeapBytes = (perf) => (perf && perf.memory && Number.isFinite(perf.memory.usedJSHeapSize) ? perf.memory.usedJSHeapSize : null);
/** The bytes of every picture kept, one decimal, and beside it the cap in whole megabytes when the cache has one (Task 31): `Sprite cache: 41.3 of 256 MB`. */
export const spriteCacheRow = (bytes, cap) => (cap === undefined || !Number.isFinite(cap) ? `Sprite cache: ${mb1(bytes)} MB` : `Sprite cache: ${mb1(bytes)} of ${mb(cap)} MB`);
/** Pictures the workers have drawn, pictures kept in the cache, and sprites the last frame drew. */
export const spritesDrawnRow = (n) => `Sprites drawn: ${n}`;
export const spritesCachedRow = (n) => `Sprites cached: ${n}`;
export const onScreenRow = (n) => `On screen: ${n}`;
export function cacheRows({ hits, misses, sizes }) {
  const totals = new Map([[1, { entries: 0, bytes: 0 }], [2, { entries: 0, bytes: 0 }], [3, { entries: 0, bytes: 0 }]]);
  for (const [density, size] of sizes) {
    const total = totals.get(density);
    if (total) {
      total.entries++;
      total.bytes += size;
    }
  }
  return [
    `Cache hits: ${hits}`,
    `Cache misses: ${misses}`,
    ...Array.from(totals, ([d, { entries, bytes }]) => `Cache ${d}x: ${entries} ${entries === 1 ? "entry" : "entries"}, ${(bytes / 1_000_000).toFixed(1)} MB`),
  ];
}
/** The bar's row while finer pictures are still coming (`have` landed of the `of` this view wants); "" once the last has landed. */
/** The bar's row: "Drawing: n of m" while pictures are on their way; once none is, and the memory cap holds some below the step (`held`), the sentence that says so (live forge Task 30's ruling). */
export const HELD_BACK = "Some pictures stay at a lower detail to save memory.";
export const drawingRow = (have, of, held = 0) => (of > have ? `Drawing: ${have} of ${of}` : held > 0 ? HELD_BACK : "");

/**
 * The real time from a switch (Detail, and the style switch's when it lands) to the last picture it asked for landing, in
 * seconds on the page's clock: the wait she sat through, not the workers' seconds summed. `start` at the switch, `landed` for each
 * picture, `frame` each frame with how many pictures the view still waits for.
 */
export class DrawClock {
  constructor() {
    this.startAt = null;
    this.lastAt = null;
    this.endAt = null;
    this.running = false;
  }

  start(now) {
    this.startAt = now;
    this.lastAt = null;
    this.endAt = null;
    this.running = true;
  }

  /** A picture landed at `now`. */
  landed(now) {
    if (this.running) this.lastAt = now;
  }

  /** The view waits for `remaining` pictures at `now`: none left stops the clock at the last landing (or at the switch, if none had to). */
  frame(now, remaining) {
    if (this.running && remaining <= 0) {
      this.running = false;
      this.endAt = this.lastAt === null ? this.startAt : this.lastAt;
    }
  }

  /** The seconds so far while it runs, the whole wait once it has stopped, 0 before any switch. */
  seconds(now) {
    if (this.startAt === null) return 0;
    return (this.running ? now : this.endAt) - this.startAt;
  }
}
