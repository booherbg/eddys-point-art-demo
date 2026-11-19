// The pool's test page (plan 2026-11-18-live-forge, Task 2): a fixed scene of 40 sprites, none drawn at the start. The
// pool draws them in the order's order, nearest the center first, each a pencil sketch until its picture lands.
// Parameters: `workers` (default: ruling 6's count), `slow` (ms each job waits, to show a slow machine mid-draw).
import { Order } from "./order.js";
import { Pool, detectWorkerCount } from "./pool.js";
import { Sprites } from "./sprites.js";

const q = new URLSearchParams(location.search);
const count = Number(q.get("workers")) || detectWorkerCount();
const slow = Number(q.get("slow") || 0);

const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const W = (canvas.width = innerWidth);
const H = (canvas.height = innerHeight);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// The scene: 40 placed sprites on a grid, the carousel in the middle.
const guests = [];
for (const d of [0, 1, 2, 3]) for (const pose of ["stand", "w0", "w2", "sit", "stand1", "w1"]) guests.push(["people_guests", `guest_s0_d${d}_${pose}`]);
const things = [
  ["gate", "gate_r0"],
  ["stalls", "stall_burger_r0"],
  ["stalls", "stall_drinks_r0"],
  ...[0, 1, 2, 3].map((r) => ["scenery_paths", `bench_r${r}`]),
  ...["bush", "flowers_red", "flowers_violet", "flowers_yellow", "tree_pine", "tree_round", "tree_small"].map((n) => ["scenery_plants", n]),
  ...guests,
];
const cols = 11, rows = [170, 300, 430, 560, 690];
const cells = [];
rows.forEach((y, r) => {
  for (let c = 0; c < cols; c++) if (!(r === 2 && c === 5)) cells.push({ x: 90 + c * 108, y }); // the carousel's cell is left free
});
// 38 things spread evenly over the cells, each name once.
const items = things.slice(0, 38).map((t, i) => {
  const cell = cells[Math.floor((i * cells.length) / 38)];
  return { family: t[0], name: t[1], x: cell.x, y: cell.y };
});
const CAROUSEL = { x: 640, y: 430 };
items.push({ family: "rides_flat", name: "shadow_carousel_f0", x: CAROUSEL.x, y: CAROUSEL.y, ground: false });
items.sort((a, b) => a.y - b.y || a.x - b.x);

const order = new Order();
const boxes = await (await fetch("boxes.json")).json();
const sprites = new Sprites({ ask: (r) => pool.request(r), boxes });
const wasm = await (await fetch("forge_worker.wasm")).arrayBuffer();
const module = await WebAssembly.compile(wasm);
const t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;
const pool = new Pool({
  module,
  count,
  slow,
  order,
  makeWorker: () => new Worker("pool-worker.js", { type: "module" }),
  onDrawn: (r) => sprites.landed(r, now()),
});
pool.setView({ x: 0, y: 0, w: W, h: H });
await pool.ready;
const readyAt = performance.now();

const placed = items.length + 1; // and the carousel
let doneAt = null;
const lf = (window.__lf = { total: placed, drawn: 0, workers: count, readyMs: readyAt - t0, doneMs: null });

function ground(x, y) {
  ctx.fillStyle = "#4b7f4e";
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + 32, y);
  ctx.lineTo(x, y + 16);
  ctx.lineTo(x - 32, y);
  ctx.closePath();
  ctx.fill();
}

function frame() {
  const t = now();
  ctx.fillStyle = "#3a6b44";
  ctx.fillRect(0, 0, W, H);
  let drawn = 0;
  for (const it of items) ground(it.x, it.y);
  ground(CAROUSEL.x, CAROUSEL.y);
  for (const it of items) {
    if (sprites.draw(ctx, { name: it.name, family: it.family, x: it.x, y: it.y }, it.x, it.y, t)) drawn++;
  }
  // The carousel turns eight frames a second. Every frame is asked for (the order sorts them: the one showing now, then
  // the rest coarse to fine); the picture is the shown frame if it is in, or the nearest earlier one.
  const shown = Math.floor(t * 8) % 32;
  for (let f = 0; f < 32; f++) pool.request({ name: `carousel_f${f}`, family: "rides_flat", x: CAROUSEL.x, y: CAROUSEL.y, frame: { index: f, count: 32, shown } });
  let have = null;
  for (let b = 0; b < 32; b++) {
    const f = (shown - b + 32) % 32;
    if (sprites.has(`carousel_f${f}`)) { have = f; break; }
  }
  const showing = `carousel_f${have === null ? shown : have}`;
  if (sprites.draw(ctx, { name: showing, family: "rides_flat", x: CAROUSEL.x, y: CAROUSEL.y }, CAROUSEL.x, CAROUSEL.y, t) && have === shown) drawn++;
  else if (have !== null && sprites.has(showing)) drawn++;
  lf.drawn = drawn;
  if (drawn >= placed && doneAt === null) {
    doneAt = t;
    lf.doneMs = Math.round(t * 1000);
    console.log(`lf-done ${lf.doneMs} ms, ${pool.stats.drawn} drawn on ${count} workers`);
  }
  hud.textContent = `Sprites: ${drawn} of ${placed}\nWorkers: ${count}\nWaiting: ${order.waiting()}\nTime: ${t.toFixed(1)} s`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
