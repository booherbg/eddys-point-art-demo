// A person painted in her own look (plan 2026-11-18-live-forge, Task 23): the forge draws each person once, with her mask
// (the remap code of every pixel, the forge's own rule), and the page paints that one picture in any look through a palette
// row from the forge's ramps (`park.wasm`'s `lf_wear_row`). The game does it in a shader; this is the same lookup on the CPU:
// a coded pixel takes the row's color for its code, every other pixel stays as it is (`forge::remap::resolve`). Plain ES
// module, no DOM.

/** `rgba` (a sprite's bytes) painted by `row` (64 texels of four bytes, texel `code`) through `codes` (a byte a pixel, 0 for none). */
export function paint(rgba, codes, row) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c > 0) out.set(row.subarray(4 * c, 4 * c + 4), 4 * i);
  }
  return out;
}

/** The most pictures kept in a look other than the first; past it the oldest go (a crowd of looks is bounded, a long visit is too). */
export const WORN_CAP = 6000;

/** A page's way of making a picture out of pixels: a canvas the 2D context draws as it draws a bitmap. */
export function canvasMaker(doc) {
  return (rgba, w, h) => {
    const c = doc.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    return c;
  };
}
