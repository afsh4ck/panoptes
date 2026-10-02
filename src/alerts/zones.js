/**
 * Watch zones: user-defined circles the alert rules evaluate against.
 *
 * Pure geometry plus a small persisted store. No DOM, no Cesium: the engine
 * and the panel own their hosts, this module owns the zone contract.
 */

export const ZONE_STORAGE_KEY = 'panoptes:watch-zones:v1';
export const ZONE_RADIUS_OPTIONS_KM = Object.freeze([25, 50, 100, 250, 500]);
export const ZONE_DEFAULT_RADIUS_KM = 100;
export const ZONE_MAX_COUNT = 40;
const ZONE_NAME_LIMIT = 40;
const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometers between two WGS84 points. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const finiteLat = (value) =>
  Number.isFinite(value) && value >= -90 && value <= 90;
const finiteLon = (value) =>
  Number.isFinite(value) && value >= -180 && value <= 180;

/** Whether a point lies inside a zone circle (on the boundary counts). */
export function isInsideZone(zone, lat, lon) {
  if (!zone || !finiteLat(lat) || !finiteLon(lon)) return false;
  if (!finiteLat(zone.lat) || !finiteLon(zone.lon)) return false;
  const radiusKm = Number(zone.radiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  return haversineKm(zone.lat, zone.lon, lat, lon) <= radiusKm;
}

/** Normalize an untrusted zone record; null when it cannot be a zone. */
export function normalizeZone(input, { now = Date.now } = {}) {
  if (!input || typeof input !== 'object') return null;
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!finiteLat(lat) || !finiteLon(lon)) return null;
  const radiusRaw = Number(input.radiusKm);
  const radiusKm =
    Number.isFinite(radiusRaw) && radiusRaw > 0
      ? Math.min(2000, Math.max(1, Math.round(radiusRaw)))
      : ZONE_DEFAULT_RADIUS_KM;
  const name =
    String(input.name ?? '')
      .trim()
      .slice(0, ZONE_NAME_LIMIT) || `Zone ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const id =
    String(input.id ?? '').trim() ||
    `zone-${Math.round(lat * 1e4)}-${Math.round(lon * 1e4)}-${radiusKm}`;
  const createdAt = Number.isFinite(Number(input.createdAt))
    ? Number(input.createdAt)
    : now();
  return {
    id,
    name,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    radiusKm,
    enabled: input.enabled !== false,
    createdAt,
  };
}

/** In-memory Storage look-alike for tests and storage-less hosts. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Read one JSON document from a Storage-like object, tolerating any failure. */
export function readStorageJson(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (typeof raw !== 'string' || !raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write one JSON document to a Storage-like object; false when it failed. */
export function writeStorageJson(storage, key, value) {
  try {
    storage?.setItem?.(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persisted zone list with change subscriptions.
 * @param {object} [options]
 * @param {object} [options.storage] Storage-like adapter (localStorage). Falls
 *   back to memory when absent or unusable.
 * @param {string} [options.key] Storage key.
 * @param {() => number} [options.now] Clock.
 */
export function createZoneStore({
  storage = null,
  key = ZONE_STORAGE_KEY,
  now = Date.now,
} = {}) {
  const backing = storage || memoryStorage();
  const listeners = new Set();
  let zones = [];

  function load() {
    const parsed = readStorageJson(backing, key);
    const rows = Array.isArray(parsed?.zones) ? parsed.zones : [];
    const seen = new Set();
    zones = [];
    for (const row of rows) {
      const zone = normalizeZone(row, { now });
      if (!zone || seen.has(zone.id)) continue;
      seen.add(zone.id);
      zones.push(zone);
      if (zones.length >= ZONE_MAX_COUNT) break;
    }
  }

  function persist() {
    writeStorageJson(backing, key, { version: 1, zones });
  }

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener(list());
      } catch {
        /* a listener failure never blocks the others */
      }
    }
  }

  function list() {
    return zones.map((zone) => ({ ...zone }));
  }

  load();

  return {
    list,
    /** Enabled zones only. */
    active: () => zones.filter((zone) => zone.enabled).map((z) => ({ ...z })),
    get: (id) => {
      const zone = zones.find((entry) => entry.id === id);
      return zone ? { ...zone } : null;
    },
    /** Add a zone; returns the stored zone or null when rejected. */
    add(input) {
      const draft = normalizeZone(
        {
          ...input,
          id: input?.id || `zone-${now().toString(36)}-${zones.length + 1}`,
          name: input?.name || `Zone ${zones.length + 1}`,
        },
        { now },
      );
      if (!draft) return null;
      if (zones.some((zone) => zone.id === draft.id)) return null;
      if (zones.length >= ZONE_MAX_COUNT) return null;
      zones = [...zones, draft];
      persist();
      notify();
      return { ...draft };
    },
    update(id, patch = {}) {
      const index = zones.findIndex((zone) => zone.id === id);
      if (index < 0) return null;
      const next = normalizeZone({ ...zones[index], ...patch, id }, { now });
      if (!next) return null;
      zones = zones.map((zone, i) => (i === index ? next : zone));
      persist();
      notify();
      return { ...next };
    },
    toggle(id, enabled) {
      const zone = zones.find((entry) => entry.id === id);
      if (!zone) return null;
      const value = typeof enabled === 'boolean' ? enabled : !zone.enabled;
      return this.update(id, { enabled: value });
    },
    remove(id) {
      const before = zones.length;
      zones = zones.filter((zone) => zone.id !== id);
      if (zones.length === before) return false;
      persist();
      notify();
      return true;
    },
    clear() {
      zones = [];
      persist();
      notify();
    },
    /** Zones whose circle contains the point. */
    containing(lat, lon, { enabledOnly = true } = {}) {
      return zones
        .filter(
          (zone) =>
            (!enabledOnly || zone.enabled) && isInsideZone(zone, lat, lon),
        )
        .map((zone) => ({ ...zone }));
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload: load,
  };
}
