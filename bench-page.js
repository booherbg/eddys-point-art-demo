// The bench page (plan 2026-11-18-live-sharp-art, Task 4): draws a game view's names at 2x or 3x through the demo's pool and
// store, and lands each copy on a stand-in of the game's page (decode the one-sprite FRG1, write color numbers into a 4096 by
// 4096 page, `texSubImage2D` it to a WebGL texture) inside the land slice, while every frame also carries a fixed 6 ms of
// stand-in work at 60 a second. It logs the still things and the motions apart (`benchRows`), then the next visit, reloaded
// from the same profile, logs the same from the store.
//
// Parameters: `view` (a pair of lists in `views/`, default lesson1-desktop-z3), `density` (2 or 3, default 3), `workers`
// (default: the pool's rule), `visit` (1 empties the store at this density first, 2 keeps it), `phone` (1 or 0 to force the
// phone's slice and rule), `slice` (ms, to try another). When both phases are done `window.__bench` holds the numbers.
import { Order } from "./order.js";
import { Pool, detectWorkerCount, detectPhone } from "./pool.js";
import { artStamps } from "./core.js";
import { openArtStore } from "./store.js";
import { decodeOne } from "./frg.js";
import {
  parseList, motionsOf, requestsFor, Lander, Progress, frameStats, benchRows, SLICE_LAPTOP_MS, SLICE_PHONE_MS, STAND_IN_LOAD_MS,
} from "./bench.js";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "lesson1-desktop-z3";
const density = Number(q.get("density") || 3);
const workers = Number(q.get("workers")) || detectWorkerCount();
const visit = Number(q.get("visit") || 1);
const phone = q.has("phone") ? q.get("phone") === "1" : detectPhone();
const slice = Number(q.get("slice")) || (phone ? SLICE_PHONE_MS : SLICE_LAPTOP_MS);
const headEl = document.getElementById("head");
const liveEl = document.getElementById("live");
const tablesEl = document.getElementById("tables");
const say = (text) => { liveEl.textContent = text; };

headEl.textContent = `${view} at ${density}x, ${workers} ${workers === 1 ? "worker" : "workers"}, ${visit === 1 ? "first visit (store emptied first)" : "second visit (from the store)"}, ${phone ? "phone" : "laptop"} slice ${slice} ms, ${navigator.hardwareConcurrency} cores`;

const list = async (kind) => {
  const res = await fetch(`views/${view}-${kind}.txt`);
  if (!res.ok) throw new Error(`no list views/${view}-${kind}.txt`);
  return parseList(await res.text());
};
const [still, moving] = await Promise.all([list("still"), list("moving")]);
const motions = motionsOf(moving);
const progress = new Progress({ still, motions });
const asks = requestsFor({ still, moving, density });
const stillNames = new Set(still.map((s) => s.name));
const stillAsks = asks.filter((a) => stillNames.has(a.name));
const movingAsks = asks.filter((a) => !stillNames.has(a.name));

// The stand-in page: one byte a texel (the color number), 4096 by 4096 like the game's pages, and a WebGL texture it is
// uploaded to. A browser with no WebGL lands without the upload and says so.
const PAGE = 4096;
const gl = document.getElementById("gl").getContext("webgl2");
let texture = null;
if (gl) {
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, PAGE, PAGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}
const page = new Uint8Array(PAGE * PAGE);
const numbers = new Map();
let cursor = { x: 0, y: 0, rowH: 0 };

function land(copy) {
  const s = decodeOne(copy.frg);
  const { w, h, rgba } = s;
  if (cursor.x + w > PAGE) cursor = { x: 0, y: cursor.y + cursor.rowH, rowH: 0 };
  if (cursor.y + h > PAGE) cursor = { x: 0, y: 0, rowH: 0 }; // the stand-in reuses its page: it measures the work, not the room
  const rect = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] === 0) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let n = numbers.get(key);
    if (n === undefined) {
      n = Math.min(255, numbers.size + 1);
      numbers.set(key, n);
    }
    rect[i] = n;
  }
  for (let row = 0; row < h; row++) page.set(rect.subarray(row * w, (row + 1) * w), (cursor.y + row) * PAGE + cursor.x);
  if (gl) gl.texSubImage2D(gl.TEXTURE_2D, 0, cursor.x, cursor.y, w, h, gl.RED, gl.UNSIGNED_BYTE, rect);
  cursor.x += w;
  cursor.rowH = Math.max(cursor.rowH, h);
}

