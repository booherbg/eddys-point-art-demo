// Playing the park (plan 2026-11-18-live-forge, Task 4): the words she reads, which tile a pointer is over, how a press becomes
// a tap or a pan, and the prefetch of the build bar's pictures. A pure module (no DOM, no timers), so node tests run it.
//
// The camera is hers: a press that slides pans it, a press that stays is a tap; nothing here moves it on a build.

// The build bar, its trays and Turn are in trays.js (Task 26).

/** The button that acts once: ten guests walk up the road. */
export const ADD_TEN = "Add 10 guests";
/** The speeds (held, one of three) and the sim steps each runs per 60th of a second. Fast is the game's 4x. */
export const SPEEDS = [
  ["Pause", 0],
  ["Play", 1],
  ["Fast", 4],
];
/** The sentence under the title, gone after the first tap. */
export const OPENING = "Every picture in this park is drawn the first time you see it.";

/** Art pixel (`px`, `py`) is on tile (tx, ty) where px = 32 (tx - ty) and py = 16 (tx + ty), a tile's center on whole numbers. */
export function tileAt(px, py) {
  const u = px / 32, v = py / 16;
  return { x: Math.round((u + v) / 2) + 0, y: Math.round((v - u) / 2) + 0 };
}

/** The center of tile (`x`, `y`) in art pixels. */
export function tileCenter(x, y) {
  return { x: 32 * (x - y), y: 16 * (x + y) };
}

/** The four corners of a tile's diamond in art pixels, top, right, bottom, left. */
export function diamond(x, y) {
  const c = tileCenter(x, y);
  return [[c.x, c.y - 16], [c.x + 32, c.y], [c.x, c.y + 16], [c.x - 32, c.y]];
}

/**
 * Pointer to tap or pan. A press is a tap when it lifts within `slop` screen pixels of where it landed; farther, it is a pan
 * (and a tool's tap is cancelled). The mouse's ghost follows it as it hovers; a finger's ghost shows while it is down, so she
 * sees the price before she lifts, and is gone when it lifts.
 */
export class Hands {
  constructor({ slop = 8 } = {}) {
    this.slop = slop;
    /** The held tool's number (0 to 9, `Tool::ALL`'s), or null. Holding the same one again lets it go. */
    this.tool = null;
    /** A stall's turn, in quarters: what the next one is placed facing, and what a turn tap sets. */
    this.turn = 0;
    /** The tile the ghost is on, `{x, y}`, or null. */
    this.cursor = null;
    this.pressed = null;
  }

  hold(i) {
    this.tool = this.tool === i ? null : i;
    if (this.tool === null) this.cursor = null;
  }

  /** Turns what she is about to place a quarter. A ride's pictures turn with it; a stall turns at its own tap. */
  rotate() {
    this.turn = (this.turn + 1) % 4;
  }

  /** A press: `p` = `{id, sx, sy, tile, touch}` (screen pixels, the tile under it). */
  down(p) {
    this.pressed = { id: p.id, sx: p.sx, sy: p.sy, px: p.sx, py: p.sy, moved: false, touch: !!p.touch };
    if (this.tool !== null) this.cursor = p.tile;
  }

  /** A move. Returns `{pan: [dx, dy]}` in screen pixels while a press is sliding, else null. */
  move(p) {
    const d = this.pressed;
    if (!d) {
      if (!p.touch && this.tool !== null) this.cursor = p.tile;
      return null;
    }
    if (p.id !== d.id) return null;
    if (!d.moved) {
      if (Math.hypot(p.sx - d.sx, p.sy - d.sy) <= this.slop) {
        if (this.tool !== null) this.cursor = p.tile;
        return null;
      }
      d.moved = true;
      this.cursor = null;
      d.px = d.sx;
      d.py = d.sy;
    }
    const pan = [p.sx - d.px, p.sy - d.py];
    d.px = p.sx;
    d.py = p.sy;
    return { pan };
  }

  /**
   * A lift: `{tap: tile}` when it was a tap with a tool held (it builds), else null (a pan, or a tap with no tool held, which
   * does nothing: Blaine, 2026-11-18, a status card on a tap "just gets in the way").
   */
  up(p) {
    const d = this.pressed;
    if (!d || p.id !== d.id) return null;
    this.pressed = null;
    if (d.touch) this.cursor = null;
    if (d.moved) return null;
    if (this.tool !== null) return p.tile ? { tap: p.tile } : null;
    return null;
  }

  /** The pointer left the page. */
  leave() {
    this.pressed = null;
    this.cursor = null;
  }
}

/**
 * The build bar's pictures, asked for once the first screen is drawn (ruling 3: the bar's items go last, so the park's own
 * art is never kept waiting for them), so a ghost shows real art. `take(firstScreenDone, view)` returns the requests the
 * first time the first screen is done, and nothing before or after.
 */
export class Prefetch {
  constructor(names, entries) {
    const family = new Map(entries.map((e) => [e.name, e.family]));
    this.names = names.filter((n) => family.has(n));
    this.family = family;
    this.taken = false;
  }

  take(done, view) {
    if (!done || this.taken) return [];
    this.taken = true;
    const x = view.x + view.w / 2, y = view.y + view.h / 2;
    return this.names.map((name) => ({ name, family: this.family.get(name), x, y, prefetch: true }));
  }
}
