/**
 * Safecast radiation records. Pure — no Cesium, no DOM. Values are counts per
 * minute from a Geiger tube: comparable within one tube type, not a dose rate.
 */

export const RADIATION_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const RADIATION_DEFAULT_DAYS = 7;

/** CPM bands; order doubles as the legend order. */
export const RADIATION_BANDS = Object.freeze([
  Object.freeze({
    id: 'background',
    label: '< 30 CPM',
    min: 0,
    color: '#00e676',
  }),
  Object.freeze({
    id: 'elevated',
    label: '30–100 CPM',
    min: 30,
    color: '#ffea00',
  }),
  Object.freeze({
    id: 'high',
    label: '100–500 CPM',
    min: 100,
    color: '#ff9100',
  }),
  Object.freeze({
    id: 'alert',
    label: '≥ 500 CPM',
    min: 500,
    color: '#ff1744',
  }),
]);

/** Band for a CPM value. */
export function radiationBand(cpm) {
  let band = RADIATION_BANDS[0];
  for (const candidate of RADIATION_BANDS)
    if (Number.isFinite(cpm) && cpm >= candidate.min) band = candidate;
  return band;
}

/** Legend colour for a CPM value. */
export function radiationColor(cpm) {
  return radiationBand(cpm).color;
}

function validCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180
  );
}

const text = (value, max = 120) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};
const cpmOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100_000
    ? number
    : null;
};

/** Normalize one aggregated cell. */
export function normalizeRadiationCell(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const south = Number(raw.south);
  const west = Number(raw.west);
  const north = Number(raw.north);
  const east = Number(raw.east);
  if (
    !validCoordinate(south, west) ||
    !validCoordinate(north, east) ||
    north <= south ||
    east <= west
  )
    return null;
  const meanCpm = cpmOrNull(raw.meanCpm);
  const maxCpm = cpmOrNull(raw.maxCpm);
  if (meanCpm === null) return null;
  const count = Math.max(1, Math.round(Number(raw.count) || 1));
  const latest = Date.parse(String(raw.latest || ''));
  return {
    id: text(raw.id, 80) || `cell:${south}:${west}`,
    south,
    west,
    north,
    east,
    lat: (south + north) / 2,
    lon: (west + east) / 2,
    count,
    meanCpm,
    maxCpm: maxCpm ?? meanCpm,
    latestMs: Number.isFinite(latest) ? latest : null,
  };
}

/** Normalize one realtime device. */
export function normalizeRadiationDevice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!validCoordinate(lat, lon)) return null;
  const cpm = cpmOrNull(raw.cpm);
  if (cpm === null) return null;
  const id = text(raw.id, 120);
  if (!id) return null;
  const captured = Date.parse(String(raw.captured || ''));
  return {
    id,
    lat,
    lon,
    cpm,
    name: text(raw.name, 80) || id,
    place: text(raw.place, 80),
    country: text(raw.country, 8),
    tube: text(raw.tube, 24),
    capturedMs: Number.isFinite(captured) ? captured : null,
  };
}

/** Validate a proxy payload; malformed entries drop. */
export function normalizeRadiationSnapshot(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.cells) ||
    !Array.isArray(payload.devices)
  )
    return null;
  const cells = [];
  const devices = [];
  const ids = new Set();
  for (const raw of payload.cells) {
    const cell = normalizeRadiationCell(raw);
    if (!cell || ids.has(cell.id)) continue;
    ids.add(cell.id);
    cells.push(cell);
  }
  for (const raw of payload.devices) {
    const device = normalizeRadiationDevice(raw);
    if (!device || ids.has(device.id)) continue;
    ids.add(device.id);
    devices.push(device);
  }
  const days = RADIATION_WINDOWS.includes(Number(payload.days))
    ? Number(payload.days)
    : RADIATION_DEFAULT_DAYS;
  return {
    cells,
    devices,
    days,
    counts: {
      measurements: Math.max(
        0,
        Math.round(Number(payload.counts?.measurements) || 0),
      ),
    },
    degraded: text(payload.degraded, 200) || null,
    stale: payload.stale === true,
    fetchedAt: Number.isFinite(Number(payload.fetchedAt))
      ? Number(payload.fetchedAt)
      : null,
  };
}

/** Analyst-engine records for cells and devices (flat, JSON-safe). */
export function mapRadiationAnalystRecords({ cells = [], devices = [] }) {
  const rows = [];
  for (const device of devices)
    rows.push({
      id: device.id,
      name: device.name,
      kind: 'device',
      lat: device.lat,
      lon: device.lon,
      cpm: device.cpm,
      band: radiationBand(device.cpm).id,
      place: device.place || null,
      country: device.country || null,
      capturedMs: device.capturedMs,
    });
  for (const cell of cells)
    rows.push({
      id: cell.id,
      name: `Cell ${cell.lat.toFixed(2)}, ${cell.lon.toFixed(2)}`,
      kind: 'cell',
      lat: cell.lat,
      lon: cell.lon,
      cpm: cell.meanCpm,
      maxCpm: cell.maxCpm,
      band: radiationBand(cell.meanCpm).id,
      count: cell.count,
      capturedMs: cell.latestMs,
    });
  return rows;
}
