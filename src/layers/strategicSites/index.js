import * as Cesium from 'cesium';
import { siteClassLabel } from './classLabels.js';
import {
  createLocalInfrastructureOverlayEntry,
  mapAnalystRecord,
} from '../../data/localGeojsonCore.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  classColor,
  isMajorSite,
  hasRealName,
  parseSiteLines,
  selectLabelCohort,
  siteTier,
  tierVisible,
} from './model.js';

export * from './model.js';

const LABEL_HOST_OPTIONS = Object.freeze({
  cohortLimit: 160,
  collisionCapacity: 160,
  moving: false,
});
/** Above this camera height no site titles are published. */
const LABEL_MAX_HEIGHT_M = 3_500_000;
/** Height bands (m) where the visible tier set changes. */
const SITE_BANDS = [4_000_000, 1_500_000];
/** Above this camera height the cohort only considers tier-0 sites. */
const GLOBE_SCALE_HEIGHT_M = 6_000_000;

/**
 * A bundled strategic-site layer drawn with one GPU point collection.
 *
 * The generic GeoJSON layer builds a Cesium entity with a stem per feature,
 * which is fine for a few thousand datacenters but freezes the page at the
 * 20k military bases this dataset carries. Points here cost one primitive
 * collection; titles go through the shared overlay host for the best
 * candidates on screen only, recomputed when the camera settles.
 *
 * @param {object} options
 * @param {object} options.spec `STRATEGIC_LAYER_SPECS` entry (id, url, name, color, icon, source, osmDerived, labelMax, labelGridPx).
 * @param {object} options.services Context, overlay and credit operations
 *   (same shape as `localGeoJsonServices`).
 * @param {Function} [options.fetchImpl]
 */
