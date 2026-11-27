// The page's sprites (Study 115, plan 2026-11-18-live-forge, Task 2, ruling 4): the memory cache (an ImageBitmap by
// name) and the sketch that holds a sprite's place until it is drawn. Only 2D-context calls, so the node tests give it a
// recording context.
//
// The sketch is pencil: the sprite's footprint diamond and its box, in the ink tone, dashed and slowly marching, so it
// reads as "being drawn" and not as "missing". When the picture lands (and a sketch was showing) it fills in top to
// bottom in `FILL_SECONDS`. Rejected: hiding the tile, a spinner, a grey box, a low-resolution first pass.

import { paint, WORN_CAP } from "./recolor.js";
import { grade } from "./grade.js";
import { spriteKey, MAX_STEP, lookOf } from "./detail.js";

const STYLES = ["classic", "soft", "toybox"];
const lookKey = lookOf;
const cacheKey = (style, name, density = 1) => spriteKey(`${lookKey(style)}\0${name}`, density);

export const INK = "#2A1C3E";
/** The pale sheet the box is drawn on (the palette's paper tone), so the pencil shows on any ground. */
export const PAPER = "#F4EFE6";
export const FILL_SECONDS = 0.2;
/** Line widths and the halo's strength (live forge Task 3: tuned on the real ground, where the road's asphalt hid plain ink). */
export const INK_WIDTH = 2;
export const HALO_WIDTH = 4;
export const HALO_ALPHA = 0.7;

/** The sheet's strength for a box `h` tall: 0.12 up to 48 px, 0.04 from 140 px, between in line. */
export function tintFor(h) {
  const t = Math.min(1, Math.max(0, (h - 48) / (140 - 48)));
  return Math.round((0.12 - t * (0.12 - 0.04)) * 1000) / 1000;
}
const TILE_HALF_W = 32;
const TILE_HALF_H = 16;

/**
 * The sketch's shapes relative to the anchor pixel: the footprint's diamond (`w` by `d` tiles, anchored on the center of
 * its first tile, as the game places a stall or a ride) as four corners, and the box `[x, y, w, h]` of the picture.
 */
export function sketchGeometry(box, footprint = { w: 1, d: 1 }) {
  const corner = (x, y) => [(x - y) * TILE_HALF_W, (x + y) * TILE_HALF_H];
  const diamond = [corner(-0.5, -0.5), corner(footprint.w - 0.5, -0.5), corner(footprint.w - 0.5, footprint.d - 0.5), corner(-0.5, footprint.d - 0.5)];
  const rect = box ? [-box.ax, -box.ay, box.w, box.h] : null;
  return { diamond, rect };
}

/** How many of a sprite's `h` rows show `t` seconds after it landed. */
export function fillRows(t, h) {
  return Math.min(h, Math.max(0, Math.floor((t / FILL_SECONDS) * h)));
}

export class Sprites {
  /**
   * `ask(req)`: how a sprite is requested (the pool's `request`). `boxes`: name -> `[w, h, ax, ay]`, the size the sketch
   * is drawn from before the picture exists.
   */
  constructor({ ask, boxes = {}, style = "classic@day", rowOf = null, makeWorn = null, cap = Infinity, onEvict = () => {} }) {
    this.ask = ask;
    this.style = style;
    this.previousStyle = null;
    /**
     * The byte budget (live forge Task 31, b582): `bytes` is everything held, the bitmaps, a person's pixels and mask, and her worn
     * canvases. Past `cap`, `endFrame` evicts what is not on screen: worn canvases first (the cheapest to make again), then fine
     * pictures, the oldest shown first. A 1x picture and a picture on screen (wanted this frame, or drawn as a stand-in) never go;
     * `onEvict(name, density)` lets the order draw an evicted one again. A fine picture is asked for only while it fits under `cap`
     * with those already on their way (`wantsFine`); the ones held back are counted (`blockedCount`), never dropped silently (b581, where
     * the old cap, with nothing ever freed, left every later picture at a lower step).
     */
    this.cap = cap;
    this.onEvict = onEvict;
    /** The bytes of the fine pictures (density above 1) in memory (their bitmaps), keyed by style, name, and density. */
    this.fineBytes = 0;
    /** The frame number, and for each key the frame it was last on screen. */
    this.frameNo = 0;
    /** Fine keys asked for and not landed yet, with the bytes reserved for each, and their sum. */
    this.claimed = new Map();
    this.inflight = 0;
    /** The fine keys this frame wanted and the cap held back. */
    this.refused = new Map();
    /** The keys the frame drew, stand-ins included: on screen, so never evicted. */
    this.shown = new Set();
    /** The keys the view wanted this frame (`beginFrame` empties it): what the Drawing panel's rows add up. */
    this.touched = new Set();
    this.boxes = boxes;
    /** `rowOf(wear)`: a wear's palette row (64 texels of four bytes), and `makeWorn(rgba, w, h)`: a drawable of pixels. Without both a person is drawn as the forge drew her. */
    this.rowOf = rowOf;
    this.makeWorn = makeWorn;
    this.rows = new Map();
    /** The pictures of people in a look: `name|wear` to a drawable, made the first time she is drawn in it. */
    this.worn = new Map();
    this.mem = new Map();
    /** The bytes of every picture in `mem` (the overlay's "Sprite cache"). */
    this.bytes = 0;
    /** The fine keys whose draw failed: never waited for. */
    this.failedKeys = new Set();
    this.sketched = new Set();
  }

