/**
 * Conflict event records. Pure — no Cesium, no DOM. The rows come from the
 * same-origin `/api/conflicts` proxy, which merges GDELT (machine-coded news
 * mentions) with the optional researcher-coded UCDP and ACLED feeds.
 */

export const CONFLICT_WINDOWS = Object.freeze([6, 24, 72]);
export const CONFLICT_DEFAULT_HOURS = 24;
export const CONFLICT_SOURCES = Object.freeze(['GDELT', 'UCDP', 'ACLED']);

/** Kind vocabulary shared with the proxy; order doubles as legend order. */
export const CONFLICT_KINDS = Object.freeze([
  Object.freeze({ id: 'battle', label: 'Battle', color: '#b71c1c' }),
  Object.freeze({ id: 'fight', label: 'Armed clash', color: '#d50000' }),
  Object.freeze({
    id: 'explosion',
    label: 'Bombing / remote violence',
    color: '#ff5252',
  }),
  Object.freeze({
    id: 'violence_against_civilians',
    label: 'Violence against civilians',
    color: '#ff1744',
  }),
  Object.freeze({
    id: 'mass_violence',
    label: 'Mass violence',
    color: '#8e0000',
  }),
  Object.freeze({ id: 'assault', label: 'Assault', color: '#ff3b30' }),
  Object.freeze({ id: 'riot', label: 'Riot', color: '#ff8f00' }),
  Object.freeze({ id: 'protest', label: 'Protest', color: '#ffb300' }),
  Object.freeze({ id: 'other', label: 'Coercion / other', color: '#9e9e9e' }),
]);
const KIND_BY_ID = new Map(CONFLICT_KINDS.map((kind) => [kind.id, kind]));

/** Legend/accent color for a kind (grey for anything unknown). */
export function conflictKindColor(kind) {
  return (KIND_BY_ID.get(kind) || KIND_BY_ID.get('other')).color;
}

/** Human label for a kind. */
export function conflictKindLabel(kind) {
  return (KIND_BY_ID.get(kind) || KIND_BY_ID.get('other')).label;
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
/** Nullable numeric field: null/''/undefined stay null (Number(null) is 0). */
const numberOrNull = (value) =>
  value === null || value === undefined || value === ''
    ? null
    : finiteOrNull(Number(value));

/** Normalize one proxy row; null when it cannot be placed or identified. */
export function normalizeConflictRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!validCoordinate(lat, lon)) return null;
  const id = text(raw.id, 120);
  if (!id) return null;
  const timeMs = Date.parse(String(raw.time || ''));
  if (!Number.isFinite(timeMs)) return null;
  const source = CONFLICT_SOURCES.includes(raw.source) ? raw.source : 'GDELT';
  const kind = KIND_BY_ID.has(raw.kind) ? raw.kind : 'other';
  const url = text(raw.url, 512);
  return {
    id,
    lat,
    lon,
    timeMs,
    source,
    kind,
    title: text(raw.title, 160) || conflictKindLabel(kind),
    actors: text(raw.actors, 160),
    country: text(raw.country, 64),
    url: /^https?:\/\//i.test(url) ? url : '',
    goldstein: numberOrNull(raw.goldstein),
    mentions: numberOrNull(raw.mentions),
    fatalities: numberOrNull(raw.fatalities),
    events: Math.max(1, Math.round(numberOrNull(raw.events) ?? 1)),
  };
}

/**
 * Validate a proxy payload. Individually malformed rows are dropped; a payload
 * without a row array rejects entirely so a broken feed never blanks a good
 * display silently.
 * @returns {{rows: object[], hours: number, sources: string[], counts: object,
 *   total: number, truncated: boolean, degraded: string|null, stale: boolean,
 *   fetchedAt: number|null, coverage: object|null}|null}
 */
