import * as Cesium from 'cesium';
import {
  SETTLE_MS,
  TILE_QUALITY_LEVELS,
  TILE_QUALITY_STORAGE_KEY,
  normalizeTileQuality,
  resolutionScaleFor,
  tilesetSettingsFor,
} from './tileQualityModel.js';

/**
 * @module tileQuality
 * @description Applies the "3D detail" level to every 3D tileset in the
 * scene (current and future ones, e.g. after a map-source switch) and to the
 * viewer's render resolution, with progressive refinement: coarse tiles
 * while the camera moves, full detail once it settles. The choice persists
 * per browser.
 */

const SCAN_INTERVAL_MS = 2000;

/**
 * Cesium validates the foveated relaxation against the CURRENT maximum
 * screen-space error, so drop the relaxation first, then set the maximum,
 * then restore the relaxation. A refused value never breaks the app.
 */
function assignSafely(tileset, settings) {
  const {
    foveatedMinimumScreenSpaceErrorRelaxation: relaxation,
    maximumScreenSpaceError,
    ...rest
  } = settings;
  try {
    tileset.foveatedMinimumScreenSpaceErrorRelaxation = 0;
    tileset.maximumScreenSpaceError = maximumScreenSpaceError;
    tileset.foveatedMinimumScreenSpaceErrorRelaxation = Math.min(
      relaxation,
      maximumScreenSpaceError,
    );
    Object.assign(tileset, rest);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Window} options.windowRef
 * @param {Storage|null} [options.storage]
 * @param {(level: string) => void} [options.onChange]
 */
export function createTileQuality({
  viewer,
  windowRef,
  storage = null,
  onChange = () => {},
}) {
  let level = normalizeTileQuality(read());
  let moving = false;
  let drone = false;
  let cockpit = false;
  let settleTimer = null;
  const applied = new WeakMap();
  const camera = viewer.camera;

  function read() {
    try {
      return storage?.getItem(TILE_QUALITY_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function tilesets() {
    const found = [];
    const primitives = viewer?.scene?.primitives;
    if (!primitives) return found;
    for (let i = 0; i < primitives.length; i++) {
      const p = primitives.get(i);
      if (p instanceof Cesium.Cesium3DTileset && !p.isDestroyed?.())
        found.push(p);
    }
    return found;
  }

  function applyResolution() {
    if (!viewer || viewer.isDestroyed?.()) return;
    const settings = TILE_QUALITY_LEVELS[level];
    viewer.useBrowserRecommendedResolution = !settings.nativeResolution;
    viewer.resolutionScale = resolutionScaleFor(
      level,
      windowRef?.devicePixelRatio || 1,
    );
  }

  function applyTilesets(force = false) {
    if (!viewer || viewer.isDestroyed?.()) return;
    syncCockpit();
    const settings = tilesetSettingsFor(level, { moving, drone, cockpit });
    const key = `${level}:${moving}:${drone}:${cockpit}`;
    let changed = false;
    for (const tileset of tilesets()) {
      if (!force && applied.get(tileset) === key) continue;
      if (!assignSafely(tileset, settings)) continue;
      applied.set(tileset, key);
      changed = true;
    }
    if (changed) viewer.scene.requestRender();
  }

  // The cockpit (first-person / chase of a tracked aircraft) gets its own
  // steady streaming profile; the shell marks it with body.cockpit-mode.
  const body = windowRef?.document?.body;
  function syncCockpit() {
    cockpit = Boolean(body?.classList?.contains('cockpit-mode'));
  }
  const cockpitObserver =
    body && windowRef?.MutationObserver
      ? new windowRef.MutationObserver(() => {
          const was = cockpit;
          syncCockpit();
          if (was !== cockpit) applyTilesets(true);
        })
      : null;
  cockpitObserver?.observe(body, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Progressive refinement follows the camera.
  const onMoveStart = () => {
    windowRef?.clearTimeout?.(settleTimer);
    if (moving) return;
    moving = true;
    applyTilesets();
  };
  const onMoveEnd = () => {
    windowRef?.clearTimeout?.(settleTimer);
    settleTimer = windowRef?.setTimeout?.(() => {
      moving = false;
      applyTilesets();
    }, SETTLE_MS);
  };
  camera?.moveStart?.addEventListener(onMoveStart);
  camera?.moveEnd?.addEventListener(onMoveEnd);

  function set(next) {
    level = normalizeTileQuality(next);
    try {
      storage?.setItem(TILE_QUALITY_STORAGE_KEY, level);
    } catch {
      /* best effort */
    }
    applyResolution();
    applyTilesets(true);
    onChange(level);
    return level;
  }

  applyResolution();
  applyTilesets(true);
  const timer = windowRef?.setInterval?.(
    () => applyTilesets(),
    SCAN_INTERVAL_MS,
  );

  return {
    get: () => level,
    set,
    /** Drone mode: keep at least UHD detail while hovering. */
    setDrone(on) {
      drone = Boolean(on);
      applyTilesets(true);
    },
    destroy() {
      windowRef?.clearInterval?.(timer);
      windowRef?.clearTimeout?.(settleTimer);
      cockpitObserver?.disconnect();
      camera?.moveStart?.removeEventListener(onMoveStart);
      camera?.moveEnd?.removeEventListener(onMoveEnd);
    },
  };
}
