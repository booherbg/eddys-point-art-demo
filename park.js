// The park module's wrapper (plan 2026-11-18-live-forge, Task 3): `park.wasm` holds the sim, the draw list and the ground
// tiles (`park/src/lib.rs`, plain C-ABI). A plain ES module with no DOM, so node tests load the same wasm the page does.

import { readPopups } from "./popups.js";

const dec = new TextDecoder();
/** Ticks (a quarter second) a held tool's answer is kept while nothing is edited. */
export const HELD_TICKS = 15;
const LIGHT_ID = { day: 0, dusk: 1, night: 2 };

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
  // What the held tool's ghost was last asked for, and what came back: asked again of the same tile, turn and view, with the park
  // changed by no edit and under `HELD_TICKS` ticks, it is the same answer (a clone and a placement each, twice, was the cost of a held tool).
  let edits = 0;
  let ticks = 0;
  let held = null;
  let heldRuns = 0;
  return {
    /** The map's width and height in tiles. */
    size: { w: W, h: H },
    /** The wasm memory's size in bytes (the overlay's "Wasm memory"). */
    memoryBytes: () => x.memory.buffer.byteLength,
    /** Runs `n` sim ticks (60 a second). */
    step: (n) => ((ticks += n), x.lf_step(n)),
    tick: () => (ticks++, x.lf_tick()),
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
      edits++;
      return { ...verdict(r !== 0), turned: r === 2 };
    },
    /** The ghost of the tool on the tile as a draw list (`drawList`'s records), for the view. */
    ghost(tool, tx, ty, turn, v) {
      const p = x.lf_ghost(tool, tx, ty, turn, v.x, v.y, v.w, v.h);
      return new Int32Array(x.memory.buffer, p, x.lf_len() * 12).slice();
    },
    /**
     * What the held tool shows over a tile: `{verdict, rec}`, the sim's answer and the ghost's draw list. Kept while the tool, tile, turn
     * and view stand, no edit is made, and under `HELD_TICKS` ticks pass; `heldRuns` counts the times it was really asked.
     */
    held(tool, tx, ty, turn, v) {
      const key = `${tool},${tx},${ty},${turn},${v.x},${v.y},${v.w},${v.h},${edits},${Math.floor(ticks / HELD_TICKS)}`;
      if (held === null || held.key !== key) {
        heldRuns++;
        const verdict = this.toolTest(tool, tx, ty, turn);
        held = { key, verdict, rec: verdict.ok ? this.ghost(tool, tx, ty, turn, v) : new Int32Array(0) };
      }
      return held;
    },
    get heldRuns() {
      return heldRuns;
    },
    /** The tile each ride's In hut stands on, `{x, y}` for every ride (where a queue can start): the Ride queue tool marks them. */
    inTiles() {
      const p = x.lf_in_tiles();
      const n = x.lf_in_len();
      const a = new Int32Array(x.memory.buffer, p, n * 2).slice();
      return Array.from({ length: n }, (_, i) => ({ x: a[i * 2], y: a[i * 2 + 1] }));
    },
    /** The guest under art pixel (`ax`, `ay`): her id, or -1 for nobody (`card.rs`). */
    guestAt: (ax, ay) => x.lf_guest_at(Math.round(ax), Math.round(ay)),
    /** Guest `id`'s card lines: her name, the stat rows, her thought last; [] when she is not in the park. */
    guestLines(id) {
      const t = text(x.lf_guest_rows(id), x.lf_guest_rows_len());
      return t ? t.split("\n") : [];
    },
    /** Guest `id` alone as draw-list records (her body, then what she holds), for her portrait. */
    guestList(id) {
      const p = x.lf_guest_list(id);
      return new Int32Array(x.memory.buffer, p, x.lf_len() * 12).slice();
    },
    /** The money popups now, `{x, y, age, gain, words}` (`popups.js`). */
    popups: () => readPopups(x, x.memory),
    /** Sends `n` guests up the road to the gate (`Park::send_guests`); how many set out. */
    sendGuests: (n) => (edits++, x.lf_send_guests(n)),
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
    atlas(density = 1, light = "day") {
      const id = LIGHT_ID[light];
      if (id === undefined) throw new Error(`unknown light: ${light}`);
      const p = x.lf_atlas_light(density, id); // the call can grow the memory, so the buffer is read after it
      return new Uint8Array(x.memory.buffer, p, x.lf_atlas_len(density)).slice();
    },
    /** The ground's atlas index for each of the `w` by `h` tiles from (`x0`, `y0`), row by row; 255 is the void. */
    ground(x0, y0, w, h) {
      const p = x.lf_ground(x0, y0, w, h);
      return new Uint8Array(x.memory.buffer, p, Math.max(0, w * h)).slice();
    },
  };
}
