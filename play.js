// Playing the park (plan 2026-11-18-live-forge, Task 4): the words she reads, which tile a pointer is over, how a press becomes
// a tap or a pan, and the prefetch of the build bar's pictures. A pure module (no DOM, no timers), so node tests run it.
//
// The camera is hers: a press that slides pans it, a press that stays is a tap; nothing here moves it on a build.

// The build bar, its trays and Turn are in trays.js (Task 26).

/** Whole forge looks the player can hold for the park. */
export const STYLES = ["Classic", "Soft", "Toybox"];
/** The held light used by the live forge renderer and the demo ground. */
export const LIGHTS = ["Day", "Dusk", "Night"];
/** Whole candidate palettes beside the game's own, which stays the default and is held at open. The controller picks two
 * of the three candidates for Blaine's look (live forge Task 22), so all three are on the row until then. */
export const PALETTES = ["Garden", "Sunset", "Harbor", "Game"];
export const DEFAULT_PALETTE = "game";
/** The word before each look row, the same stat-row form as the Tools tray's "Detail:". */
export const STYLE_ROW = "Style:";
export const LIGHT_ROW = "Light:";
export const PALETTE_ROW = "Colors:";

/** A look's pictures have their own cache key; Game keeps the earlier key for today's pictures. */
export function lookKey(style, light, palette = DEFAULT_PALETTE) {
  const base = `${style}@${light}`;
  return palette === DEFAULT_PALETTE ? base : `${base}@${palette}`;
}

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

/** The Ride queue tool's number (`Tool::Queue`, the last of `Tool::ALL`): the one that makes every In show. */
export const QUEUE_TOOL = 9;
/** The In hut's green (the forge's entrance hut is the green one, the exit the red), as the marker's outline. */
export const IN_GREEN = "#3fd45e";
/** The dark casing under the outline: green on the park's grass needs it to read. */
export const IN_CASING = "#0f3a1c";
/** The seconds one pulse of an In marker takes. */
export const IN_PULSE_S = 1.4;

/**
 * The In tiles to mark while tool `tool` is held (Blaine, 2026-11-26: "I can only add a queue on the entrance but it's not clear
 * where the entrance is"): all of them with Ride queue held, none with any other tool or none. Only an overlay: it never moves
 * the view, and a tap on the map still builds as before.
 */
export function inMarkers(tool, tiles) {
  return tool === QUEUE_TOOL ? tiles : [];
}

/**
 * One frame of the marker at time `t` (seconds): `ring` 0 to 1 is how far the ring has spread (it starts on the tile's edge and
 * fades out as it grows), `glow` 0 to 1 breathes the outline and its fill. It repeats every `IN_PULSE_S`.
 */
export function inPulse(t) {
  const ring = (((t / IN_PULSE_S) % 1) + 1) % 1;
  return { ring, glow: 0.5 - 0.5 * Math.cos(ring * 2 * Math.PI) };
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
    /** Every finger down now, by pointer id: `{sx, sy}`. */
    this.fingers = new Map();
    /** Two fingers down: `{ids, base}` where `base` is the distance the last zoom step was taken at. */
    this.pinch = null;
    /** The last lone press, for the double tap: `{t, sx, sy}`. */
    this.lastTap = null;
  }

  hold(i) {
    this.tool = this.tool === i ? null : i;
    if (this.tool === null) this.cursor = null;
  }

  /** Turns what she is about to place a quarter. A ride's pictures turn with it; a stall turns at its own tap. */
  rotate() {
    this.turn = (this.turn + 1) % 4;
  }

  /**
   * A press: `p` = `{id, sx, sy, tile, touch, t}` (screen pixels, the tile under it, the time in ms). Returns `{double: true}`
   * for a double tap: a second lone press within 320 ms and 30 px of the first, with no tool held. A second finger landing is
   * never one: it starts a pinch and drops the first finger's press, so nothing pans or builds.
   */
  down(p) {
    this.fingers.set(p.id, { sx: p.sx, sy: p.sy });
    if (this.fingers.size >= 2) {
      this.lastTap = null;
      this.pressed = null;
      this.cursor = null;
      if (!this.pinch) {
        const ids = [...this.fingers.keys()].slice(0, 2);
        this.pinch = { ids, base: this.gap(ids) };
      }
      return null;
    }
    let double = false;
    const last = this.lastTap;
    if (this.tool === null && typeof p.t === "number" && last && p.t - last.t < 320 && Math.hypot(p.sx - last.sx, p.sy - last.sy) < 30) {
      double = true;
      this.lastTap = null;
    } else {
      this.lastTap = typeof p.t === "number" ? { t: p.t, sx: p.sx, sy: p.sy } : null;
    }
    this.pressed = { id: p.id, sx: p.sx, sy: p.sy, px: p.sx, py: p.sy, moved: false, touch: !!p.touch };
    if (this.tool !== null) this.cursor = p.tile;
    return double ? { double: true } : null;
  }

  gap(ids) {
    const [a, b] = ids.map((i) => this.fingers.get(i));
    return Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy));
  }

  /**
   * A move. Returns `{pan: [dx, dy]}` in screen pixels while a press is sliding, `{zoom: n}` (whole steps, signed) while two
   * fingers pinch (a step each time the gap grows or shrinks by 1.25 from the last), else null.
   */
  move(p) {
    const f = this.fingers.get(p.id);
    if (f) {
      f.sx = p.sx;
      f.sy = p.sy;
    }
    if (this.pinch) {
      if (!this.pinch.ids.includes(p.id)) return null;
      const g = this.gap(this.pinch.ids);
      let n = 0;
      while (g >= this.pinch.base * 1.25) { this.pinch.base *= 1.25; n++; }
      while (g <= this.pinch.base / 1.25) { this.pinch.base /= 1.25; n--; }
      return n ? { zoom: n } : null;
    }
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
    this.fingers.delete(p.id);
    if (this.pinch) {
      if (this.fingers.size < 2) this.pinch = null; // the one left does not pan or build until it lifts and presses again
      return null;
    }
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
    this.fingers.clear();
    this.pinch = null;
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
