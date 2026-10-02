import {
  createCachedJsonRoute,
  pickAllowedInteger,
  withUserAgent,
} from './cachedRoute.js';
import { createGdeltStore, GDELT_MAX_WINDOW_HOURS } from './gdelt.js';
import { fetchUcdpRows } from './ucdp.js';
import { fetchAcledRows, acledCredentials } from './acled.js';

export const CONFLICT_WINDOW_HOURS = Object.freeze([6, 24, 72]);
/** Row ceilings per window so a 72 h globe never ships tens of thousands of entities. */
export const CONFLICT_ROW_CAPS = Object.freeze({ 6: 1500, 24: 3000, 72: 4000 });
const BYOK_TTL_MS = 6 * 3600_000;

/** Sort rows so the most-reported / deadliest survive a cap. */
export function rankConflictRows(rows) {
  const weight = (row) =>
    (Number.isFinite(row.fatalities) ? row.fatalities * 50 : 0) +
    (Number.isFinite(row.mentions) ? row.mentions : 0) +
    (row.source === 'GDELT' ? 0 : 100);
  return rows
    .slice()
    .sort((a, b) => weight(b) - weight(a) || String(a.id).localeCompare(b.id));
}

/**
 * `GET /api/conflicts?hours=6|24|72` — GDELT (keyless) merged with the
 * optional UCDP and ACLED feeds.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {object} [options.env]
 * @param {object} [options.store] GDELT store seam.
 * @returns {import('vite').Plugin}
 */
export function conflictsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
  store = createGdeltStore({ fetchImpl, now }),
} = {}) {
  fetchImpl = withUserAgent(fetchImpl);
  const byok = new Map();

  async function cachedByok(name, loader) {
    const previous = byok.get(name);
    if (previous && now() - previous.at < BYOK_TTL_MS) return previous;
    try {
      const rows = await loader();
      const entry = { at: now(), rows, error: null };
      byok.set(name, entry);
      return entry;
    } catch (error) {
      const entry = {
        at: previous?.at ?? now(),
        rows: previous?.rows ?? [],
        error: `${name} unavailable`,
      };
      // Retry a failed BYOK source after ten minutes rather than every request.
      byok.set(name, { ...entry, at: now() - BYOK_TTL_MS + 10 * 60_000 });
      return entry;
    }
  }

  async function load({ hours }) {
    const windowHours = Math.min(GDELT_MAX_WINDOW_HOURS, hours);
    const sinceMs = now() - windowHours * 3600_000;
    const degraded = [];
    let gdelt = { rows: [], loadedSlots: 0, expectedSlots: 0, latestKey: null };
    try {
      await store.ensure({ hours: windowHours });
      gdelt = store.rows({ hours: windowHours });
      if (gdelt.loadedSlots === 0) degraded.push('GDELT unavailable');
    } catch (error) {
      degraded.push('GDELT unavailable');
    }
    const token = String(env.UCDP_ACCESS_TOKEN || '').trim();
    const ucdp = token
      ? await cachedByok('UCDP', () =>
          fetchUcdpRows({
            fetchImpl,
            token,
            version: env.UCDP_DATASET_VERSION,
            sinceMs: now() - 30 * 86_400_000,
          }),
        )
      : { rows: [], error: null };
    const acled = acledCredentials(env)
      ? await cachedByok('ACLED', () =>
          fetchAcledRows({ fetchImpl, env, sinceMs: now() - 30 * 86_400_000 }),
        )
      : { rows: [], error: null };
    if (ucdp.error) degraded.push(ucdp.error);
    if (acled.error) degraded.push(acled.error);
    const inWindow = (row) => Date.parse(row.time) >= sinceMs;
    const merged = [
      ...gdelt.rows,
      ...ucdp.rows.filter(inWindow),
      ...acled.rows.filter(inWindow),
    ];
    const cap = CONFLICT_ROW_CAPS[hours] || CONFLICT_ROW_CAPS[24];
    const ranked = rankConflictRows(merged);
    const rows = ranked.slice(0, cap);
    const counts = { GDELT: 0, UCDP: 0, ACLED: 0 };
    for (const row of merged)
      counts[row.source] = (counts[row.source] || 0) + 1;
    const sources = ['GDELT'];
    if (token) sources.push('UCDP');
    if (acledCredentials(env)) sources.push('ACLED');
    return {
      rows,
      fetchedAt: now(),
      hours,
      sources,
      counts,
      total: merged.length,
      truncated: merged.length > rows.length,
      coverage: {
        loadedSlots: gdelt.loadedSlots,
        expectedSlots: gdelt.expectedSlots,
        latestSlot: gdelt.latestKey,
      },
      degraded: degraded.length ? degraded.join(' · ') : null,
    };
  }

  return createCachedJsonRoute({
    name: 'conflicts',
    headerName: 'Conflicts',
    route: '/api/conflicts',
    ttlMs: 5 * 60_000,
    load,
    now,
    parseQuery: (search) => ({
      hours: pickAllowedInteger(
        search,
        'hours',
        [...CONFLICT_WINDOW_HOURS],
        24,
      ),
    }),
    keyOf: ({ hours }) => `hours:${hours}`,
    maxPerMinute: 60,
    globalMax: 600,
    maxEntries: 4,
  });
}
