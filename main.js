// The live forge's park (plan 2026-11-18-live-forge, Task 3): the sim running in the page at 60 steps a second, its draw list
// from `park.wasm`, every sprite drawn the first time it is seen by the worker pool (Task 2), the ground drawn in code.
// The camera is hers: it moves only when she drags, or zooms (the wheel, the keys 1 to 5, plus and minus, a double tap with no tool
// held); a build never moves it, and neither does the Detail row (Task 18: it changes how pictures are drawn, never the view). Task 4 adds the play: the build bar (Task 26: trays, a held tool inside one), the ghost with its price or the sim's refusal, the tap,
// the speeds, and the two stat rows. Parameters: `noprefetch` (do not ask for the bar's pictures: E3 without them), `stats` (the dev overlay), `zoom` (1 to 5), `seed`, `workers`, `slow` (ms each job waits).
import { Order } from "./order.js";
import { Pool, detectWorkerCount, detectPhone } from "./pool.js";
import { cacheCap } from "./detail.js";
import { Sprites } from "./sprites.js";
import { canvasMaker } from "./recolor.js";
import { fpsRow, prepRows, wasmMemoryRow, jsHeapRow, jsHeapBytes, spriteCacheRow, spritesDrawnRow, spritesCachedRow, onScreenRow, drawingRow, DrawClock } from "./stats.js";
import { openPark } from "./park.js";
import { Scene, Camera, wheelStep, parseTable, makeAtlas, GroundAtlases, RECORD } from "./scene.js";
import { SPEEDS, OPENING, tileAt, diamond, Hands, Prefetch } from "./play.js";
import { CardState, makeCard, beside } from "./card.js";
import { heldGroup, heldButton } from "./bar.js";
import { TOOLS, START, tapTray, tapTool, tapRemove, labelOfTool, isRide, makeBuildBar } from "./trays.js";
import { makePanel } from "./panel.js";

const q = new URLSearchParams(location.search);
const workers = Number(q.get("workers")) || detectWorkerCount();
const slow = Number(q.get("slow") || 0);
const showStats = q.has("stats");

const canvas = document.getElementById("c");
const line = document.getElementById("line");
line.textContent = OPENING;
const tip = document.getElementById("tip");
const moneyEl = document.getElementById("money");
const guestsEl = document.getElementById("guests");
const statsEl = document.getElementById("stats");
const drawingEl = document.getElementById("drawing");
const ctx = canvas.getContext("2d");
if (showStats) statsEl.classList.add("on");

const nowS = () => performance.now() / 1000; // seconds since the page opened: the times the overlay shows
/** The wait from a switch to the last finer picture landing (the panel's "Time to draw"). */
const clock = new DrawClock();

const [parkBytes, forgeBytes] = await Promise.all(["park.wasm", "forge_worker.wasm"].map(async (f) => (await fetch(f)).arrayBuffer()));
const [api, forgeModule] = await Promise.all([openPark(parkBytes, Number(q.get("seed") || 0)), WebAssembly.compile(forgeBytes)]);
const table = parseTable(api.table());
// The ground, drawn in code: each density is the same recipe at finer pixels, built on a turn of its own when first needed.
const atlas = new GroundAtlases({ build: (d) => makeAtlas(api.atlas(d), (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }), d) });

// A past run's build times (`prep.json`) tell the order which families are slow before the first build; a worker's own measure replaces each.
const prepHints = await fetch("prep.json").then((r) => (r.ok ? r.json() : {}), () => ({}));
const order = new Order({ boxes: table.boxes, prep: prepHints });
// The picture cache's byte budget (Task 31, b582): 64 MB on a phone (pool.js's phone rule), 256 MB on a laptop, `?cache=<MB>` for another.
const cap = cacheCap({ phone: detectPhone(), param: q.get("cache") });
const sprites = new Sprites({ ask: (r) => pool.request(r), boxes: table.boxes, cap, onEvict: (name, d) => order.forget(name, d), rowOf: (id) => api.wearRow(id), makeWorn: canvasMaker(document) });
const pool = new Pool({
  module: forgeModule,
  count: workers,
  slow,
  order,
  makeWorker: () => new Worker("pool-worker.js", { type: "module" }),
  onDrawn: (r) => (sprites.landed(r, nowS()), clock.landed(nowS())),
  onError: (r) => (sprites.failed(r), console.log(`lf-failed ${r.name}: ${r.error || "no picture"}`)),
});
const scene = new Scene({ api, table, sprites, ask: (r) => pool.request(r), atlas, slow: (family) => order.slow(family) });

