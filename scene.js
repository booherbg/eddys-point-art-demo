// The park on screen (plan 2026-11-18-live-forge, Task 3): which ground tiles and which sprites a view shows, and how each
// is drawn. A pure module (it draws into a 2D context it is given, and asks the pool through `ask`), so node tests run it
// with a recording context and a fake park.
//
// Everything is in art pixels, the game's own map projection (`park/src/scene.rs`): the page sets the context's transform
// to `zoom` and the view's corner, so a sprite is drawn at its own pixel and a zoom of 1 or 2 stays a whole number of
// screen pixels to each art pixel (nearest neighbor, no smoothing). The wasm gives the list already culled to the view; the
// scene asks the pool for those names and no others.

import { MAX_STEP, densityFor, fineDensity } from "./detail.js";

export const TILE_W = 64;
export const TILE_H = 32;
/** The i32s in a draw-list record: id, x, y, clipFrom, clipTo, footprintW, footprintD, frame, count, row, wear, ride. */
export const RECORD = 12;
/** The frames of each animation (`park/src/scene.rs`'s `ANIMATIONS`): `{prefix}{k}` of `count`. */
export const ANIMATIONS = [["carousel_f", 32], ["ferris_f", 8], ["ferris_r1_f", 8], ["ship_f", 13], ["ship_r1_f", 13]];
/** Tiles of grass past the map's edge that are drawn (`ground.rs`'s APRON). */
export const APRON = 10;
/** Atlas indexes (`ground.rs`): the first water frame, the count of water frames, and the void past the apron. */
export const WATER = 6;
export const WATER_FRAMES = 4;
export const VOID = 255;
export const ATLAS_TILES = 44;
const NO_CLIP_FROM = -2147483648;
const NO_CLIP_TO = 2147483647;

/** `name family w h ax ay` a line to `{entries, boxes}`: `entries[id]`, and `boxes[name] = [w, h, ax, ay]` for the sketch. */
export function parseTable(text) {
  const entries = [];
  const boxes = {};
  for (const line of text.split("\n")) {
    const p = line.split(" ");
    if (p.length !== 6) continue;
    const [name, family, w, h, ax, ay] = p;
    entries.push({ name, family, w: +w, h: +h, ax: +ax, ay: +ay });
    boxes[name] = [+w, +h, +ax, +ay];
  }
  return { entries, boxes };
}

/** The art-pixel rectangle a `width` by `height` screen shows at `zoom` (a whole step, 1 to `MAX_STEP`) with the camera's center at `cam`. */
export function viewOf(cam, width, height, zoom) {
  const w = Math.ceil(width / zoom);
  const h = Math.ceil(height / zoom);
  return { x: Math.round(cam.x - w / 2), y: Math.round(cam.y - h / 2), w, h };
}

/** Keeps the camera's center over the park (its map and its apron), so a drag cannot lose the map. */
export function clampCamera(cam, size) {
  const reach = (n) => (n + APRON) * 32;
  return {
    x: Math.max(-reach(size.h), Math.min(reach(size.w), cam.x)),
    y: Math.max(0, Math.min((size.w + size.h) * 16, cam.y)),
  };
}

