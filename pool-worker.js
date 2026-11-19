// A drawing worker of the pool (plan 2026-11-18-live-forge, Task 2): instantiates the module the page compiled once, then
// draws what it is sent. It makes each sprite's ImageBitmap itself and transfers it to the page.
import { instantiate } from "./core.js";
import { runJob } from "./draw-job.js";

let forge = null;
const makeBitmap = (rgba, w, h) => createImageBitmap(new ImageData(rgba, w, h));

self.onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    forge = await instantiate(m.module);
    self.postMessage({ kind: "ready", id: m.id });
  } else if (m.kind === "draw") {
    if (m.slow) await new Promise((r) => setTimeout(r, m.slow));
    const { msg, transfer } = await runJob(forge, m, makeBitmap);
    self.postMessage({ ...msg, id: m.id }, transfer);
  }
};
