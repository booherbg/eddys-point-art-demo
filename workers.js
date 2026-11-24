// The Workers panel (plan 2026-11-18-live-forge, Task 28, R324; CLAUDE.md, "One look per kind of button"): the drawing workers and their
// queue, opened by the Workers button in the Tools tray (held while open), a small panel that stays open until she shuts it. One row a
// worker (idle, or the sprite it draws, with a thin bar), the waiting list next first, what has been drawn of this burst of work and a bar
// that drains as the queue empties, the count and its reason, and - + Reset Clear cache to feel the pool at other sizes.
//
// A pure module (no timers, no globals): the page gives it the pool, the order and a clock, and the node tests run it with a small fake
// document. The panel costs nothing while shut: `frame` returns before it reads anything, and `read` is the only way it reaches the pool.
//
// **A worker's bar is an estimate.** One sprite is one synchronous call into the forge, and real progress would need a callback inside
// the forge's render loop (`crates/forge`), which the demo does not change. So the bar fills from that kind of sprite's mean time at this
// Detail (`Pool.meanMs`: the family's mean at the density, else the whole pool's mean), holds at `HOLD` until the picture lands, and says
// nothing on screen about being an estimate.
import { onceButton } from "./bar.js";
import { cacheRows } from "./stats.js";
import { WORKER_RULE, MIN_WORKERS, MAX_WORKERS } from "./pool.js";

/** The Tools tray's button, and the panel's own buttons. */
export const WORKERS = "Workers";
export const MINUS = "-";
export const PLUS = "+";
export const RESET = "Reset";
export const CLEAR = "Clear cache";
export const CLOSE = "Close";
/** What a tap on a grey button says (new sentences of this task, reported to the controller). */
export const MOST = `${MAX_WORKERS} is the most.`;
export const FEWEST = `${MIN_WORKERS} is the fewest.`;
/** A bar's most while its picture has not landed (ruling: holds at 95%). */
export const HOLD = 0.95;
/** How many of the waiting list's first names show. */
export const NEXT_SHOWN = 5;
/** How often the open panel reads the pool, in seconds. */
export const EVERY = 0.25;

/** A sprite as the panel names it: its name (the Detail step is the one she set, so it is not repeated on every row). */
export const spriteLabel = ({ name }) => name;
export const workerRow = (n, job) => `Worker ${n}: ${job ? spriteLabel(job) : "Idle"}`;
export const waitingRow = (n) => `Waiting: ${n}`;
export const drawnRow = (have, of) => `Drawn: ${have} of ${of}`;
export const coresRow = (n) => `Cores: ${n}`;
export const workersRow = (n) => `Workers: ${n}`;
export const suggestedRow = (n) => `Suggested: ${n}`;

/** How full a busy worker's bar is: its time in flight over its kind's mean, held at `HOLD`; empty with no mean to go by. */
export function barFraction({ elapsed, mean }) {
  if (!(mean > 0)) return 0;
  return Math.max(0, Math.min(HOLD, (elapsed * 1000) / mean));
}

/** How full the drain bar is: all of it when nothing of the burst is drawn, none when all is; empty with no burst. */
export function drainFraction(have, of) {
  return of > 0 ? Math.max(0, Math.min(1, (of - have) / of)) : 0;
}

/** What the panel shows right now, read from the pool and the order (the page's one call while the panel is open). */
export function snapshot({ pool, order, cores, suggested, sizes = [] }) {
  return {
    workers: pool.view(),
    waiting: order.waiting(),
    next: order.upcoming(NEXT_SHOWN),
    have: pool.burst.have,
    of: pool.burst.of,
    cores,
    count: pool.size,
    suggested,
    cache: cacheRows({ ...pool.cache, sizes }),
  };
}

/**
 * The panel in `parent`. `read(now)` gives a `snapshot`; `taps` is `{minus, plus, reset, clear, close, grey(why)}`. Returns `{el, open(), shut(),
 * isOpen, frame(now), words()}`: `frame` is called every frame and reads nothing while the panel is shut.
 */