// The camera's center in art pixels, over the carousel and the gate to start; moved only by her.
const camera = new Camera({ x: -200, y: 450 }, api.size, Number(q.get("zoom")) || 1);
/** The Detail step (1x to 5x): how finely pictures are drawn; 1x enlarges the game's pixels as the demo always did. */
let detail = 1;
const pixelRatio = () => Math.max(1, Math.round(devicePixelRatio || 1));
const scale = () => camera.zoom * pixelRatio();

function resize() {
  const dpr = Math.max(1, devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
resize();
addEventListener("resize", resize);

// ---- her hands: a held tool taps to build; a slide of more than 8 px pans; the wheel or a double tap zooms ----
const hands = new Hands();
let tapAt = 0;
/** What the tip line shows after a tap: the sim's words for a moment (a refusal, or what the build cost). */
let flash = null;
const dprNow = () => canvas.width / innerWidth;
/** The tile under a pointer event: the screen pixel to the art pixel to the tile (the same math the draw uses). */
function press(e) {
  const s = scale();
  const view = camera.view(canvas.width, canvas.height, pixelRatio());
  const art = { x: view.x + (e.clientX * dprNow()) / s, y: view.y + (e.clientY * dprNow()) / s };
  return { id: e.pointerId, sx: e.clientX, sy: e.clientY, tile: tileAt(art.x, art.y), art, touch: e.pointerType !== "mouse" };
}
addEventListener("pointerdown", () => line.classList.add("gone"), { capture: true });
canvas.addEventListener("pointerdown", (e) => {
  hands.down(press(e));
  canvas.setPointerCapture(e.pointerId);
  const t = performance.now();
  if (hands.tool === null && t - tapAt < 320) camera.cycle();
  tapAt = t;
});
canvas.addEventListener("pointermove", (e) => {
  const m = hands.move(press(e));
  if (!m) return;
  camera.drag(m.pan[0] * dprNow(), m.pan[1] * dprNow(), scale());
  canvas.classList.add("drag");
});
const end = (e) => {
  canvas.classList.remove("drag");
  const r = hands.up(press(e));
  if (r?.tap) build(r.tap);
  else if (r?.look) cardState.tap(hands.tool, r.look, (x, y) => api.pick(x, y)); // no tool held: the small card for what is under the tap, or closed on bare ground
};
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", (e) => {
  hands.leave();
  canvas.classList.remove("drag");
});
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") hands.cursor = null;
});

// ---- the small card: with no tool held, a tap on a guest, a ride or a stall opens it beside what she tapped; the view never moves ----
const cardState = new CardState();
const card = makeCard(document, document.body);
let cardSide = null;
/** The card's words from the sim each frame, set beside its thing; gone when the thing is. */
function showCard(view) {
  const open = cardState.open;
  const got = open && api.card(open.kind, open.id);
  if (!got) {
    cardState.close();
    card.hide();
    cardSide = null;
    return;
  }
  card.show(got.rows);
  const s = scale();
  const dpr = dprNow();
  const r = got.rect;
  const px = (ax, ay) => [((ax - view.x) * s) / dpr, ((ay - view.y) * s) / dpr];
  const [x0, y0] = px(r.x0, r.y0);
  const [x1, y1] = px(r.x1, r.y1);
  // The space the bars leave: the top bar's 44 px, the bottom bar's and an open tray's.
  const screen = { x0: 8, y0: 52, x1: innerWidth - 8, y1: innerHeight - (tray.open !== null && tray.open !== TOOLS ? 128 : 70) };
  const at = beside(screen, { x0, y0, x1, y1 }, card.size(), cardSide);
  cardSide = at.side;
  card.at(at.x, at.y);
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape") cardState.close();
});

/** The tap: the sim's own command, free to refuse. The view stays where it is. */
function build({ x, y }) {
  const v = api.toolDo(hands.tool, x, y, hands.turn);
  if (v.turned) hands.turn = v.turn;
  flash = { line: v.line, until: performance.now() + 1600, ok: v.ok };
  if (v.ok) console.log(`lf-built ${toolName(hands.tool)} ${x},${y} ${v.turned ? "turned" : v.line}`);
}

