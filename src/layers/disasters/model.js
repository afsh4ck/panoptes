import * as Cesium from 'cesium';
import {
  disasterCardModel,
  disasterLevelColor,
  disasterPriority,
} from './records.js';

export const DISASTER_OVERLAY_SOURCE_ID = 'disaster-alerts';
export const DISASTER_OVERLAY_COHORT_LIMIT = 64;
export const DISASTER_OVERLAY_COLLISION_CAPACITY = 32;

const colorCache = new Map();

/** Cesium color for a level (cached; callers must not mutate it). */
export function disasterColor(level) {
  const css = disasterLevelColor(level);
  let color = colorCache.get(css);
  if (!color) {
    color = Cesium.Color.fromCssColorString(css);
    colorCache.set(css, color);
  }
  return color;
}

/** Overlay card for one row; `position` is the ground anchor. */
export function createDisasterOverlayEntry({ row, position, nowMs }) {
  const { title, details } = disasterCardModel(row, nowMs);
  return {
    id: `disaster:${row.id}`,
    position,
    variant: 'card',
    title,
    details,
    accent: disasterLevelColor(row.level),
    priority: disasterPriority(row),
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest alerts, stable identity as the tie-break. */
export function selectDisasterOverlayCohort(
  entries,
  limit = DISASTER_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(DISASTER_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}
