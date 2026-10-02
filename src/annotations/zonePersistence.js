/**
 * @module zonePersistence
 * @description Marked zones survive reloads. Every mark drawn by hand (the
 * DRAW tool's `manual: true` specs) is saved in this browser's localStorage
 * and re-drawn on the next start; deleting a zone or clearing the board
 * forgets it. Voice and other automatic marks are not stored.
 */

export const ZONES_STORAGE_KEY = 'panoptes:saved-zones:v1';
const MAX_ZONES = 200;

/** Keep only well-formed manual specs. */
export function sanitizeSavedZones(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((spec) => spec && typeof spec === 'object' && spec.manual === true)
    .filter((spec) => ['area', 'route', 'pin'].includes(spec.type))
    .slice(-MAX_ZONES);
}

/**
 * Pair the marks one annotate() call added with the manual specs it was given.
 * One spec ↔ one mark in order; a single spec that produced several marks
 * (multi-part outlines) owns all of them.
 */
export function pairAddedMarks(specs, addedIds) {
  const pairs = [];
  if (!specs.length || !addedIds.length) return pairs;
  if (specs.length === 1) {
    for (const id of addedIds) pairs.push([id, specs[0]]);
    return pairs;
  }
  for (let i = 0; i < Math.min(specs.length, addedIds.length); i++)
    pairs.push([addedIds[i], specs[i]]);
  return pairs;
}

/**
 * @param {object} options
 * @param {() => object|null} options.getEngine Annotation engine accessor.
 * @param {Window} options.windowRef
 */
export function installZonePersistence({ getEngine, windowRef }) {
  const storage = (() => {
    try {
      return windowRef?.localStorage || null;
    } catch {
      return null;
    }
  })();
  /** mark id → the manual spec that drew it */
  const saved = new Map();

  function read() {
    try {
      return sanitizeSavedZones(
        JSON.parse(storage?.getItem(ZONES_STORAGE_KEY) || '[]'),
      );
    } catch {
      return [];
    }
  }
  function write() {
    const specs = [...new Set(saved.values())];
    try {
      if (specs.length)
        storage?.setItem(ZONES_STORAGE_KEY, JSON.stringify(specs));
      else storage?.removeItem(ZONES_STORAGE_KEY);
    } catch {
      /* storage full or blocked */
    }
  }

  function patch(engine) {
    if (engine.__zonePersistence) return;
    engine.__zonePersistence = true;
    const annotate = engine.annotate.bind(engine);
    const remove = engine.remove?.bind(engine);
    const clear = engine.clear.bind(engine);
    const ids = () => new Set((engine.list?.() || []).map((mark) => mark.id));

    async function annotateAndRemember(specs, options, { store = true } = {}) {
      const manual = (Array.isArray(specs) ? specs : []).filter(
        (spec) => spec?.manual === true,
      );
      const before = ids();
      const result = await annotate(specs, options);
      if (manual.length) {
        const added = [...ids()].filter((id) => !before.has(id));
        for (const [id, spec] of pairAddedMarks(manual, added))
          saved.set(id, spec);
        if (store) write();
      }
      return result;
    }

    engine.annotate = (specs, options) => annotateAndRemember(specs, options);
    if (remove)
      engine.remove = (id) => {
        const removed = remove(id);
        if (saved.delete(id)) write();
        return removed;
      };
    engine.clear = (...args) => {
      const result = clear(...args);
      if (saved.size) {
        saved.clear();
        write();
      }
      return result;
    };

    // Restore last session's zones (one call each so a bad one cannot block the rest).
    const restore = read();
    (async () => {
      for (const spec of restore)
        await annotateAndRemember(
          [spec],
          { persist: true, flyTo: false },
          { store: false },
        ).catch(() => {});
      write();
    })();
  }

  const timer = windowRef?.setInterval?.(() => {
    const engine = getEngine();
    if (!engine?.annotate || !engine?.list) return;
    windowRef.clearInterval(timer);
    patch(engine);
  }, 400);

  return {
    destroy() {
      windowRef?.clearInterval?.(timer);
    },
  };
}