/** The tiles a view can show, as `{x0, y0, w, h}`: the box round the rhombus of tiles it crosses, within the apron. */
export function tileRange(view, size) {
  // Art pixel (px, py) is on tile (tx, ty) where px = 32 (tx - ty) and py = 16 (tx + ty).
  const u0 = view.x / 32, u1 = (view.x + view.w) / 32;
  const v0 = view.y / 16, v1 = (view.y + view.h) / 16;
  const lo = (n) => Math.floor(n) - 2;
  const hi = (n) => Math.ceil(n) + 2;
  let x0 = lo((u0 + v0) / 2), x1 = hi((u1 + v1) / 2);
  let y0 = lo((v0 - u1) / 2), y1 = hi((v1 - u0) / 2);
  x0 = Math.max(x0, -APRON); y0 = Math.max(y0, -APRON);
  x1 = Math.min(x1, size.w + APRON); y1 = Math.min(y1, size.h + APRON);
  return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * The camera: its center in art pixels and its zoom (a whole step, 1 to 5). It moves only through `drag` and the zoom calls,
 * which are her hands; nothing the park does (a guest, a new sprite, the end of a draw) calls any (CLAUDE.md, "The camera is
 * hers"). The Detail row changes how pictures are drawn, never the view.
 */
export class Camera {
  constructor(center, size, zoom = 1) {
    this.size = size;
    this.center = clampCamera(center, size);
    this.zoomTo(zoom);
  }

  /** Dragging the map by (`dx`, `dy`) device pixels, at `scale` device pixels to an art pixel. */
  drag(dx, dy, scale) {
    this.center = clampCamera({ x: this.center.x - dx / scale, y: this.center.y - dy / scale }, this.size);
  }

  /** Zoom to step `z` (whole, 1 to 5; a deeper or odd one is the nearest) about the center, which stays where it is. */
  zoomTo(z) {
    const n = Math.round(Number(z));
    this.zoom = Number.isFinite(n) ? Math.max(1, Math.min(MAX_STEP, n)) : 1;
  }

  /** One step in (`+1`) or out (`-1`), stopping at the ends: the wheel and the plus and minus keys. */
  zoomBy(steps) {
    this.zoomTo(this.zoom + steps);
  }

  /** The double tap: one step in, and from the deepest back to 1. */
  cycle() {
    this.zoomTo(this.zoom >= MAX_STEP ? 1 : this.zoom + 1);
  }

  /** The view of a `width` by `height` screen at this zoom times the screen's own pixel ratio `dpr` (a whole number). */
  view(width, height, dpr = 1) {
    return viewOf(this.center, width, height, this.zoom * dpr);
  }
}

/** The frame of an animation to draw: the one showing now if it is in memory, else the nearest earlier one that is, else null. */
export function nearestEarlier(has, shown, count) {
  for (let b = 0; b < count; b++) {
    const f = (shown - b + count) % count;
    if (has(f)) return f;
  }
  return null;
}

export class Scene {
  /**
   * `api`: the park (`park.js`'s shape: `size`, `drawList(view)`, `ground(x0, y0, w, h)`). `table`: `parseTable`'s result.
   * `sprites`: the page's `Sprites`. `ask(req)`: asks the pool for a sprite. `atlas.draw(ctx, index, x, y)`: one ground tile.
   */
  constructor({ api, table, sprites, ask, atlas }) {
    Object.assign(this, { api, table, sprites, ask, atlas });
    this.stats = { tiles: 0, items: 0, asked: 0, below: 0, belowNames: [] };
    /** The names the first frame showed (the carousel's frame then showing, not all 32), and when each was all in memory. */
    this.first = null;
    this.firstDoneAt = null;
    this.sketched = new Set();
  }

  /**
   * Draws the ground then the draw list for `view` at time `now` (seconds). `look` is the view's zoom and the Detail step: a sprite
   * is asked for at `densityFor` them (the lower of the two, kept under the 4,096 rule), and the ground drawn at `fineDensity`.
   */
  frame(ctx, view, now, look = { zoom: 1, detail: 1 }) {
    this.stats = { tiles: 0, items: 0, asked: 0, below: 0, belowNames: [] };
    this.look = look;
    this.sprites.beginFrame?.();
    /** The names drawn as a sketch this frame (asked for, not yet in memory). */
    this.sketched = new Set();
    this.#ground(ctx, view, now);
    const rec = this.api.drawList(view);
    const asked = new Set();
    const shownNames = [];
    // A ride none of whose frames is in memory yet shows its stand-in box. Her riders (the sprites of its footprint that are not
    // the ride's own frame) wait for that ride's picture, so none floats over the box (b574); another ride's riders do not wait
    // for it (Task 23b: each ride is boxed or not on its own).
    const boxed = new Set();
    for (let o = 0; o + RECORD <= rec.length; o += RECORD) {
      const f = rec[o + 7], c = rec[o + 8];
      if (f >= 0) {
        const base = /^(.*_f)\d+$/.exec(this.table.entries[rec[o]].name)[1];
        if (nearestEarlier((k) => this.sprites.has(`${base}${k}`), f, c) === null) boxed.add(rec[o + 11]);
      }
    }
    for (let o = 0; o + RECORD <= rec.length; o += RECORD) {
      const e = this.table.entries[rec[o]];
      const [x, y, from, to, fw, fd, frame, count] = [rec[o + 1], rec[o + 2], rec[o + 3], rec[o + 4], rec[o + 5], rec[o + 6], rec[o + 7], rec[o + 8]];
      const clip = from === NO_CLIP_FROM && to === NO_CLIP_TO ? null : [from, to];
      let req = { name: e.name, family: e.family, x, y, footprint: { w: fw, d: fd }, wear: rec[o + 10], density: this.#density(e.name) };
      if (frame >= 0) {
        // An animation: every frame is asked for (the order sorts them, the one showing now first) and the nearest earlier
        // one in memory is drawn meanwhile.
        const base = /^(.*_f)\d+$/.exec(e.name)[1];
        req.frame = { index: frame, count, shown: frame };
        if (!asked.has(base)) {
          asked.add(base);
          for (let f = 0; f < count; f++) this.#ask({ name: `${base}${f}`, family: e.family, x, y, frame: { index: f, count, shown: frame }, density: this.#density(`${base}${f}`) });
        }
        const k = nearestEarlier((f) => this.sprites.has(`${base}${f}`), frame, count);
        if (k !== null) req = { ...req, name: `${base}${k}`, frame: undefined, density: this.#density(`${base}${k}`) };
      }
      if (frame < 0 && boxed.has(rec[o + 11]) && (fw > 1 || fd > 1) && /^guest_|_front\d+$/.test(e.name)) continue;
      shownNames.push(e.name);
      this.stats.items++;
      // `below`: the sprites this frame draws at a step under the one asked (a stand-in, or a sketch), the read of "every sprite draws at the step".
      if ((this.sprites.densityOf?.(req.name, req.density) ?? req.density) < req.density) { this.stats.below++; if (this.stats.belowNames.length < 40 && !this.stats.belowNames.includes(req.name)) this.stats.belowNames.push(req.name); }
      if (!this.sprites.draw(ctx, req, x, y, now, clip) && !this.sprites.has(req.name)) this.sketched.add(req.name);
    }
    this.#firstScreen(shownNames, now);
    this.sprites.endFrame?.();
  }

  /** The density sprite `name` is drawn at in this view. */
  #density(name) {
    return densityFor(this.table.boxes[name], this.look.detail, this.look.zoom);
  }

  /** Asks for a frame's picture: the game's size first if it is not in memory (it stands in for every finer one), then the fine one. */
  #ask(req) {
    const d = req.density || 1;
    this.sprites.touch?.(req.name, d);
    if (!this.sprites.hasAt(req.name, 1)) {
      this.sprites.claimOne?.(req.name);
      this.stats.asked++;
      this.ask({ ...req, density: 1 });
    }
    if (this.sprites.wantsFine(req.name, d)) {
      this.stats.asked++;
      this.ask(req);
    }
  }

  #ground(ctx, view, now) {
    const size = this.api.size;
    const r = tileRange(view, size);
    if (r.w === 0 || r.h === 0) return;
    const idx = this.api.ground(r.x0, r.y0, r.w, r.h);
    const water = Math.floor(now * 4) % WATER_FRAMES;
    const d = fineDensity(this.look.detail, this.look.zoom);
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        let t = idx[j * r.w + i];
        if (t === VOID) continue;
        const tx = r.x0 + i, ty = r.y0 + j;
        const cx = 32 * (tx - ty), cy = 16 * (tx + ty);
        if (cx + 32 <= view.x || cx - 32 >= view.x + view.w || cy + 16 <= view.y || cy - 16 >= view.y + view.h) continue;
        if (t === WATER) t += water;
        this.atlas.draw(ctx, t, cx - 32, cy - 16, d);
        this.stats.tiles++;
      }
    }
  }

  /** The first screen is the names of the first frame that showed anything; it is done when every one is in memory. */
  #firstScreen(names, now) {
    if (this.first === null) {
      if (names.length) this.first = [...new Set(names)];
      return;
    }
    if (this.firstDoneAt === null && this.#needed().every((n) => this.sprites.has(n) || this.#frameDrawn(n))) this.firstDoneAt = now;
  }

  /** The first screen's names that hold it back: all of them (no family is built whole now, Task 1b, so none is left out as slow). */
  #needed() {
    return this.first;
  }

  /** A frame of an animation counts as drawn when any earlier frame of it is, as it is shown. */
  #frameDrawn(name) {
    const m = /^(.*f)(\d+)$/.exec(name);
    const count = m && ANIMATIONS.find(([prefix]) => name.startsWith(prefix))?.[1];
    if (!count) return false;
    return nearestEarlier((f) => this.sprites.has(`${m[1]}${f}`), +m[2], count) !== null;
  }

  /** How many of the first screen's names are in memory, and how many it has. */
  firstProgress() {
    if (this.first === null) return [0, 0];
    const need = this.#needed();
    return [need.filter((n) => this.sprites.has(n) || this.#frameDrawn(n)).length, need.length];
  }
}

/**
 * Draws atlas tiles from an RGBA strip (`ATLAS_TILES` tiles one under another) kept on an offscreen canvas. At `density` `d` each
 * tile is `64 * d` by `32 * d` texels, drawn into the tile's own 64 by 32 art pixels.
 */
export function makeAtlas(rgba, canvasFactory, density = 1) {
  const w = TILE_W * density, h = TILE_H * density;
  const canvas = canvasFactory(w, h * ATLAS_TILES);
  const c = canvas.getContext("2d");
  c.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h * ATLAS_TILES), 0, 0);
  return { draw: (ctx, index, x, y) => ctx.drawImage(canvas, 0, index * h, w, h, x, y, TILE_W, TILE_H) };
}

