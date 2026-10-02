import { readResponseJsonCapped } from '../common/http.js';
import { validCoordinate } from './cachedRoute.js';

/**
 * ACLED (Armed Conflict Location & Event Data). Bring-your-own credentials:
 * either the legacy access key + email pair or an OAuth password grant
 * (username + password). Best effort — any failure yields no rows and a
 * degraded note, never a crash.
 */
export const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
export const ACLED_READ_URL = 'https://acleddata.com/api/acled/read';
const MAX_BYTES = 16 * 1024 * 1024;
const LIMIT = 5000;

const EVENT_TYPE_TO_KIND = Object.freeze({
  battles: 'battle',
  'explosions/remote violence': 'explosion',
  'violence against civilians': 'violence_against_civilians',
  protests: 'protest',
  riots: 'riot',
  'strategic developments': 'other',
});

/** Resolve which credential mode the environment provides, if any. */
export function acledCredentials(env = {}) {
  const username = String(env.ACLED_USERNAME || '').trim();
  const password = String(env.ACLED_PASSWORD || '').trim();
  if (username && password) return { mode: 'oauth', username, password };
  const email = String(env.ACLED_EMAIL || '').trim();
  const key = String(env.ACLED_ACCESS_KEY || '').trim();
  if (email && key) return { mode: 'key', email, key };
  return null;
}

/** Normalize one ACLED record into the shared conflict row shape. */
export function normalizeAcledEvent(event) {
  const lat = Number(event?.latitude);
  const lon = Number(event?.longitude);
  if (!validCoordinate(lat, lon)) return null;
  const id = String(event?.event_id_cnty || '').trim();
  if (!id) return null;
  const typeKey = String(event?.event_type || '')
    .trim()
    .toLowerCase();
  const kind = EVENT_TYPE_TO_KIND[typeKey] || 'other';
  const date = Date.parse(String(event?.event_date || ''));
  if (!Number.isFinite(date)) return null;
  const location = String(event?.location || '').trim();
  const country = String(event?.country || '').trim();
  const fatalities = Number(event?.fatalities);
  const subType = String(event?.sub_event_type || '').trim();
  return {
    id: `acled:${id}`,
    lat,
    lon,
    time: new Date(date).toISOString(),
    source: 'ACLED',
    kind,
    title: `${subType || String(event?.event_type || 'Event')} · ${
      location || country || 'unlocated'
    }`,
    actors: [event?.actor1, event?.actor2]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' vs '),
    country,
    url: '',
    goldstein: null,
    mentions: null,
    fatalities: Number.isFinite(fatalities)
      ? Math.max(0, Math.round(fatalities))
      : null,
  };
}

async function oauthToken(fetchImpl, { username, password }) {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetchImpl(ACLED_TOKEN_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username,
      password,
      grant_type: 'password',
      client_id: 'acled',
    }).toString(),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ACLED token HTTP ${response.status}`);
  }
  const payload = await readResponseJsonCapped(response, 64 * 1024, signal);
  const token = String(payload?.access_token || '').trim();
  if (!token) throw new Error('ACLED token missing');
  return token;
}

/**
 * Fetch ACLED events since `sinceMs`. Returns [] without credentials.
 * @param {object} options
 * @param {Function} options.fetchImpl
 * @param {object} options.env
 * @param {number} options.sinceMs
 */
export async function fetchAcledRows({ fetchImpl, env = {}, sinceMs }) {
  const credentials = acledCredentials(env);
  if (!credentials) return [];
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    _format: 'json',
    event_date: since,
    event_date_where: '>=',
    limit: String(LIMIT),
  });
  const headers = { Accept: 'application/json' };
  if (credentials.mode === 'oauth') {
    headers.Authorization = `Bearer ${await oauthToken(fetchImpl, credentials)}`;
  } else {
    params.set('key', credentials.key);
    params.set('email', credentials.email);
  }
  const signal = AbortSignal.timeout(30_000);
  const response = await fetchImpl(`${ACLED_READ_URL}?${params}`, {
    signal,
    headers,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ACLED HTTP ${response.status}`);
  }
  const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const rows = [];
  for (const event of data) {
    const row = normalizeAcledEvent(event);
    if (row) rows.push(row);
  }
  return rows;
}
