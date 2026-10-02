import * as Cesium from 'cesium';
import {
  RADIATION_BANDS,
  RADIATION_DEFAULT_DAYS,
  RADIATION_WINDOWS,
  mapRadiationAnalystRecords,
  radiationBand,
  radiationColor,
} from './records.js';
export * from './records.js';
export { createRadiationSource } from './source.js';

export const RADIATION_OVERLAY_SOURCE_ID = 'radiation';
export const RADIATION_OVERLAY_COHORT_LIMIT = 80;
export const RADIATION_OVERLAY_COLLISION_CAPACITY = 40;
const CPM_NOTE = 'CPM depends on the Geiger tube — not a dose rate';

const colorCache = new Map();
function cesiumColor(css) {
  let color = colorCache.get(css);
  if (!color) {
    color = Cesium.Color.fromCssColorString(css);
    colorCache.set(css, color);
  }
  return color;
}

/** Ambient label for one realtime device. */
export function createRadiationOverlayEntry({ device, position }) {
  return {
    id: `radiation:${device.id}`,
    position,
    variant: 'label',
    title: `${Math.round(device.cpm)} CPM`,
    accent: radiationColor(device.cpm),
    priority: Math.round(device.cpm * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 12,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the hottest readings, stable identity as the tie-break. */
export function selectRadiationOverlayCohort(
  entries,
  limit = RADIATION_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(RADIATION_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
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

/**
 * Own one Safecast display: measurement cells as draped rectangles and
 * realtime devices as points with CPM labels.
 * @param {object} options
 * @param {{getSnapshot: Function}} options.source Snapshot source.
 * @param {object} options.overlayHost World-overlay host.
 * @param {() => number} [options.now] Clock seam.
 */
/**
 * INTEL context for one clicked radiation entity (device or map cell).
 * Pure: takes the entity's id, position and property bag values.
 */
export function radiationContext({ id, lat, lon, props = {} }) {
  const kind = props.kind === 'device' ? 'device' : 'cell';
  const cpm = kind === 'device' ? props.cpm : props.meanCpm;
  const band = radiationBand(Number(cpm));
  const when = Number(kind === 'device' ? props.captured : props.latest);
  const name =
    kind === 'device'
      ? props.name || 'Safecast device'
      : 'Safecast measurement cell';
  // The site dossier lists  as its DETAILS rows.
  const tags = {
    level: band.label,
    ...(kind === 'device'
      ? { cpm: props.cpm, tube: props.tube || null }
      : {
          mean_cpm: props.meanCpm,
          max_cpm: props.maxCpm,
          measurements: props.count,
        }),
    last_reading: Number.isFinite(when) ? new Date(when).toISOString() : null,
    note: CPM_NOTE,
  };
  const properties = { name, source: 'Safecast', tags };
  return {
    id,
    layerId: 'radiation',
    layerName: 'Radiation (Safecast)',
    source: 'Safecast',
    label: properties.name,
    properties,
    latitude: Number(Number(lat).toFixed(6)),
    longitude: Number(Number(lon).toFixed(6)),
  };
}

export function createRadiationLayer({
  source,
  overlayHost,
  now = () => Date.now(),
  // Optional context-store hooks: clicking a point opens its INTEL dossier.
  registerEntityContext = null,
  selectEntityContext = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Radiation requires a snapshot source');
  if (!overlayHost) throw new TypeError('Radiation requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _clickHandler = null;
  const _params = { days: RADIATION_DEFAULT_DAYS };

  function bindClicks(viewer) {
    if (_clickHandler || !viewer || typeof selectEntityContext !== 'function')
      return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled || document.body.classList.contains('gev-drawing')) return;
      const picked = viewer.scene.pick(click.position);
      const entity = picked?.id;
      if (!(entity instanceof Cesium.Entity)) return;
      if (!String(entity.id).startsWith('radiation:')) return;
      const time = viewer.clock.currentTime;
      const carto = Cesium.Cartographic.fromCartesian(
        entity.position?.getValue(time),
      );
      if (!carto) return;
      const context = radiationContext({
        id: entity.id,
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
        props: entity.properties?.getValue(time) || {},
      });
      registerEntityContext?.(entity, context);
      selectEntityContext(entity);
      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function render() {
    if (!_dataSource || !_snapshot) return;
    const entities = [];
    const overlayEntries = [];
    for (const cell of _snapshot.cells) {
      const color = cesiumColor(radiationColor(cell.meanCpm));
      entities.push(
        new Cesium.Entity({
          id: `radiation:${cell.id}`,
          position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat),
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              cell.west,
              cell.south,
              cell.east,
              cell.north,
            ),
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            kind: 'cell',
            meanCpm: cell.meanCpm,
            maxCpm: cell.maxCpm,
            count: cell.count,
            latest: cell.latestMs,
          },
        }),
      );
    }
    for (const device of _snapshot.devices) {
      const color = cesiumColor(radiationColor(device.cpm));
      const position = Cesium.Cartesian3.fromDegrees(device.lon, device.lat);
      entities.push(
        new Cesium.Entity({
          id: `radiation:${device.id}`,
          position,
          point: {
            pixelSize: 8,
            color: color.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            kind: 'device',
            name: device.name,
            cpm: device.cpm,
            tube: device.tube,
            captured: device.capturedMs,
          },
        }),
      );
      overlayEntries.push(createRadiationOverlayEntry({ device, position }));
    }
    _dataSource.entities.suspendEvents();
    _dataSource.entities.removeAll();
    for (const entity of entities) _dataSource.entities.add(entity);
    _dataSource.entities.resumeEvents();
    if (_enabled)
      overlayHost.setEntries(
        RADIATION_OVERLAY_SOURCE_ID,
        selectRadiationOverlayCohort(overlayEntries),
        {
          cohortLimit: RADIATION_OVERLAY_COHORT_LIMIT,
          collisionCapacity: RADIATION_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
  }

  const layer = {
    id: 'radiation',
    name: 'Radiation (Safecast)',
    icon: '☢',
    source: 'Safecast',
    updateInterval: 30 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Radiation layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('radiation');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      bindClicks(viewer);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(RADIATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      _loading = true;
      try {
        const snapshot = await source.getSnapshot({
          days: _params.days,
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _snapshot = snapshot;
        render();
        _lastUpdate = now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Radiation] Fetch error:', error);
        _lastError = error?.message || 'Safecast unavailable';
        return false;
      } finally {
        if (_request === request) {
          _request = null;
          _loading = false;
        }
      }
    },

    destroy(viewer = _viewer) {
      _clickHandler?.destroy();
      _clickHandler = null;
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      overlayHost.clearSource(RADIATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getParams() {
      return { days: _params.days };
    },

    setParams(params = {}) {
      const days = Number(params?.days);
      if (!RADIATION_WINDOWS.includes(days)) return false;
      if (days === _params.days) return true;
      _params.days = days;
      if (_enabled && _viewer)
        Promise.resolve()
          .then(() => layer.update(_viewer))
          .catch(() => {});
      return true;
    },

    getRowControls() {
      const counts = new Map();
      for (const cell of _snapshot?.cells || [])
        counts.set(
          radiationBand(cell.meanCpm).id,
          (counts.get(radiationBand(cell.meanCpm).id) || 0) + 1,
        );
      for (const device of _snapshot?.devices || [])
        counts.set(
          radiationBand(device.cpm).id,
          (counts.get(radiationBand(device.cpm).id) || 0) + 1,
        );
      const notes = [CPM_NOTE];
      if (_snapshot)
        notes.unshift(
          `${_snapshot.counts.measurements} readings · ${_snapshot.devices.length} live sensors`,
        );
      if (_snapshot?.degraded) notes.push(_snapshot.degraded);
      return {
        chips: RADIATION_WINDOWS.map((days) => ({
          id: `days-${days}`,
          label: `${days}D`,
          active: _params.days === days,
          params: { days },
        })),
        legend: RADIATION_BANDS.map((band, index) => ({
          label: band.label,
          color: band.color,
          count: counts.get(band.id) || 0,
          ...(index === 0
            ? {
                blurb:
                  'Cells average Safecast community readings over 0.25°; points are realtime sensors. Safecast data is CC0.',
              }
            : {}),
        })),
        info: notes.join(' — '),
        infoTitle:
          'Counts per minute are tube-specific. Typical background is 10–40 CPM on an LND 7317/7318 tube.',
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return mapRadiationAnalystRecords(_snapshot)
        .sort((a, b) => b.cpm - a.cpm)
        .slice(0, limit);
    },

    getStats() {
      const cells = _snapshot?.cells.length || 0;
      const devices = _snapshot?.devices.length || 0;
      return {
        count: cells + devices,
        countLabel:
          cells + devices ? `${cells} cells · ${devices} live` : undefined,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        stale: Boolean(_snapshot?.stale),
      };
    },
  };
  return layer;
}
