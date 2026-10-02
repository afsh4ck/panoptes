/**
 * Disaster alert records (GDACS + NASA EONET). Pure — no Cesium, no DOM.
 */

export const DISASTER_LEVELS = Object.freeze([
  Object.freeze({
    id: 'red',
    label: 'Red alert',
    color: '#ff1744',
    radiusM: 150_000,
  }),
  Object.freeze({
    id: 'orange',
    label: 'Orange alert',
    color: '#ff9100',
    radiusM: 100_000,
  }),
  Object.freeze({
    id: 'green',
    label: 'Green alert',
    color: '#00e676',
    radiusM: 60_000,
  }),
  Object.freeze({
    id: 'info',
    label: 'EONET event',
    color: '#40c4ff',
    radiusM: 40_000,
  }),
]);
const LEVEL_BY_ID = new Map(DISASTER_LEVELS.map((level) => [level.id, level]));
const LEVEL_RANK = Object.freeze({ red: 0, orange: 1, green: 2, info: 3 });

export const DISASTER_MIN_LEVELS = Object.freeze(['all', 'orange', 'red']);
export const DISASTER_DEFAULT_MIN_LEVEL = 'all';

export const DISASTER_TYPE_LABELS = Object.freeze({
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
  TS: 'Tsunami',
  storm: 'Severe storm',
  volcano: 'Volcano',
  wildfire: 'Wildfire',
  flood: 'Flood',
  landslide: 'Landslide',
  other: 'Natural event',
});
export const DISASTER_SOURCES = Object.freeze(['GDACS', 'EONET']);

/** Legend color for a level. */
export function disasterLevelColor(level) {
  return (LEVEL_BY_ID.get(level) || LEVEL_BY_ID.get('info')).color;
}

/** Ground disc radius for a level in meters. */
export function disasterLevelRadius(level) {
  return (LEVEL_BY_ID.get(level) || LEVEL_BY_ID.get('info')).radiusM;
}

/** Human label for a type code. */
export function disasterTypeLabel(type) {
  return DISASTER_TYPE_LABELS[type] || DISASTER_TYPE_LABELS.other;
}

/** True when a level passes the minimum-level filter. */
export function disasterPassesFilter(level, minLevel) {
  if (minLevel === 'red') return level === 'red';
  if (minLevel === 'orange') return level === 'red' || level === 'orange';
  return true;
}

function validCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180
  );
}

const text = (value, max = 240) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const numberOrNull = (value) =>
  value === null || value === undefined || value === ''
    ? null
    : finiteOrNull(Number(value));
const timeOrNull = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
};

/** Normalize one proxy row; null when it cannot be placed or identified. */
export function normalizeDisasterRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!validCoordinate(lat, lon)) return null;
  const id = text(raw.id, 120);
  if (!id) return null;
  const level = LEVEL_BY_ID.has(raw.level) ? raw.level : 'info';
  const type = DISASTER_TYPE_LABELS[raw.type] ? raw.type : 'other';
  const link = text(raw.link, 512);
  return {
    id,
    lat,
    lon,
    source: DISASTER_SOURCES.includes(raw.source) ? raw.source : 'GDACS',
    type,
    level,
    title: text(raw.title, 200) || disasterTypeLabel(type),
    description: text(raw.description, 400),
    score: numberOrNull(raw.score) ?? 0,
    severityText: text(raw.severity?.text, 120),
    severityValue: numberOrNull(raw.severity?.value),
    severityUnit: text(raw.severity?.unit, 24),
    populationText: text(raw.population?.text, 120),
    populationValue: numberOrNull(raw.population?.value),
    country: text(raw.country, 80),
    iso3: text(raw.iso3, 3),
    link: /^https?:\/\//i.test(link) ? link : '',
    fromMs: timeOrNull(raw.from),
    toMs: timeOrNull(raw.to),
    updatedMs: timeOrNull(raw.updated),
    bbox:
      Array.isArray(raw.bbox) &&
      raw.bbox.length === 4 &&
      raw.bbox.every(Number.isFinite)
        ? raw.bbox.slice()
        : null,
  };
}

/** Validate a proxy payload; malformed rows drop, a missing row array rejects. */
export function normalizeDisasterSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows))
    return null;
  const rows = [];
  const ids = new Set();
  for (const raw of payload.rows) {
    const row = normalizeDisasterRow(raw);
    if (!row || ids.has(row.id)) continue;
    ids.add(row.id);
    rows.push(row);
  }
  rows.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      b.score - a.score ||
      a.id.localeCompare(b.id),
  );
  const counts = {};
  for (const source of DISASTER_SOURCES)
    counts[source] = Math.max(
      0,
      Math.round(Number(payload.counts?.[source]) || 0),
    );
  return {
    rows,
    counts,
    degraded: text(payload.degraded, 200) || null,
    stale: payload.stale === true,
    fetchedAt: finiteOrNull(Number(payload.fetchedAt)),
  };
}

/** Rank for cohort selection: red first, then score, then recency. */
export function disasterPriority(row) {
  const levelScore = (3 - LEVEL_RANK[row.level]) * 1_000_000;
  const updated = Number.isFinite(row.updatedMs)
    ? Math.floor(row.updatedMs / 60_000) % 100_000
    : 0;
  return levelScore + Math.round(row.score * 1000) + updated;
}

function formatAge(nowMs, timeMs) {
  const delta = nowMs - timeMs;
  if (!Number.isFinite(delta) || delta < 0) return null;
  const hours = Math.floor(delta / 3600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Card copy for one row. */
export function disasterCardModel(row, nowMs = Date.now()) {
  const typeLabel = disasterTypeLabel(row.type);
  const title =
    row.source === 'EONET'
      ? `${typeLabel} · ${row.title}`
      : `${typeLabel}${row.country ? ` · ${row.country}` : ''}`;
  const status = [
    row.level === 'info' ? 'NASA EONET' : `${row.level.toUpperCase()} alert`,
    row.severityText || null,
  ]
    .filter(Boolean)
    .join(' · ');
  const details = [status];
  if (row.populationText) details.push(row.populationText);
  if (row.source === 'GDACS' && row.title && row.title !== title)
    details.push(row.title);
  const age = Number.isFinite(row.updatedMs)
    ? formatAge(nowMs, row.updatedMs)
    : null;
  if (age) details.push(`${row.source} · updated ${age} ago`);
  else details.push(row.source);
  return {
    title: title.length > 60 ? `${title.slice(0, 57)}…` : title,
    details: details.map((line) =>
      line.length > 96 ? `${line.slice(0, 93)}…` : line,
    ),
  };
}

/** Analyst-engine record (flat, JSON-safe). */
export function mapDisasterAnalystRecord(row) {
  return {
    id: row.id,
    name: row.title,
    type: row.type,
    typeLabel: disasterTypeLabel(row.type),
    level: row.level,
    source: row.source,
    lat: row.lat,
    lon: row.lon,
    country: row.country || null,
    severity: row.severityText || null,
    population: row.populationText || null,
    updatedMs: row.updatedMs,
    link: row.link || null,
  };
}
