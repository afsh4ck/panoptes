/**
 * How old the active camera's still is, from the proxy's health row
 * (server/providers/cctv/freshness.js): "IMG 4 MIN", "IMG 3 H", or FROZEN
 * when the publisher's image has not changed for over an hour. Empty when the
 * age is unknown (no Last-Modified and no change seen yet).
 *
 * @param {number|null|undefined} frameTime - Epoch ms the image last changed.
 * @param {boolean} [frozen]
 * @param {number} [now]
 * @returns {string}
 */
export function frameFreshnessLabel(
  frameTime,
  frozen = false,
  now = Date.now(),
) {
  if (frozen) return 'FROZEN';
  if (frameTime === null || frameTime === undefined) return '';
  const ageMs = now - Number(frameTime);
  if (!Number.isFinite(ageMs)) return '';
  const minutes = Math.max(0, Math.floor(ageMs / 60000));
  if (minutes < 1) return 'IMG <1 MIN';
  if (minutes < 120) return `IMG ${minutes} MIN`;
  return `IMG ${Math.floor(minutes / 60)} H`;
}
