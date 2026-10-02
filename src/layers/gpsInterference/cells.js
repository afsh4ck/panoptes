/**
 * GPS interference cells from ADS-B navigation integrity. Pure — no Cesium,
 * no DOM — shared by the server aggregator and the browser layer.
 *
 * ADS-B position reports carry NIC (Navigation Integrity Category) and NACp
 * (Navigation Accuracy Category, position). Aircraft flying through GNSS
 * jamming or spoofing report low values, so the share of low-integrity
 * aircraft in an area is a widely used proxy for interference (the same idea
 * as gpsjam.org). It is a proxy, not a measurement: sparse coverage and old
 * transponders also lower the numbers, so cells with few samples stay 'low'.
 */

export const INTERFERENCE_MAX_SPAN_DEG = 60;
export const INTERFERENCE_QUANTUM_DEG = 0.5;
export const INTERFERENCE_POINT_RADIUS_NM = 250;
export const INTERFERENCE_MAX_CENTERS = 9;
/** readsb semantics: NIC <= 5 is a containment radius above ~1 NM. */
export const NAV_INTEGRITY_BAD_NIC = 5;
export const NAV_INTEGRITY_BAD_NACP = 5;
export const INTERFERENCE_MIN_SAMPLE = 5;
export const INTERFERENCE_MEDIUM_RATIO = 0.1;
export const INTERFERENCE_HIGH_RATIO = 0.3;
export const INTERFERENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);

const NM_TO_KM = 1.852;
const KM_PER_DEG = 111.32;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const round4 = (value) => Math.round(value * 10_000) / 10_000;

/** True for a finite, ordered, in-range box within the span cap. */
export function validInterferenceBox(box) {
  if (!box || typeof box !== 'object') return false;
  const { south, west, north, east } = box;
  if (![south, west, north, east].every(Number.isFinite)) return false;
  if (south < -90 || north > 90 || west < -180 || east > 180) return false;
  if (!(south < north) || !(west < east)) return false;
  if (
    north - south > INTERFERENCE_MAX_SPAN_DEG ||
    east - west > INTERFERENCE_MAX_SPAN_DEG
  )
    return false;
  return true;
}

/**
 * Read a box from query parameters (URLSearchParams or a plain object).
 * @returns {{south: number, west: number, north: number, east: number}|null}
 */
export function parseInterferenceBox(params) {
  const read = (key) => {
    const raw =
      typeof params?.get === 'function' ? params.get(key) : params?.[key];
    if (raw === null || raw === undefined || String(raw).trim() === '')
      return null;
    return finite(raw);
  };
  const box = {
    south: read('south'),
    west: read('west'),
    north: read('north'),
    east: read('east'),
  };
  return validInterferenceBox(box) ? box : null;
}

/**
 * Snap a box outward to the cache quantum so nearby viewports share one
 * upstream answer; the span cap is re-applied after snapping.
 */
export function quantizeInterferenceBox(box, step = INTERFERENCE_QUANTUM_DEG) {
  const south = Math.max(-90, Math.floor(box.south / step) * step);
  const west = Math.max(-180, Math.floor(box.west / step) * step);
  let north = Math.min(90, Math.ceil(box.north / step) * step);
  let east = Math.min(180, Math.ceil(box.east / step) * step);
  if (north - south > INTERFERENCE_MAX_SPAN_DEG)
    north = south + INTERFERENCE_MAX_SPAN_DEG;
  if (east - west > INTERFERENCE_MAX_SPAN_DEG)
    east = west + INTERFERENCE_MAX_SPAN_DEG;
  if (!(north > south)) north = Math.min(90, south + step);
  if (!(east > west)) east = Math.min(180, west + step);
  return {
    south: round4(south),
    west: round4(west),
    north: round4(north),
    east: round4(east),
  };
}

/** Half-degree cells for a city-scale box, whole degrees otherwise. */
export function interferenceCellSize(box) {
  return box.north - box.south < 10 && box.east - box.west < 10 ? 0.5 : 1;
}

