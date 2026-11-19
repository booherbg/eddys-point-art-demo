// Decodes a one-sprite `FRG1` or `FRG2` bundle (the bytes the worker's wasm gives, `crates/forge/src/bundle.rs`) into
// pixels: `{name, w, h, ax, ay, rgba}`, `rgba` a Uint8ClampedArray of w*h*4 for `ImageData`. Plain ES module, no DOM.

export function decodeOne(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "FRG1" && magic !== "FRG2") throw new Error("not a sprite bundle: " + magic);
  const wide = magic === "FRG2";
  let o = 4;
  const palLen = wide ? v.getUint16(o, true) : v.getUint32(o, true);
  o += wide ? 2 : 4;
  const pal = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + o, palLen * 4);
  o += palLen * 4;
  const count = v.getUint32(o, true);
  o += 4;
  if (count !== 1) throw new Error("expected one sprite, the bundle holds " + count);
  const nameLen = v.getUint16(o, true);
  o += 2;
  const name = new TextDecoder().decode(bytes.subarray(o, o + nameLen));
  o += nameLen;
  const w = v.getUint16(o, true), h = v.getUint16(o + 2, true);
  const ax = v.getInt16(o + 4, true), ay = v.getInt16(o + 6, true);
  o += 8;
  const runs = v.getUint32(o, true);
  o += 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let p = 0;
  for (let r = 0; r < runs; r++) {
    const len = bytes[o];
    const idx = wide ? v.getUint16(o + 1, true) : bytes[o + 1];
    o += wide ? 3 : 2;
    if (idx !== 0) for (let k = 0; k < len; k++) rgba.set(pal.subarray(idx * 4, idx * 4 + 4), (p + k) * 4);
    p += len;
  }
  if (p !== w * h) throw new Error(`runs cover ${p} pixels, not ${w} by ${h}`);
  return { name, w, h, ax, ay, rgba };
}
