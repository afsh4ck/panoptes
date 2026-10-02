import {
  createCachedJsonRoute,
  pickAllowedInteger,
  withUserAgent,
} from './cachedRoute.js';
import { readResponseJsonCapped } from '../common/http.js';
import {
  SAFECAST_DEVICES_URL,
  SAFECAST_MEASUREMENTS_URL,
  aggregateSafecastMeasurements,
  normalizeSafecastDevices,
} from './safecast.js';

const MIB = 1024 * 1024;
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
export const RADIATION_DAY_WINDOWS = Object.freeze([1, 3, 7, 14, 30]);

/**
 * `GET /api/radiation?days=7` — Safecast CPM measurements aggregated into
 * cells plus realtime devices.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @returns {import('vite').Plugin}
 */
export function radiationProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  fetchImpl = withUserAgent(fetchImpl);
  async function measurements(days) {
    const since = new Date(now() - days * 86_400_000).toISOString();
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        captured_after: since,
        per_page: String(PAGE_SIZE),
        page: String(page),
        unit: 'cpm',
      });
      const signal = AbortSignal.timeout(20_000);
      const response = await fetchImpl(
        `${SAFECAST_MEASUREMENTS_URL}?${params}`,
        {
          signal,
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Safecast HTTP ${response.status}`);
      }
      const payload = await readResponseJsonCapped(response, 8 * MIB, signal);
      if (!Array.isArray(payload)) throw new Error('Safecast payload invalid');
      all.push(...payload);
      if (payload.length < PAGE_SIZE) break;
    }
    return all;
  }

  async function devices() {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(SAFECAST_DEVICES_URL, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Safecast devices HTTP ${response.status}`);
    }
    return normalizeSafecastDevices(
      await readResponseJsonCapped(response, 8 * MIB, signal),
      { nowMs: now() },
    );
  }

  async function load({ days }) {
    const [measured, realtime] = await Promise.allSettled([
      measurements(days),
      devices(),
    ]);
    const degraded = [];
    const raw = measured.status === 'fulfilled' ? measured.value : [];
    const deviceRows = realtime.status === 'fulfilled' ? realtime.value : [];
    if (measured.status === 'rejected')
      degraded.push('Safecast measurements unavailable');
    if (realtime.status === 'rejected')
      degraded.push('Safecast devices unavailable');
    if (measured.status === 'rejected' && realtime.status === 'rejected')
      throw new Error('safecast upstreams unavailable');
    const cells = aggregateSafecastMeasurements(raw);
    return {
      cells,
      devices: deviceRows,
      fetchedAt: now(),
      days,
      counts: {
        measurements: raw.length,
        cells: cells.length,
        devices: deviceRows.length,
      },
      degraded: degraded.length ? degraded.join(' · ') : null,
    };
  }

  return createCachedJsonRoute({
    name: 'radiation',
    headerName: 'Radiation',
    route: '/api/radiation',
    ttlMs: 30 * 60_000,
    load,
    now,
    parseQuery: (search) => ({
      days: pickAllowedInteger(search, 'days', [...RADIATION_DAY_WINDOWS], 7),
    }),
    keyOf: ({ days }) => `days:${days}`,
    maxPerMinute: 30,
    globalMax: 300,
    maxEntries: 5,
  });
}
