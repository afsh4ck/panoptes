/**
 * Pure rules for the "3D detail" setting: how hard the photorealistic 3D
 * tiles are refined and at what pixel density the scene is drawn.
 *
 * There is no separate "texture pack" for Google / Cesium photorealistic
 * tiles: the streamed tiles ARE the textures. Sharper buildings come from
 * requesting deeper levels of detail (a lower screen-space error) and from
 * rendering at the screen's native pixel density.
 *
 * Loading stays fast through progressive refinement: while the camera moves
 * the tiles are refined to a coarse `movingScreenSpaceError` (few requests,
 * the view fills quickly), and once it has been still for `settleMs` they
 * refine to the level's full `maximumScreenSpaceError`. The centre of the
 * view always loads first (foveated loading); the periphery may lag by up to
 * `peripheryRelaxation` pixels of error and catches up when idle.
 */

export const TILE_QUALITY_STORAGE_KEY = 'panoptes:tile-quality:v1';
export const DEFAULT_TILE_QUALITY = 'high';
/** Drone mode never refines less than this while hovering. */
export const DRONE_SCREEN_SPACE_ERROR = 6;

export const TILE_QUALITY_LEVELS = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    label: 'Standard',
    hint: 'Fastest. Cesium default tile detail at the browser-recommended resolution.',
    maximumScreenSpaceError: 16,
    movingScreenSpaceError: 32,
    peripheryRelaxation: 16,
    dynamicScreenSpaceError: true,
    nativeResolution: false,
    pixelRatioCap: 1,
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    hint: 'Sharper facades: twice the tile detail when the view settles, native resolution.',
    maximumScreenSpaceError: 8,
    movingScreenSpaceError: 24,
    peripheryRelaxation: 12,
    dynamicScreenSpaceError: true,
    nativeResolution: true,
    pixelRatioCap: 1.5,
  }),
  ultra: Object.freeze({
    id: 'ultra',
    label: 'Ultra HD',
    hint: 'Deepest tile detail and up to 2x pixel density when the view settles. Needs a strong GPU and a fast connection.',
    maximumScreenSpaceError: 4,
    movingScreenSpaceError: 16,
    peripheryRelaxation: 8,
    dynamicScreenSpaceError: false,
    nativeResolution: true,
    pixelRatioCap: 2,
  }),
});

/**
 * Cockpit / chase views never stop moving, so the settle-based refinement
 * above would keep them on coarse tiles forever, foveated loading would defer
 * the periphery forever, and Cesium would cancel the requests the fast camera
 * "outruns". Riding along therefore uses one steady, moderate detail per
 * level, loads the whole view, keeps every request, and lets the far horizon
 * (most of a low-pitch view) stay coarse through dynamic screen-space error.
 */
export const COCKPIT_SCREEN_SPACE_ERROR = Object.freeze({
  standard: 20,
  high: 14,
  ultra: 10,
});

/** How long the camera must be still before full refinement. */
export const SETTLE_MS = 350;

/** A known level id, falling back to the default. */
export function normalizeTileQuality(value) {
  const id = String(value || '').toLowerCase();
  return Object.hasOwn(TILE_QUALITY_LEVELS, id) ? id : DEFAULT_TILE_QUALITY;
}

/**
 * Cesium `resolutionScale` that renders at min(devicePixelRatio, cap) when the
 * viewer uses the native pixel ratio (useBrowserRecommendedResolution=false).
 */
export function resolutionScaleFor(level, devicePixelRatio = 1) {
  const settings = TILE_QUALITY_LEVELS[normalizeTileQuality(level)];
  const dpr = Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1;
  if (!settings.nativeResolution) return 1;
  return Math.min(dpr, settings.pixelRatioCap) / dpr;
}

/**
 * Tileset properties for a level and camera state.
 * @param {string} level
 * @param {{moving?: boolean, drone?: boolean}} [state]
 */
export function tilesetSettingsFor(
  level,
  { moving = false, drone = false, cockpit = false } = {},
) {
  const id = normalizeTileQuality(level);
  const s = TILE_QUALITY_LEVELS[id];
  if (cockpit) {
    const maximumScreenSpaceError = COCKPIT_SCREEN_SPACE_ERROR[id];
    return {
      maximumScreenSpaceError,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 4.0e-4,
      dynamicScreenSpaceErrorFactor: 24,
      foveatedScreenSpaceError: false,
      foveatedConeSize: 0.2,
      foveatedMinimumScreenSpaceErrorRelaxation: 0,
      foveatedTimeDelay: 0,
      cullRequestsWhileMoving: false,
      progressiveResolutionHeightFraction: 0.5,
    };
  }
  let settled = s.maximumScreenSpaceError;
  let travelling = s.movingScreenSpaceError;
  if (drone) {
    settled = Math.min(settled, DRONE_SCREEN_SPACE_ERROR);
    travelling = Math.min(travelling, DRONE_SCREEN_SPACE_ERROR * 2);
  }
  const maximumScreenSpaceError = moving ? travelling : settled;
  return {
    maximumScreenSpaceError,
    dynamicScreenSpaceError: s.dynamicScreenSpaceError,
    dynamicScreenSpaceErrorDensity: 2.0e-4,
    dynamicScreenSpaceErrorFactor: 24,
    foveatedScreenSpaceError: true,
    foveatedConeSize: 0.2,
    // Cesium rejects a relaxation above the maximum screen-space error.
    foveatedMinimumScreenSpaceErrorRelaxation: Math.min(
      s.peripheryRelaxation,
      maximumScreenSpaceError,
    ),
    foveatedTimeDelay: 0.15,
    cullRequestsWhileMoving: true,
    progressiveResolutionHeightFraction: 0.3,
  };
}
