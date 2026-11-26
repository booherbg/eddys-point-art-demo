// The build bar's trays and the Tools tray (plan 2026-11-18-live-forge, Task 26, R322; CLAUDE.md, "One look per kind of button").
// Building goes into trays, one button each along the bottom (Paths, Rides, Stalls, Scenery) and Remove on its own; settings leave
// the build bar for the Tools tray in the top bar. Every button here is a held one: a tray's button is held while its tray is open,
// the tool picked inside is held too, and opening one tray closes another (Tools is a tray too). Turn and Add 10 guests act once.
// The state is two things, the tray open and the tool held, and the rules are pure so node tests run them; the DOM calls are the
// ones the tests' small fake document gives.
//
// "Walkway" and "Ride queue" are the demo's try-out words (Blaine's, 2026-11-18); the game still says Path and Queue.
import { heldButton, onceButton } from "./bar.js";

/** The trays along the build bar, each with its tools as `[label, tool number]` (`Tool::ALL`'s numbers, `park/src/play.rs`). */
export const TRAYS = [
  { name: "Paths", tools: [["Walkway", 0], ["Ride queue", 9]] },
  { name: "Rides", tools: [["Carousel", 6], ["Ferris Wheel", 7], ["Pirate Ship", 8]] },
  { name: "Stalls", tools: [["Burger Bar", 1], ["Drinks Stall", 2]] },
  { name: "Scenery", tools: [["Bench", 3], ["Tree", 4]] },
];
/** Remove holds its tool straight from the bar, with no tray. */
export const REMOVE = "Remove";
export const REMOVE_TOOL = 5;
/** The top bar's tray: Detail and the once-buttons (the Workers panel's button joins it in Task 28). */
export const TOOLS = "Tools";
/** The Looks button beside Tools (Style, Light, Colors): a tray of switches, one open at a time like the rest. */
export const LOOKS = "Looks";
/** The buttons along the build bar, in order. */
export const BUILD_BAR = [...TRAYS.map((t) => t.name), REMOVE];
/** The once button that turns what she is about to place, a quarter at a time (the R key does the same); it stands in the Rides tray. */
export const TURN = "Turn";
/** What a tap on Turn says while it is grey (no ride held). */
export const PICK_RIDE = "Pick a ride first.";
/** The tool numbers of the three rides. */
export const RIDE_TOOLS = TRAYS[1].tools.map((t) => t[1]);
export const isRide = (tool) => RIDE_TOOLS.includes(tool);
/** Turn is grey unless a ride is held; the reason it says when tapped grey, or `null` when it acts. */
export const turnReason = (tool) => (isRide(tool) ? null : PICK_RIDE);

/** The tray a tool lives in (its name), or null for Remove and for no tool. */
export const trayOfTool = (tool) => TRAYS.find((t) => t.tools.some((x) => x[1] === tool))?.name ?? null;
/** The label of tool number `tool`, as its button reads. */
export const labelOfTool = (tool) => (tool === REMOVE_TOOL ? REMOVE : TRAYS.flatMap((t) => t.tools).find((x) => x[1] === tool)?.[0] ?? null);

/** The state before any tap: nothing open, nothing held. */
export const START = Object.freeze({ open: null, tool: null });

/**
 * A tap on a tray's button (a name of `TRAYS`, or `TOOLS`): opens it and shuts any other, keeping the tool held only if it lives in
 * that tray; a tap on the open one shuts it and lets its tool go.
 */
export function tapTray(s, name) {
  if (s.open === name) return { open: null, tool: null };
  return { open: name, tool: trayOfTool(s.tool) === name ? s.tool : null };
}

/** A tap on a tool inside its tray: holds it (the tray stays open), or lets it go if it was held. */
export function tapTool(s, tool) {
  return { open: trayOfTool(tool) ?? s.open, tool: s.tool === tool ? null : tool };
}

/** A tap on Remove: holds it and shuts every tray, or lets it go. */
export function tapRemove(s) {
  return { open: null, tool: s.tool === REMOVE_TOOL ? null : REMOVE_TOOL };
}

/**
 * The build bar and its trays in the DOM. `bar` holds the five buttons; `tray` holds one group of tool buttons for each tray (only
 * the open tray's group shows, and `tray` itself is hidden when none is). `taps` is `{tray(name), tool(n), remove(), turn(), grey(why)}`.
 * `set(state)` lights the lamps: a tray's button while it is open, the tool held, Remove while it is held.
 */
export function makeBuildBar(doc, bar, tray, taps) {
  const trayButtons = new Map();
  const toolButtons = new Map();
  const groups = new Map();
  for (const t of TRAYS) {
    const b = heldButton(doc, t.name, () => taps.tray(t.name));
    trayButtons.set(t.name, b);
    bar.append(b);
    const group = doc.createElement("div");
    group.className = "group gone";
    for (const [label, n] of t.tools) {
      const tb = heldButton(doc, label, () => taps.tool(n));
      toolButtons.set(n, tb);
      group.append(tb);
    }
    groups.set(t.name, group);
    tray.append(group);
  }
  const remove = heldButton(doc, REMOVE, () => taps.remove());
  bar.append(remove);
  // Turn stays beside the rides, at the end of their tray; grey with no ride held, and its tap says why.
  const turn = onceButton(doc, TURN, () => taps.turn(), (why) => taps.grey(why));
  groups.get("Rides").append(turn);
  const light = (b, on) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  };
  return {
    trayButtons, toolButtons, groups, remove, turn,
    set(s) {
      for (const [name, b] of trayButtons) light(b, s.open === name);
      for (const [n, b] of toolButtons) light(b, s.tool === n);
      light(remove, s.tool === REMOVE_TOOL);
      for (const [name, g] of groups) g.classList.toggle("gone", s.open !== name);
      tray.classList.toggle("gone", !groups.has(s.open));
      turn.grey(turnReason(s.tool));
    },
  };
}
