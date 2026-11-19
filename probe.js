// The probe page (Study 115, H1 to H3): N workers, each instantiating the one module the page compiled, draw a fixed
// list of the small park's sprites. Each call is timed with `performance.now()` and its bytes hashed (FNV-1a), and
// the hash is compared with the native one in names.json. Parameters: `workers` (default 4), `list` (`all`, the
// small park's names, or `first`, the names its opening minute asks for; default `all`).

const q = new URLSearchParams(location.search);
const N = Math.max(1, Number(q.get("workers") || 4));
const listName = q.get("list") || "all";
const wasmName = q.get("wasm") || "forge_worker.wasm";

const $ = (id) => document.getElementById(id);
const ms = (x) => x.toFixed(1);

async function run() {
  const t0 = performance.now();
  const names = await (await fetch("names.json")).json();
  const jobs = names[listName];
  const expected = new Map(jobs.map(([f, n, h]) => [`${f}/${n}`, h]));
  const bytes = await (await fetch(wasmName)).arrayBuffer();
  const fetched = performance.now();
  const module = await WebAssembly.compile(bytes);
  const compiled = performance.now();

  const workers = Array.from({ length: N }, (_, id) => new Worker("worker.js", { type: "module" }));
  await Promise.all(
    workers.map(
      (w, id) =>
        new Promise((res) => {
          w.onmessage = () => res();
          w.postMessage({ kind: "init", id, module });
        })
    )
  );
  const ready = performance.now();

  const rows = [];
  const queue = jobs.map(([f, n]) => [f, n]);
  let next = 0;
  const start = performance.now();
  await Promise.all(
    workers.map(
      (w, id) =>
        new Promise((res) => {
          const feed = () => {
            if (next >= queue.length) return res();
            w.postMessage({ kind: "draw", id, jobs: [queue[next++]] });
          };
          w.onmessage = (e) => {
            rows.push(...e.data.rows);
            feed();
          };
          feed();
        })
    )
  );
  const wall = performance.now() - start;
  workers.forEach((w) => w.terminate());

  // Per family.
  const fam = new Map();
  for (const r of rows) {
    const f = fam.get(r.family) || { family: r.family, sprites: 0, draw_ms: 0, prepare_ms: 0, prepares: 0, match: 0, mismatch: 0, missing: 0, bytes: 0 };
    f.sprites++;
    f.draw_ms += r.draw_ms;
    f.prepare_ms += r.prepare_ms;
    if (r.prepare_ms > 0) f.prepares++;
    f.bytes += r.size;
    if (r.hash === "missing") f.missing++;
    else if (r.hash === expected.get(`${r.family}/${r.name}`)) f.match++;
    else f.mismatch++;
    fam.set(r.family, f);
  }
  const perWorker = Array.from({ length: N }, (_, id) => rows.filter((r) => r.worker === id).reduce((a, r) => a + r.draw_ms + r.prepare_ms, 0));
  const total = [...fam.values()].reduce((a, f) => ({ draw: a.draw + f.draw_ms, prep: a.prep + f.prepare_ms, match: a.match + f.match, mismatch: a.mismatch + f.mismatch, missing: a.missing + f.missing }), { draw: 0, prep: 0, match: 0, mismatch: 0, missing: 0 });
  const summary = {
    workers: N,
    list: listName,
    sprites: rows.length,
    wall_ms: wall,
    fetch_ms: fetched - t0,
    compile_ms: compiled - fetched,
    ready_ms: ready - compiled,
    busy_ms_by_worker: perWorker,
    draw_ms_sum: total.draw,
    prepare_ms_sum: total.prep,
    match: total.match,
    mismatch: total.mismatch,
    missing: total.missing,
    wasm_bytes: bytes.byteLength,
    cores: navigator.hardwareConcurrency,
    families: [...fam.values()],
  };
  window.__probe = { done: true, summary, rows };

  $("env").textContent = `${N} workers, list ${listName}, ${navigator.hardwareConcurrency} cores, wasm ${(bytes.byteLength / 1024).toFixed(0)} KB, compile ${ms(summary.compile_ms)} ms`;
  const ok = total.mismatch === 0 && total.missing === 0;
  $("summary").innerHTML = `${rows.length} sprites in ${(wall / 1000).toFixed(2)} s on ${N} workers; bytes equal to native: <span class="${ok ? "ok" : "bad"}">${total.match} of ${rows.length}</span>`;
  const head = "<tr><th>Family</th><th>Sprites</th><th>Prepares</th><th>Prepare ms</th><th>Draw ms</th><th>Mean ms</th><th>Equal</th></tr>";
  const body = [...fam.values()]
    .map((f) => `<tr><td>${f.family}</td><td>${f.sprites}</td><td>${f.prepares}</td><td>${ms(f.prepare_ms)}</td><td>${ms(f.draw_ms)}</td><td>${ms(f.draw_ms / f.sprites)}</td><td class="${f.mismatch + f.missing ? "bad" : "ok"}">${f.match}/${f.sprites}</td></tr>`)
    .join("");
  $("table").innerHTML = head + body;
  console.log("probe-json " + JSON.stringify(summary));
  console.log("probe-done");
}

run().catch((e) => {
  window.__probe = { done: true, error: String(e) };
  $("summary").textContent = "Failed: " + e;
  console.log("probe-error " + e);
});
