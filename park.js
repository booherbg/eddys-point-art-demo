// The park module's wrapper (plan 2026-11-18-live-forge, Task 3): `park.wasm` holds the sim, the draw list and the ground
// tiles (`park/src/lib.rs`, plain C-ABI). A plain ES module with no DOM, so node tests load the same wasm the page does.

const dec = new TextDecoder();

/** Instantiate the park's wasm (bytes or a compiled module), start a park from `seed`, and wrap its exports. */
export async function openPark(source, seed = 0) {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const { exports: x } = await WebAssembly.instantiate(module, {});
  x.lf_new(seed);
  const text = (p, n) => dec.decode(new Uint8Array(x.memory.buffer, p, n));
  const [W, H] = (() => {
    const s = x.lf_size();
    return [s & 0xffff, s >>> 16];
  })();
  const verdict = (ok) => ({ ok, cost: x.lf_verdict_cost(), line: text(x.lf_verdict_line(), x.lf_verdict_line_len()), turn: x.lf_verdict_turn() });
  return {
    /** The map's width and height in tiles. */
    size: { w: W, h: H },
    /** The wasm memory's size in bytes (the overlay's "Wasm memory"). */
    memoryBytes: () => x.memory.buffer.byteLength,
    /** Runs `n` sim ticks (60 a second). */
    step: (n) => x.lf_step(n),
    tick: () => x.lf_tick(),
    /** The sprite table's text: `name family w h ax ay` a line; a sprite's id is its line's number. */
    table: () => text(x.lf_table(), x.lf_table_len()),
    /**
     * The draw list for the art-pixel rectangle `{x, y, w, h}`, back to front, as a copy: twelve i32 a record
     * (`id, x, y, clipFrom, clipTo, footprintW, footprintD, frame, count, row, wear, ride`).
     */
    drawList(v) {
      const p = x.lf_draw_list(v.x, v.y, v.w, v.h);
      return new Int32Array(x.memory.buffer, p, x.lf_len() * 12).slice();
    },
    /**
     * What tool `tool` (0 to 9, `Tool::ALL`'s order) would do on tile (`tx`, `ty`) turned `turn` quarters, asked of the sim with
     * `Park::test` and never done: `{ok, cost, line, turn}` with the price in cents and the line she reads (the price, or the
     * sim's refusal).
     */
    toolTest(tool, tx, ty, turn = 0) {
      const ok = x.lf_tool_test(tool, tx, ty, turn) === 1;
      return verdict(ok);
    },
    /** The tap: `Park::execute`. `{ok, turned, cost, line, turn}`; a refusal changes nothing. */
    toolDo(tool, tx, ty, turn = 0) {
      const r = x.lf_tool_do(tool, tx, ty, turn);
      return { ...verdict(r !== 0), turned: r === 2 };
    },
    /** The ghost of the tool on the tile as a draw list (`drawList`'s records), for the view. */
    ghost(tool, tx, ty, turn, v) {
      const p = x.lf_ghost(tool, tx, ty, turn, v.x, v.y, v.w, v.h);
      return new Int32Array(x.memory.buffer, p, x.lf_len() * 12).slice();
    },
    /** Sends `n` guests up the road to the gate (`Park::send_guests`); how many set out. */
    sendGuests: (n) => x.lf_send_guests(n),
    /** The stat rows, "Money: $1,000" and "Guests: 12". */
    /** Sales at every stall so far: a scripted run reads it to know a guest has bought. */
    sales: () => x.lf_sales(),
    moneyRow: () => text(x.lf_money_row(), x.lf_money_row_len()),
    guestsRow: () => text(x.lf_guests_row(), x.lf_guests_row_len()),
    /** The palette row of wear `id` (a record's `wear`): 64 texels of four bytes, the color of each remap code, from the forge's own ramps. */
    wearRow(id) {
      const p = x.lf_wear_row(id);
      return new Uint8Array(x.memory.buffer, p, x.lf_row_len()).slice();
    },
    /** The sprite names the bar's tools draw, to prefetch. */
    barNames: () => text(x.lf_bar_names(), x.lf_bar_names_len()).split("\n").filter(Boolean),
    /** The names the last list could not draw, one a line: empty, or a bug. */
    missing: () => text(x.lf_missing(), x.lf_missing_len()),
    /** The ground tiles' RGBA at `density` (`lf_atlas_len` bytes): 44 tiles of 64 by 32, times the density each way, one under another. */
    atlas(density = 1) {
      const p = x.lf_atlas(density); // the call can grow the memory, so the buffer is read after it
      return new Uint8Array(x.memory.buffer, p, x.lf_atlas_len(density)).slice();
    },
    /** The ground's atlas index for each of the `w` by `h` tiles from (`x0`, `y0`), row by row; 255 is the void. */
    ground(x0, y0, w, h) {
      const p = x.lf_ground(x0, y0, w, h);
      return new Uint8Array(x.memory.buffer, p, Math.max(0, w * h)).slice();
    },
  };
}
