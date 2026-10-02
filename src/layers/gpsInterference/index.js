import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  INTERFERENCE_MAX_SPAN_DEG,
  INTERFERENCE_MIN_SAMPLE,
  boxChangeFraction,
  interferenceCellKey,
  interferenceCountLabel,
  quantizeInterferenceBox,
  validInterferenceBox,
} from './cells.js';
export * from './cells.js';
export { createGpsInterferenceSource } from './source.js';

export const GPS_INTERFERENCE_LAYER_ID = 'gps-interference';
/** Above this camera height a viewport spans continents: no point queries. */
export const GPS_INTERFERENCE_MAX_CAMERA_HEIGHT_M = 15_000_000;
export const GPS_INTERFERENCE_DEBOUNCE_MS = 2000;
/** Camera motion below this view change reuses the last answer. */
export const GPS_INTERFERENCE_REFETCH_FRACTION = 0.25;
export const GPS_INTERFERENCE_INFO =
  'Derived from ADS-B NIC/NACp; a proxy, not a measurement';

export const GPS_INTERFERENCE_LEGEND = Object.freeze([
  Object.freeze({ label: 'Nominal', color: '#2ecc71' }),
  Object.freeze({ label: 'Degraded · 10–30% low integrity', color: '#ffcc00' }),
  Object.freeze({ label: 'Severe · >30% low integrity', color: '#ff3b30' }),
]);

const LEVEL_STYLE = Object.freeze({
  low: Object.freeze({ css: '#2ecc71', alpha: 0.1 }),
  medium: Object.freeze({ css: '#ffcc00', alpha: 0.32 }),
  high: Object.freeze({ css: '#ff3b30', alpha: 0.45 }),
});

/** Fill alpha: the level's base, thinner for thin samples, denser with more. */
export function interferenceCellAlpha(cell) {
  const style = LEVEL_STYLE[cell.level] || LEVEL_STYLE.low;
  if (cell.total < INTERFERENCE_MIN_SAMPLE) return 0.04;
  return Math.min(0.7, style.alpha + Math.min(0.15, cell.total / 200));
}

/**
 * Own one GPS-interference cell display: viewport-driven loads with a
 * settle debounce, a camera-height guard, and the shared refresh tick.
 * @param {object} options
 * @param {{getCells: Function}} options.source Cell source.
 * @param {object} [options.render] Render governor seam.
 * @param {Function} [options.now] Clock seam.
 * @param {Function} [options.setTimeoutImpl] Timer seam.
 * @param {Function} [options.clearTimeoutImpl] Timer seam.
 */