/**
 * The ground at each density: the game's own is built first; a finer one is built on a turn of its own (`schedule`, so no frame
 * stalls while the wasm draws it), and until it is ready the best lower one is drawn enlarged, as a sprite's stand-in is.
 * `build(d)` makes an atlas `{draw(ctx, index, x, y)}`.
 */
export class GroundAtlases {
  constructor({ build, schedule = (f) => setTimeout(f, 0), light = "day" }) {
    this.build = build;
    this.schedule = schedule;
    this.light = light;
    this.atlases = new Map([[atlasKey(light, 1), build(1, light)]]);
    this.pending = new Set();
  }

  /** Switch the code-drawn ground with the held forge light; the base atlas is small enough to make immediately. */
  setLight(light) {
    if (light === this.light) return;
    this.light = light;
    const key = atlasKey(light, 1);
    if (!this.atlases.has(key)) this.atlases.set(key, this.build(1, light));
  }

  draw(ctx, index, x, y, d = 1) {
    const light = this.light;
    let k = d;
    while (k > 1 && !this.atlases.has(atlasKey(light, k))) k--;
    const key = atlasKey(light, d);
    if (d > 1 && !this.atlases.has(key) && !this.pending.has(key)) {
      this.pending.add(key);
      this.schedule(() => {
        this.atlases.set(key, this.build(d, light));
        this.pending.delete(key);
      });
    }
    this.atlases.get(atlasKey(light, k)).draw(ctx, index, x, y);
  }
}

const atlasKey = (light, density) => `${light}@${density}`;

/** Whether a wheel event at `now` (ms) may zoom: one step per 150 ms after the last one that did. */
export function wheelStep(last, now) {
  return now - last >= 150;
}