// ---- the bars: the build trays and Tools (one tray open at a time, the tool inside held), the speeds (one held) ----
// A tray's button is held while its tray is open; the tool picked inside is the one `hands` holds, so a tap on the map places it.
// Tools is a tray too (Detail and Add 10 guests); it holds no tool, so a tap on the map with it open is a tap with no tool held.
const trayEl = document.getElementById("tray");
let tray = START;
const toolName = (t) => labelOfTool(t);
function sync() {
  cardState.close(); // a tray, a tool or Tools is a new thing in her hand: the card goes
  hands.tool = tray.tool;
  hands.cursor = null;
  buildBar.set(tray);
  toolsButton.classList.toggle("on", tray.open === TOOLS);
  toolsButton.setAttribute("aria-pressed", tray.open === TOOLS ? "true" : "false");
  panelEl.classList.toggle("gone", tray.open !== TOOLS);
  document.body.classList.toggle("tray-open", tray.open !== null && tray.open !== TOOLS); // the price line stands above the tray, never behind it
  flash = null;
}
const buildBar = makeBuildBar(document, document.getElementById("tools"), trayEl, {
  tray: (name) => ((tray = tapTray(tray, name)), sync()),
  tool: (n) => ((tray = tapTool(tray, n)), sync()),
  remove: () => ((tray = tapRemove(tray)), sync()),
  // Turn is grey with no ride held but stays tappable: the tap says why (CLAUDE.md, one look per kind of button).
  turn: () => turnIt(),
  grey: (why) => {
    flash = { line: why, until: performance.now() + 1600, ok: false };
  },
});
function turnIt() {
  if (!isRide(hands.tool)) return;
  hands.rotate();
  flash = null;
}
let speed = 1;
const speedBar = heldGroup(document, document.getElementById("speeds"), SPEEDS.map((s) => s[0]), (i) => {
  speed = SPEEDS[i][1];
  speedBar.set(i);
});
speedBar.set(1);
let wheelAt = -Infinity;
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!wheelStep(wheelAt, performance.now())) return; // one zoom step per 150 ms, so a trackpad burst does not flicker
  wheelAt = performance.now();
  camera.zoomBy(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
addEventListener("keydown", (e) => {
  if (/^[1-5]$/.test(e.key)) camera.zoomTo(Number(e.key));
  else if (e.key === "-") camera.zoomBy(-1);
  else if (e.key === "+" || e.key === "=") camera.zoomBy(1);
  else if (e.key === "r" || e.key === "R") turnIt();
});

// ---- the Tools tray: a held button in the top bar opens it (lit while open, one tray at a time); the Detail row holds one step, and
// Add 10 guests acts once: the ten appear at the road's far end and walk up to the gate ----
const panelEl = document.getElementById("panel");
const panel = makePanel(document, panelEl, {
  onDetail: (step) => (detail = step, panel.setDetail(detail), clock.start(nowS())),
  onAddGuests: () => console.log(`lf-sent ${api.sendGuests(10)}`),
});
panel.setDetail(detail);
const toolsButton = heldButton(document, TOOLS, () => ((tray = tapTray(tray, TOOLS)), sync()));
document.getElementById("topright").append(toolsButton);
sync();

// ---- the dev overlay's numbers: E3 (times) and E5 (frame time while drawing) ----
const frames = { all: [], drawing: [], idle: [] };
const lf = (window.__lf = { workers, readyMs: null, firstScreenMs: null, allSetMs: null, firstNames: 0, drawn: 0, missing: "" });
// Read-only helpers for the scripted run (never a way to build): where a tile is on the screen, whether the sim would take a
// tool there (`Park::test`), and what the ground there is. A run's taps go through the page's own buttons and pointer events.
lf.screenOf = (tx, ty) => {
  const s = scale();
  const view = camera.view(canvas.width, canvas.height, pixelRatio());
  const dpr = canvas.width / innerWidth;
  return { x: ((32 * (tx - ty) - view.x) * s) / dpr, y: ((16 * (tx + ty) - view.y) * s) / dpr };
};
lf.screenOfArt = (ax, ay) => {
  const view = camera.view(canvas.width, canvas.height, pixelRatio());
  return { x: ((ax - view.x) * scale()) / dprNow(), y: ((ay - view.y) * scale()) / dprNow() };
};
lf.asks = (tool, x, y, turn = 0) => api.toolTest(tool, x, y, turn);
lf.groundAt = (x, y) => api.ground(x, y, 1, 1)[0];
lf.rows = () => [api.moneyRow(), api.guestsRow()];
lf.sales = () => api.sales();
lf.tick = () => api.tick();
lf.camera = () => ({ ...camera.center, zoom: camera.zoom });
// The sprites of every ride the park draws, each with its anchor in art pixels (read-only, Task 24): a scripted run waits on the
// train's car and its riders by name (`car_family_h2_p1`, `guest_ride_s0_h2_p1_hold`) and where they are, then looks.
lf.rideNames = () => {
  const rec = api.drawList({ x: -4000, y: -1000, w: 8000, h: 4000 });
  const out = [];
  for (let o = 0; o + RECORD <= rec.length; o += RECORD) if (rec[o + 11] >= 0) out.push({ name: table.entries[rec[o]].name, x: rec[o + 1], y: rec[o + 2] });
  return out;
};
// Read-only, for the card's shots (Task 27): the art-pixel anchors of the draw list's sprites whose names start with `prefix`, and the
// words on the open card (null when none is open). A run opens a card by a tap on the map, never by these.
lf.items = (prefix) => {
  const rec = api.drawList({ x: -4000, y: -1000, w: 8000, h: 4000 });
  const out = [];
  for (let o = 0; o + RECORD <= rec.length; o += RECORD) if (table.entries[rec[o]].name.startsWith(prefix)) out.push({ name: table.entries[rec[o]].name, x: rec[o + 1], y: rec[o + 2], ride: rec[o + 11] });
  return out;
};
lf.card = () => (cardState.open ? card.words().filter(Boolean) : null);
lf.detail = () => detail;
// Read-only: the sprites the last frame drew, and how many of them at a step under the Detail row's (stand-ins and sketches).
lf.cache = () => ({ bytes: sprites.bytes, cap, fineBytes: sprites.fineBytes, held: sprites.mem.size, blocked: sprites.blockedCount() });
lf.sharp = () => ({ onScreen: scene.stats.items, below: scene.stats.below, belowNames: scene.stats.belowNames });
lf.settled = () => pool.settled();
lf.cost = () => sprites.cost();
lf.bar = () => drawingEl.textContent;
lf.clock = () => clock.seconds(nowS());
lf.panel = () => [...panelEl.querySelectorAll(".rowlabel, .btn, .stat")].map((e) => e.textContent);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const worst = (a) => (a.length ? Math.max(...a) : 0);
const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : 0);