export function createStrategicSitesLayer({
  spec,
  services,
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  const {
    overlayHost,
    registerEntityContext,
    selectEntityContext,
    clearSelectedEntityContextForLayer,
    removeEntityContextsForLayer,
    governorRequestRender,
    showOsmCredit,
    hideOsmCredit,
  } = services;
  const id = spec.id;
  const baseColor = Cesium.Color.fromCssColorString(spec.color);
  let viewer = null;
  let collection = null;
  let records = null;
  let loadPromise = null;
  let loadController = null;
  let enabled = false;
  let clickHandler = null;
  let removeMoveEnd = null;
  let lastUpdate = null;
  let error = null;
  const pseudoEntities = new Map();

  async function load() {
    if (records) return records;
    loadController = new AbortController();
    const response = await fetchImpl(spec.url, {
      signal: loadController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    records = parseSiteLines(text);
    // Highest priority last so it paints on top of neighbours.
    records.sort((a, b) => a.priority - b.priority);
    return records;
  }

  function buildPoints() {
    if (!collection || !records || collection.length) return;
    for (const record of records) {
      const major = isMajorSite(record.properties);
      const color = Cesium.Color.fromCssColorString(
        classColor(record.properties.class, spec.color),
      );
      record.position = Cesium.Cartesian3.fromDegrees(
        record.lon,
        record.lat,
        30,
      );
      record.tier = siteTier(record.properties);
      record.point = collection.add({
        position: record.position,
        pixelSize: major ? 8 : 5,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        outlineWidth: 1.5,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.6, 1.5e7, 0.7),
        // Never depth-tested: relief and 3D tiles clipped these sea-level
        // points. The far side of the globe is hidden by applyLod's
        // ellipsoid occlusion test instead.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: record,
      });
    }
  }

  let lodHeightBand = -1;
  /** Show only the detail tiers the camera height allows. */
  // Type filter (multi-select chips in the layer row): hidden classes.
  const hiddenClasses = new Set();
  let rowControlsListener = null;
  const classOf = (record) => String(record?.properties?.class || 'other');
  function classCounts() {
    const counts = new Map();
    for (const record of records || [])
      counts.set(classOf(record), (counts.get(classOf(record)) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }
  function refreshClassFilter() {
    applyLod(viewer?.camera?.positionCartographic?.height ?? Infinity, {
      force: true,
    });
    publishLabels();
    rowControlsListener?.();
  }

  let lastOcclusionAt = 0;
  const lastCameraPosition = new Cesium.Cartesian3();
  function applyLod(height, { force = false } = {}) {
    const band = SITE_BANDS.findIndex((limit) => height >= limit);
    const key = band < 0 ? SITE_BANDS.length : band;
    const camera = viewer?.scene?.camera;
    const moved =
      camera &&
      !Cesium.Cartesian3.equalsEpsilon(
        camera.positionWC,
        lastCameraPosition,
        0,
        1,
      );
    if (key === lodHeightBand && !moved && !force) return;
    lodHeightBand = key;
    if (camera) Cesium.Cartesian3.clone(camera.positionWC, lastCameraPosition);
    // Points behind the Earth stay hidden (they are not depth-tested).
    const occluder = camera
      ? new Cesium.EllipsoidalOccluder(
          Cesium.Ellipsoid.WGS84,
          camera.positionWC,
        )
      : null;
    for (const record of records || [])
      if (record.point)
        record.point.show =
          tierVisible(record.tier, height) &&
          !hiddenClasses.has(classOf(record)) &&
          (!occluder || occluder.isPointVisible(record.position));
    governorRequestRender?.(`strategic-lod:${id}`);
  }
  // Re-test occlusion while the globe turns (throttled).
  function onPreRender() {
    if (!enabled || !viewer) return;
    const nowMs = performance.now();
    if (nowMs - lastOcclusionAt < 150) return;
    lastOcclusionAt = nowMs;
    applyLod(viewer.camera.positionCartographic?.height ?? Infinity);
  }

  function publishLabels() {
    if (!enabled || !viewer || !records?.length || !overlayHost) return;
    const scene = viewer.scene;
    const camera = scene.camera;
    const height = camera.positionCartographic?.height ?? Infinity;
    applyLod(height);
    // From farther away the shared host fades cards to near-transparent
    // boxes; leave the markers alone until the view is regional.
    if (height > LABEL_MAX_HEIGHT_M) {
      overlayHost.clearSource(id);
      return;
    }
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      camera.positionWC,
    );
    const width = scene.canvas.clientWidth;
    const heightPx = scene.canvas.clientHeight;
    const scratch = new Cesium.Cartesian2();
    const candidates = [];
    for (const record of records) {
      if (!record.position || !record.point?.show) continue;
      if (!hasRealName(record.properties.name)) continue;
      if (height > GLOBE_SCALE_HEIGHT_M && record.tier !== 0) continue;
      if (!occluder.isPointVisible(record.position)) continue;
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(
        scene,
        record.position,
        scratch,
      );
      if (
        !screen ||
        screen.x < 0 ||
        screen.y < 0 ||
        screen.x > width ||
        screen.y > heightPx
      )
        continue;
      candidates.push({ record, x: screen.x, y: screen.y });
    }
    const cohort = selectLabelCohort(candidates, {
      gridPx: spec.labelGridPx || 130,
      max: Math.min(spec.labelMax || 120, LABEL_HOST_OPTIONS.cohortLimit),
    });
    overlayHost.setEntries(
      id,
      cohort.map(({ record }) =>
        createLocalInfrastructureOverlayEntry({
          id: record.id,
          layerId: id,
          position: record.position,
          properties: record.properties,
          priority: record.priority,
          accent: classColor(record.properties.class, spec.color),
        }),
      ),
      LABEL_HOST_OPTIONS,
    );
    overlayHost.setVisible(id, true);
  }

  function contextEntity(record) {
    let entity = pseudoEntities.get(record.id);
    if (!entity) {
      entity = { id: `${id}:${record.id}`, show: true };
      pseudoEntities.set(record.id, entity);
      registerEntityContext(entity, {
        id: `${id}:${record.id}`,
        layerId: id,
        layerName: spec.name,
        source: spec.source,
        label: record.properties.name || spec.name,
        properties: record.properties,
        latitude: Number(record.lat.toFixed(6)),
        longitude: Number(record.lon.toFixed(6)),
      });
    }
    return entity;
  }

  function bindInput() {
    if (clickHandler || !viewer) return;
    clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandler.setInputAction((click) => {
      if (!enabled || !isPointerFree()) return;
      const picked = viewer.scene.pick(click.position);
      if (picked?.collection !== collection || !picked?.id) return;
      selectEntityContext(contextEntity(picked.id));
      governorRequestRender?.(`strategic-select:${id}`);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    const onMoveEnd = () => publishLabels();
    viewer.camera.moveEnd.addEventListener(onMoveEnd);
    viewer.scene.preRender.addEventListener(onPreRender);
    removeMoveEnd = () => {
      viewer?.camera?.moveEnd.removeEventListener(onMoveEnd);
      viewer?.scene?.preRender.removeEventListener(onPreRender);
    };
  }

  function releaseInput() {
    clickHandler?.destroy();
    clickHandler = null;
    removeMoveEnd?.();
    removeMoveEnd = null;
  }

  const layer = {
    id,
    name: spec.name,
    icon: spec.icon,
    source: spec.source,
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
      collection = new Cesium.PointPrimitiveCollection();
      collection.show = false;
      viewer.scene.primitives.add(collection);
      overlayHost?.setVisible(id, false);
    },

    async enable() {
      enabled = true;
      error = null;
      try {
        loadPromise ||= load();
        await loadPromise;
      } catch (loadError) {
        loadPromise = null;
        if (loadError?.name !== 'AbortError')
          error = loadError?.message || 'Dataset unavailable';
        return;
      }
      if (!enabled || !collection) return;
      buildPoints();
      lodHeightBand = -1;
      applyLod(viewer.camera.positionCartographic?.height ?? Infinity);
      collection.show = true;
      lastUpdate = Date.now();
      bindInput();
      publishLabels();
      if (spec.osmDerived) showOsmCredit?.(viewer, id);
      governorRequestRender?.(`strategic-enable:${id}`);
    },

    disable() {
      enabled = false;
      if (collection) collection.show = false;
      releaseInput();
      overlayHost?.clearSource(id);
      overlayHost?.setVisible(id, false);
      clearSelectedEntityContextForLayer?.(id);
      if (spec.osmDerived) hideOsmCredit?.(viewer, id);
      governorRequestRender?.(`strategic-disable:${id}`);
    },

    // Static dataset: nothing to refresh. A falsy result would read as a
    // rejected lifecycle transition, so confirm while the layer is active.
    async update() {
      return enabled && !error;
    },

    destroy() {
      enabled = false;
      loadController?.abort();
      releaseInput();
      overlayHost?.clearSource(id);
      overlayHost?.setVisible(id, false);
      removeEntityContextsForLayer?.(id);
      pseudoEntities.clear();
      if (spec.osmDerived) hideOsmCredit?.(viewer, id);
      if (collection && viewer && !viewer.isDestroyed?.())
        viewer.scene.primitives.remove(collection);
      collection = null;
      viewer = null;
    },

    /** Type chips: "All" plus one chip per class present (multi-select). */
    getRowControls() {
      const counts = classCounts();
      if (counts.length < 2) return null;
      return {
        chips: [
          {
            id: 'class-all',
            label: 'All',
            title: 'Show every type',
            active: hiddenClasses.size === 0,
            onClick: () => {
              hiddenClasses.clear();
              refreshClassFilter();
            },
          },
          ...counts.map(([cls, count]) => ({
            id: `class-${cls}`,
            label: siteClassLabel(cls),
            title: `${count.toLocaleString('en-US')} sites`,
            active: !hiddenClasses.has(cls),
            onClick: () => {
              // From "All", the first click isolates that type; later
              // clicks add or remove types.
              if (hiddenClasses.size === 0) {
                for (const [other] of counts)
                  if (other !== cls) hiddenClasses.add(other);
              } else if (hiddenClasses.has(cls)) hiddenClasses.delete(cls);
              else hiddenClasses.add(cls);
              if (hiddenClasses.size === counts.length) hiddenClasses.clear();
              refreshClassFilter();
            },
          })),
        ],
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      return {
        count: enabled && records ? records.length : 0,
        lastUpdate,
        error,
        status: error ? 'error' : undefined,
        loading: enabled && !records && !error,
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !records) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, maxCount) : 2000;
      const out = [];
      for (let i = records.length - 1; i >= 0 && out.length < limit; i--) {
        const record = records[i];
        out.push(
          mapAnalystRecord(
            {
              id: record.id,
              lat: record.lat,
              lon: record.lon,
              properties: record.properties,
            },
            id,
          ),
        );
      }
      return out;
    },
  };
  return layer;
}
