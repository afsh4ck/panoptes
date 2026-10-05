import { createHash } from 'node:crypto';

/** A still whose bytes have not changed for this long is reported frozen. */
export const FROZEN_FRAME_MS = 60 * 60 * 1000;

/**
 * Per-camera memory of when each camera's image content last changed, so the
 * panel can say how old a still is and flag feeds that stopped updating.
 *
 * `frameTime` is the publisher's `Last-Modified` when it is plausible, else
 * the moment this proxy saw the content change; a first sighting dates
 * nothing. `frozen` is only ever claimed from what the proxy itself observed:
 * the same bytes for FROZEN_FRAME_MS or longer.
 *
 * @param {{maxEntries?: number}} [options]
 */
export function createFrameFreshness({ maxEntries = 30000 } = {}) {
  const seen = new Map();
  return {
    /**
     * @param {string} cameraId
     * @param {Uint8Array} body - The image bytes just served.
     * @param {{lastModified?: number, now?: number}} [options]
     * @returns {{frameTime: number|null, frozen: boolean}}
     */
    observe(cameraId, body, { lastModified = NaN, now = Date.now() } = {}) {
      const digest = createHash('sha1').update(body).digest('hex');
      let entry = seen.get(cameraId);
      if (!entry || entry.digest !== digest) {
        if (!entry && seen.size >= maxEntries) {
          seen.delete(seen.keys().next().value);
        }
        entry = { digest, since: now, changedAt: entry ? now : null };
        seen.set(cameraId, entry);
      }
      // A Last-Modified from the future (clock skew beyond a minute) is noise.
      const upstream =
        Number.isFinite(lastModified) && lastModified <= now + 60_000
          ? lastModified
          : null;
      return {
        frameTime: upstream ?? entry.changedAt,
        frozen: now - entry.since >= FROZEN_FRAME_MS,
      };
    },
  };
}