function overlay(t) {
  const [have, of] = scene.firstProgress();
  const rows = [
    `Time: ${t.toFixed(1)} s`,
    `First screen: ${lf.firstScreenMs === null ? `${have} of ${of}` : `${(lf.firstScreenMs / 1000).toFixed(2)} s`}`,
    `All set: ${lf.allSetMs === null ? "no" : `${(lf.allSetMs / 1000).toFixed(2)} s`}`,
    `Queued: ${order.waiting()}`,
    `Workers busy: ${pool.working}`,
    `Failed: ${pool.stats.failed}`,
    spritesDrawnRow(pool.stats.drawn),
    spritesCachedRow(sprites.mem.size),
    onScreenRow(scene.stats.items),
    wasmMemoryRow(api.memoryBytes()),
    jsHeapRow(jsHeapBytes(performance)),
    spriteCacheRow(sprites.bytes, cap),
    `Sprite ms: ${(pool.stats.ms / Math.max(1, pool.stats.drawn)).toFixed(1)}`,
    `Workers: ${workers}`,
    ...prepRows(order.prep),
    fpsRow(frames.all),
    `Frame ms: ${mean(frames.all).toFixed(1)} (95th ${p95(frames.all).toFixed(1)}, worst ${worst(frames.all).toFixed(1)})`,
    `Frame ms drawing: ${mean(frames.drawing).toFixed(1)} (95th ${p95(frames.drawing).toFixed(1)}, worst ${worst(frames.drawing).toFixed(1)}, ${frames.drawing.length} frames)`,
    `Sim tick: ${api.tick()}`,
  ];
  statsEl.textContent = rows.filter((r) => r !== null).join("\n");
}

// ---- the ghost: the tile the held tool is over, its picture half see-through, and the price or the sim's refusal ----
const prefetch = new Prefetch(api.barNames(), table.entries);
const GHOST_OK = "rgba(255, 255, 255, 0.28)";
const GHOST_NO = "rgba(214, 60, 60, 0.38)";
function drawGhost(ctx, view) {
  if (hands.tool === null || hands.cursor === null) return null;
  const { x, y } = hands.cursor;
  const v = api.toolTest(hands.tool, x, y, hands.turn);
  const d = diamond(x, y);
  ctx.save();
  ctx.beginPath();
  d.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fillStyle = v.ok ? GHOST_OK : GHOST_NO;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = v.ok ? "#f4efe6" : "#d63c3c";
  ctx.stroke();
  ctx.restore();
  if (v.ok) {
    const rec = api.ghost(hands.tool, x, y, hands.turn, view);
    for (let o = 0; o + RECORD <= rec.length; o += RECORD) {
      const e = table.entries[rec[o]];
      sprites.ghost(ctx, { name: e.name, family: e.family, x: rec[o + 1], y: rec[o + 2] }, rec[o + 1], rec[o + 2]);
    }
  }
  return v;
}

