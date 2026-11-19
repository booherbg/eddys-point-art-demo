// A drawing worker: instantiates the module the page compiled once, then draws what it is sent, timing each call with
// `performance.now()` (the forge keeps no clock; the page does).
import { instantiate, fnv1a, hex8 } from "./core.js";

let forge = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    const t = performance.now();
    forge = await instantiate(m.module);
    self.postMessage({ kind: "ready", id: m.id, ms: performance.now() - t });
  } else if (m.kind === "draw") {
    const rows = [];
    for (const [family, name] of m.jobs) {
      let prepare_ms = 0;
      if (!forge.hasGroup(family, name)) {
        const t0 = performance.now();
        forge.build(family, name);
        prepare_ms = performance.now() - t0;
      }
      const t1 = performance.now();
      const bytes = forge.draw(family, name);
      const draw_ms = performance.now() - t1;
      rows.push({ family, name, prepare_ms, draw_ms, size: bytes ? bytes.length : 0, hash: bytes ? hex8(fnv1a(bytes)) : "missing", worker: m.id });
    }
    self.postMessage({ kind: "drew", id: m.id, rows, now: performance.now() });
  }
};