export function normalizeConflictSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows))
    return null;
  const rows = [];
  const ids = new Set();
  for (const raw of payload.rows) {
    const row = normalizeConflictRow(raw);
    if (!row || ids.has(row.id)) continue;
    ids.add(row.id);
    rows.push(row);
  }
  const hours = CONFLICT_WINDOWS.includes(Number(payload.hours))
    ? Number(payload.hours)
    : CONFLICT_DEFAULT_HOURS;
  const counts = {};
  for (const source of CONFLICT_SOURCES)
    counts[source] = Math.max(
      0,
      Math.round(Number(payload.counts?.[source]) || 0),
    );
  return {
    rows,
    hours,
    sources: Array.isArray(payload.sources)
      ? payload.sources.filter((entry) => CONFLICT_SOURCES.includes(entry))
      : ['GDELT'],
    counts,
    total: Math.max(rows.length, Math.round(Number(payload.total) || 0)),
    truncated: payload.truncated === true,
    degraded: text(payload.degraded, 200) || null,
    stale: payload.stale === true,
    fetchedAt: finiteOrNull(Number(payload.fetchedAt)),
    coverage:
      payload.coverage && typeof payload.coverage === 'object'
        ? {
            loadedSlots: Math.max(
              0,
              Math.round(Number(payload.coverage.loadedSlots) || 0),
            ),
            expectedSlots: Math.max(
              0,
              Math.round(Number(payload.coverage.expectedSlots) || 0),
            ),
          }
        : null,
  };
}

/** Importance used for sizing, cohort selection and analyst ranking. */
export function conflictWeight(row) {
  const fatalities = Number.isFinite(row?.fatalities) ? row.fatalities : 0;
  const mentions = Number.isFinite(row?.mentions) ? row.mentions : 0;
  return fatalities * 50 + mentions + (row?.source === 'GDELT' ? 0 : 100);
}

/** Ground disc radius in meters: 6 km floor, 60 km ceiling. */
export function conflictRadiusMeters(row) {
  const fatalities = Number.isFinite(row?.fatalities) ? row.fatalities : 0;
  const mentions = Number.isFinite(row?.mentions) ? row.mentions : 0;
  const scale =
    fatalities > 0
      ? 8000 + Math.sqrt(fatalities) * 6000
      : 6000 + Math.log2(1 + mentions) * 4000;
  return Math.max(6000, Math.min(60_000, scale));
}

/** Compact relative age: 4m, 3h, 2d. */
export function formatConflictAge(nowMs, timeMs) {
  const delta = nowMs - timeMs;
  if (!Number.isFinite(delta) || delta < 0) return 'now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Card copy for one row (title + detail lines), JSON-safe. */
export function conflictCardModel(row, nowMs = Date.now()) {
  const facts = [`${row.source} · ${conflictKindLabel(row.kind)}`];
  const evidence = [];
  if (Number.isFinite(row.fatalities))
    evidence.push(
      `${row.fatalities} reported ${row.fatalities === 1 ? 'fatality' : 'fatalities'}`,
    );
  if (Number.isFinite(row.mentions))
    evidence.push(
      `${row.mentions} media mention${row.mentions === 1 ? '' : 's'}`,
    );
  if (row.events > 1) evidence.push(`${row.events} codings`);
  const details = [facts.join(' ')];
  if (row.actors) details.push(row.actors);
  details.push(
    [evidence.join(' · '), `${formatConflictAge(nowMs, row.timeMs)} ago`]
      .filter(Boolean)
      .join(' · '),
  );
  if (row.source === 'GDELT')
    details.push('Machine-coded news, not a verified incident');
  return {
    title: row.title.length > 60 ? `${row.title.slice(0, 57)}…` : row.title,
    details,
  };
}

/** Analyst-engine record (flat, JSON-safe). */
export function mapConflictAnalystRecord(row) {
  return {
    id: row.id,
    name: row.title,
    kind: row.kind,
    kindLabel: conflictKindLabel(row.kind),
    source: row.source,
    lat: row.lat,
    lon: row.lon,
    timeMs: row.timeMs,
    country: row.country || null,
    actors: row.actors || null,
    mentions: row.mentions,
    fatalities: row.fatalities,
    goldstein: row.goldstein,
    url: row.url || null,
  };
}
