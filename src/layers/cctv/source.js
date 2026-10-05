import {
  ACTIVE_FRAME_REFRESH_MS,
  FRAME_ENDPOINT,
  MEDIA_ENDPOINT,
} from './sourcePolicy.js';
function safeNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function frameUrlFor(camera, refreshMs = ACTIVE_FRAME_REFRESH_MS) {
  const cadenceMs = Math.max(
    1000,
    safeNumber(refreshMs, ACTIVE_FRAME_REFRESH_MS),
  );
  const tick = Math.floor(Date.now() / cadenceMs);
  const params = new URLSearchParams({
    label: camera.name,
    city: camera.city,
    lat: camera.lat.toFixed(6),
    lon: camera.lon.toFixed(6),
    heading: String(Math.round(camera.headingDeg)),
    fov: String(Math.round(camera.fovDeg)),
    pitch: String(Math.round(camera.pitchDeg || -10)),
    ts: String(tick),
  });
  return `${FRAME_ENDPOINT}/${encodeURIComponent(camera.id)}?${params.toString()}`;
}
function mediaUrlFor(camera) {
  return `${MEDIA_ENDPOINT}/${encodeURIComponent(camera.id)}?ts=${Math.floor(Date.now() / 15000)}`;
}
/**
 * `/api/cctv/sources` ships each licence once in `licenses`; rows point at it
 * with `licenseRef`. Restore `license` on every row (in place).
 */
export function expandCatalogPayload(payload) {
  const licenses = Array.isArray(payload?.licenses) ? payload.licenses : [];
  if (!licenses.length) return payload;
  for (const source of payload.sources) {
    if (!source || source.license !== undefined) continue;
    const license = licenses[source.licenseRef];
    if (typeof license === 'string') source.license = license;
  }
  return payload;
}
/** Supply catalog/health records and the existing registered camera URL families. */
export function createCctvSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function read(path, key, { signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(path, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Camera source HTTP ' + response.status);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!Array.isArray(payload?.[key]))
      throw new Error('Malformed camera ' + key + ' snapshot');
    return payload;
  }
  return {
    async getCatalog(options) {
      return expandCatalogPayload(
        await read('/api/cctv/sources', 'sources', options),
      );
    },
    getHealth(options) {
      return read('/api/cctv/health', 'cameras', options);
    },
    getFrameUrl: frameUrlFor,
    getMediaUrl: mediaUrlFor,
  };
}