let lastLandAt = 0;
const lander = new Lander({
  clock: () => performance.now(),
  sliceMs: slice,
  land,
  onLanded: (copy) => {
    progress.landed(copy.name);
    lastLandAt = performance.now();
  },
});

const [forgeBytes] = await Promise.all([(await fetch("forge_worker.wasm")).arrayBuffer()]);
const module = await WebAssembly.compile(forgeBytes);
const stamps = await artStamps(module, "");
const store = await openArtStore(stamps);
if (visit === 1) await store.clear(density);

let phaseNow = null; // the phase being measured: `{deltas, hits, memory, failed}`
const order = new Order();
order.setView({ x: -50, y: -50, w: 100, h: 100 });
const pool = new Pool({
  module,
  count: workers,
  order,
  store,
  stamps,
  wantFrg: true,
  makeWorker: () => new Worker("pool-worker.js", { type: "module" }),
  onDrawn: (m) => {
    m.bitmap?.close();
    if (phaseNow) {
      if (m.cached) phaseNow.hits++;
      phaseNow.memory = Math.max(phaseNow.memory, m.mem || 0);
    }
    lander.push({ name: m.name, w: m.w, h: m.h, frg: m.frg });
  },
  onError: (m) => {
    console.log(`bench-failed ${m.name}: ${m.error || "no picture"}`);
    if (phaseNow) phaseNow.failed++;
    progress.landed(m.name); // a name that cannot be drawn is not waited for
  },
});
pool.setView({ x: -50, y: -50, w: 100, h: 100 });
await pool.ready;

function busy(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* the stand-in for the game's own frame */ }
}

/** Runs the frames until `done()`; resolves with the frame times seen. */
function frames(done) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = null;
    const tick = () => {
      const t = performance.now();
      if (last !== null) deltas.push(t - last);
      last = t;
      busy(STAND_IN_LOAD_MS);
      lander.frame();
      if (done() && lander.queue.length === 0) return resolve(deltas);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function storeSize() {
  const rows = await store.sizes();
  const mine = rows.filter(([d]) => d === density);
  return { entries: mine.length, bytes: mine.reduce((sum, [, size]) => sum + size, 0) };
}

async function phase(label, phaseAsks, done) {
  phaseNow = { hits: 0, memory: 0, failed: 0 };
  lander.largest = null;
  lander.frames.length = 0;
  const base = { ms: pool.stats.ms };
  const t0 = performance.now();
  lastLandAt = t0;
  say(`${label}: asking for ${phaseAsks.length} names`);
  for (const a of phaseAsks) pool.request(a);
  const deltas = await frames(done);
  const result = {
    names: phaseAsks.length,
    fromCache: phaseNow.hits,
    failed: phaseNow.failed,
    timeToDrawMs: lastLandAt - t0,
    workerMs: pool.stats.ms - base.ms,
    frames: frameStats(deltas),
    largest: lander.largest,
    workerMemory: phaseNow.memory,
    workers,
    overruns: lander.overruns(),
    store: await storeSize(),
  };
  phaseNow = null;
  return result;
}

const results = {};
results.still = await phase("Still", stillAsks, () => progress.stillDone());
results.moving = await phase("Moving", movingAsks, () => progress.allDone());
const estimate = (await navigator.storage?.estimate?.()) || {};
const persisted = (await navigator.storage?.persist?.().catch(() => false)) || false;
const storage = { usage: estimate.usage || 0, quota: estimate.quota || 0, persisted };

tablesEl.textContent = "";
const out = { view, density, workers, visit, phone, slice, cores: navigator.hardwareConcurrency, gl: !!gl, motions: motions.map((m) => ({ key: m.key, frames: m.names.length })), storage, rows: {} };
for (const [kind, label] of [["still", "Still"], ["moving", "Moving"]]) {
  const rows = benchRows({ view, density, workers, visit, phase: label, result: results[kind], storage });
  out.rows[kind] = rows;
  out[kind] = results[kind];
  const block = document.createElement("div");
  block.className = "block";
  const h = document.createElement("h2");
  h.textContent = label === "Still" ? "Still things" : "Motions";
  const pre = document.createElement("pre");
  pre.textContent = rows.join("\n");
  block.append(h, pre);
  tablesEl.append(block);
}
out.done = true;
window.__bench = out;
say(!gl ? "Done. This browser has no WebGL, so copies landed without the upload." : motions.length ? `Done: all ${motions.length} motions whole.` : "Done. This view has no motions.");
console.log(`bench-done ${JSON.stringify(out)}`);