export function createGpsInterferenceLayer({
  source,
  render = { governorRequestRender },
  now = () => Date.now(),
  setTimeoutImpl = (...args) => setTimeout(...args),
  clearTimeoutImpl = (...args) => clearTimeout(...args),
} = {}) {
  if (typeof source?.getCells !== 'function')
    throw new TypeError('GPS interference requires a cell source');
  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    request: null,
    /** Last quantized request box and the raw settled view it came from. */
    box: null,
    viewBox: null,
    cells: [],
    lastUpdate: null,
    error: null,
    stale: false,
    partial: false,
    aircraftSampled: 0,
    status: '',
    loading: false,
    moveEndRemove: null,
    timer: null,
  };

  function cameraTooHigh(viewer) {
    const height = viewer?.camera?.positionCartographic?.height;
    return (
      Number.isFinite(height) && height > GPS_INTERFERENCE_MAX_CAMERA_HEIGHT_M
    );
  }

  /** The settled camera's view box, capped to the request span around its center. */
  function viewportBox(viewer) {
    const camera = viewer?.camera;
    if (!camera) return null;
    let south, west, north, east;
    const rectangle = camera.computeViewRectangle?.(
      viewer.scene?.globe?.ellipsoid,
    );
    if (rectangle) {
      south = Cesium.Math.toDegrees(rectangle.south);
      north = Cesium.Math.toDegrees(rectangle.north);
      west = Cesium.Math.toDegrees(rectangle.west);
      east = Cesium.Math.toDegrees(rectangle.east);
    } else {
      const carto = camera.positionCartographic;
      if (!carto) return null;
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      south = lat - 5;
      north = lat + 5;
      west = lon - 5;
      east = lon + 5;
    }
    if (![south, west, north, east].every(Number.isFinite)) return null;
    // A dateline-crossing view reports east < west; keep the eastern half.
    if (east < west) east = 180;
    const half = INTERFERENCE_MAX_SPAN_DEG / 2;
    if (north - south > INTERFERENCE_MAX_SPAN_DEG) {
      const mid = (north + south) / 2;
      south = mid - half;
      north = mid + half;
    }
    if (east - west > INTERFERENCE_MAX_SPAN_DEG) {
      const mid = (east + west) / 2;
      west = mid - half;
      east = mid + half;
    }
    const box = {
      south: Math.max(-90, south),
      west: Math.max(-180, west),
      north: Math.min(90, north),
      east: Math.min(180, east),
    };
    return validInterferenceBox(box) ? box : null;
  }

  function buildEntities(cells) {
    const entities = [];
    for (const cell of cells) {
      const style = LEVEL_STYLE[cell.level] || LEVEL_STYLE.low;
      entities.push(
        new Cesium.Entity({
          id: `gps-interference:${interferenceCellKey(cell)}`,
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              cell.lon,
              cell.lat,
              cell.lon + cell.size,
              cell.lat + cell.size,
            ),
            material: Cesium.Color.fromCssColorString(style.css).withAlpha(
              interferenceCellAlpha(cell),
            ),
            classificationType: Cesium.ClassificationType.BOTH,
          },
          properties: {
            level: cell.level,
            total: cell.total,
            bad: cell.bad,
            ratio: cell.ratio,
          },
        }),
      );
    }
    return entities;
  }

  function clearRendered() {
    state.dataSource?.entities.removeAll();
    state.cells = [];
  }

  function scheduleLoad() {
    if (!state.enabled) return;
    clearTimeoutImpl(state.timer);
    state.timer = setTimeoutImpl(() => {
      state.timer = null;
      void loadCells({ force: false });
    }, GPS_INTERFERENCE_DEBOUNCE_MS);
  }

  /**
   * Load cells for the current view. A camera-driven load skips when the view
   * barely moved; the manager tick (`force`) always refreshes.
   * @returns {Promise<boolean>} True when the display changed.
   */
  async function loadCells({ force = false } = {}) {
    if (!state.enabled || !state.viewer || !state.dataSource) return false;
    if (cameraTooHigh(state.viewer)) {
      state.status = 'zoom-in';
      return false;
    }
    const viewBox = viewportBox(state.viewer);
    if (!viewBox) return false;
    // Compare the raw settled views: snapping to the request quantum would
    // turn a small pan into a spurious 'moved' verdict at the cell edges.
    if (
      !force &&
      state.viewBox &&
      !state.error &&
      boxChangeFraction(state.viewBox, viewBox) <=
        GPS_INTERFERENCE_REFETCH_FRACTION
    )
      return false;
    const box = quantizeInterferenceBox(viewBox);
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    state.loading = true;
    state.status = '';
    try {
      const snapshot = await source.getCells(box, { signal: request.signal });
      if (request.signal.aborted || state.request !== request || !state.enabled)
        return false;
      const entities = buildEntities(snapshot.cells);
      state.dataSource.entities.removeAll();
      for (const entity of entities) state.dataSource.entities.add(entity);
      state.cells = snapshot.cells;
      state.box = box;
      state.viewBox = viewBox;
      state.lastUpdate = now();
      state.error = null;
      state.stale = snapshot.stale === true;
      state.partial = snapshot.partial === true;
      state.aircraftSampled = snapshot.aircraftSampled || 0;
      render.governorRequestRender('gps-interference');
      console.log(
        `[Data:GpsInterference] Updated: ${state.cells.length} cells from ${state.aircraftSampled} aircraft`,
      );
      return true;
    } catch (error) {
      if (request.signal.aborted || state.request !== request || !state.enabled)
        return false;
      console.warn('[Data:GpsInterference] Fetch error:', error);
      state.error = error?.message || 'GPS interference feed unavailable';
      return false;
    } finally {
      if (state.request === request) {
        state.request = null;
        state.loading = false;
      }
    }
  }

  const layer = {
    id: GPS_INTERFERENCE_LAYER_ID,
    name: 'GPS Interference',
    icon: '📡',
    source: 'adsb.lol · ADS-B integrity',
    updateInterval: 120000,

    init(viewer) {
      if (state.viewer)
        throw new Error('GPS interference layer is already initialized');
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource('gps-interference');
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.moveEndRemove =
        viewer.camera?.moveEnd?.addEventListener?.(scheduleLoad) || null;
      console.log('[Data:GpsInterference] Initialized');
    },

    enable() {
      state.enabled = true;
      if (state.dataSource) state.dataSource.show = true;
      // DataLayerManager calls update() right after enable(); it owns the first fetch.
    },

    disable() {
      state.enabled = false;
      clearTimeoutImpl(state.timer);
      state.timer = null;
      state.request?.abort();
      state.request = null;
      state.loading = false;
      state.status = '';
      state.box = null;
      state.viewBox = null;
      if (state.dataSource) state.dataSource.show = false;
      clearRendered();
    },

    update() {
      return loadCells({ force: true });
    },

    destroy(viewer = state.viewer) {
      this.disable();
      state.moveEndRemove?.();
      state.moveEndRemove = null;
      if (state.dataSource && viewer)
        viewer.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.viewer = null;
      state.lastUpdate = null;
      state.error = null;
    },

    /** Row legend and honesty line for the layer panel. */
    getRowControls() {
      return {
        legend: GPS_INTERFERENCE_LEGEND.map((entry) => ({ ...entry })),
        info: GPS_INTERFERENCE_INFO,
      };
    },

    /** JSON-safe cell records for the analyst query engine. */
    getAnalystRecords(maxCount = 2000) {
      if (!state.enabled || !state.cells.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return state.cells.slice(0, limit).map((cell) => ({
        id: interferenceCellKey(cell),
        lat: cell.lat + cell.size / 2,
        lon: cell.lon + cell.size / 2,
        sizeDeg: cell.size,
        level: cell.level,
        aircraft: cell.total,
        lowIntegrity: cell.bad,
        ratio: cell.ratio,
      }));
    },

    getStats() {
      const degraded = state.cells.filter(
        (cell) => cell.level !== 'low',
      ).length;
      return {
        count: degraded,
        countLabel: interferenceCountLabel(state.cells),
        cells: state.cells.length,
        aircraftSampled: state.aircraftSampled,
        lastUpdate: state.lastUpdate,
        error: state.error,
        stale: state.stale,
        partial: state.partial,
        loading: state.loading,
        status: state.status,
        loadingLabel: state.loading
          ? 'sampling ADS-B integrity'
          : state.error && /429|rate|unavailable/i.test(String(state.error))
            ? 'adsb.lol rate limit · retrying'
            : state.lastUpdate && state.cells.length && !degraded
              ? 'no interference in view · hotspots: Baltic, E. Med, Black Sea'
              : '',
      };
    },
  };
  return layer;
}
