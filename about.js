// The About panel's words (Blaine, 2026-11-26): a short technical note about the demo, as plain strings, set with `textContent` and
// never as markup. The title is first, then one paragraph each.
export const ABOUT_TITLE = "How it works";
export const ABOUT_PARAGRAPHS = [
  "No image files ship with this page. Every sprite is a Rust recipe, rendered the first time the view needs it.",
  "The park is the game's own Rust simulation compiled to WebAssembly, running 60 steps a second. Web Workers (one per core minus one, at most 7) run the sprite renderer, a second wasm module: each builds the models for a sprite family, draws the sprite, and transfers the bitmap to the page. On-screen sprites come first, then off-screen, then the build bar.",
  "Finished sprites are cached in IndexedDB, keyed on family, build stamp, detail density, look and name. Each look (style, light, colors) and Detail step (1x to 5x) renders its own pictures.",
  "A demo for a simulation game Blaine Booher is building, to explore simulation parameters, see how far Rust goes in a browser, and try frontier LLMs for experimental software engineering."
];

/** Fills `el` with the title and paragraphs. DOM calls only: no markup string is ever parsed. */
export function fillAbout(doc, el) {
  const h = doc.createElement("h2");
  h.textContent = ABOUT_TITLE;
  el.append(h);
  for (const text of ABOUT_PARAGRAPHS) {
    const p = doc.createElement("p");
    p.textContent = text;
    el.append(p);
  }
}
