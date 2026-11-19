// The small card (plan 2026-11-18-live-forge, Task 27): the page's side of it. What the card says is the park crate's (`park/src/card.rs`,
// the game's own words); this is when it opens and closes, where it sits, and the DOM it is. A pure module (no timers, no camera),
// so node tests run it with a fake DOM.
//
// The camera is hers: nothing here reads or writes it. The card is moved to sit beside what she tapped, never the view.

/** The space between a thing and its card, in CSS pixels. */
export const GAP = 10;

/**
 * Which thing is open. A tap with no tool held opens the card for what is under it (or closes the card on bare ground, or on the
 * thing already open's own spot, which keeps it); a tap with a tool held builds and is not this module's. `pick(art)` is
 * the park's (`{kind, id}` or null).
 */
export class CardState {
  constructor() {
    /** `{kind, id}` of the card that is open, or null. */
    this.open = null;
  }

  /** A tap at art pixel `art` with `tool` held (a number) or null. Returns whether a card is open now. */
  tap(tool, art, pick) {
    if (tool !== null && tool !== undefined) return this.open !== null; // a held tool builds; the card, if open, is not touched
    this.open = art ? pick(art.x, art.y) : null;
    return this.open !== null;
  }

  close() {
    this.open = null;
  }
}

/**
 * Where a card `card` ({w, h}) goes beside `thing` ({x0, y0, x1, y1}), on `screen` (the same kind of box: the space the bars leave).
 * It takes a side the card fits on without covering the thing, the side it sat on last time (`prefer`) if that still fits, else
 * the one with the most room, right and left before below and above. Where no side fits (a phone's narrow map) it goes where there
 * is most room, kept on the screen. Returns `{x, y, side}`.
 */
export function beside(screen, thing, card, prefer = null) {
  const room = { right: screen.x1 - thing.x1, left: thing.x0 - screen.x0, below: screen.y1 - thing.y1, above: thing.y0 - screen.y0 };
  const need = { right: card.w + GAP, left: card.w + GAP, below: card.h + GAP, above: card.h + GAP };
  const fits = Object.keys(room).filter((s) => room[s] >= need[s]);
  const order = ["right", "left", "below", "above"];
  const side = fits.includes(prefer)
    ? prefer
    : (fits.length ? fits : order).slice().sort((a, b) => room[b] - room[a] || order.indexOf(a) - order.indexOf(b))[0];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const midX = (thing.x0 + thing.x1) / 2 - card.w / 2;
  const midY = (thing.y0 + thing.y1) / 2 - card.h / 2;
  const at = {
    right: [thing.x1 + GAP, midY],
    left: [thing.x0 - GAP - card.w, midY],
    below: [midX, thing.y1 + GAP],
    above: [midX, thing.y0 - GAP - card.h],
  }[side];
  return { x: Math.round(clamp(at[0], screen.x0, screen.x1 - card.w)), y: Math.round(clamp(at[1], screen.y0, screen.y1 - card.h)), side };
}

/**
 * The card's DOM in `parent`: a title and a row for each fact. `show(rows)` sets the words (the first row is the name) and keeps
 * the elements it has; `at(x, y)` places it; `hide()` takes it off. No buttons, no tabs.
 */
export function makeCard(doc, parent) {
  const el = doc.createElement("div");
  el.className = "card gone";
  const title = doc.createElement("div");
  title.className = "cardtitle";
  el.append(title);
  const rows = [];
  let shown = "";
  parent.append(el);
  return {
    el,
    /** The words now on the card, whole, one row each. */
    words: () => [title.textContent, ...rows.map((r) => r.textContent)],
    show(list) {
      const key = list.join("\n");
      el.classList.toggle("gone", false);
      if (key === shown) return;
      shown = key;
      title.textContent = list[0];
      while (rows.length < list.length - 1) {
        const r = doc.createElement("div");
        r.className = "cardrow";
        el.append(r);
        rows.push(r);
      }
      rows.forEach((r, i) => {
        const text = list[i + 1];
        r.textContent = text ?? "";
        r.classList.toggle("gone", text === undefined);
      });
    },
    hide() {
      el.classList.toggle("gone", true);
      shown = "";
    },
    size() {
      const b = el.getBoundingClientRect();
      return { w: b.width, h: b.height };
    },
    at(x, y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    },
  };
}