export function makeWorkersPanel(doc, parent, { read, taps }) {
  const el = doc.createElement("div");
  el.className = "wpanel gone";
  const div = (cls, ...kids) => {
    const d = doc.createElement("div");
    d.className = cls;
    d.append(...kids);
    return d;
  };
  const bar = () => {
    const fill = doc.createElement("div");
    fill.className = "wfill";
    if (!fill.style) fill.style = {}; // the tests' small fake document has none
    return { fill, el: div("wbar", fill) };
  };
  const text = (cls) => {
    const t = doc.createElement("div");
    t.className = cls;
    return t;
  };
  const once = (label, tap) => onceButton(doc, label, tap, (why) => taps.grey(why));
  const close = once(CLOSE, () => taps.close());
  const minus = once(MINUS, () => taps.minus());
  const plus = once(PLUS, () => taps.plus());
  const reset = once(RESET, () => taps.reset());
  const clear = once(CLEAR, () => taps.clear());

  const rows = [];
  const list = div("wlist");
  const waiting = text("stat");
  const nextRows = Array.from({ length: NEXT_SHOWN }, () => text("wnext"));
  const drawn = text("stat");
  const drain = bar();
  const cache = Array.from({ length: 5 }, () => text("stat"));
  const cores = text("stat");
  const count = text("stat");
  const suggested = text("stat");
  const rule = text("wrule");
  rule.textContent = WORKER_RULE;
  el.append(
    div("row", close),
    list,
    waiting,
    ...nextRows,
    drawn,
    drain.el,
    ...cache,
    cores,
    count,
    suggested,
    rule,
    div("row actions", minus, plus, reset, clear),
  );
  parent.append(el);

  let isOpen = false;
  let last = -Infinity;
  const set = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const width = (b, f) => {
    b.fill.style.width = `${Math.round(f * 100)}%`;
  };

  /** Puts a snapshot on the panel. */
  function show(d) {
    while (rows.length < d.workers.length) {
      const name = text("wname");
      const b = bar();
      const row = div("wrow", name, b.el);
      list.append(row);
      rows.push({ row, name, bar: b });
    }
    rows.forEach((r, i) => {
      const w = d.workers[i];
      r.row.classList.toggle("gone", !w);
      if (!w) return;
      set(r.name, workerRow(w.n, w.job));
      width(r.bar, w.job ? barFraction(w.job) : 0);
    });
    set(waiting, waitingRow(d.waiting));
    nextRows.forEach((n, i) => {
      const next = d.next[i];
      n.classList.toggle("gone", !next);
      if (next) set(n, spriteLabel(next));
    });
    set(drawn, drawnRow(d.have, d.of));
    width(drain, drainFraction(d.have, d.of));
    set(cores, coresRow(d.cores));
    set(count, workersRow(d.count));
    set(suggested, suggestedRow(d.suggested));
    minus.grey(d.count <= MIN_WORKERS ? FEWEST : null);
    plus.grey(d.count >= MAX_WORKERS ? MOST : null);
    cache.forEach((row, i) => set(row, d.cache?.[i] ?? ""));
  }

  return {
    el,
    buttons: { close, minus, plus, reset, clear },
    get isOpen() {
      return isOpen;
    },
    /** Reads and shows at once (after a tap that changed the count or the cache). */
    refresh(now = 0) {
      last = -Infinity;
      this.frame(now);
    },
    /** Opens the panel; it reads at once. */
    open(now = 0) {
      isOpen = true;
      el.classList.toggle("gone", false);
      last = -Infinity;
      this.frame(now);
    },
    /** Shuts it: from here `frame` reads nothing. */
    shut() {
      isOpen = false;
      el.classList.toggle("gone", true);
    },
    /** Every frame: while open, the panel reads the pool a few times a second; while shut, nothing. */
    frame(now) {
      if (!isOpen || now - last < EVERY) return;
      last = now;
      show(read(now));
    },
    /** The words on the panel now, whole, one string a visible line, in order. */
    words() {
      const out = [];
      const visit = (n) => {
        if (n.classList && n.classList.contains("gone")) return;
        if (n.children && n.children.length) Array.from(n.children).forEach(visit); // a page's `children` is an HTMLCollection: no forEach
        else if (n.textContent) out.push(n.textContent);
      };
      visit(el);
      return out;
    },
  };
}

/** Clear both copies at the held detail, and start a fresh burst. Other densities stay available. */
export async function clearCache({ sprites, pool, detail, clock = null, now = 0 }) {
  const pending = pool.clearCached(detail);
  sprites.clearDetail(detail);
  pool.newBurst();
  if (clock) clock.start(now);
  await pending;
}

/**
 * What the panel's buttons do. `say(why)` is a tap on a grey one; `refresh()` redraws the panel after an action.
 * - and + keep the count from 1 to 12 and Reset goes to `suggested`.
 */
export function workerTaps({ pool, suggested, clear, say, refresh, close }) {
  const to = (n) => (pool.resize(Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, n))), refresh());
  return {
    minus: () => to(pool.size - 1),
    plus: () => to(pool.size + 1),
    reset: () => to(suggested),
    clear: async () => {
      await clear();
      refresh();
    },
    close,
    grey: say,
  };
}
