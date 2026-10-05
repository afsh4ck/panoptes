/**
 * @module nearby
 * @description "What is around this?" for any dossier: the records the
 * enabled layers hold (aircraft, vessels, sites, events, public cameras…)
 * within a radius of the subject, nearest first and a few per layer. Pure:
 * the console hands it the layers' analyst records.
 */
import { cleanText, fmtDistance } from './intelModel.js';

export const NEARBY_RADIUS_KM = 50;
const PER_LAYER = 3;
const MAX_ROWS = 12;
/** A record this close to the subject in the subject's own layer is the subject. */
const SELF_M = 25;
/** Layers whose positions are not places on the ground (orbits). */
const SKIPPED_LAYERS = new Set(['satellites']);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** A record's position from any of the field spellings the layers use. */
export function positionOf(record) {
  if (!record || typeof record !== 'object') return null;
  const lat = finite(record.lat ?? record.latitude ?? record.latitudeDeg);
  const lon = finite(
    record.lon ?? record.lng ?? record.longitude ?? record.longitudeDeg,
  );
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** A short label for an analyst record of any layer. */
export function recordLabel(record) {
  const mag = finite(record?.magnitude ?? record?.mag);
  const name = [
    record?.name,
    record?.title,
    record?.callsign,
    record?.flight,
    record?.label,
    record?.place,
    record?.registration,
    record?.id,
  ]
    .map((value) => cleanText(value, 80))
    .find(Boolean);
  return [mag !== null ? `M${mag.toFixed(1)}` : '', name || '']
    .filter(Boolean)
    .join(' ');
}

const toRad = Math.PI / 180;

function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(a, b) {
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) *
      Math.cos(b.lat * toRad) *
      Math.cos((b.lon - a.lon) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

/** Eight-point compass direction for a bearing. */
export function compassPoint(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/**
 * Nearest records around `origin`, at most `perLayer` from each layer and
 * `maxRows` in all, nearest first.
 *
 * @param {{lat: number, lon: number}} origin
 * @param {Array<{layerId: string, name?: string, records: object[]}>} collections
 * @param {{radiusKm?: number, perLayer?: number, maxRows?: number,
 *   subjectLayerId?: string}} [options]
 * @returns {Array<{layerId: string, layerName: string, label: string,
 *   lat: number, lon: number, distanceM: number, bearingDeg: number,
 *   cameraId: string|null}>}
 */
export function nearbyEntries(
  origin,
  collections,
  {
    radiusKm = NEARBY_RADIUS_KM,
    perLayer = PER_LAYER,
    maxRows = MAX_ROWS,
    subjectLayerId = '',
  } = {},
) {
  if (!positionOf(origin)) return [];
  const limitM = radiusKm * 1000;
  const entries = [];
  for (const collection of Array.isArray(collections) ? collections : []) {
    const layerId = cleanText(collection?.layerId);
    if (!layerId || SKIPPED_LAYERS.has(layerId)) continue;
    const found = [];
    for (const record of Array.isArray(collection.records)
      ? collection.records
      : []) {
      const position = positionOf(record);
      if (!position) continue;
      const d = distanceM(origin, position);
      if (d > limitM) continue;
      if (layerId === subjectLayerId && d < SELF_M) continue;
      found.push({ record, position, d });
    }
    found.sort((a, b) => a.d - b.d);
    for (const { record, position, d } of found.slice(0, perLayer)) {
      entries.push({
        layerId,
        layerName: cleanText(collection.name) || layerId,
        label: recordLabel(record),
        lat: position.lat,
        lon: position.lon,
        distanceM: d,
        bearingDeg: bearingDeg(origin, position),
        cameraId: layerId === 'cctv' ? cleanText(record.id) || null : null,
      });
    }
  }
  return entries.sort((a, b) => a.distanceM - b.distanceM).slice(0, maxRows);
}

/**
 * The NEARBY dossier section: each row flies to its record, or opens the
 * camera when it is one.
 * @param {ReturnType<typeof nearbyEntries>} entries
 * @param {{radiusKm?: number}} [options]
 * @returns {{heading: string, rows: object[]}|null}
 */
export function nearbySection(entries, { radiusKm = NEARBY_RADIUS_KM } = {}) {
  if (!entries?.length) return null;
  return {
    heading: `NEARBY · ${radiusKm} KM`,
    rows: entries.map((entry) => ({
      label: entry.layerName,
      value: [
        entry.label || 'Unnamed',
        `${fmtDistance(entry.distanceM)} ${compassPoint(entry.bearingDeg)}`,
      ].join(' · '),
      fly: { lat: entry.lat, lon: entry.lon },
      ...(entry.cameraId ? { camera: entry.cameraId } : {}),
    })),
  };
}
