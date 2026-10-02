import { validCoordinate } from './cachedRoute.js';

/**
 * Safecast normalizers. Values are counts per minute from a Geiger tube; the
 * conversion to dose rate depends on the tube, so the API keeps CPM and the
 * layer says so.
 */
export const SAFECAST_MEASUREMENTS_URL =
  'https://api.safecast.org/measurements.json';
export const SAFECAST_DEVICES_URL = 'https://tt.safecast.org/devices';
export const SAFECAST_CELL_DEGREES = 0.25;
const MAX_CPM = 100_000;
/** Realtime device readings older than this are stale, not evidence. */
const DEVICE_MAX_AGE_MS = 30 * 86_400_000;
/** LND tube fields in priority order (CPM). */
const DEVICE_CPM_FIELDS = Object.freeze([
  'lnd_7318u',
  'lnd_7318c',
  'lnd_712u',
  'lnd_7128ec',
]);

function cpmOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= MAX_CPM
    ? number
    : null;
}

/** Aggregate raw measurements into equal-angle cells with CPM statistics. */
export function aggregateSafecastMeasurements(
  measurements,
  { cellDeg = SAFECAST_CELL_DEGREES } = {},
) {
  const cells = new Map();
  for (const measurement of Array.isArray(measurements) ? measurements : []) {
    if (String(measurement?.unit || '').toLowerCase() !== 'cpm') continue;
    const cpm = cpmOf(measurement?.value);
    const lat = Number(measurement?.latitude);
    const lon = Number(measurement?.longitude);
    if (cpm === null || !validCoordinate(lat, lon)) continue;
    const latIndex = Math.floor(lat / cellDeg);
    const lonIndex = Math.floor(lon / cellDeg);
    const key = `${latIndex}:${lonIndex}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        id: `cell:${key}`,
        lat: (latIndex + 0.5) * cellDeg,
        lon: (lonIndex + 0.5) * cellDeg,
        south: latIndex * cellDeg,
        west: lonIndex * cellDeg,
        north: (latIndex + 1) * cellDeg,
        east: (lonIndex + 1) * cellDeg,
        count: 0,
        sum: 0,
        maxCpm: 0,
        latest: null,
      };
      cells.set(key, cell);
    }
    cell.count += 1;
    cell.sum += cpm;
    if (cpm > cell.maxCpm) cell.maxCpm = cpm;
    const captured = Date.parse(String(measurement?.captured_at || ''));
    if (Number.isFinite(captured)) {
      const iso = new Date(captured).toISOString();
      if (!cell.latest || iso > cell.latest) cell.latest = iso;
    }
  }
  return [...cells.values()].map(({ sum, ...cell }) => ({
    ...cell,
    meanCpm: Math.round((sum / cell.count) * 10) / 10,
  }));
}

/** Keep realtime devices that report a Geiger CPM at a known location. */
export function normalizeSafecastDevices(devices, { nowMs = Date.now() } = {}) {
  const rows = [];
  for (const device of Array.isArray(devices) ? devices : []) {
    const lat = Number(device?.loc_lat);
    const lon = Number(device?.loc_lon);
    if (!validCoordinate(lat, lon)) continue;
    let cpm = null;
    let tube = '';
    for (const field of DEVICE_CPM_FIELDS) {
      const value = cpmOf(device?.[field]);
      if (value !== null) {
        cpm = value;
        tube = field;
        break;
      }
    }
    if (cpm === null) continue;
    const captured = Date.parse(String(device?.when_captured || ''));
    if (!Number.isFinite(captured) || nowMs - captured > DEVICE_MAX_AGE_MS)
      continue;
    const id = String(device?.device_urn || device?.device || '').trim();
    if (!id) continue;
    rows.push({
      id: `device:${id}`,
      lat,
      lon,
      name: String(device?.device_sn || device?.loc_name || id).trim(),
      place: String(device?.loc_name || '').trim(),
      country: String(device?.loc_country || '').trim(),
      cpm,
      tube,
      captured: new Date(captured).toISOString(),
    });
  }
  return rows;
}