/** The bar's "Drawing: 212 of 640" while finer pictures are still coming, cleared when the last lands; stops the Detail clock too. */
let shownDrawing = null;
function showSharpening(t) {
  const { have } = sprites.progress();
  // The pictures the cap holds back are not on their way: the bar counts only those that are, so it clears when they land.
  const held = sprites.blockedCount();
  const of = sprites.progress().of - held;
  clock.frame(t, of - have);
  const row = drawingRow(have, of, held);
  if (row === shownDrawing) return;
  drawingEl.textContent = shownDrawing = row;
  drawingEl.classList.toggle("gone", !row);
}

let shownMoney = "";
let shownGuests = "";
function showRows(verdict) {
  const m = api.moneyRow(), g = api.guestsRow();
  if (m !== shownMoney) moneyEl.textContent = shownMoney = m;
  if (g !== shownGuests) guestsEl.textContent = shownGuests = g;
  let words = "";
  if (verdict) words = verdict.line;
  else if (flash && performance.now() < flash.until) words = flash.line;
  tip.textContent = words;
  tip.classList.toggle("gone", !words);
  tip.classList.toggle("no", !!verdict && !verdict.ok);
}

await pool.ready;
lf.readyMs = Math.round(nowS() * 1000);

// ---- the loop: sixty sim steps a second, a draw each frame ----
let last = performance.now();
let owed = 0;
let lastLog = 0;
let panelAt = 0;
function loop() {
  const tNow = performance.now();
  const dt = tNow - last;
  last = tNow;
  owed = Math.min(owed + dt / (1000 / 60), 12); // a long stall owes at most twelve steps, so it never spirals
  const steps = Math.floor(owed);
  if (steps) {
    if (speed) api.step(steps * speed);
    owed -= steps;
  }
  const view = camera.view(canvas.width, canvas.height, pixelRatio());
  pool.setView(view);
  const s = scale();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#14201a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, -view.x * s, -view.y * s);
  ctx.imageSmoothingEnabled = false;
  const t = nowS();
  scene.frame(ctx, view, t, { zoom: camera.zoom, detail });
  showSharpening(t);
  if (tray.open === TOOLS && t - panelAt > 0.25) {
    panelAt = t;
    panel.setStats({ ...sprites.cost(), wait: clock.seconds(t) });
  }
  const verdict = drawGhost(ctx, view);
  showCard(view);
  showRows(verdict);
  if (scene.firstDoneAt !== null && !q.has("noprefetch")) for (const r of prefetch.take(true, view)) pool.request(r);

  const busy = order.waiting() > 0 || pool.working > 0;
  if (frames.all.length || dt < 1000) {
    frames.all.push(dt);
    (busy ? frames.drawing : frames.idle).push(dt);
    for (const a of Object.values(frames)) if (a.length > 600) a.shift();
  }
  if (lf.firstScreenMs === null && scene.firstDoneAt !== null) {
    lf.firstScreenMs = Math.round(scene.firstDoneAt * 1000);
    lf.firstNames = scene.first.length;
    order.setFirstDone(); // the slow families (the animals') are drawn from here
    console.log(`lf-first-screen ${lf.firstScreenMs} ms, ${lf.firstNames} names, ${pool.stats.drawn} drawn on ${workers} workers`);
  }
  if (lf.allSetMs === null && lf.firstScreenMs !== null && pool.settled()) {
    lf.allSetMs = Math.round(t * 1000);
    console.log(`lf-all-set ${lf.allSetMs} ms, ${pool.stats.drawn} drawn`);
  }
  lf.drawn = pool.stats.drawn;
  lf.missing = api.missing();
  if (showStats) overlay(t);
  if (showStats && t - lastLog > 2) {
    lastLog = t;
    console.log(`lf-stats ${JSON.stringify({ t: +t.toFixed(1), first: lf.firstScreenMs, allSet: lf.allSetMs, queued: order.waiting(), sketched: [...scene.sketched].map((n) => `${n}=${order.state(n)}`), drawn: pool.stats.drawn, cached: sprites.mem.size, spriteMs: +(pool.stats.ms / Math.max(1, pool.stats.drawn)).toFixed(1), frameMs: +mean(frames.all).toFixed(1), frameP95: +p95(frames.all).toFixed(1), frameWorst: +worst(frames.all).toFixed(1), drawingMs: +mean(frames.drawing).toFixed(1), drawingP95: +p95(frames.drawing).toFixed(1), drawingFrames: frames.drawing.length, tick: api.tick() })}`);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
