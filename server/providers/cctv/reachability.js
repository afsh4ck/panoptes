import { createHash } from 'node:crypto';

/**
 * CCTV frame reachability.
 *
 * Two failure modes made whole camera packs look broken:
 *  1. Publishers that refuse frames outside their own region (Austin's
 *     CloudFront answers 403 from Europe) or whose snapshots are down.
 *  2. Publishers that answer 200 with a stock "No live camera feed at this
 *     time" card (the shared 511 platform used by Georgia, Arizona, New
 *     England, Alaska…), which looks like a real frame to every check.
 *
 * `isPublisherPlaceholder` recognises the stock cards by content hash, and
 * `filterReachableProviders` samples each provider once per TTL and drops the
 * ones that cannot deliver a single real frame from where this server runs.
 */

/** SHA-1 of stock "no feed" cards served with HTTP 200 by publishers. */
export const PUBLISHER_PLACEHOLDER_SHA1 = Object.freeze(
  new Set([
    // 511 platform (GDOT, ADOT, New England 511, Alaska 511): 540×330 PNG
    // "No live camera feed at this time".
    '7063c3929559b480e4c4874b8064082603994c69',
  ]),
);

/** @param {Uint8Array|Buffer} body */
export function isPublisherPlaceholder(body) {
  if (!body || !body.length) return false;
  const digest = createHash('sha1').update(body).digest('hex');
  return PUBLISHER_PLACEHOLDER_SHA1.has(digest);
}

export const PROVIDER_PROBE_TTL_MS = 30 * 60 * 1000;
const PROBES_PER_PROVIDER = 3;
const PROBE_CONCURRENCY = 12;

/** Provider key used to group cameras for probing. */
export function providerKey(source) {
  return String(source?.provider || source?.sourceKind || 'unknown');
}

/** Evenly spaced sample of cameras that have a fetchable still. */
export function probeSample(cameras, count = PROBES_PER_PROVIDER) {
  const withStill = cameras.filter((c) => c?.snapshotUrl || c?.url);
  if (withStill.length <= count) return withStill;
  const step = withStill.length / count;
  return Array.from(
    { length: count },
    (_, i) => withStill[Math.floor(i * step)],
  );
}

/**
 * @param {Array<object>} sources Catalog sources.
 * @param {object} options
 * @param {(source: object) => Promise<boolean>} options.probe Resolves true
 *   when the camera delivered a real frame.
 * @param {Map<string, {ok: boolean, at: number}>} [options.cache]
 * @param {number} [options.now]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{sources: Array<object>, dropped: string[]}>}
 */
export async function filterReachableProviders(
  sources,
  { probe, cache = new Map(), now = Date.now(), log = () => {} },
) {
  const groups = new Map();
  for (const source of sources) {
    const key = providerKey(source);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  const pending = [];
  for (const [key, cameras] of groups) {
    const cached = cache.get(key);
    if (cached && now - cached.at < PROVIDER_PROBE_TTL_MS) continue;
    pending.push([key, probeSample(cameras)]);
  }
  // Bounded concurrency across all providers.
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const [key, sample] = pending[cursor++];
      if (!sample.length) {
        cache.set(key, { ok: true, at: now });
        continue;
      }
      const results = await Promise.all(
        sample.map((camera) => probe(camera).catch(() => false)),
      );
      cache.set(key, { ok: results.some(Boolean), at: now });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, worker),
  );
  const dropped = [...groups.keys()].filter((key) => !cache.get(key)?.ok);
  if (dropped.length)
    log(
      `[CCTV] hiding providers with no reachable frames from this server: ${dropped.join(', ')}`,
    );
  const keep = new Set([...groups.keys()].filter((key) => cache.get(key)?.ok));
  return {
    sources: sources.filter((source) => keep.has(providerKey(source))),
    dropped,
  };
}
