// A guest's card on a tap (art demo, Blaine's phone notes of 2026-11-27, note 14): with no tool held, a tap on a guest opens a card with her name as its
// title, the game's stat rows, her latest thought, and her picture at 4x following her, inside the card. The view never moves (the camera is hers).
// The words come from the park (`park/src/card.rs`: `lines`); this module builds the card and draws the portrait. Only DOM calls the node tests' small
// fake document gives.
import { onceButton } from "./bar.js";

/** The word on the card's button: it acts once, so it has no lamp. */
export const CLOSE = "Close";
/** The portrait's size in CSS pixels, and how many times the art it shows (the game's own pixels) are enlarged. */
export const PORTRAIT_W = 96;
export const PORTRAIT_H = 136;
export const PORTRAIT_ZOOM = 4;

/**
 * The card's portrait transform for a canvas of `w` by `h` device pixels at device ratio `dpr`: the scale of one art pixel, and the offset that puts
 * a guest's anchor (her feet) at the middle of the canvas, a tenth of its height up from the bottom.
 */
export function portraitTransform(w, h, dpr, anchor) {
  const s = PORTRAIT_ZOOM * Math.max(1, Math.round(dpr || 1));
  return { s, x: Math.round(w / 2 - anchor.x * s), y: Math.round(h * 0.9 - anchor.y * s) };
}

/** Builds the card in `parent` (hidden until `show`). `onClose()` is a tap on Close. */
export function makeCard(doc, parent, { onClose }) {
  const title = doc.createElement("div");
  title.className = "cardtitle";
  const portrait = doc.createElement("canvas");
  portrait.className = "portrait";
  portrait.width = PORTRAIT_W * 2;
  portrait.height = PORTRAIT_H * 2;
  const rows = doc.createElement("div");
  rows.className = "cardrows";
  const body = doc.createElement("div");
  body.className = "cardbody";
  body.append(portrait, rows);
  const close = onceButton(doc, CLOSE, () => onClose());
  parent.append(title, body, close);
  let divs = [];
  return {
    portrait,
    close,
    /** Her lines (`card.rs`): her name, the stat rows, her thought last. Rewrites only what changed. */
    setLines(lines) {
      const [name = "", ...rest] = lines;
      if (title.textContent !== name) title.textContent = name;
      if (rest.length !== divs.length) {
        divs = rest.map((t, i) => {
          const d = doc.createElement("div");
          d.className = i === rest.length - 1 ? "stat thought" : "stat";
          d.textContent = t;
          return d;
        });
        rows.replaceChildren(...divs);
        return;
      }
      rest.forEach((t, i) => {
        if (divs[i].textContent !== t) divs[i].textContent = t;
      });
    },
    /** Every line the card shows, in order (title first), for the tests and the shot scripts. */
    words() {
      return [title.textContent, ...divs.map((d) => d.textContent)];
    },
  };
}

/**
 * Draws guest `list` (her draw-list records, twelve i32 a record: her body, then what she holds) on `ctx` at 4x, nearest-neighbor, her feet at the
 * portrait's middle. `draw(req, x, y)` draws one sprite on the transformed context (`Sprites.draw`); `entry(id)` is the table's line; `density(name)`
 * the picture's density at 4x. Returns how many sprites it drew.
 */
export function drawPortrait(ctx, canvas, list, { dpr, entry, draw, density, now = 0 }) {
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!list.length) return 0;
  const t = portraitTransform(w, h, dpr, { x: list[0 + 1], y: list[0 + 2] });
  ctx.setTransform(t.s, 0, 0, t.s, t.x, t.y);
  ctx.imageSmoothingEnabled = false;
  let n = 0;
  for (let o = 0; o + 12 <= list.length; o += 12) {
    const e = entry(list[o]);
    draw({ name: e.name, family: e.family, x: list[o + 1], y: list[o + 2], wear: list[o + 10], density: density(e.name) }, list[o + 1], list[o + 2], now);
    n++;
  }
  return n;
}
