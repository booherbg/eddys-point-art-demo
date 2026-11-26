// One job in a worker (plan 2026-11-18-live-forge, Task 2): draw the sprite in the forge's wasm, decode its one-sprite
// bundle, and make the ImageBitmap here in the worker, so the page's thread only ever receives a finished picture
// (transferred, not copied). `makeBitmap(rgba, w, h)` is `createImageBitmap(new ImageData(..))` in a worker; the tests
// pass a stand-in. Returns the message to post and the transfer list.
import { decodeOne } from "./frg.js";
import { grade } from "./grade.js";

export async function drawJob(forge, { family, name, density = 1, style, wantFrg }, makeBitmap, clock = () => performance.now()) {
  const t0 = clock();
  // The first job of a group in this worker builds only that group's models (the family's own, or one portrait kind's pair: Task 1b);
  // how long that took goes with it, so the order can tell a slow group (built by one worker only) from a fast one.
  let prep;
  if (forge.hasGroup && forge.build && !forge.hasGroup(family, name)) {
    forge.build(family, name);
    prep = clock() - t0;
  }
  const bytes = forge.draw(family, name, density);
  if (!bytes) return { msg: { kind: "failed", name, family, density, prep, ...(style ? { style } : {}) }, transfer: [] };
  const copy = { frg: bytes, mask: forge.codes?.() ?? null };
  const msg = await picture(copy, { name, family, density, style, wantFrg }, makeBitmap);
  const transfer = [msg.bitmap];
  if (msg.codes) transfer.push(msg.rgba.buffer, msg.codes.buffer);
  // The bench asks for the copy's own bytes to land them itself; the worker has written its store copy before it posts this.
  if (msg.frg) transfer.push(msg.frg.buffer);
  return { msg: { ...msg, ms: clock() - t0, prep, ...(forge.memoryBytes ? { mem: forge.memoryBytes() } : {}) }, transfer, copy };
}

/**
 * Turn either a worker's fresh bundle or a stored copy into the picture the page uses, graded for its look (`grade.js`; the store
 * keeps the forge's own bytes, so a grade can change with no cache to clear).
 */
export async function picture({ frg, mask }, { name, family, density, style, wantFrg }, makeBitmap) {
  const s = decodeOne(frg);
  if (s.name !== name || (mask && mask.length !== s.w * s.h)) throw new Error("Invalid sprite copy");
  grade(s.rgba, style);
  const bitmap = await makeBitmap(s.rgba, s.w, s.h);
  const msg = { kind: "drew", name, family, density, bitmap, w: s.w, h: s.h, ax: s.ax, ay: s.ay, ...(style ? { style } : {}) };
  if (wantFrg) msg.frg = frg;
  // A person comes with her pixels and her mask, so the page can paint her in any look.
  if (mask) {
    msg.rgba = s.rgba;
    msg.codes = mask;
  }
  return msg;
}

/** `drawJob` that never throws: a draw that throws is a failed draw, so the worker goes back to idle. */
export async function runJob(forge, job, makeBitmap, clock) {
  try {
    return await drawJob(forge, job, makeBitmap, clock);
  } catch (e) {
    return { msg: { kind: "failed", name: job.name, family: job.family, density: job.density || 1, error: String(e), ...(job.style ? { style: job.style } : {}) }, transfer: [] };
  }
}
