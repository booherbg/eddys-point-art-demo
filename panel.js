// The Tools tray's contents (plan 2026-11-18-live-forge, Tasks 18 and 26): the Detail row, a label and held buttons "1x" to "5x",
// under it the stat rows for what the view shows, and the row of buttons (Add 10 guests, which acts once, and Workers, held while its
// panel is open: Task 28; both stand in `panel.actions`). Only DOM calls the node tests' small fake document gives. The Tools button in the top bar opens and shuts
// it (held while open, one tray at a time).
import { heldGroup, heldButton, onceButton } from "./bar.js";
import { ADD_TEN } from "./play.js";
import { WORKERS } from "./workers.js";
import { DETAIL_LABELS, DETAIL_ROW, STEPS, timeToDrawRow, workerTimeRow, picturesRow } from "./detail.js";

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
  const pictures = doc.createElement("div");
  pictures.className = "stat";
  pictures.textContent = picturesRow(0);
  // Add 10 guests acts once and holds nothing, so it has no lamp; Workers is held while its panel is open, so it has one.
  // A new button for the tray is appended here.
  const actions = doc.createElement("div");
  actions.className = "row actions";
  const workers = heldButton(doc, WORKERS, onWorkers);
  actions.append(onceButton(doc, ADD_TEN, onAddGuests), workers);
  parent.append(row, wait, time, pictures, actions);
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
    /** The stat rows: the wait from the switch to the last picture, the workers' seconds summed, and the bytes of the pictures the view shows at this step. */
    setStats({ wait: waited = 0, seconds, bytes }) {
      wait.textContent = timeToDrawRow(waited);
      time.textContent = workerTimeRow(seconds);
      pictures.textContent = picturesRow(bytes);
    },
  };
}