/**
 * Point-query centers covering a box with at most `maxCenters` circles.
 * Each 250 NM circle fully covers its inscribed square (side r·√2), so the
 * centers form a grid of that spacing; when the box needs more circles than
 * the budget allows the grid is thinned and the result flagged `partial`.
 * @returns {{centers: Array<{lat: number, lon: number, radiusNm: number}>, partial: boolean, needed: number}}
 */
export function tileInterferenceCenters(
  box,
  {
    maxCenters = INTERFERENCE_MAX_CENTERS,
    radiusNm = INTERFERENCE_POINT_RADIUS_NM,
  } = {},
) {
  const side = radiusNm * NM_TO_KM * Math.SQRT2;
  const spacingLat = side / KM_PER_DEG;
  const midLat = (box.south + box.north) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spacingLon = spacingLat / cosLat;
  const spanLat = box.north - box.south;
  const spanLon = box.east - box.west;
  let rows = Math.max(1, Math.ceil(spanLat / spacingLat));
  let cols = Math.max(1, Math.ceil(spanLon / spacingLon));
  const needed = rows * cols;
  const budget = Math.max(1, Math.floor(maxCenters));
  while (rows * cols > budget) {
    if (cols >= rows && cols > 1) cols -= 1;
    else if (rows > 1) rows -= 1;
    else break;
  }
  const centers = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      centers.push({
        lat: round4(box.south + ((i + 0.5) * spanLat) / rows),
        lon: round4(box.west + ((j + 0.5) * spanLon) / cols),
        radiusNm,
      });
    }
  }
  return { centers, partial: needed > rows * cols, needed };
}

/**
 * 'bad' when the reported integrity or accuracy category is low, 'good'
 * otherwise, null when the aircraft cannot vote (on ground, no categories).
 */
export function classifyNavIntegrity(aircraft) {
  if (!aircraft || aircraft.alt_baro === 'ground') return null;
  const nic = finite(aircraft.nic);
  const nacp = finite(aircraft.nac_p);
  if (nic === null && nacp === null) return null;
  return (nic !== null && nic <= NAV_INTEGRITY_BAD_NIC) ||
    (nacp !== null && nacp <= NAV_INTEGRITY_BAD_NACP)
    ? 'bad'
    : 'good';
}

/** Level from sample size and low-integrity share; thin samples stay low. */
export function interferenceLevel(total, bad) {
  if (!(total >= INTERFERENCE_MIN_SAMPLE) || !(bad >= 0)) return 'low';
  const ratio = bad / total;
  if (ratio >= INTERFERENCE_HIGH_RATIO) return 'high';
  if (ratio >= INTERFERENCE_MEDIUM_RATIO) return 'medium';
  return 'low';
}

/** Stable cell identity: south-west corner and size. */
export function interferenceCellKey(cell) {
  return `${cell.size}:${cell.lat}:${cell.lon}`;
}

/**
 * Aggregate readsb aircraft lists (point queries + the military feed) into
 * grid cells clipped to the box. Aircraft are deduplicated by hex across
 * lists, keeping the freshest position.
 * @param {Array<Array<object>>} lists Aircraft arrays.
 * @param {object} box Query box (degrees).
 * @param {number} size Cell size in degrees.
 * @returns {{cells: object[], aircraftSampled: number}}
 */
