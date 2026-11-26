// The demo's persistent one-sprite bundles. Each copy is scoped to its art stamp,
// detail, and style. A store that is unavailable leaves the normal drawing path.
const DATABASE = "procedural-art-copies";
const COPIES = "copies";
const SIZES = "sizes";
const epochKey = (density) => ["!clear", density];
const stampKey = (family) => ["!stamp", family];
const noCopy = () => ({ copy: null, generation: 0 });

export class ArtStore {
  constructor(backend, stamps) {
    this.backend = backend;
    this.stamps = { ...stamps };
  }

  #key({ family, name, density = 1, style = "classic" }) {
    if (!Object.hasOwn(this.stamps, family)) return null;
    return [family, this.stamps[family], density, style, name];
  }

  async #use(mode, work, fallback) {
    if (!this.backend) return fallback;
    try {
      return await this.backend.transact(mode, work);
    } catch {
      this.backend = null;
      return fallback;
    }
  }

  read(job) {
    const key = this.#key(job);
    if (!key) return Promise.resolve(noCopy());
    return this.#use("readonly", async (store) => {
      const { density = 1 } = job;
      const [copy, generation] = await Promise.all([store.read(key), store.read(epochKey(density))]);
      return { copy: copy ?? null, generation: generation ?? 0 };
    }, noCopy());
  }

  write(job, copy, generation) {
    const key = this.#key(job);
    if (!key || !copy?.frg?.byteLength) return Promise.resolve(false);
    return this.#use("readwrite", async (store) => {
      const { density = 1 } = job;
      const [current, stamp] = await Promise.all([store.read(epochKey(density)), store.read(stampKey(job.family))]);
      if ((current ?? 0) !== generation || (stamp !== undefined && stamp !== key[1])) return false;
      const size = copy.frg.byteLength + (copy.mask?.byteLength ?? 0);
      await store.write(key, { frg: copy.frg, mask: copy.mask ?? null, density, size, ...(Number.isFinite(copy.ms) ? { ms: copy.ms } : {}) });
      return true;
    }, false);
  }

  prune() {
    return this.#use("readwrite", async (store) => {
      for (const [family, stamp] of Object.entries(this.stamps)) {
        const keys = await store.keys(family);
        const stale = keys.filter((key) => key[1] !== stamp);
        await Promise.all([store.write(stampKey(family), stamp), ...stale.map((key) => store.remove(key))]);
      }
    });
  }

  clear(density) {
    return this.#use("readwrite", async (store) => {
      const marker = epochKey(density);
      const [previous, keys] = await Promise.all([store.read(marker), store.keys()]);
      const matching = keys.filter((key) => key.length === 5 && key[2] === density);
      await Promise.all([store.write(marker, (previous ?? 0) + 1), ...matching.map((key) => store.remove(key))]);
      return matching.length;
    }, 0);
  }

  sizes() {
    return this.#use("readonly", (store) => store.sizes(), []);
  }
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readSizes(index) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const request = index.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(rows);
      rows.push(cursor.key);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function indexedBackend(db, range) {
  return {
    async transact(mode, work) {
      const tx = db.transaction(COPIES, mode);
      const copies = tx.objectStore(COPIES);
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      const values = Promise.resolve().then(() => work({
        read: (key) => result(copies.get(key)),
        write: (key, value) => result(copies.put(value, key)),
        remove: (key) => result(copies.delete(key)),
        keys: (family) => result(copies.getAllKeys(family === undefined ? undefined : range.bound([family], [family, []]))),
        sizes: () => readSizes(copies.index(SIZES)),
      }));
      try {
        const [answer] = await Promise.all([values, done]);
        return answer;
      } catch (error) {
        try { tx.abort(); } catch { /* The transaction may already have ended. */ }
        throw error;
      }
    },
  };
}

export async function openArtStore(stamps, { prune = true } = {}) {
  let backend = null;
  try {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(COPIES).createIndex(SIZES, ["density", "size"]);
    };
    const db = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => {
        opening.onsuccess = () => opening.result.close();
        reject(new Error("The art store is busy"));
      };
    });
    db.onversionchange = () => db.close();
    backend = indexedBackend(db, IDBKeyRange);
  } catch {
    // Browsers can block site data or IndexedDB can run out of space.
  }
  const store = new ArtStore(backend, stamps);
  if (prune) await store.prune();
  return store;
}
