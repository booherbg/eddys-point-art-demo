// The Tools tray's contents (plan 2026-11-18-live-forge, Tasks 18 and 26): the Detail row, a label and held buttons "1x" to "5x",
// under it the stat rows for what the view shows, and the row of buttons (Add 10 guests, which acts once, and Workers, held while its
// panel is open: Task 28; both stand in `panel.actions`). Only DOM calls the node tests' small fake document gives. The Tools button in the top bar opens and shuts
// it (held while open, one tray at a time).
import { heldGroup, heldButton, onceButton } from "./bar.js";
import { ADD_TEN } from "./play.js";
import { workersRow } from "./stats.js";
import { WORKERS } from "./workers.js";
import { DETAIL_LABELS, DETAIL_ROW, STEPS, timeToDrawRow, workerTimeRow, picturesRow } from "./detail.js";
import { perfRows, CHART_TOP } from "./perf.js";

/** The FPS chart's size in CSS pixels, and its colors (the bars' green on the panel's dark, a dim guide at 60 frames a second). */
export const CHART_W = 232;
export const CHART_H = 56;
const CHART_BG = "#14101c";
const CHART_LINE = "#5fd068";
const CHART_GUIDE = "#54426f";

/** Draws the chart's `points` (`chartPoints`) on `canvas`; a canvas with no 2D context (the tests' small document) is left alone. */
export function drawChart(canvas, points) {
  const c = canvas.getContext?.("2d");
  if (!c) return;
  c.setTransform(canvas.width / CHART_W, 0, 0, canvas.height / CHART_H, 0, 0);
  c.fillStyle = CHART_BG;
  c.fillRect(0, 0, CHART_W, CHART_H);
  const guide = CHART_H - (60 / CHART_TOP) * CHART_H;
  c.fillStyle = CHART_GUIDE;
  c.fillRect(0, Math.round(guide), CHART_W, 1);
  if (!points.length) return;
  c.strokeStyle = CHART_LINE;
  c.lineWidth = 1.5;
  c.lineJoin = "round";
  c.beginPath();
  points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.stroke();
}

/** Builds the panel's rows in `parent`; `onDetail(step)` is a tap on a step, `onAddGuests()` a tap on Add 10 guests, `onWorkers()` a tap on Workers. */
export function makePanel(doc, parent, { onDetail, onAddGuests = () => {}, onWorkers = () => {} }) {
  const row = doc.createElement("div");
  row.className = "row";
  const label = doc.createElement("span");
  label.className = "rowlabel";
  label.textContent = DETAIL_ROW;
  const group = doc.createElement("div");
  group.className = "group";
  row.append(label, group);
  const steps = heldGroup(doc, group, DETAIL_LABELS, (i) => onDetail(STEPS[i]));
  const wait = doc.createElement("div");
  wait.className = "stat";
  wait.textContent = timeToDrawRow(0);
  const time = doc.createElement("div");
  time.className = "stat";
  time.textContent = workerTimeRow(0);
  const busy = doc.createElement("div");
  busy.className = "stat";
  busy.textContent = workersRow(0, 0);
  const pictures = doc.createElement("div");
  pictures.className = "stat";
  pictures.textContent = picturesRow(0);
  // Add 10 guests acts once and holds nothing, so it has no lamp; Workers is held while its panel is open, so it has one.
  // A new button for the tray is appended here.
  const actions = doc.createElement("div");
  actions.className = "row actions";
  const workers = heldButton(doc, WORKERS, onWorkers);
  actions.append(onceButton(doc, ADD_TEN, onAddGuests), workers);
  // The frame rows and the FPS chart under them: the last second's numbers, and the last ten seconds as a line.
  const frameRows = perfRows({ fps: 0, frame: 0, sim: 0, list: 0, sprites: 0 }).map((text) => {
    const d = doc.createElement("div");
    d.className = "stat";
    d.textContent = text;
    return d;
  });
  const chart = doc.createElement("canvas");
  chart.className = "chart";
  chart.width = Math.round(CHART_W * 2);
  chart.height = Math.round(CHART_H * 2);
  parent.append(row, wait, time, pictures, busy, ...frameRows, chart, actions);
  return {
    actions,
    workers,
    /** The Workers button's lamp: lit while its panel is open. */
    setWorkers(on) {
      workers.set(on);
    },
    /** The held step's lamp. */
    setDetail(step) {
      steps.set(STEPS.indexOf(step));
    },
    /** The frame rows (`perfRows`' five lines) and the chart's points (`chartPoints`). */
    setPerf(rows, points) {
      frameRows.forEach((r, i) => {
        if (r.textContent !== rows[i]) r.textContent = rows[i];
      });
      drawChart(chart, points);
    },
    /** The stat rows: the wait from the switch to the last picture, the workers' seconds summed, and the bytes of the pictures the view shows at this step. */
    setStats({ wait: waited = 0, seconds, bytes, busy: b = 0, total = 0 }) {
      busy.textContent = workersRow(b, total);
      wait.textContent = timeToDrawRow(waited);
      time.textContent = workerTimeRow(seconds);
      pictures.textContent = picturesRow(bytes);
    },
  };
}
