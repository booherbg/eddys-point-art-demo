// The bar's buttons (plan 2026-11-18-live-forge, Task 4; CLAUDE.md, "One look per kind of button"). Every button here is a
// held one, one of a group: a lamp, dark when off and yellow on the one held, drawn by this one kit function in the build
// bar and in the speeds alike. No lamp on a button that acts once (`onceButton`: Add 10 guests). Only DOM calls the node tests'
// small fake document gives, so the bar is tested without a browser.

/** One held button: its lamp and its label. */
export function heldButton(doc, label, onTap) {
  const b = doc.createElement("button");
  b.className = "btn held";
  const lamp = doc.createElement("span");
  lamp.className = "lamp";
  const text = doc.createElement("span");
  text.className = "label";
  text.textContent = label;
  b.append(lamp, text);
  b.addEventListener("click", onTap);
  b.setAttribute("aria-pressed", "false");
  // A held button on its own (one panel's button) is lit and unlit by `set`; a group sets its members the same way.
  b.set = (on) => {
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  };
  return b;
}

/**
 * A button that acts once: its label and no lamp, since it holds nothing (CLAUDE.md, "One look per kind of button"). It can
 * grey (`grey(reason)`, `grey(null)` to clear): a greyed one never vanishes and is never the browser's own `disabled` (which
 * swallows the tap); a tap on it does not act, and calls `onGrey(reason)` so the page can say why.
 */
export function onceButton(doc, label, onTap, onGrey = () => {}) {
  const b = doc.createElement("button");
  b.className = "btn once";
  const text = doc.createElement("span");
  text.className = "label";
  text.textContent = label;
  b.append(text);
  let reason = null;
  b.grey = (why) => {
    reason = why || null;
    b.classList.toggle("grey", reason !== null);
    if (reason !== null) b.setAttribute("aria-disabled", "true");
    else b.removeAttribute("aria-disabled");
  };
  b.addEventListener("click", () => (reason !== null ? onGrey(reason) : onTap()));
  return b;
}

/** A switch: on or off, its lamp dark when off and green when on (the lamp's color is the CSS's, by `.switch.on`). */
export function switchButton(doc, label, onTap) {
  const b = doc.createElement("button");
  b.className = "btn switch";
  const lamp = doc.createElement("span");
  lamp.className = "lamp";
  const text = doc.createElement("span");
  text.className = "label";
  text.textContent = label;
  b.append(lamp, text);
  b.addEventListener("click", onTap);
  b.setAttribute("aria-pressed", "false");
  b.set = (on) => {
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  };
  return b;
}

/** A group of held buttons, `labels` in order, at most one held (`held` null: none, so no lamp is lit). */
export function heldGroup(doc, parent, labels, onTap) {
  const buttons = labels.map((l, i) => heldButton(doc, l, () => onTap(i)));
  buttons.forEach((b) => parent.append(b));
  return {
    buttons,
    set(held) {
      buttons.forEach((b, i) => b.set(i === held));
    },
  };
}

/** A held group with its row's word before it (`Style:`, the same form as the Tools tray's `Detail:`): the word, then the buttons. */
export function labeledGroup(doc, parent, word, labels, onTap) {
  const label = doc.createElement("span");
  label.className = "rowlabel";
  label.textContent = word;
  parent.append(label);
  return heldGroup(doc, parent, labels, onTap);
}
