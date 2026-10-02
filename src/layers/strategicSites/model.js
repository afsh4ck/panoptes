/**
 * Pure helpers for the bundled strategic-site layers: GeoJSONL parsing,
 * per-class colors and screen-grid label selection. No Cesium, no DOM.
 */

/** Per-class marker colors; unknown classes fall back to the layer color. */
export const STRATEGIC_CLASS_COLORS = Object.freeze({
  naval_base: '#4dabf7',
  air_base: '#f5a524',
  army_base: '#94d82d',
  missile_base: '#ff4d4f',
  radar_station: '#c084fc',
  barracks: '#a9b1ba',
  training_area: '#868e96',
  base: '#ffd43b',
  power_plant: '#ff4d4f',
  research_reactor: '#ff922b',
  enrichment: '#e64980',
  missile_silo: '#c92a2a',
  test_site: '#ffd8a8',
  large_airport: '#8ab4f8',
  medium_airport: '#5c7cfa',
  military_airfield: '#f5a524',
  port_large: '#2dd4bf',
  port_medium: '#20c997',
  port_small: '#63e6be',
  port_very_small: '#96f2d7',
  coal: '#868e96',
  gas: '#ffd166',
  oil: '#a0522d',
  nuclear: '#ff4d4f',
  hydro: '#4dabf7',
  wind: '#c3fae8',
  solar: '#ffe066',
});

/** Classes drawn larger because they matter most at globe scale. */
const MAJOR_CLASSES = new Set([
  'naval_base',
  'air_base',
  'missile_base',
  'power_plant',
  'enrichment',
  'missile_silo',
  'large_airport',
  'port_large',
  'chokepoint',
  'nuclear',
]);

/** Generic fallback names the ETL writes for unnamed features. */
const GENERIC_NAME =
  /^(military base|air base|naval base|army base|barracks|training area|military land|radar station|missile base|port|volcano|power plant|nuclear site)(\s*\(.*\))?$/i;

/** Whether a site carries a real name rather than a class fallback. */
export function hasRealName(name) {
  const text = String(name || '').trim();
  return Boolean(text) && !GENERIC_NAME.test(text);
}

/** Marker color for a site class. */
export function classColor(klass, fallback) {
  return STRATEGIC_CLASS_COLORS[String(klass || '')] || fallback;
}

/** Label/marker priority: major classes and named, linked sites first. */
export function sitePriority(properties = {}) {
  let score = 0;
  if (MAJOR_CLASSES.has(String(properties.class || ''))) score += 600;
  if (hasRealName(properties.name)) score += 1000;
  const tags = properties.tags || {};
  if (tags.wikidata || tags.wikidata_id) score += 300;
  const capacity = Number(tags.capacity_mw);
  if (Number.isFinite(capacity)) score += Math.min(400, capacity / 10);
  const authored = Number(properties.priority);
  if (Number.isFinite(authored)) score += authored;
  return score;
}

/** Whether a site is drawn with the larger "major" marker. */
export function isMajorSite(properties = {}) {
  return MAJOR_CLASSES.has(String(properties.class || ''));
}

/**
 * Parse GeoJSONL text into compact point records. Malformed lines and
 * features without finite Point coordinates are skipped.
 * @param {string} text
 * @returns {Array<{id: string, lon: number, lat: number, properties: object, priority: number}>}
 */
export function parseSiteLines(text) {
  const records = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let feature;
    try {
      feature = JSON.parse(line);
    } catch {
      continue;
    }
    const coordinates = feature?.geometry?.coordinates;
    const lon = Number(coordinates?.[0]);
    const lat = Number(coordinates?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const properties =
      feature.properties && typeof feature.properties === 'object'
        ? feature.properties
        : {};
    records.push({
      id: String(feature.id ?? records.length),
      lon,
      lat,
      properties,
      priority: sitePriority(properties),
    });
  }
  return records;
}

/**
 * Keep the best-priority candidate per screen grid cell, then cap.
 * @param {Array<{record: object, x: number, y: number}>} candidates
 * @param {{gridPx: number, max: number}} options
 */
export function selectLabelCohort(candidates, { gridPx = 130, max = 120 }) {
  const best = new Map();
  for (const candidate of candidates) {
    const key = `${Math.floor(candidate.x / gridPx)}:${Math.floor(candidate.y / gridPx)}`;
    const incumbent = best.get(key);
    if (!incumbent || candidate.record.priority > incumbent.record.priority)
      best.set(key, candidate);
  }
  return [...best.values()]
    .sort((a, b) => b.record.priority - a.record.priority)
    .slice(0, max);
}

/** Camera heights (m) below which each detail tier becomes visible. */
export const SITE_TIER_HEIGHTS = Object.freeze([
  Infinity,
  4_000_000,
  1_500_000,
]);

/**
 * Detail tier: 0 = major class or a named, Wikidata-linked site (always
 * drawn); 1 = other named sites; 2 = unnamed features (close range only).
 */
export function siteTier(properties = {}) {
  const tags = properties.tags || {};
  const named = hasRealName(properties.name);
  if (isMajorSite(properties) && named) return 0;
  // Barracks and training land stay out of the globe-scale set even when
  // Wikidata-linked: there are thousands and they bury the major sites.
  const minorClass = /^(barracks|training_area|other)$/.test(
    String(properties.class || ''),
  );
  if (named && !minorClass && (tags.wikidata || tags.wikidata_id)) return 0;
  if (named || isMajorSite(properties)) return 1;
  return 2;
}

/** Whether a tier is drawn at a camera height. */
export function tierVisible(tier, heightM) {
  return heightM < (SITE_TIER_HEIGHTS[tier] ?? 0);
}
