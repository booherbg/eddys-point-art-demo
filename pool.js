// The worker pool (Study 115, plan 2026-11-18-live-forge, Task 2, rulings 2, 3 and 6): N drawing workers, each given the
// one compiled module, dealt jobs by the order. No DOM at load, so node imports it for its tests; the page passes the
// real `Worker` factory.

/**
 * How many workers (ruling 6). A phone (a coarse pointer and a short side under 700 CSS px) gets three at most; any
 * other machine gets its cores minus one, at most seven. A core count above that cap is never trusted (a browser that
 * hides its machine reports a made-up one).
 */
export function workerCount({ coarse, width, height, cores }) {
  const spare = Math.max(1, (Number.isFinite(cores) ? cores : 1) - 1);
  return Math.min(isPhone({ coarse, width, height }) ? 3 : 7, spare);
}

/** The phone rule (ruling 6): a coarse pointer and a short side under 700 CSS px. The picture cache's cap reads it too (Task 31). */
export function isPhone({ coarse, width, height }) {
  return !!coarse && Math.min(width, height) < 700;
}

/** Whether this browser is a phone. */
export function detectPhone() {
  return isPhone({ coarse: matchMedia("(pointer: coarse)").matches, width: innerWidth, height: innerHeight });
}

/** The count for this browser. */
export function detectWorkerCount() {
  return workerCount({
    coarse: matchMedia("(pointer: coarse)").matches,
    width: innerWidth,
    height: innerHeight,
    cores: navigator.hardwareConcurrency,
  });
}

export class Pool {
  /**
   * `module`: the compiled forge module (posted to each worker once). `count`: workers. `makeWorker(id)`: a worker whose
   * messages follow `pool-worker.js`. `order`: the `Order`. `slow`: ms each job waits first (a test page's way to show a slow machine), `onDrawn(result)`: each sprite as it lands, `{name, family, density,
   * bitmap, w, h, ax, ay, ms}`, the bitmap made by the worker and transferred.
   */
  constructor({ module, count, makeWorker, order, onDrawn, onError, slow = 0 }) {
    this.order = order;
    this.slow = slow;
    this.onDrawn = onDrawn || (() => {});
    this.onError = onError || (() => {});
    this.workers = [];
    this.idle = [];
    this.pumping = false;
    this.stats = { drawn: 0, ms: 0, failed: 0 };
    this.ready = Promise.all(
      Array.from({ length: count }, (_, id) => {
        const w = makeWorker(id);
        this.workers.push(w);
        return new Promise((res) => {
          w.onmessage = (e) => {
            if (e.data.kind === "ready") {
              w.onmessage = (ev) => this.#message(id, ev.data);
              this.idle.push(id);
              res();
            }
          };
          w.postMessage({ kind: "init", id, module });
        });
      })
    ).then(() => this.#schedule());
  }

  /** Workers with a job in flight. */
  get working() {
    return this.workers.length - this.idle.length;
  }

  /** True when nothing waits, nothing is drawing and no name has failed (a failed name keeps its sketch, so the page is not all set). */
  settled() {
    return this.order.waiting() === 0 && this.working === 0 && this.stats.failed === 0;
  }

  setView(view) {
    this.order.setView(view);
  }

  /** Ask for a sprite (see `Order.request`). Jobs go out together at the end of the tick, so a frame's whole ask is sorted first. */
  request(r) {
    this.order.request(r);
    this.#schedule();
  }

  #schedule() {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      this.#pump();
    });
  }

  #pump() {
    // Each idle worker is offered its own family's jobs first, then a family nobody holds, then a steal.
    for (const mode of ["mine", "unheld", "any"]) {
      for (const id of [...this.idle]) {
        const job = this.order.next(id, mode);
        if (!job) continue;
        this.idle.splice(this.idle.indexOf(id), 1);
        this.workers[id].postMessage({ kind: "draw", id, name: job.name, family: job.family, density: job.density > 1 ? job.density : 1, slow: this.slow });
      }
    }
  }

  #message(id, m) {
    // A worker that built a family's models says how long it took; a failed first job counts as built, so no family stays unmeasured.
    if (m.prep !== undefined) this.order.prepared(m.family, m.prep);
    else if (m.kind === "failed") this.order.prepared(m.family, 0);
    if (m.kind === "drew") {
      this.order.finish(m.name, m.density);
      this.stats.drawn++;
      this.stats.ms += m.ms || 0;
      this.onDrawn(m);
    } else if (m.kind === "failed") {
      this.order.fail(m.name, m.density);
      this.stats.failed++;
      this.onError(m);
    }
    this.idle.push(id);
    this.#schedule();
  }

  close() {
    this.workers.forEach((w) => w.terminate());
  }
}
