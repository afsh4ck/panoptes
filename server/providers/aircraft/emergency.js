import {
  EMERGENCY_SQUAWKS,
  normalizeEmergencyFeeds,
} from '../../../src/layers/airEmergencies/records.js';
import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * Vite plugin: adsb.lol emergency-squawk proxy (7500 / 7600 / 7700) with a
 * 12 s response cache.
 *
 * Serves GET /api/adsblol/emergency from the three public squawk feeds. The
 * three fetches run together; when one fails the response is marked
 * `partial` rather than failing the alert surface. When every feed fails —
 * a thrown fetch OR a non-OK status such as 429 — the proxy serves its cached
 * body as STALE and backs off from upstream for the Retry-After period
 * (bounded), mirroring `adsb-lol.js` so one rate limit is never hammered
 * mid-cooldown. A failure with nothing cached is relayed as 502.
 *
 * @returns {import('vite').Plugin}
 */
export function emergencySquawkProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const CACHE_MS = 12000;
  const RATE_LIMIT_COOLDOWN_MS = 30000;
  const SERVER_ERROR_COOLDOWN_MS = 15000;
  const COOLDOWN_MIN_MS = 5000;
  const COOLDOWN_MAX_MS = 120000;
  const UPSTREAM_TIMEOUT_MS = 10000;
  const MAX_FEED_BYTES = 4 * 1024 * 1024;
  const FEED_URL = (squawk) => `https://api.adsb.lol/v2/sqk/${squawk}`;

  /** @type {{body: object, at: number}|null} */
  let cache = null;
  let cooldownUntil = 0;
  let cooldownStatus = 0;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  const clampCooldown = (ms) =>
    Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS, ms));

  function cooldownFor(error, at) {
    const raw = error?.retryAfter;
    if (raw) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds > 0)
        return clampCooldown(seconds * 1000);
      const when = Date.parse(raw);
      if (Number.isFinite(when) && when > at) return clampCooldown(when - at);
    }
    return error?.status === 429
      ? RATE_LIMIT_COOLDOWN_MS
      : SERVER_ERROR_COOLDOWN_MS;
  }

  function startCooldown(error) {
    const at = now();
    cooldownUntil = at + cooldownFor(error, at);
    cooldownStatus = error?.status || 503;
  }

  async function fetchFeed(squawk) {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await fetchImpl(FEED_URL(squawk), {
      headers: { 'User-Agent': 'gods-eye-view-adsblol-proxy/1.0' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      throw Object.assign(new Error(`adsb.lol ${response.status}`), {
        status: response.status,
        retryAfter: response.headers?.get?.('retry-after') || null,
      });
    }
    return readResponseJsonCapped(response, MAX_FEED_BYTES, signal);
  }

  async function refresh() {
    const settled = await Promise.allSettled(EMERGENCY_SQUAWKS.map(fetchFeed));
    const feeds = [];
    const sources = {};
    const failures = [];
    settled.forEach((result, index) => {
      const squawk = EMERGENCY_SQUAWKS[index];
      if (result.status === 'fulfilled') {
        feeds.push({ squawk, payload: result.value });
        sources[squawk] = 'ok';
      } else {
        sources[squawk] = 'error';
        failures.push(result.reason);
      }
    });
    const throttled = failures.find(
      (error) => error?.status === 429 || error?.status >= 500,
    );
    if (throttled) startCooldown(throttled);
    if (!feeds.length) throw failures[0] || new Error('upstream_unavailable');
    const fetchedAt = now();
    const body = {
      rows: normalizeEmergencyFeeds(feeds, fetchedAt),
      fetchedAt,
      stale: false,
      partial: feeds.length < EMERGENCY_SQUAWKS.length,
      sources,
    };
    cache = { body, at: fetchedAt };
    return body;
  }

  function serve(res, status, body, cacheStatus, extra = {}) {
    if (res.destroyed) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-ADS-B-Cache': cacheStatus,
      ...(cacheStatus === 'STALE' ? { 'X-Data-Stale': 'true' } : {}),
      ...(['HIT', 'STALE'].includes(cacheStatus) && cache
        ? { 'X-ADS-B-Cache-Age-Ms': String(Math.max(0, now() - cache.at)) }
        : {}),
      ...extra,
    });
    res.end(JSON.stringify(body));
  }

  const serveStale = (res, extra) =>
    serve(res, 200, { ...cache.body, stale: true }, 'STALE', extra);

  async function handler(req, res) {
    if (req.method !== 'GET') {
      serve(res, 405, { error: 'method_not_allowed' }, 'NONE', {
        Allow: 'GET',
      });
      return;
    }
    if (!allow(clientKey(req))) {
      serve(res, 429, { error: 'rate_limited' }, 'NONE', {
        'Retry-After': '60',
      });
      return;
    }
    try {
      const at = now();
      if (cache && at - cache.at < CACHE_MS) {
        serve(res, 200, cache.body, 'HIT');
        return;
      }
      if (at < cooldownUntil) {
        const retryAfter = String(Math.ceil((cooldownUntil - at) / 1000));
        if (cache) {
          serveStale(res, {
            'X-ADS-B-Upstream-Status': String(cooldownStatus),
            'X-ADS-B-Retry-After-Seconds': retryAfter,
          });
          return;
        }
        serve(res, 503, { error: 'adsb.lol upstream cooling down' }, 'NONE', {
          'Retry-After': retryAfter,
        });
        return;
      }
      const { promise } = coalesceProxyRequest(inFlight, 'emergency', refresh);
      const body = await promise;
      serve(res, 200, body, 'MISS');
    } catch (error) {
      if (error?.status === 429 || error?.status >= 500) startCooldown(error);
      console.warn('[adsb.lol Emergency Proxy]', error?.message || error);
      if (cache) {
        serveStale(res);
        return;
      }
      serve(res, 502, { error: 'emergency_feed_unavailable' }, 'NONE');
    }
  }

  return {
    name: 'adsblol-emergency-proxy',
    configureServer({ middlewares }) {
      middlewares.use('/api/adsblol/emergency', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/adsblol/emergency', handler);
    },
  };
}
