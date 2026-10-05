import { createSidecarLoader } from './sidecar.js';

/** Sidecar written by scripts/precompute-cctv-road-headings.mjs. */
export const DEFAULT_ROAD_HEADINGS_FILE =
  'src/data/local_data/cctv_road_headings/cctv_road_headings.json';

/** How far (degrees) a camera may have moved and keep its road bearing. */
const MOVED_DEG = 1e-4;

/**
 * Road-aligned bearings for highway cameras whose feed publishes no facing
 * (see src/data/cctvRoadHeadings.js). Cached by file mtime; missing or
 * malformed files mean "none shipped".
 * @param {string} sourceRoot
 * @returns {Record<string, object>} camera id → `{headingDeg, confidence, lat, lon}`
 */
export const loadRoadHeadings = createSidecarLoader({
  envName: 'CCTV_ROAD_HEADINGS_FILE',
  defaultFile: DEFAULT_ROAD_HEADINGS_FILE,
});

/**
 * Replace a synthetic bearing with the shipped road bearing. Only cameras
 * still at the position the bearing was computed for, and only `low`
 * confidence bearings: a surveyed, curated or calibrated pose always wins.
 * @param {Array<object>} sources - Normalized served sources.
 * @param {Record<string, object>} entries - Sidecar cameras map.
 * @returns {Array<object>} The same sources, bearings updated in place.
 */
export function joinRoadHeadings(sources, entries) {
  if (!entries || typeof entries !== 'object') return sources;
  for (const source of sources) {
    const entry = entries[source.id];
    if (!entry || !Number.isFinite(entry.headingDeg)) continue;
    if (source.headingConfidence !== 'low' || source.poseSource === 'curated')
      continue;
    if (
      !(Math.abs(entry.lat - source.lat) <= MOVED_DEG) ||
      !(Math.abs(entry.lon - source.lon) <= MOVED_DEG)
    )
      continue;
    source.headingDeg = entry.headingDeg;
    source.headingConfidence = entry.confidence === 'medium' ? 'medium' : 'low';
  }
  return sources;
}