  /** Select a style and light together, keeping every look's pictures in its own cache. */
  setStyle(style) {
    if (style === this.style) return;
    this.previousStyle = this.style;
    this.style = style;
    // The pool drops the queued jobs of a look she leaves, so their reserves end here (b666): left in `claimed` they added up with each
    // switch until `inflight` filled the cap and no fine picture was asked for. One still drawing lands later and ends nothing twice.
    const own = `${lookKey(style)}\0`;
    for (const key of [...this.claimed.keys()]) if (!key.startsWith(own)) this.#unclaim(key);
  }

  /** Whether the picture is in memory, at any step. */
  has(name, style = this.style) {
    return this.#best(name, MAX_STEP, style) !== null;
  }

  /** Whether the picture is in memory at exactly density `d`. */
  hasAt(name, d = 1, style = this.style) {
    return this.mem.has(cacheKey(style, name, d));
  }

  /** The density of the picture `draw` would use for `name` at `d` (the finest in memory at or below it), 0 when none is in memory. */
  densityOf(name, d = 1, style = this.style) {
    return this.#best(name, d, style)?.density || 0;
  }

  /** The finest picture of `name` in memory at or below density `d`: the enlarged lower step stands in for a finer one not drawn yet. */
  #best(name, d, style = this.style) {
    for (let k = Math.max(1, d); k >= 1; k--) {
      const e = this.mem.get(cacheKey(style, name, k));
      if (e) return e;
    }
    return null;
  }

  /**
   * Whether a fine picture (density `d` above 1) of `name` should be asked for: it is not in memory, and it fits under the cap beside
   * what is held and what is already on its way. A picture asked for once stays asked (true again until it lands); one the cap holds
   * back is noted for `blockedCount` and asked again on a later frame, when the frame's trim has freed room.
   */
  wantsFine(name, d, style = this.style) {
    if (d <= 1 || this.hasAt(name, d, style)) return false;
    const key = cacheKey(style, name, d);
    if (this.claimed.has(key)) return true;
    const box = this.boxes[name];
    const est = box ? (box[0] + 2) * (box[1] + 2) * d * d * 4 : 0;
    if (this.bytes + this.inflight + est > this.cap) {
      this.refused.set(key, est);
      return false;
    }
    this.claimed.set(key, est);
    this.inflight += est;
    return true;
  }

  /**
   * The game's size of `name` is asked for: its bytes are reserved like a fine picture's, so the cap counts it before it lands (it is
   * never refused and never evicted). Say it again each frame it is still missing: it is one reserve.
   */
  claimOne(name, style = this.style) {
    const key = cacheKey(style, name, 1);
    if (this.claimed.has(key)) return;
    const box = this.boxes[name];
    const est = box ? (box[0] + 2) * (box[1] + 2) * 9 : 0;
    this.claimed.set(key, est);
    this.inflight += est;
  }

  /** The reserve for `key` ends: it landed, or failed. */
  #unclaim(key) {
    const est = this.claimed.get(key);
    if (est === undefined) return;
    this.claimed.delete(key);
    this.inflight -= est;
  }

  /** Read-only, for a probe: why `name` at density `d` is or is not in memory (its key, what holds it, the cap's sums). */
  explain(name, d = 1, style = this.style) {
    const key = cacheKey(style, name, d);
    const box = this.boxes[name];
    return { name, d, held: [...this.mem.values()].filter((e) => e.name === name).map((e) => e.density), claimed: this.claimed.has(key), refused: this.refused.has(key), est: box ? (box[0] + 2) * (box[1] + 2) * d * d * 4 : 0, bytes: this.bytes, inflight: this.inflight, claims: this.claimed.size, cap: this.cap };
  }

  /** How many of the fine pictures this frame wanted the cap is holding back. */
  blockedCount() {
    let n = 0;
    for (const k of this.refused.keys()) if (!this.mem.has(k) && !this.claimed.has(k)) n++;
    return n;
  }

  /** A new frame: the keys the view wants start again. */
  beginFrame() {
    this.frameNo++;
    this.touched = new Set();
    this.shown = new Set();
    this.refused = new Map();
  }

  /** The frame is drawn: mark what was on screen, then bring the held bytes under the cap by evicting what was not. */
  endFrame() {
    for (const k of this.touched) this.#use(this.mem.get(k));
    for (const k of this.shown) this.#use(this.mem.get(k));
    this.#trim();
  }

  #use(e) {
    if (e) e.used = this.frameNo;
  }

  /** What the held pictures and those on their way come to, and with room made for what the cap held back this frame, the target. */
  #trim() {
    let need = 0;
    for (const [k, est] of this.refused) if (!this.mem.has(k) && !this.claimed.has(k)) need += est;
    const target = this.cap - this.inflight - need;
    if (this.bytes <= target) return;
    // The worn canvases not drawn this frame first; the map is in least recently used order (`#picture` moves a used one to the end).
    for (const [key, w] of this.worn) {
      if (this.bytes <= target) return;
      if (w.used === this.frameNo) continue;
      this.worn.delete(key);
      this.bytes -= w.bytes;
    }
    // Then the fine pictures not on screen, oldest shown first (a tie, the one asked first).
    const stale = [];
    for (const [key, e] of this.mem) if (e.density > 1 && !this.touched.has(key) && !this.shown.has(key)) stale.push(e);
    stale.sort((a, b) => a.used - b.used);
    const gone = new Set();
    for (const e of stale) {
      if (this.bytes <= target) break;
      this.mem.delete(e.key);
      this.bytes -= e.held;
      this.fineBytes -= e.w * e.h * 4;
      e.bitmap?.close?.();
      gone.add(e.key);
      this.onEvict(e.name, e.density, e.style);
    }
    if (gone.size) {
      // Her worn pictures made from an evicted one go with it.
      for (const [key, w] of this.worn) if (gone.has(key.slice(0, key.lastIndexOf("|")))) (this.worn.delete(key), (this.bytes -= w.bytes));
    }
  }

  /** Drop this detail's pictures and their recolors, so the view may ask for them again. */
  clearDetail(detail) {
    const gone = new Set();
    for (const [key, e] of [...this.mem]) {
      if (e.density !== detail) continue;
      this.mem.delete(key);
      this.bytes -= e.held;
      if (e.density > 1) this.fineBytes -= e.w * e.h * 4;
      e.bitmap?.close?.();
      gone.add(key);
      this.onEvict(e.name, e.density, e.style);
    }
    for (const [key, w] of [...this.worn]) {
      if (gone.has(key.slice(0, key.lastIndexOf("|")))) {
        this.worn.delete(key);
        this.bytes -= w.bytes;
      }
    }
    // The pool cancels what was drawing at this step: a reserve for a picture no one may ask for again ends too (the view asks again,
    // and reserves again, for what it still wants).
    for (const key of [...this.claimed.keys()]) if (key.endsWith(`@${detail}`) && detail > 1) this.#unclaim(key);
    this.refused = new Map();
    return gone.size;
  }

  /** `name` at `d` is on the view (the animation's frames too, drawn or not). */
  touch(name, d = 1, style = this.style) {
    this.touched.add(cacheKey(style, name, d));
  }

  /** A queued job the pool dropped for waiting off screen too long (`onDropped`): its reserve ends, and the view asks again if it still wants it. */
  dropped({ name, density = 1, style = this.style }) {
    const key = cacheKey(style, name, density);
    this.#unclaim(key);
    this.sketched.delete(key);
  }

  /** A draw that failed (the pool's `onError`): that picture is never waited for. */
  failed({ name, density = 1, style = this.style }) {
    const key = cacheKey(style, name, density);
    this.failedKeys.add(key);
    this.#unclaim(key);
  }

  /**
   * How far the view's finer pictures have come, over the keys this frame wanted at a density above 1: `have` in memory of the `of` that are
   * or can still be on their way (one that failed is not waited for; every other is counted, the ones the cap holds back too, so nothing is
   * dropped silently: `blockedCount` says how many of the rest those are). Read after the frame
   * has drawn. Each picture swaps in on the frame after it lands (`draw`'s best-in-memory rule), so this only counts.
   */
  progress() {
    let have = 0, of = 0;
    for (const k of this.touched) {
      if (!k.includes("@")) continue;
      if (this.mem.has(k)) {
        have++;
        of++;
      } else if (!this.failedKeys.has(k)) of++;
    }
    return { have, of };
  }

  /** How many pictures the view wants that are on their way, at any step: not drawn, not failed, not held back by a cap. */
  waiting() {
    let n = 0;
    for (const k of this.touched) if (!this.mem.has(k) && !this.failedKeys.has(k) && !(this.refused.has(k) && !this.claimed.has(k))) n++;
    return n;
  }

  /** What the view's pictures cost: the worker seconds spent and the bytes of bitmaps held, over the keys the view wants and that are in memory. */
  cost() {
    let ms = 0, bytes = 0;
    for (const k of this.touched) {
      const e = this.mem.get(k);
      if (!e) continue;
      ms += e.ms || 0;
      bytes += e.w * e.h * 4;
    }
    return { seconds: ms / 1000, bytes };
  }

  /** The pool's `onDrawn`: keep the bitmap, and note when it landed. */
  landed(res, now) {
    const style = res.style || this.style;
    const density = res.density > 1 ? res.density : 1;
    const key = cacheKey(style, res.name, density);
    this.#unclaim(key);
    if (density > 1 && !this.mem.has(key)) this.fineBytes += res.w * res.h * 4;
    const old = this.mem.get(key);
    const held = res.w * res.h * 4 + (res.rgba ? res.rgba.byteLength : 0) + (res.codes ? res.codes.byteLength : 0);
    this.bytes += held - (old ? old.held : 0);
    this.mem.set(key, { key, name: res.name, style, density, bitmap: res.bitmap, w: res.w, h: res.h, ax: res.ax, ay: res.ay, at: now, fill: this.sketched.has(key), rgba: res.rgba, codes: res.codes, ms: res.ms || 0, held, used: this.frameNo });
  }

  /** What to draw for sprite `e` worn by `wear` (-1 or undefined: the forge's own look): the picture in her look, made once. */
  #picture(e, wear) {
    if (wear === undefined || wear < 0 || !e.codes || !this.rowOf || !this.makeWorn) return e.bitmap;
    const key = `${e.key}|${wear}`;
    const kept = this.worn.get(key);
    if (kept) {
      // Used again: to the end of the map (least recently used first), and marked for this frame.
      this.worn.delete(key);
      kept.used = this.frameNo;
      this.worn.set(key, kept);
      return kept.pic;
    }
    // Her clothes' row is graded for the picture's look too, so a guest wears Sunset's cast like everything round her.
    const rowKey = `${e.style}|${wear}`;
    let row = this.rows.get(rowKey);
    if (!row) this.rows.set(rowKey, (row = grade(Uint8ClampedArray.from(this.rowOf(wear)), e.style)));
    const pic = this.makeWorn(paint(e.rgba, e.codes, row), e.w, e.h);
    if (this.worn.size >= WORN_CAP) {
      const [oldest, w] = this.worn.entries().next().value;
      this.worn.delete(oldest);
      this.bytes -= w.bytes;
    }
    const bytes = e.w * e.h * 4;
    this.worn.set(key, { pic, bytes, used: this.frameNo });
    this.bytes += bytes;
    return pic;
  }

  /**
   * Draw sprite `req.name` with its anchor on pixel (`sx`, `sy`) at time `now` (seconds), asking for it first if it is not
   * drawn. A picture in memory is drawn; one just landed fills in; one not yet drawn is a sketch. Returns true when the
   * picture itself was drawn (all of it). `clip` is `[from, to]` in x, the columns of the sprite to draw (a ride's one
   * view column: it is drawn in slices, each in its place among the things round it), or null for all of it.
   */
  draw(ctx, req, sx, sy, now, clip = null) {
    const style = req.style || this.style;
    const d = req.density > 1 ? req.density : 1;
    const key = cacheKey(style, req.name, d);
    this.touched.add(key);
    const e = this.#best(req.name, d, style);
    if (e) this.shown.add(e.key);
    if (!e) {
      // Nothing drawn at any step: the game's size first (it stands in for every finer one), then the fine one.
      this.ask({ ...req, style, density: 1 });
      if (this.wantsFine(req.name, d, style)) this.ask({ ...req, style, density: d });
      this.sketched.add(key);
      const old = this.#fallback(req.name, style, d);
      if (old) this.#blit(ctx, old, this.#picture(old, req.wear), sx, sy, old.h, clip);
      else this.#sketch(ctx, req, sx, sy, now, clip);
      return false;
    }
    if (e.density < d && this.wantsFine(req.name, d, style)) this.ask({ ...req, style, density: d });
    const t = now - e.at;
    if (e.fill && t < FILL_SECONDS) {
      const rows = fillRows(t, e.h);
      const old = this.#fallback(req.name, style, d);
      if (old) this.#blit(ctx, old, this.#picture(old, req.wear), sx, sy, old.h, clip);
      this.#sketch(ctx, req, sx, sy, now, clip);
      if (rows > 0) this.#blit(ctx, e, this.#picture(e, req.wear), sx, sy, rows, clip);
      return false;
    }
    this.#blit(ctx, e, this.#picture(e, req.wear), sx, sy, e.h, clip);
    return true;
  }

  /**
   * A build ghost: the picture in memory, half see-through, with its anchor on (`sx`, `sy`). A picture not drawn yet is asked
   * for (the bar's items are prefetched, so this is rare) and nothing shows meanwhile; a ghost is never sketched.
   */
  ghost(ctx, req, sx, sy, alpha = 0.6) {
    const style = req.style || this.style;
    const e = this.#best(req.name, req.density || 1, style) || this.#fallback(req.name, style, req.density || 1);
    if (!e) {
      this.ask({ ...req, style, density: 1 });
      return false;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const k = e.density;
    ctx.drawImage(this.#picture(e, req.wear), sx - e.ax / k, sy - e.ay / k, e.w / k, e.h / k);
    ctx.restore();
    return true;
  }

  /** A cached picture in another style holds the place until this style's draw lands. */
  #fallback(name, style, d) {
    for (const candidate of [this.previousStyle, ...STYLES]) {
      if (!candidate || lookKey(candidate) === lookKey(style)) continue;
      const e = this.#best(name, d, candidate);
      if (e) return e;
    }
    return null;
  }

  /**
   * The top `rows` (texels) of the picture, in the columns `clip` allows (art pixels). A picture of density `k` is drawn `1/k` of its
   * size with its anchor `1/k` of the way in, so one art pixel is `k` texels of it.
   */
  #blit(ctx, e, pic, sx, sy, rows, clip) {
    const k = e.density;
    const left = sx - e.ax / k;
    const width = e.w / k;
    let a = 0, b = width;
    if (clip) {
      a = Math.max(0, clip[0] - left);
      b = Math.min(width, clip[1] - left);
    }
    if (b <= a) return;
    const top = sy - e.ay / k;
    if (k === 1) {
      if (a === 0 && b === e.w && rows === e.h) ctx.drawImage(pic, left, top);
      else ctx.drawImage(pic, a, 0, b - a, rows, left + a, top, b - a, rows);
    } else ctx.drawImage(pic, a * k, 0, (b - a) * k, rows, left + a, top, b - a, rows / k);
  }

  #sketch(ctx, req, sx, sy, now, clip = null) {
    const b = this.boxes[req.name];
    const g = sketchGeometry(b ? { w: b[0], h: b[1], ax: b[2], ay: b[3] } : null, req.footprint);
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip[0], sy - 4096, clip[1] - clip[0], 8192);
      ctx.clip();
    }
    if (g.rect) {
      // The sheet: a tall box carries less of it, so a tree or a gate does not stay a pale ghost over the ground.
      ctx.globalAlpha = tintFor(g.rect[3]);
      ctx.fillStyle = PAPER;
      ctx.fillRect(sx + g.rect[0], sy + g.rect[1], g.rect[2], g.rect[3]);
    }
    // Each line is drawn twice: a paper halo under the ink, so the pencil reads on any ground (the grass's two greens, sand,
    // water, the road's dark asphalt), then the ink itself.
    for (const [style, width, alpha] of [[PAPER, HALO_WIDTH, HALO_ALPHA], [INK, INK_WIDTH, 1]]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      // The footprint diamond, solid.
      ctx.setLineDash([]);
      ctx.beginPath();
      g.diamond.forEach(([x, y], i) => (i ? ctx.lineTo(sx + x + 0.5, sy + y + 0.5) : ctx.moveTo(sx + x + 0.5, sy + y + 0.5)));
      ctx.closePath();
      ctx.stroke();
      if (g.rect) {
        // The picture's box, dashed, the dashes marching a little, so the pencil looks to be working.
        const [x, y, w, h] = g.rect;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -Math.floor(now * 10);
        ctx.strokeRect(sx + x + 0.5, sy + y + 0.5, w - 1, h - 1);
        // A center line from the foot of the box to its top.
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, sy + y + 0.5);
        ctx.lineTo(sx + 0.5, sy + 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
