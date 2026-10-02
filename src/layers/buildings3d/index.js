import * as Cesium from 'cesium';
import {
  BUILDING_ZOOM,
  buildingColor,
  buildingTilesForView,
  createLruCache,
} from './records.js';

export * from './records.js';
export { createOpenFreeMapBuildingsSource } from './source.js';

/** Buildings only load below this camera height (metres above ground). */
export const BUILDINGS_MAX_CAMERA_HEIGHT_M = 4000;
/** Tiles requested per settled view. */
const TILES_PER_VIEW = 12;
/** Tile primitives kept around for panning back (GPU memory bound). */
const TILE_PRIMITIVE_CACHE = 28;
const MOVE_DEBOUNCE_MS = 450;

/**
 * 3D buildings without Google: Cesium OSM Buildings through ion when a token
 * exists, otherwise footprints from OpenFreeMap vector tiles extruded to their
 * OpenStreetMap heights. Hidden while the photorealistic Google stack is the
 * active map (it already carries buildings).
 *
 * @param {object} options
 * @param {object} options.source `createOpenFreeMapBuildingsSource()` result.
 * @param {string} [options.ionToken] Cesium ion token for OSM Buildings.
 */
export function createBuildings3dLayer({ source, ionToken = '' } = {}) {
  if (typeof source?.getTiles !== 'function')
    throw new TypeError('3D buildings require a tile source');
  const token = String(ionToken || '').trim();
  let viewer = null;
  let enabled = false;
  let mode = token ? 'ion' : 'vector';
  let ionTileset = null;
  let ionLoad = null;
  let root = null;
  let request = null;
  let moveTimer = null;
  let removeMoveEnd = null;
  let suppressed = false;
  let lastError = null;
  let lastUpdate = null;
  let status = undefined;
  let visibleCount = 0;
  const primitives = createLruCache(TILE_PRIMITIVE_CACHE, (entry) => {
    if (entry?.primitive && root && !root.isDestroyed?.())
      root.remove(entry.primitive);
  });

  const onMapStack = (event) => {
    suppressed = event?.detail?.activeId === 'photoreal';
    applyVisibility();
    if (!suppressed) scheduleRefresh(0);
  };

  function applyVisibility() {
    const show = enabled && !suppressed;
    if (root) root.show = show && mode === 'vector';
    if (ionTileset) ionTileset.show = show && mode === 'ion';
    viewer?.scene?.requestRender?.();
  }

  function cameraHeight() {
    const carto = viewer?.camera?.positionCartographic;
    if (!carto) return Infinity;
    const ground = viewer.scene.globe?.getHeight?.(carto);
    return carto.height - (Number.isFinite(ground) ? ground : 0);
  }

  function viewBounds() {
    const rect = viewer.camera.computeViewRectangle(
      viewer.scene.globe.ellipsoid,
    );
    if (!rect) return null;
    return {
      west: Cesium.Math.toDegrees(rect.west),
      east: Cesium.Math.toDegrees(rect.east),
      south: Cesium.Math.toDegrees(rect.south),
      north: Cesium.Math.toDegrees(rect.north),
    };
  }

  /**
   * Ground height under each building. The rendered globe answers first (it
   * is what the buildings must sit on); terrain sampling fills the gaps, and
   * anything still unknown takes the median of its neighbours so a tile never
   * ends up buried at the ellipsoid.
   */
  async function groundHeights(buildings) {
    const globe = viewer.scene.globe;
    const positions = buildings.map((b) =>
      Cesium.Cartographic.fromDegrees(b.centroid[0], b.centroid[1]),
    );
    const heights = positions.map((p) => {
      const h = globe?.getHeight?.(p);
      return Number.isFinite(h) ? h : null;
    });
    const missing = [];
    heights.forEach((h, i) => {
      if (h === null) missing.push(i);
    });
    const provider = viewer.terrainProvider;
    if (
      missing.length &&
      provider &&
      !(provider instanceof Cesium.EllipsoidTerrainProvider)
    ) {
      try {
        const sampled = await Cesium.sampleTerrainMostDetailed(
          provider,
          missing.map((i) => positions[i].clone()),
        );
        sampled.forEach((p, k) => {
          if (Number.isFinite(p.height)) heights[missing[k]] = p.height;
        });
      } catch {
        /* provider without sampling support: fall through to the median */
      }
    }
    const known = heights.filter((h) => h !== null).sort((a, b) => a - b);
    const median = known.length ? known[Math.floor(known.length / 2)] : 0;
    return heights.map((h) => (h === null ? median : h));
  }

  async function buildTile(decoded, signal) {
    if (!decoded?.buildings?.length || primitives.has(decoded.tile)) return;
    const ground = await groundHeights(decoded.buildings);
    if (signal.aborted || !enabled || !root) return;
    const instances = [];
    decoded.buildings.forEach((building, index) => {
      const base = ground[index];
      const flat = building.ring.flatMap(([lon, lat]) => [lon, lat]);
      try {
        instances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(
                Cesium.Cartesian3.fromDegreesArray(flat),
              ),
              height: base + building.minHeight,
              extrudedHeight: base + building.height,
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                new Cesium.Color(...buildingColor(building.height), 1),
              ),
            },
            id: building.id,
          }),
        );
      } catch {
        /* degenerate footprint */
      }
    });
    if (!instances.length) return;
    const primitive = new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: true,
      }),
      asynchronous: true,
      releaseGeometryInstances: true,
      allowPicking: false,
      shadows: Cesium.ShadowMode.DISABLED,
    });
    root.add(primitive);
    primitives.set(decoded.tile, {
      primitive,
      count: instances.length,
      base: Math.round(ground[0] ?? 0),
    });
    visibleCount = primitives.values().reduce((n, e) => n + e.count, 0);
    viewer.scene.requestRender?.();
  }

  async function refresh() {
    if (!enabled || !viewer || suppressed || mode !== 'vector') return;
    const height = cameraHeight();
    if (height > BUILDINGS_MAX_CAMERA_HEIGHT_M) {
      status = 'zoom-in';
      return;
    }
    status = undefined;
    const bounds = viewBounds();
    if (!bounds) return;
    const focus = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(
        viewer.scene.canvas.clientWidth / 2,
        viewer.scene.canvas.clientHeight / 2,
      ),
    );
    let focusDeg = null;
    if (focus) {
      const c = Cesium.Cartographic.fromCartesian(focus);
      focusDeg = {
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
      };
    }
    const wanted = buildingTilesForView(
      bounds,
      focusDeg,
      TILES_PER_VIEW,
    ).filter((tile) => !primitives.has(`${tile.z}/${tile.x}/${tile.y}`));
    for (const tile of buildingTilesForView(bounds, focusDeg, TILES_PER_VIEW))
      primitives.get(`${tile.z}/${tile.x}/${tile.y}`); // touch for LRU
    if (!wanted.length) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const builds = [];
    try {
      await source.getTiles(wanted, {
        signal: controller.signal,
        onTile: (decoded) => builds.push(buildTile(decoded, controller.signal)),
      });
      await Promise.all(builds);
      lastUpdate = Date.now();
      lastError = null;
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      lastError = error?.message || '3D buildings unavailable';
    } finally {
      if (request === controller) request = null;
    }
  }

  function scheduleRefresh(delay = MOVE_DEBOUNCE_MS) {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moveTimer = null;
      refresh();
    }, delay);
  }

  async function ensureIon() {
    if (ionTileset || mode !== 'ion') return;
    // Cesium OSM Buildings (ion asset 96188) with an explicit token, so the
    // SDK-wide default token is never touched.
    ionLoad ||= Cesium.IonResource.fromAssetId(96188, { accessToken: token })
      .then((resource) => Cesium.Cesium3DTileset.fromUrl(resource))
      .then((tileset) => {
        tileset.style = new Cesium.Cesium3DTileStyle({
          color: "color('#5c6169')",
        });
        return tileset;
      })
      .catch((error) => {
        // ion unreachable or token refused: fall back to the keyless path.
        console.warn('[Buildings3D] Cesium OSM Buildings unavailable:', error);
        mode = 'vector';
        return null;
      });
    const tileset = await ionLoad;
    if (!tileset) return;
    if (!viewer || viewer.isDestroyed?.()) {
      tileset.destroy();
      return;
    }
    ionTileset = tileset;
    viewer.scene.primitives.add(ionTileset);
  }

  const layer = {
    id: 'osm-buildings-3d',
    name: '3D Buildings (OSM)',
    icon: '🏙',
    source: token ? 'Cesium OSM Buildings · OpenFreeMap' : 'OpenFreeMap · OSM',
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
      root = new Cesium.PrimitiveCollection();
      root.show = false;
      viewer.scene.primitives.add(root);
      suppressed = Boolean(globalThis.window?.__panoptesMapStatus?.photoreal);
      globalThis.window?.addEventListener?.(
        'gev:map-stack-changed',
        onMapStack,
      );
    },

    async enable() {
      enabled = true;
      if (mode === 'ion') await ensureIon();
      if (!enabled) return;
      applyVisibility();
      if (!removeMoveEnd) {
        const onMove = () => scheduleRefresh();
        viewer.camera.moveEnd.addEventListener(onMove);
        removeMoveEnd = () =>
          viewer?.camera?.moveEnd.removeEventListener(onMove);
      }
      scheduleRefresh(0);
    },

    disable() {
      enabled = false;
      clearTimeout(moveTimer);
      moveTimer = null;
      request?.abort();
      request = null;
      removeMoveEnd?.();
      removeMoveEnd = null;
      applyVisibility();
    },

    // Camera-driven: no periodic work. A falsy value would read as a rejected
    // lifecycle transition, so confirm while the layer is active.
    async update() {
      return enabled;
    },

    destroy() {
      layer.disable();
      globalThis.window?.removeEventListener?.(
        'gev:map-stack-changed',
        onMapStack,
      );
      primitives.clear();
      if (viewer && !viewer.isDestroyed?.()) {
        if (root) viewer.scene.primitives.remove(root);
        if (ionTileset) viewer.scene.primitives.remove(ionTileset);
      }
      root = null;
      ionTileset = null;
      viewer = null;
      source.clear?.();
    },

    getStats() {
      return {
        count: enabled ? (mode === 'ion' ? 1 : visibleCount) : 0,
        countLabel:
          enabled && mode === 'ion'
            ? 'ion'
            : enabled && visibleCount
              ? `${visibleCount.toLocaleString('en-US')} bldg`
              : undefined,
        lastUpdate,
        lastError,
        status: suppressed ? undefined : status,
      };
    },

    /** Diagnostics for QA: active path and loaded tiles. */
    getDiagnostics() {
      return {
        mode,
        suppressed,
        zoom: BUILDING_ZOOM,
        tiles: primitives.keys(),
        buildings: visibleCount,
        primitivesReady: primitives.values().filter((e) => e.primitive.ready)
          .length,
        bases: primitives.values().map((e) => e.base),
      };
    },
  };
  return layer;
}
