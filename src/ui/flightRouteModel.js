/**
 * Pure route math for the tracked-aircraft route overlay: great-circle
 * distance and interpolation, progress along the route, and an ETA estimate
 * from the current ground speed. No Cesium, no DOM.
 */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Normalize an airport/point record to {lat, lon, code, name} or null. */
export function routePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat ?? raw.latitude);
  const lon = Number(raw.lon ?? raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    code: String(raw.code || raw.iata || raw.icao || '').trim(),
    name: String(raw.municipality || raw.name || '').trim(),
  };
}

/** Great-circle distance in km. */
export function greatCircleKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from a to b (inclusive), for drawing.
 * @returns {Array<{lat: number, lon: number}>}
 */
export function greatCirclePath(a, b, segments = 64) {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);
  const d = greatCircleKm(a, b) / EARTH_RADIUS_KM;
  if (!d) return [{ lat: a.lat, lon: a.lon }];
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y =
      A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push({
      lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
      lon: toDeg(Math.atan2(y, x)),
    });
  }
  return out;
}

/**
 * Route summary for a tracked aircraft.
 * @param {{origin: object, destination: object, position: {lat: number, lon: number}, speedMps?: number|null, nowMs?: number}} input
 * @returns {null|{origin: object, destination: object, totalKm: number, flownKm: number, remainingKm: number, progress: number, etaMs: number|null, remainingMinutes: number|null}}
 */
export function routeSummary({
  origin,
  destination,
  position,
  speedMps = null,
  nowMs = Date.now(),
}) {
  const from = routePoint(origin);
  const to = routePoint(destination);
  const at = routePoint(position);
  if (!from || !to || !at) return null;
  const totalKm = greatCircleKm(from, to);
  const remainingKm = greatCircleKm(at, to);
  const flownKm = greatCircleKm(from, at);
  const progress =
    flownKm + remainingKm > 0 ? flownKm / (flownKm + remainingKm) : 0;
  const speedKmh =
    Number.isFinite(speedMps) && speedMps > 20 ? speedMps * 3.6 : null;
  const remainingMinutes = speedKmh ? (remainingKm / speedKmh) * 60 : null;
  return {
    origin: from,
    destination: to,
    totalKm,
    flownKm,
    remainingKm,
    progress: Math.max(0, Math.min(1, progress)),
    remainingMinutes,
    etaMs: remainingMinutes === null ? null : nowMs + remainingMinutes * 60_000,
  };
}

/** `1h 12m` / `48m` / `--`. */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '--';
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
}

/** `16:42Z` from an epoch. */
export function formatUtcTime(ms) {
  if (!Number.isFinite(ms)) return '--';
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`;
}
