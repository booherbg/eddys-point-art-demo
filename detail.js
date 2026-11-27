// The Detail dial's rules (plan 2026-11-18-live-forge, Task 18, R308): a pure module, so node runs its tests.
//
// Detail is a whole step, 1x to 5x (decision 0004: whole candidates, never a slider). The camera's zoom goes two steps further, to 7: Blaine,
// 2026-11-27, "I'm good with the level of detail stopping at 5x. I just want to be able to zoom in a little bit further so I can get closer up to
// the actual game itself." Past zoom 5 the 5x pictures are drawn larger, nearest-neighbor, so no new pictures are asked for. A sprite drawn at density `d` is the
// forge's model drawn again with `d` times the pixels; the page draws it at `1/d` of its size, so one art pixel is `d` texels.
// A view at zoom `z` shows a texel `z/d` screen pixels wide, so a density past the zoom would only be shrunk: the density a view
// asks for is the lower of the step and the zoom. At 1x the game's own pixels are enlarged, as the demo always did.

/** The Detail row's steps, and the labels the panel shows for them. */
export const STEPS = [1, 2, 3, 4, 5];
export const DETAIL_LABELS = STEPS.map((s) => `${s}x`);
/** The finest density any picture is drawn at: the last Detail step. */
export const MAX_STEP = STEPS[STEPS.length - 1];
/** The camera's zoom steps: five, and two closer (it was 1 to 5 before 2026-11-27). Past `MAX_STEP` a picture is the 5x one, enlarged. */
export const ZOOM_STEPS = [1, 2, 3, 4, 5, 6, 7];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
/** The word of the Detail row in the Tools tray. */
export const DETAIL_ROW = "Detail:";
/** No fine picture is wider or taller than this (a browser's canvas and texture limit); a step that would pass it stays one lower. */
export const MAX_PIXELS = 4096;
/**
 * The picture cache's byte budget (live forge Task 31, b582). It was none (Blaine, 2026-11-26: "Let the phone deal with it, let's not
 * make the assumptions"), and since the zoom reaches 7 it is 150 MB on every device (art demo, 2026-11-27, item 11): one picture at 5x is
 * (w + 2) (h + 2) 4 d^2 bytes, 0.36 MB for the table's mean sprite and 3.9 MB for the Ferris wheel's frame. Past it, the pictures finer than
 * 1x that are not on screen go, least recently shown first; the game's own size never does. `?cache=<megabytes>` sets another cap, and 0
 * sets none.
 */
export const MIB = 1024 * 1024;
export const NO_CAP = Infinity;
export const DEFAULT_CAP = 150 * MIB;

/** The cap for this browser: `param` (the `?cache=` text, in megabytes) when it is a positive number, none for `0`, else `DEFAULT_CAP`. */
export function cacheCap({ param = null } = {}) {
  const mb = param === null || param === undefined || param === "" ? NaN : Number(param);
  if (Number.isFinite(mb) && mb > 0) return mb * MIB;
  if (mb === 0) return NO_CAP;
  return DEFAULT_CAP;
}

/**
 * A look's one name: `classic` is `classic@day` (the first light), `soft@dusk` and `soft@dusk@sunset` stay as they are. Every key that holds a look
 * (a job's, a worker's, a picture's) holds this name, so one sprite in one look is one job however it was asked (b740: the scene asked in
 * "classic@day" and `Sprites.draw` in "classic", and a still sprite on screen queued behind another look's frames).
 */
export const lookOf = (style = "classic") => (style.includes("@") ? style : `${style}@day`);

/** The cache's key for sprite `name` at density `d`: the game's own size keeps its name; a finer one is `name@d`. */
export const spriteKey = (name, d) => (d && d > 1 ? `${name}@${d}` : name);

/**
 * The screen pixels one art pixel covers: the camera's zoom times the device's pixel ratio (whole). A phone's screen at zoom 1 already
 * shows an art pixel three pixels wide, so its Detail steps show there too (2026-11-26: they did nothing below zoom 2, "holding back").
 */
export const screenZoom = (zoom, dpr) => zoom * Math.max(1, Math.round(dpr || 1));

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
