/**
 * Normalize adsb.lol emergency-squawk feeds into plain rows. Pure — no Cesium,
 * no DOM — so the server proxy and the browser layer share one contract.
 *
 * Squawk semantics (ICAO): 7500 unlawful interference, 7600 radio failure,
 * 7700 general emergency. The readsb `emergency` field (general / lifeguard /
 * minfuel / nordo / unlawful / downed) is carried when the transponder sets
 * the ADS-B emergency status; it is independent of the squawk.
 */

export const EMERGENCY_SQUAWKS = Object.freeze(['7500', '7600', '7700']);

export const EMERGENCY_SQUAWK_MEANING = Object.freeze({
  7500: 'Unlawful interference',
  7600: 'Radio failure',
  7700: 'General emergency',
});

const HEX_PATTERN = /^~?[0-9a-f]{6}$/;
const MAX_ROWS = 500;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

/**
 * Normalize one readsb-style aircraft object from a squawk feed.
 * Rows without a plottable position are dropped: an alert needs a place.
 * @param {object} aircraft adsb.lol `ac[]` entry.
 * @param {number} nowMs Feed retrieval time.
 * @param {string|null} [squawkHint] Squawk the feed was queried for.
 * @returns {object|null} Emergency row or null when unusable.
 */
export function normalizeEmergencyAircraft(aircraft, nowMs, squawkHint = null) {
  const hex = String(aircraft?.hex || '')
    .trim()
    .toLowerCase();
  if (!HEX_PATTERN.test(hex)) return null;
  const lat = finite(aircraft?.lat);
  const lon = finite(aircraft?.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  const rawSquawk = text(aircraft?.squawk);
  const squawk = EMERGENCY_SQUAWKS.includes(rawSquawk)
    ? rawSquawk
    : EMERGENCY_SQUAWKS.includes(squawkHint)
      ? squawkHint
      : null;
  if (!squawk) return null;
  const onGround = aircraft?.alt_baro === 'ground';
  const altFt = onGround
    ? 0
    : (finite(aircraft?.alt_baro) ?? finite(aircraft?.alt_geom));
  const seen = Math.max(
    0,
    finite(aircraft?.seen_pos) ?? finite(aircraft?.seen) ?? 0,
  );
  const emergency = text(aircraft?.emergency);
  return {
    hex,
    callsign: text(aircraft?.flight),
    registration: text(aircraft?.r),
    type: text(aircraft?.t),
    squawk,
    emergency: emergency && emergency !== 'none' ? emergency : null,
    lat,
    lon,
    altFt,
    onGround,
    gsKt: finite(aircraft?.gs),
    track: finite(aircraft?.track),
    seen,
    category: text(aircraft?.category),
    observedAtMs: Number.isFinite(nowMs)
      ? Math.round(nowMs - seen * 1000)
      : null,
  };
}

const SQUAWK_RANK = Object.freeze({ 7500: 0, 7700: 1, 7600: 2 });

/**
 * Merge several squawk feeds into one deduplicated, deterministically ordered
 * row list (hijack first, then emergency, then radio failure).
 * @param {Array<{squawk: string, payload: object}>} feeds Feed payloads.
 * @param {number} nowMs Retrieval time.
 * @returns {object[]} Rows, at most MAX_ROWS.
 */
export function normalizeEmergencyFeeds(feeds, nowMs) {
  const byHex = new Map();
  for (const feed of Array.isArray(feeds) ? feeds : []) {
    const list = Array.isArray(feed?.payload?.ac) ? feed.payload.ac : [];
    for (const aircraft of list) {
      const row = normalizeEmergencyAircraft(aircraft, nowMs, feed?.squawk);
      if (!row) continue;
      const previous = byHex.get(row.hex);
      // The same transponder can only squawk one code; keep the fresher fix.
      if (!previous || row.seen < previous.seen) byHex.set(row.hex, row);
    }
  }
  return [...byHex.values()]
    .sort(
      (a, b) =>
        SQUAWK_RANK[a.squawk] - SQUAWK_RANK[b.squawk] ||
        a.hex.localeCompare(b.hex),
    )
    .slice(0, MAX_ROWS);
}

/**
 * Validate a proxy snapshot before it can replace displayed rows. A malformed
 * body returns null so the layer keeps its last good rows.
 * @param {object} payload `/api/adsblol/emergency` body.
 * @returns {{rows: object[], fetchedAt: number|null, stale: boolean, partial: boolean}|null}
 */
export function normalizeEmergencySnapshot(payload) {
  if (!Array.isArray(payload?.rows)) return null;
  const rows = [];
  const seen = new Set();
  for (const row of payload.rows) {
    const hex = String(row?.hex || '').toLowerCase();
    const lat = finite(row?.lat);
    const lon = finite(row?.lon);
    if (
      !HEX_PATTERN.test(hex) ||
      lat === null ||
      lon === null ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !EMERGENCY_SQUAWKS.includes(String(row?.squawk))
    )
      return null;
    if (seen.has(hex)) continue;
    seen.add(hex);
    rows.push({
      hex,
      callsign: text(row.callsign),
      registration: text(row.registration),
      type: text(row.type),
      squawk: String(row.squawk),
      emergency: text(row.emergency),
      lat,
      lon,
      altFt: finite(row.altFt),
      onGround: row.onGround === true,
      gsKt: finite(row.gsKt),
      track: finite(row.track),
      seen: Math.max(0, finite(row.seen) ?? 0),
      category: text(row.category),
      observedAtMs: finite(row.observedAtMs),
    });
    if (rows.length >= MAX_ROWS) break;
  }
  return {
    rows,
    fetchedAt: finite(payload.fetchedAt),
    stale: payload.stale === true,
    partial: payload.partial === true,
    // The proxy answered from another feed while adsb.lol was unavailable.
    fallback: payload.fallback === 'opensky' ? 'opensky' : null,
  };
}
