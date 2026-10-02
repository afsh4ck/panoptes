import { readResponseJsonCapped } from '../common/http.js';
import { validCoordinate } from './cachedRoute.js';

/**
 * UCDP Georeferenced Event Dataset (Uppsala). Bring-your-own token: the API
 * requires `x-ucdp-access-token`. Rows are researcher-coded, so they carry
 * fatality estimates GDELT never has.
 */
export const UCDP_API_BASE = 'https://ucdpapi.pcr.uu.se/api/gedevents/';
export const UCDP_DEFAULT_VERSION = '25.1';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

const TYPE_TO_KIND = Object.freeze({
  1: 'battle',
  2: 'battle',
  3: 'violence_against_civilians',
});

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Normalize one UCDP GED result into the shared conflict row shape. */
export function normalizeUcdpEvent(event) {
  const lat = Number(event?.latitude);
  const lon = Number(event?.longitude);
  if (!validCoordinate(lat, lon)) return null;
  const id = String(event?.id ?? '').trim();
  if (!id) return null;
  const kind = TYPE_TO_KIND[Number(event?.type_of_violence)] || 'other';
  const sideA = String(event?.side_a || '').trim();
  const sideB = String(event?.side_b || '').trim();
  const where = String(event?.where_description || event?.adm_1 || '').trim();
  const country = String(event?.country || '').trim();
  const best = Number(event?.best);
  const dateStart = String(event?.date_start || '').trim();
  const time = Number.isFinite(Date.parse(dateStart))
    ? new Date(Date.parse(dateStart)).toISOString()
    : null;
  if (!time) return null;
  return {
    id: `ucdp:${id}`,
    lat,
    lon,
    time,
    source: 'UCDP',
    kind,
    title: `${kind === 'battle' ? 'Battle' : 'Violence against civilians'} · ${
      where || country || 'unlocated'
    }`,
    actors: [sideA, sideB].filter(Boolean).join(' vs '),
    country,
    url: String(event?.source_office || '').startsWith('http')
      ? String(event.source_office)
      : '',
    goldstein: null,
    mentions: null,
    fatalities: Number.isFinite(best) ? Math.max(0, Math.round(best)) : null,
  };
}

/**
 * Fetch UCDP events since `sinceMs`. Returns [] without a token.
 * @param {object} options
 * @param {Function} options.fetchImpl
 * @param {string} [options.token]
 * @param {string} [options.version]
 * @param {number} options.sinceMs
 */
export async function fetchUcdpRows({
  fetchImpl,
  token,
  version = UCDP_DEFAULT_VERSION,
  sinceMs,
}) {
  if (!token) return [];
  const safeVersion = /^[0-9.]{1,12}$/.test(String(version))
    ? String(version)
    : UCDP_DEFAULT_VERSION;
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${UCDP_API_BASE}${safeVersion}?pagesize=${PAGE_SIZE}&page=${page}` +
      `&StartDate=${isoDay(sinceMs)}`;
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, {
      signal,
      headers: { 'x-ucdp-access-token': token, Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`UCDP HTTP ${response.status}`);
    }
    const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
    const results = Array.isArray(payload?.Result) ? payload.Result : [];
    for (const event of results) {
      const row = normalizeUcdpEvent(event);
      if (row) rows.push(row);
    }
    const totalPages = Number(payload?.TotalPages);
    if (
      !results.length ||
      !Number.isFinite(totalPages) ||
      page + 1 >= totalPages
    )
      break;
  }
  return rows;
}
