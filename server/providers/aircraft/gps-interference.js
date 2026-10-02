import {
  aggregateInterferenceCells,
  interferenceCellSize,
  parseInterferenceBox,
  quantizeInterferenceBox,
  tileInterferenceCenters,
} from '../../../src/layers/gpsInterference/cells.js';
import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * Vite plugin: GPS-interference cell aggregator over adsb.lol.
 *
 * GET /api/gps-interference?south&west&north&east tiles the box with at most
 * nine 250 NM point queries, adds the global military feed, and aggregates the
 * NIC/NACp verdicts into grid cells (see src/layers/gpsInterference/cells.js).
 * Answers are cached per quantized box for 90 s; upstream calls share one
 * 20-per-minute budget so a panning client cannot hammer the public API.
 * Upstream failure serves the last answer for that box as STALE, else 502.
 *
 * @returns {import('vite').Plugin}
 */
export function gpsInterferenceProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const CACHE_MS = 90_000;
  const CACHE_MAX_KEYS = 64;
  const MIL_CACHE_MS = 12_000;
  const UPSTREAM_TIMEOUT_MS = 12_000;
  const MAX_FEED_BYTES = 8 * 1024 * 1024;
  const RATE_LIMIT_COOLDOWN_MS = 30_000;
  const SERVER_ERROR_COOLDOWN_MS = 15_000;
  const COOLDOWN_MAX_MS = 120_000;
  const UPSTREAM_KEY = 'adsb.lol';

  /** @type {Map<string, {body: object, at: number}>} */
  const cache = new Map();
  const inFlight = new Map();
  /** @type {{ac: object[], at: number}|null} */
  let mil = null;
  let cooldownUntil = 0;
  const allowClient = makeRateLimiter({
    windowMs: 60_000,
    max: 30,
    globalMax: 300,
  });
  const allowUpstream = makeRateLimiter({
    windowMs: 60_000,
    max: 20,
    globalMax: 20,
  });

  function startCooldown(status, retryAfter) {
    const at = now();
    let ms = status === 429 ? RATE_LIMIT_COOLDOWN_MS : SERVER_ERROR_COOLDOWN_MS;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0)
      ms = Math.min(COOLDOWN_MAX_MS, Math.max(5000, seconds * 1000));
    cooldownUntil = Math.max(cooldownUntil, at + ms);
  }

  async function fetchAircraft(url) {
    if (now() < cooldownUntil) return null;
    if (!allowUpstream(UPSTREAM_KEY)) return null;
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'gods-eye-view-adsblol-proxy/1.0' },
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel?.().catch?.(() => {});
        if (response.status === 429 || response.status >= 500)
          startCooldown(
            response.status,
            response.headers?.get?.('retry-after'),
          );
        return null;
      }
      const payload = await readResponseJsonCapped(
        response,
        MAX_FEED_BYTES,
        signal,
      );
      return Array.isArray(payload?.ac) ? payload.ac : [];
    } catch {
      return null;
    }
  }

  async function militaryAircraft() {
    const at = now();
    if (mil && at - mil.at < MIL_CACHE_MS) return mil.ac;
    const ac = await fetchAircraft('https://api.adsb.lol/v2/mil');
    if (ac) {
      mil = { ac, at: now() };
      return ac;
    }
    return mil ? mil.ac : null;
  }

  async function build(box) {
    const size = interferenceCellSize(box);
    const { centers, partial } = tileInterferenceCenters(box);
    const results = await Promise.all(
      centers.map((center) =>
        fetchAircraft(
          `https://api.adsb.lol/v2/point/${center.lat}/${center.lon}/${center.radiusNm}`,
        ),
      ),
    );
    const lists = results.filter(Array.isArray);
    // The military feed alone cannot describe a box; without any point
    // answer the caller gets the last good body (or 502), not a thin one.
    if (!lists.length) throw new Error('upstream_unavailable');
    const budgetPartial = lists.length < centers.length;
    const military = await militaryAircraft();
    if (military) lists.push(military);
    const { cells, aircraftSampled } = aggregateInterferenceCells(
      lists,
      box,
      size,
    );
    return {
      cells,
      fetchedAt: now(),
      partial: partial || budgetPartial,
      stale: false,
      aircraftSampled,
      box,
      cellSize: size,
    };
  }

  function remember(key, body) {
    cache.delete(key);
    cache.set(key, { body, at: now() });
    while (cache.size > CACHE_MAX_KEYS) cache.delete(cache.keys().next().value);
  }

  function serve(res, status, body, extra = {}) {
    if (res.destroyed) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    });
    res.end(JSON.stringify(body));
  }

  async function handler(req, res) {
    if (req.method !== 'GET') {
      serve(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      return;
    }
    const query = String(req.url || '').split('?')[1] || '';
    const requested = parseInterferenceBox(new URLSearchParams(query));
    if (!requested) {
      serve(res, 400, { error: 'invalid_box' });
      return;
    }
    if (!allowClient(clientKey(req))) {
      serve(res, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
      return;
    }
    const box = quantizeInterferenceBox(requested);
    const key = [box.south, box.west, box.north, box.east].join(',');
    const cached = cache.get(key);
    if (cached && now() - cached.at < CACHE_MS) {
      serve(res, 200, cached.body, { 'X-GPS-Cache': 'HIT' });
      return;
    }
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, async () => {
        const body = await build(box);
        remember(key, body);
        return body;
      });
      const body = await promise;
      serve(res, 200, body, { 'X-GPS-Cache': 'MISS' });
    } catch (error) {
      console.warn('[GPS Interference Proxy]', error?.message || error);
      if (cached) {
        serve(
          res,
          200,
          { ...cached.body, stale: true },
          { 'X-GPS-Cache': 'STALE', 'X-Data-Stale': 'true' },
        );
        return;
      }
      serve(res, 502, { error: 'gps_interference_unavailable' });
    }
  }

  return {
    name: 'gps-interference-proxy',
    configureServer({ middlewares }) {
      middlewares.use('/api/gps-interference', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/gps-interference', handler);
    },
  };
}
