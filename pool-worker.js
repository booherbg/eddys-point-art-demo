// A drawing worker of the pool (plan 2026-11-18-live-forge, Task 2): instantiates the module the page compiled once, then
// draws what it is sent. It makes each sprite's ImageBitmap itself and transfers it to the page.
import { instantiate } from "./core.js";
import { runJob } from "./draw-job.js";

let module = null;
let forge = null;
let style = null;
const makeBitmap = (rgba, w, h) => createImageBitmap(new ImageData(rgba, w, h));

async function selectStyle(next) {
  if (!forge || style !== next) {
    forge = await instantiate(module, next);
    style = next;
  }
  return forge;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    module = m.module;
    await selectStyle("classic");
    self.postMessage({ kind: "ready", id: m.id });
  } else if (m.kind === "draw") {
    if (m.slow) await new Promise((r) => setTimeout(r, m.slow));
    const selected = await selectStyle(m.style || "classic");
    const { msg, transfer } = await runJob(selected, m, makeBitmap);
    self.postMessage({ ...msg, id: m.id }, transfer);
  }
};
