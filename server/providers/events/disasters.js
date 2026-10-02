import { createCachedJsonRoute, withUserAgent } from './cachedRoute.js';
import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from '../common/http.js';
import { GDACS_RSS_URL, parseGdacsRss } from './gdacs.js';
import { EONET_GEOJSON_URL, normalizeEonetGeojson } from './eonet.js';

const MIB = 1024 * 1024;
export const DISASTER_ROW_CAP = 2000;

/**
 * `GET /api/disasters` — GDACS alerts merged with NASA EONET open events.
 * Either upstream may fail independently; the payload names the gap.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @returns {import('vite').Plugin}
 */
export function disastersProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  fetchImpl = withUserAgent(fetchImpl);
  async function gdacs() {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(GDACS_RSS_URL, {
      signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GDACS HTTP ${response.status}`);
    }
    return parseGdacsRss(
      await readResponseTextCapped(response, 8 * MIB, signal),
    );
  }

  async function eonet() {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(EONET_GEOJSON_URL, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`EONET HTTP ${response.status}`);
    }
    return normalizeEonetGeojson(
      await readResponseJsonCapped(response, 16 * MIB, signal),
    );
  }

  async function load() {
    const [gdacsResult, eonetResult] = await Promise.allSettled([
      gdacs(),
      eonet(),
    ]);
    const degraded = [];
    const gdacsRows =
      gdacsResult.status === 'fulfilled' ? gdacsResult.value : [];
    const eonetRows =
      eonetResult.status === 'fulfilled' ? eonetResult.value : [];
    if (gdacsResult.status === 'rejected') degraded.push('GDACS unavailable');
    if (eonetResult.status === 'rejected') degraded.push('EONET unavailable');
    if (gdacsResult.status === 'rejected' && eonetResult.status === 'rejected')
      throw new Error('disasters upstreams unavailable');
    const order = { red: 0, orange: 1, green: 2, info: 3 };
    const rows = [...gdacsRows, ...eonetRows]
      .sort(
        (a, b) =>
          order[a.level] - order[b.level] ||
          (b.score || 0) - (a.score || 0) ||
          String(a.id).localeCompare(b.id),
      )
      .slice(0, DISASTER_ROW_CAP);
    return {
      rows,
      fetchedAt: now(),
      sources: ['GDACS', 'EONET'],
      counts: { GDACS: gdacsRows.length, EONET: eonetRows.length },
      degraded: degraded.length ? degraded.join(' · ') : null,
    };
  }

  return createCachedJsonRoute({
    name: 'disasters',
    headerName: 'Disasters',
    route: '/api/disasters',
    ttlMs: 10 * 60_000,
    load,
    now,
    maxPerMinute: 60,
    globalMax: 600,
    maxEntries: 1,
  });
}
