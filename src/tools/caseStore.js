/**
 * Case state: a named investigation with timestamped notes, optional pinned
 * positions and tags, persisted through an injected storage. Pure logic —
 * the panel in src/ui/casePanel.js renders it.
 */

export const CASE_STORAGE_KEY = 'panoptes:case:v1';
export const CASE_SCHEMA_VERSION = 1;
/** Bound on notes so a runaway import cannot fill storage. */
export const CASE_MAX_NOTES = 500;
export const CASE_MAX_TEXT = 4000;
export const CASE_MAX_TAGS = 32;

const clean = (value, max = CASE_MAX_TEXT) =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);

const finite = (value) => (Number.isFinite(value) ? value : null);

function normalizeTag(tag) {
  return clean(tag, 32)
    .toLowerCase()
    .replace(/[^a-z0-9\-_. ]/g, '')
    .trim();
}

function normalizePin(pin) {
  if (!pin || typeof pin !== 'object') return null;
  const lat = finite(Number(pin.lat));
  const lon = finite(Number(pin.lon));
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    lat,
    lon,
    altM: finite(Number(pin.altM)),
    heading: finite(Number(pin.heading)),
    pitch: finite(Number(pin.pitch)),
    label: clean(pin.label, 120) || null,
    subjectId: clean(pin.subjectId, 120) || null,
  };
}

function normalizeNote(note, now) {
  if (!note || typeof note !== 'object') return null;
  const body = clean(note.text);
  const pin = normalizePin(note.pin);
  if (!body && !pin) return null;
  const createdAt = finite(Number(note.createdAt)) ?? now;
  return {
    id:
      clean(note.id, 64) ||
      `note-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    text: body,
    createdAt,
    updatedAt: finite(Number(note.updatedAt)) ?? createdAt,
    tags: [
      ...new Set(
        (Array.isArray(note.tags) ? note.tags : [])
          .map(normalizeTag)
          .filter(Boolean),
      ),
    ].slice(0, CASE_MAX_TAGS),
    pin,
  };
}

/** Bring any stored or imported object into the current schema, or null. */
export function normalizeCase(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((note) => normalizeNote(note, now))
    .filter(Boolean)
    .slice(0, CASE_MAX_NOTES);
  const createdAt = finite(Number(raw.createdAt)) ?? now;
  return {
    version: CASE_SCHEMA_VERSION,
    name: clean(raw.name, 120) || 'Untitled case',
    createdAt,
    updatedAt: finite(Number(raw.updatedAt)) ?? createdAt,
    tags: [
      ...new Set(
        (Array.isArray(raw.tags) ? raw.tags : [])
          .map(normalizeTag)
          .filter(Boolean),
      ),
    ].slice(0, CASE_MAX_TAGS),
    notes,
  };
}

/** A fresh, empty case. */
export function emptyCase(now = Date.now()) {
  return {
    version: CASE_SCHEMA_VERSION,
    name: 'Untitled case',
    createdAt: now,
    updatedAt: now,
    tags: [],
    notes: [],
  };
}

/**
 * @param {{storage?: {getItem: Function, setItem: Function, removeItem?: Function}|null, key?: string, now?: () => number}} [options]
 */
export function createCaseStore({
  storage = null,
  key = CASE_STORAGE_KEY,
  now = () => Date.now(),
} = {}) {
  const listeners = new Set();
  let state = emptyCase(now());
  try {
    const raw = storage?.getItem?.(key);
    const parsed = raw ? normalizeCase(JSON.parse(raw), now()) : null;
    if (parsed) state = parsed;
  } catch {
    /* corrupt or unavailable storage starts a fresh case */
  }

  function persist() {
    try {
      storage?.setItem?.(key, JSON.stringify(state));
    } catch {
      /* quota or private mode: the case lives for the session */
    }
  }

  function commit(next) {
    state = { ...next, updatedAt: now() };
    persist();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        /* one listener must not break the others */
      }
    }
    return state;
  }

  const findNote = (id) => state.notes.find((note) => note.id === id) || null;

  return {
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rename(name) {
      const next = clean(name, 120) || 'Untitled case';
      if (next === state.name) return state;
      return commit({ ...state, name: next });
    },
    addNote({ text = '', pin = null, tags = [] } = {}) {
      const note = normalizeNote(
        {
          id: `note-${now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          pin,
          tags,
          createdAt: now(),
        },
        now(),
      );
      if (!note) return null;
      if (state.notes.length >= CASE_MAX_NOTES) return null;
      commit({ ...state, notes: [note, ...state.notes] });
      return note;
    },
    updateNote(id, patch = {}) {
      const existing = findNote(id);
      if (!existing) return null;
      const merged = normalizeNote(
        {
          ...existing,
          ...patch,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: now(),
          pin: Object.hasOwn(patch, 'pin') ? patch.pin : existing.pin,
          tags: Object.hasOwn(patch, 'tags') ? patch.tags : existing.tags,
        },
        now(),
      );
      if (!merged) return null;
      commit({
        ...state,
        notes: state.notes.map((note) => (note.id === id ? merged : note)),
      });
      return merged;
    },
    removeNote(id) {
      if (!findNote(id)) return false;
      commit({ ...state, notes: state.notes.filter((note) => note.id !== id) });
      return true;
    },
    addTag(tag) {
      const normalized = normalizeTag(tag);
      if (!normalized || state.tags.includes(normalized)) return state;
      if (state.tags.length >= CASE_MAX_TAGS) return state;
      return commit({ ...state, tags: [...state.tags, normalized] });
    },
    removeTag(tag) {
      const normalized = normalizeTag(tag);
      if (!state.tags.includes(normalized)) return state;
      return commit({
        ...state,
        tags: state.tags.filter((entry) => entry !== normalized),
      });
    },
    clear() {
      return commit(emptyCase(now()));
    },
    /** JSON text of the whole case, ready to save. */
    exportJson() {
      return JSON.stringify(
        { ...state, exportedAt: new Date(now()).toISOString() },
        null,
        2,
      );
    },
    /** Replace the case from JSON text; returns false when unreadable. */
    importJson(textValue) {
      let parsed;
      try {
        parsed = JSON.parse(String(textValue));
      } catch {
        return false;
      }
      const next = normalizeCase(parsed, now());
      if (!next) return false;
      commit(next);
      return true;
    },
    /** Merge notes from JSON text into the current case (dedupe by id). */
    mergeJson(textValue) {
      let parsed;
      try {
        parsed = JSON.parse(String(textValue));
      } catch {
        return 0;
      }
      const incoming = normalizeCase(parsed, now());
      if (!incoming) return 0;
      const known = new Set(state.notes.map((note) => note.id));
      const added = incoming.notes.filter((note) => !known.has(note.id));
      if (!added.length) return 0;
      commit({
        ...state,
        tags: [...new Set([...state.tags, ...incoming.tags])].slice(
          0,
          CASE_MAX_TAGS,
        ),
        notes: [...added, ...state.notes].slice(0, CASE_MAX_NOTES),
      });
      return added.length;
    },
  };
}

/** File name for a case export. */
export function caseFilename(state, at = Date.now()) {
  const slug =
    String(state?.name || 'case')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'case';
  const iso = new Date(at).toISOString().slice(0, 19).replace(/[-:]/g, '');
  return `panoptes-case-${slug}-${iso}Z.json`;
}
