// Each look's color grade (Blaine, 2026-11-26: "garden sunset etc I don't see much of a difference, it should be more dramatic for a
// demo"). The forge draws a style's shapes (its outline, tones, shine) and a palette's material bases; this grade then pushes the
// whole picture, the ground and every guest's clothes included, the way a film's grade does, so each look reads apart at a glance on
// a phone. Classic and Game have no grade, so their pictures stay byte for byte the forge's (and the game's bake), and the light
// (Day, Dusk, Night) is the forge's and the ground's own. A pure module: node tests run it.
//
// A grade is a list of steps on each opaque pixel, in 0 to 1: `bands` (hue, saturation and value moved for the hues near a center),
// `snap` (hues pulled toward a few, a toy's primaries), `gain` (each channel scaled), `sat` (saturation scaled about the pixel's
// luma), `shadows` and `highlights` (the dark and the light pixels mixed toward a color, by how dark or light), `contrast` (about
// the middle), `lift` (the blacks raised) and `mix` (every pixel mixed toward one color).

/** The style grades (Classic has none). */
export const STYLE_GRADES = {
  // Pastel and low contrast: lifted shadows, so the ink outline turns a light mauve and the faces sit close together.
  soft: { contrast: 0.8, lift: 0.22, mix: { color: [1.0, 0.9, 0.96], amount: 0.07 } },
  // Saturated primaries and high contrast: every hue pulled toward red, yellow, green or blue, the darks (the bold ink) darker.
  // The greens a toy's darker green, not a highlighter's.
  toybox: { bands: [{ hue: 115, width: 50, val: 0.8 }], snap: { hues: [0, 50, 125, 215], amount: 0.45 }, sat: 1.45, contrast: 1.3 },
};

/** The palette grades (Game has none). */
export const PALETTE_GRADES = {
  // Lush deep greens, warm earth, flowers that pop: the greens darker and truer, the browns and creams warmer, the rest brighter.
  garden: {
    bands: [
      { hue: 100, width: 55, shift: 14, sat: 1.35, val: 0.7 },
      { hue: 32, width: 26, shift: -6, sat: 1.4, val: 0.9 },
      { hue: 340, width: 60, shift: 0, sat: 1.5, val: 1.08 },
      { hue: 55, width: 14, shift: 0, sat: 1.4, val: 1.05 },
    ],
    sat: 1.2,
    shadows: { color: [0.04, 0.2, 0.08], amount: 0.45 },
    highlights: { color: [1.0, 0.94, 0.66], amount: 0.16 },
  },
  // A warm orange, pink and purple cast over everything, the shadows violet.
  sunset: {
    // The greens turned gold (the low sun on the grass), then everything pinker and warmer.
    bands: [{ hue: 110, width: 70, shift: -55, sat: 0.95, val: 0.95 }],
    gain: [1.12, 0.82, 0.84],
    sat: 1.15,
    shadows: { color: [0.36, 0.1, 0.52], amount: 0.75 },
    highlights: { color: [1.0, 0.6, 0.48], amount: 0.38 },
  },
  // Cool sea blues, teals and weathered greys: the greens turned teal, everything greyer and bluer, the shadows navy.
  harbor: {
    bands: [{ hue: 105, width: 75, shift: 55, sat: 0.85, val: 0.92 }],
    sat: 0.62,
    gain: [0.86, 0.97, 1.08],
    shadows: { color: [0.06, 0.15, 0.3], amount: 0.55 },
    highlights: { color: [0.86, 0.93, 0.98], amount: 0.22 },
  },
};

/** A look key's parts: `classic@day` or `soft@dusk@sunset` (play.js's `lookKey`). */
export function parseLook(key) {
  const [style = "classic", light = "day", palette = "game"] = String(key || "").split("@");
  return { style: style || "classic", light: light || "day", palette: palette || "game" };
}

/** The steps of look `key`: its style's grade, then its palette's; null when it has neither (Classic with Game). */
export function gradesOf(key) {
  const { style, palette } = parseLook(key);
  const steps = [STYLE_GRADES[style], PALETTE_GRADES[palette]].filter(Boolean);
  return steps.length ? steps : null;
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mixTo = (c, t, a) => [c[0] + (t[0] - c[0]) * a, c[1] + (t[1] - c[1]) * a, c[2] + (t[2] - c[2]) * a];
/** How far hue `h` is from `center`, in degrees round the wheel (0 to 180). */
const hueDistance = (h, center) => {
  const d = Math.abs((((h - center) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

function toHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * ((((g - b) / d) % 6) + 6) % 360;
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function fromHsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** One grade's steps on one color (`[r, g, b]`, 0 to 1). */
export function gradeColor(c, g) {
  let [r, gr, b] = c;
  if (g.bands || g.snap) {
    let [h, s, v] = toHsv(r, gr, b);
    if (s > 0.04) {
      for (const band of g.bands || []) {
        const w = Math.max(0, 1 - hueDistance(h, band.hue) / band.width);
        if (w <= 0) continue;
        h += (band.shift || 0) * w;
        s *= 1 + ((band.sat ?? 1) - 1) * w;
        v *= 1 + ((band.val ?? 1) - 1) * w;
      }
      if (g.snap) {
        let best = g.snap.hues[0];
        for (const t of g.snap.hues) if (hueDistance(h, t) < hueDistance(h, best)) best = t;
        let delta = (((best - h) % 360) + 540) % 360 - 180;
        h += delta * g.snap.amount;
      }
      [r, gr, b] = fromHsv(h, clamp(s), clamp(v));
    }
  }
  if (g.gain) [r, gr, b] = [r * g.gain[0], gr * g.gain[1], b * g.gain[2]];
  if (g.sat !== undefined) {
    const l = luma(r, gr, b);
    [r, gr, b] = [l + (r - l) * g.sat, l + (gr - l) * g.sat, l + (b - l) * g.sat];
  }
  if (g.shadows || g.highlights) {
    const l = clamp(luma(r, gr, b));
    if (g.shadows) [r, gr, b] = mixTo([r, gr, b], g.shadows.color, g.shadows.amount * (1 - l) * (1 - l));
    if (g.highlights) [r, gr, b] = mixTo([r, gr, b], g.highlights.color, g.highlights.amount * l * l);
  }
  if (g.contrast !== undefined) [r, gr, b] = [0.5 + (r - 0.5) * g.contrast, 0.5 + (gr - 0.5) * g.contrast, 0.5 + (b - 0.5) * g.contrast];
  if (g.lift !== undefined) {
    const k = 1 - g.lift;
    [r, gr, b] = [g.lift + clamp(r) * k, g.lift + clamp(gr) * k, g.lift + clamp(b) * k];
  }
  if (g.mix) [r, gr, b] = mixTo([r, gr, b], g.mix.color, g.mix.amount);
  return [clamp(r), clamp(gr), clamp(b)];
}

/**
 * Grade `rgba` (four bytes a pixel, a Uint8Array or Uint8ClampedArray) in place for look `key`, and return it. A fully transparent
 * pixel is left alone. Classic with Game returns it untouched. Each distinct color is graded once (a sprite has few).
 */
export function grade(rgba, key) {
  const steps = gradesOf(key);
  if (!steps) return rgba;
  const seen = new Map();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let out = seen.get(k);
    if (out === undefined) {
      let c = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
      for (const g of steps) c = gradeColor(c, g);
      out = c.map((x) => Math.round(x * 255));
      seen.set(k, out);
    }
    rgba[i] = out[0];
    rgba[i + 1] = out[1];
    rgba[i + 2] = out[2];
  }
  return rgba;
}
