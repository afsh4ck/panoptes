import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { coalesceProxyRequest } from '../common/http.js';

/**
 * Shared scaffolding for the keyless event proxies (conflicts, disasters,
 * radiation): one same-origin GET route, a bounded per-query cache with
 * stale-on-error, request coalescing, a per-client rate limiter and sanitized
 * errors. Upstream bodies never reach the browser on failure.
 *
 * @param {object} options
 * @param {string} options.name Plugin name; also the sanitized error prefix.
 * @param {string} options.headerName Header token for `X-<headerName>-Cache`.
 * @param {string} options.route Same-origin route, e.g. `/api/conflicts`.
 * @param {number} options.ttlMs Fresh window for a cached payload.
 * @param {(query: object) => Promise<object>} options.load Build the payload.
 * @param {(search: URLSearchParams) => object} [options.parseQuery] Validate
 *   query parameters; throw `{status: 400, code}` on invalid input.
 * @param {(query: object) => string} [options.keyOf] Cache key for a query.
 * @param {() => number} [options.now] Clock seam.
 * @param {number} [options.maxPerMinute] Per-client request cap.
 * @param {number} [options.globalMax] Global request cap per minute.
 * @param {number} [options.maxEntries] Retained cache entries.
 * @param {number} [options.staleTtlMs] How long a stale entry may still serve.
 * @returns {import('vite').Plugin & {_handler: Function}}
 */
export function createCachedJsonRoute({
  name,
  headerName,
  route,
  ttlMs,
  load,
  parseQuery = () => ({}),
  keyOf = () => 'default',
  now = () => Date.now(),
  maxPerMinute = 60,
  globalMax = 600,
  maxEntries = 16,
  staleTtlMs = ttlMs * 24,
}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: maxPerMinute,
    globalMax,
  });
  const errorCode = `${name.replace(/-/g, '_')}_unavailable`;

  async function acquire(key, query) {
    const previous = cache.get(key);
    if (previous && now() - previous.savedAt < ttlMs)
      return { value: previous.value, cacheStatus: 'HIT' };
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, async () => {
        const value = await load(query);
        cache.delete(key);
        cache.set(key, { value, savedAt: now() });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return value;
      });
      return { value: await promise, cacheStatus: 'MISS' };
    } catch (error) {
      if (previous && now() - previous.savedAt < staleTtlMs)
        return { value: previous.value, cacheStatus: 'STALE', error };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value, extra = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...extra,
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const [path, search = ''] = String(req.url || '/').split('?');
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    let query;
    try {
      query = parseQuery(new URLSearchParams(search));
    } catch (error) {
      return json(400, { error: error?.code || 'invalid_query' });
    }
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, cacheStatus } = await acquire(keyOf(query), query);
      json(200, cacheStatus === 'STALE' ? { ...value, stale: true } : value, {
        [`X-${headerName}-Cache`]: cacheStatus,
        ...(cacheStatus === 'STALE' ? { 'X-Data-Stale': 'true' } : {}),
      });
    } catch (error) {
      console.warn(
        `[${name}] upstream unavailable: ${error?.message || error}`,
      );
      json(error?.status === 429 ? 429 : 502, { error: errorCode });
    }
  }

  return {
    name,
    configureServer({ middlewares }) {
      middlewares.use(route, handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use(route, handler);
    },
    /** Test seam: the bare (req, res) handler. */
    _handler: handler,
  };
}

/** Parse a bounded integer query value from an allow-list. */
export function pickAllowedInteger(search, key, allowed, fallback) {
  const raw = search.get(key);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || !allowed.includes(value))
    throw Object.assign(new Error(`invalid ${key}`), {
      status: 400,
      code: `invalid_${key}`,
    });
  return value;
}

/** True for a finite WGS84 pair. */
export function validCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180
  );
}

/** User-Agent sent to every events upstream (brand + contact path). */
export const EVENTS_USER_AGENT = 'PanoptesOSINT/0.1';

/** Wrap a fetch so every request carries the PANOPTES User-Agent. */
export function withUserAgent(fetchImpl, userAgent = EVENTS_USER_AGENT) {
  return (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent);
    return fetchImpl(url, { ...options, headers });
  };
}
