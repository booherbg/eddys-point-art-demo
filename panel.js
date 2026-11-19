// The Tools tray's contents (plan 2026-11-18-live-forge, Tasks 18 and 26): the Detail row, a label and held buttons "1x" to "5x",
// under it the stat rows for what the view shows, and the row of once-buttons (Add 10 guests; Task 28's Workers button joins that
// row, `panel.actions`). Only DOM calls the node tests' small fake document gives. The Tools button in the top bar opens and shuts
// it (held while open, one tray at a time).
import { heldGroup, onceButton } from "./bar.js";
import { ADD_TEN } from "./play.js";
import { DETAIL_LABELS, DETAIL_ROW, STEPS, timeToDrawRow, workerTimeRow, picturesRow } from "./detail.js";

/** Builds the panel's rows in `parent`; `onDetail(step)` is a tap on a step, `onAddGuests()` a tap on Add 10 guests. */
export function makePanel(doc, parent, { onDetail, onAddGuests = () => {} }) {
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
  // The once-buttons: each acts and holds nothing, so none has a lamp. A new button for the tray is appended here.
  const actions = doc.createElement("div");
  actions.className = "row actions";
  actions.append(onceButton(doc, ADD_TEN, onAddGuests));
  parent.append(row, wait, time, pictures, actions);
  return {
    actions,
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
