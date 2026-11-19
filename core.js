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

export const hex8 = (n) => n.toString(16).padStart(8, "0");

/** Instantiate `module` (a compiled `WebAssembly.Module`, or its bytes) and wrap its exports. */
export async function instantiate(moduleOrBytes) {
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
  const take = (p) => (p === 0 ? null : mem().slice(p, p + x.lf_len()));
  const prepared = new Map();
  let lastCodes = null;
  return {
    /** Every family's name. */
    families() {
      return dec.decode(take(x.lf_families())).split("\n").filter(Boolean);
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
    /** Draw sprite `name` of `family` (prepared first if it is not) at `density` times the pixels (1 is the bake's): its one-sprite FRG1 bytes, or null. */
    draw(family, name, density = 1) {
      if (!prepared.has(family) && this.prepare(family) === null) return null;
      const i = prepared.get(family).get(name);
      if (i === undefined) return null;
      const [p, n] = put(family);
      const out = take(x.lf_draw(p, n, i, density));
      x.lf_free(p, n);
      // A person's mask (the remap code of each pixel), kept for `codes`; the next draw replaces it.
      lastCodes = out ? take(x.lf_codes()) : null;
      return out;
    },
    /** The mask of the sprite `draw` just drew, a byte a pixel (0 takes no slot), or null when it is no person's. */
    codes: () => lastCodes,
    has: (family) => prepared.has(family),
  };
}
