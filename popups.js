// The money that floats up over a sale (art demo, Blaine's phone notes of 2026-11-27, item 7): the game's popups (`crates/app/src/feedback.rs`),
// drawn the game's way. The words and the start come from the park (`park/src/popups.rs`: "+$1.50" for money in, "-$300" for money out); this module
// draws them: the good green or the bad red, a shadow one art pixel down and right in the outline violet, rising `RISE` art pixels over the popup's 55
// ticks. Plain functions over a 2D context, so node tests record the calls.

/** How far a popup rises, in art pixels, over how many ticks (the game's `POPUP_RISE` and the sim's `POPUP_TICKS`). */
export const RISE = 24;
export const TICKS = 55;
/** The game's palette: the good green and the bad red (`palette.rs`), and the outline violet the shadow is drawn in. */
export const GOOD = "#2f9e4f";
export const BAD = "#d6382c";
export const OUTLINE = "#2a1c3e";
/** The words' size in art pixels: the game's font is 7 pixels from cap to baseline. */
export const FONT_PX = 10;

/** How far a popup `age` ticks old has risen, in art pixels, a whole pixel at a time. */
export const rise = (age) => Math.floor((RISE * Math.min(age, TICKS)) / TICKS);

/** The popups the park has: `{x, y, age, gain, words}`, `x, y` the art pixel they start on. */
export function readPopups(x, memory) {
  const p = x.lf_popups(); // the call fills both lists
  const n = x.lf_popups_len();
  const a = new Int32Array(memory.buffer, p, n * 5).slice();
  const words = new TextDecoder().decode(new Uint8Array(memory.buffer, x.lf_popup_words(), x.lf_popup_words_len())).split("\n");
  return Array.from({ length: n }, (_, i) => ({ x: a[i * 5], y: a[i * 5 + 1], age: a[i * 5 + 2], gain: a[i * 5 + 3] === 1, words: words[i] }));
}

/** Draws `popups` on `ctx`, whose transform is the view's (art pixels): each centered on its x, its letters' bottom `rise(age)` over where it started. */
export function drawPopups(ctx, popups) {
  if (!popups.length) return;
  ctx.save();
  ctx.font = `700 ${FONT_PX}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const p of popups) {
    const y = p.y - rise(p.age);
    ctx.fillStyle = OUTLINE;
    ctx.fillText(p.words, p.x + 1, y + 1);
    ctx.fillStyle = p.gain ? GOOD : BAD;
    ctx.fillText(p.words, p.x, y);
  }
  ctx.restore();
}
