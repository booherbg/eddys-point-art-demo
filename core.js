// The live forge's wasm wrapper, shared by the page's workers and the node tests (plain ES module, no dependency).
// The module's exports are plain C-ABI (`forge-worker/src/lib.rs`): strings go in as a pointer and a length, results
// come back as a pointer with the length from `lf_len`.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** FNV-1a, 32 bits, of `bytes`: the hash the probe logs for each sprite (the native probe prints the same). */
export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The key of the group of a family's models a sprite lives in: the family, and for a portrait (`portrait_{kind}_{rest|move}`) its kind
 * too, since a portrait is built alone (the forge's `Group`). The page's order and the worker use the same key.
 */
export function groupKey(family, name) {
  const m = /^portrait_(.+)_(rest|move)$/.exec(name);
  return m ? `${family}/${m[1]}` : family;
}

export const hex8 = (n) => n.toString(16).padStart(8, "0");

/** Instantiate `module` (a compiled `WebAssembly.Module`, or its bytes) and wrap its exports. */
export async function instantiate(moduleOrBytes, style = "classic", light = "day", palette = "game") {
  const module = moduleOrBytes instanceof WebAssembly.Module ? moduleOrBytes : await WebAssembly.compile(moduleOrBytes);
  const instance = await WebAssembly.instantiate(module, {});
  const x = instance.exports;
  const mem = () => new Uint8Array(x.memory.buffer);
  const put = (s) => {
    const b = enc.encode(s);
    const p = x.lf_alloc(b.length);
    mem().set(b, p);
    return [p, b.length];
  };
  const [stylePtr, styleLen] = put(style);
  const [lightPtr, lightLen] = put(light);
  const [palettePtr, paletteLen] = put(palette);
  const lookSet = x.lf_set_look(stylePtr, styleLen, lightPtr, lightLen, palettePtr, paletteLen);
  x.lf_free(stylePtr, styleLen);
  x.lf_free(lightPtr, lightLen);
  x.lf_free(palettePtr, paletteLen);
  if (lookSet !== 1) throw new Error(`unknown drawing style, light, or palette: ${style}/${light}/${palette}`);
  const take = (p) => (p === 0 ? null : mem().slice(p, p + x.lf_len()));
  const prepared = new Map();
  /** group key -> true: the groups this instance has built (a family's own models, or one kind's portraits; `groupKey`). */
  const groups = new Set();
  let lastCodes = null;
  return {
    /** Every family's name. */
    families() {
      return dec.decode(take(x.lf_families())).split("\n").filter(Boolean);
    },
    stamp(family) {
      const [p, n] = put(family);
      const stamp = BigInt.asUintN(64, x.lf_stamp(p, n));
      x.lf_free(p, n);
      return stamp === 0n ? null : stamp.toString(16).padStart(16, "0");
    },
    /** Build `family`'s models (the fixed cost) and give its sprite names in bundle order; null for no such family. */
    prepare(family) {
      const [p, n] = put(family);
      const out = take(x.lf_prepare(p, n));
      x.lf_free(p, n);
      if (out === null) return null;
      const names = dec.decode(out).split("\n").filter(Boolean);
      prepared.set(family, new Map(names.map((nm, i) => [nm, i])));
      return names;
    },
    /**
     * Build only the group of `family`'s models that sprite `name` lives in (its own models, or one kind's portraits: Task 1b), the
     * fixed cost of drawing it. How many sprites the group holds; 0 for no such family.
     */
    build(family, name) {
      const [p, n] = put(family);
      const [q, m] = put(name);
      const count = x.lf_build(p, n, q, m);
      x.lf_free(p, n);
      x.lf_free(q, m);
      if (count > 0) groups.add(groupKey(family, name));
      return count;
    },
    /** Whether the group sprite `name` of `family` lives in is built here. */
    hasGroup: (family, name) => groups.has(groupKey(family, name)),
    /** Draw sprite `name` of `family` at `density` times the pixels (1 is the bake's): its one-sprite FRG1 bytes, or null. Builds only its own group, never the whole family. */
    draw(family, name, density = 1) {
      const [p, n] = put(family);
      const [q, m] = put(name);
      const out = take(x.lf_draw_named(p, n, q, m, density));
      x.lf_free(p, n);
      x.lf_free(q, m);
      if (out) groups.add(groupKey(family, name));
      // A person's mask (the remap code of each pixel), kept for `codes`; the next draw replaces it.
      lastCodes = out ? take(x.lf_codes()) : null;
      return out;
    },
    /** The bytes this instance's wasm memory holds now (the bench reads the most any worker needed). */
    memoryBytes: () => x.memory.buffer.byteLength,
    /** The mask of the sprite `draw` just drew, a byte a pixel (0 takes no slot), or null when it is no person's. */
    codes: () => lastCodes,
    has: (family) => prepared.has(family),
  };
}

/** Every known family has its own stamp. A test URL may replace one or more stamps. */
export async function artStamps(module, overrides = "") {
  const forge = await instantiate(module);
  const families = [...forge.families(), "queue_rails"];
  const stamps = Object.fromEntries(families.map((family) => [family, forge.stamp(family)]).filter(([, stamp]) => stamp !== null));
  for (const pair of overrides.split(",")) {
    const [family, stamp] = pair.split(":");
    if (stamp && Object.hasOwn(stamps, family)) stamps[family] = stamp;
  }
  return stamps;
}
