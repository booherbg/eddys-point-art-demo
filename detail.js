// The Detail dial's rules (plan 2026-11-18-live-forge, Task 18, R308): a pure module, so node runs its tests.
//
// Detail is a whole step, 1x to 5x (decision 0004: whole candidates, never a slider). A sprite drawn at density `d` is the
// forge's model drawn again with `d` times the pixels; the page draws it at `1/d` of its size, so one art pixel is `d` texels.
// A view at zoom `z` shows a texel `z/d` screen pixels wide, so a density past the zoom would only be shrunk: the density a view
// asks for is the lower of the step and the zoom. At 1x the game's own pixels are enlarged, as the demo always did.

/** The Detail row's steps, and the labels the panel shows for them. */
export const STEPS = [1, 2, 3, 4, 5];
export const DETAIL_LABELS = STEPS.map((s) => `${s}x`);
export const MAX_STEP = STEPS[STEPS.length - 1];
/** The word of the Detail row in the Tools tray. */
export const DETAIL_ROW = "Detail:";
/** No fine picture is wider or taller than this (a browser's canvas and texture limit); a step that would pass it stays one lower. */
export const MAX_PIXELS = 4096;
/**
 * The picture cache's byte budget (live forge Task 31, b582): everything the page holds of drawn pictures, the game's size included.
 * A laptop's, and a phone's (pool.js's phone rule: the phone's limits are the phone's). `?cache=<megabytes>` tries another.
 */
export const MIB = 1024 * 1024;
export const CACHE_CAP = 256 * MIB;
export const CACHE_CAP_PHONE = 64 * MIB;

/** The cap for this browser: `param` (the `?cache=` text, in megabytes) when it is a positive number, else the phone's or the laptop's. */
export function cacheCap({ phone, param = null }) {
  const mb = param === null || param === undefined || param === "" ? NaN : Number(param);
  if (Number.isFinite(mb) && mb > 0) return mb * MIB;
  return phone ? CACHE_CAP_PHONE : CACHE_CAP;
}

/** The cache's key for sprite `name` at density `d`: the game's own size keeps its name; a finer one is `name@d`. */
export const spriteKey = (name, d) => (d && d > 1 ? `${name}@${d}` : name);

/** The density a view at `zoom` draws at under step `detail`. */
export const fineDensity = (detail, zoom) => Math.max(1, Math.min(detail, zoom));

/**
 * The density sprite `box` (`[w, h, ax, ay]`, the table's) is drawn at for this view: `fineDensity`, lowered while its
 * picture would pass `MAX_PIXELS`. The picture is at most (box + 2) times the density wide (the render keeps a margin of
 * two texels of the art pixel), which is what this keeps under the limit. A name with no box is not capped.
 */
export function densityFor(box, detail, zoom) {
  let d = fineDensity(detail, zoom);
  if (!box) return d;
  while (d > 1 && Math.max(box[0] + 2, box[1] + 2) * d > MAX_PIXELS) d--;
  return d;
}

const one = (n) => (Math.round(n * 10) / 10).toFixed(1);
/** The panel's stat rows (`Label: value`, one decimal for seconds and megabytes): the wait from the switch to the last picture, the workers' seconds summed. */
export const timeToDrawRow = (seconds) => `Time to draw: ${one(seconds)} s`;
export const workerTimeRow = (seconds) => `Worker time: ${one(seconds)} s`;
export const picturesRow = (bytes) => `Pictures: ${one(bytes / MIB)} MB`;
