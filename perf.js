// The frame log behind the Tools panel's FPS chart and its stat rows (art demo, Blaine's phone notes of 2026-11-27, note 6). A pure
// module: no DOM, no clock of its own (the page says when each frame was), so node tests print every row whole.
//
// Each frame the page pushes `{at, dt, sim, list, sprites, work, ground}`: when it began (seconds), the time since the frame before (ms), the
// ms spent stepping the sim, the ms spent making the draw list, the sprites it drew, the ms the whole frame's own work took, and the ms of it the ground took. The
// log keeps the last `WINDOW_S` seconds. The rows read the last second, so a change shows at once; the chart is the whole window.

/** How many seconds of frames the log keeps, and the chart shows. */
export const WINDOW_S = 10;
/** The chart's points: one a tenth of a second. */
export const CHART_BUCKETS = WINDOW_S * 10;
/** The top of the chart, in frames a second: the line never rises past it, and a screen that runs faster sits on it. */
export const CHART_TOP = 70;

export class FrameLog {
  constructor() {
    /** The kept frames, oldest first. */
    this.frames = [];
  }

  push({ at, dt, sim = 0, list = 0, sprites = 0, work = 0, ground = 0 }) {
    this.frames.push({ at, dt, sim, list, sprites, work, ground });
    while (this.frames.length && this.frames[0].at < at - WINDOW_S) this.frames.shift();
  }

  /** The last `seconds` of frames. */
  recent(seconds = 1) {
    const last = this.frames.at(-1);
    if (!last) return [];
    return this.frames.filter((f) => f.at > last.at - seconds);
  }

  /** The numbers the rows print, over the last second: frames a second, and the mean of each timing. */
  now() {
    const r = this.recent(1);
    const mean = (k) => (r.length ? r.reduce((s, f) => s + f[k], 0) / r.length : 0);
    const dt = mean("dt");
    return { fps: dt > 0 ? Math.round(1000 / dt) : 0, frame: dt, sim: mean("sim"), list: mean("list"), sprites: r.length ? r.at(-1).sprites : 0, work: mean("work") };
  }
}

/** The panel's five stat rows, whole, from `FrameLog.now()`. The same labels as the rest of the panel: `Label: value`. */
export const perfRows = ({ fps, frame, sim, list, sprites }) => [
  `FPS: ${fps}`,
  `Frame: ${ms(frame)} ms`,
  `Sim: ${ms(sim)} ms`,
  `Draw list: ${ms(list)} ms`,
  `Sprites: ${sprites}`,
];

/** Milliseconds as the rows print them: whole from 10, one decimal below (the sim and the list take under 1 ms on a laptop; "0 ms" says nothing). */
const ms = (v) => (v >= 9.95 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));

/** Buckets each side a point averages over: a point is the mean of 0.5 s of frames (about 30 at 60 a second), so frame times that wobble a few ms draw flat. */
export const SMOOTH = 2;

/**
 * The chart's points for a `width` by `height` box: frames a second (from the frames' own times) in tenth-second buckets over the last `WINDOW_S` seconds, oldest on the
 * left, the newest at the right edge, faster higher (`y` counts down from the top). A point is the rate over its own bucket and the `SMOOTH` on each side
 * (frames over their summed times), since six frames a bucket cannot tell a steady 60 from one that wobbles (the line read like a heartbeat, 2026-11-27); a
 * stall still shows, as a dip half a second wide. A stretch with no frame in reach is 0 (the page stalled or slept). Empty before any frame.
 */
export function chartPoints(log, width, height) {
  const last = log.frames.at(-1);
  if (!last) return [];
  const end = last.at;
  const counts = new Array(CHART_BUCKETS).fill(0);
  const total = new Array(CHART_BUCKETS).fill(0);
  for (const f of log.frames) {
    const b = CHART_BUCKETS - 1 - Math.floor((end - f.at) * 10);
    if (b >= 0 && b < CHART_BUCKETS) (counts[b]++, (total[b] += f.dt));
  }
  const rate = (i) => {
    let n = 0;
    let t = 0;
    for (let j = Math.max(0, i - SMOOTH); j <= Math.min(CHART_BUCKETS - 1, i + SMOOTH); j++) (n += counts[j], (t += total[j]));
    return n ? 1000 / (t / n) : 0;
  };
  return counts.map((_, i) => {
    const fps = rate(i);
    return { x: (i / (CHART_BUCKETS - 1)) * width, y: height - (Math.min(fps, CHART_TOP) / CHART_TOP) * height, fps };
  });
}
