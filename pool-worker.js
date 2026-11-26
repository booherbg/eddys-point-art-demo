// A drawing worker of the pool (plan 2026-11-18-live-forge, Task 2): instantiates the module the page compiled once, then
// draws what it is sent. It makes each sprite's ImageBitmap itself and transfers it to the page.
import { instantiate } from "./core.js";
import { runJob } from "./draw-job.js";
import { openArtStore } from "./store.js";

let module = null;
let forge = null;
let style = null;
let store = null;
const makeBitmap = (rgba, w, h) => createImageBitmap(new ImageData(rgba, w, h));

async function selectStyle(next) {
  if (!forge || style !== next) {
    const [look, light = "day", palette = "game"] = next.split("@");
    forge = await instantiate(module, look, light, palette);
    style = next;
  }
  return forge;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    module = m.module;
    if (m.stamps) store = await openArtStore(m.stamps, { prune: false });
    await selectStyle("classic@day");
    self.postMessage({ kind: "ready", id: m.id });
  } else if (m.kind === "draw") {
    if (m.slow) await new Promise((r) => setTimeout(r, m.slow));
    const selected = await selectStyle(m.style || "classic");
    const { msg, transfer, copy } = await runJob(selected, m, makeBitmap);
    // The copy keeps how long the draw took, so a picture read back on a later visit still counts its worker time (the panel's row).
    if (copy && store && m.cacheGeneration !== undefined) await store.write(m, { ...copy, ms: msg.ms }, m.cacheGeneration);
    self.postMessage({ ...msg, id: m.id }, transfer);
  }
};