export function aggregateInterferenceCells(lists, box, size) {
  const byHex = new Map();
  for (const list of Array.isArray(lists) ? lists : []) {
    if (!Array.isArray(list)) continue;
    for (const aircraft of list) {
      const hex = String(aircraft?.hex || '')
        .trim()
        .toLowerCase();
      if (!hex) continue;
      const lat = finite(aircraft?.lat);
      const lon = finite(aircraft?.lon);
      if (lat === null || lon === null) continue;
      const previous = byHex.get(hex);
      const age = finite(aircraft.seen_pos) ?? finite(aircraft.seen) ?? 1e9;
      const previousAge =
        previous === undefined
          ? Infinity
          : (finite(previous.seen_pos) ?? finite(previous.seen) ?? 1e9);
      if (!previous || age < previousAge) byHex.set(hex, aircraft);
    }
  }
  const cells = new Map();
  let aircraftSampled = 0;
  for (const aircraft of byHex.values()) {
    const verdict = classifyNavIntegrity(aircraft);
    if (!verdict) continue;
    const lat = Number(aircraft.lat);
    const lon = Number(aircraft.lon);
    const south = round4(Math.floor(lat / size) * size);
    const west = round4(Math.floor(lon / size) * size);
    if (
      south + size <= box.south ||
      south >= box.north ||
      west + size <= box.west ||
      west >= box.east
    )
      continue;
    aircraftSampled += 1;
    const key = `${south}:${west}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { lat: south, lon: west, size, total: 0, bad: 0 };
      cells.set(key, cell);
    }
    cell.total += 1;
    if (verdict === 'bad') cell.bad += 1;
  }
  const rows = [...cells.values()]
    .map((cell) => ({
      ...cell,
      ratio: cell.total ? Math.round((cell.bad / cell.total) * 1000) / 1000 : 0,
      level: interferenceLevel(cell.total, cell.bad),
    }))
    .sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  return { cells: rows, aircraftSampled };
}

/**
 * Validate a proxy snapshot before it replaces displayed cells. Levels are
 * recomputed from the counts so a stale or foreign body cannot paint red.
 * @returns {{cells: object[], fetchedAt: number|null, partial: boolean, aircraftSampled: number, box: object|null, cellSize: number|null}|null}
 */
export function normalizeInterferenceSnapshot(payload) {
  if (!Array.isArray(payload?.cells)) return null;
  const cells = [];
  const seen = new Set();
  for (const raw of payload.cells) {
    const lat = finite(raw?.lat);
    const lon = finite(raw?.lon);
    const size = finite(raw?.size);
    const total = finite(raw?.total);
    const bad = finite(raw?.bad);
    if (
      lat === null ||
      lon === null ||
      ![0.5, 1].includes(size) ||
      total === null ||
      bad === null ||
      !Number.isInteger(total) ||
      !Number.isInteger(bad) ||
      total < 0 ||
      bad < 0 ||
      bad > total ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return null;
    const cell = { lat, lon, size, total, bad };
    const key = interferenceCellKey(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({
      ...cell,
      ratio: total ? Math.round((bad / total) * 1000) / 1000 : 0,
      level: interferenceLevel(total, bad),
    });
  }
  const box = validInterferenceBox(payload.box) ? { ...payload.box } : null;
  return {
    cells,
    fetchedAt: finite(payload.fetchedAt),
    partial: payload.partial === true,
    stale: payload.stale === true,
    aircraftSampled: Math.max(0, finite(payload.aircraftSampled) ?? 0),
    box,
    cellSize: [0.5, 1].includes(payload.cellSize) ? payload.cellSize : null,
  };
}

/** 1 − IoU of two boxes: 0 for identical views, 1 for disjoint ones. */
export function boxChangeFraction(a, b) {
  if (!validInterferenceBox(a) || !validInterferenceBox(b)) return 1;
  const areaOf = (box) => (box.north - box.south) * (box.east - box.west);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  if (!(north > south) || !(east > west)) return 1;
  const intersection = (north - south) * (east - west);
  const union = areaOf(a) + areaOf(b) - intersection;
  return union > 0 ? Math.max(0, Math.min(1, 1 - intersection / union)) : 1;
}

/** Chip phrasing: degraded cell count, or nominal coverage when none. */
export function interferenceCountLabel(cells) {
  if (!Array.isArray(cells) || !cells.length) return '';
  const degraded = cells.filter((cell) => cell.level !== 'low').length;
  if (!degraded) return `${cells.length} cells nominal`;
  return degraded === 1 ? '1 cell degraded' : `${degraded} cells degraded`;
}
