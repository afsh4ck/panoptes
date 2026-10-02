import * as Cesium from 'cesium';
import {
  conflictCardModel,
  conflictKindColor,
  conflictWeight,
} from './records.js';

export const CONFLICT_OVERLAY_SOURCE_ID = 'conflict-events';
export const CONFLICT_OVERLAY_COHORT_LIMIT = 40;
export const CONFLICT_OVERLAY_COLLISION_CAPACITY = 24;
/** Rows above this rank get a ground disc; the rest stay points. */
export const CONFLICT_DISC_LIMIT = 250;

const colorCache = new Map();

/** Cesium color for a kind (cached; callers must not mutate it). */
export function conflictColor(kind) {
  const css = conflictKindColor(kind);
  let color = colorCache.get(css);
  if (!color) {
    color = Cesium.Color.fromCssColorString(css);
    colorCache.set(css, color);
  }
  return color;
}

/** Overlay card for one row; `position` is the ground anchor. */
export function createConflictOverlayEntry({ row, position, nowMs }) {
  const { title, details } = conflictCardModel(row, nowMs);
  return {
    id: `conflict:${row.id}`,
    position,
    variant: 'card',
    title,
    details,
    accent: conflictKindColor(row.kind),
    priority: Math.round(conflictWeight(row)),
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the most-reported events, stable identity as the tie-break. */
export function selectConflictOverlayCohort(
  entries,
  limit = CONFLICT_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(CONFLICT_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
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
