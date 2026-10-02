import * as Cesium from 'cesium';
import {
  DISASTER_OVERLAY_COHORT_LIMIT,
  DISASTER_OVERLAY_COLLISION_CAPACITY,
  DISASTER_OVERLAY_SOURCE_ID,
  createDisasterOverlayEntry,
  disasterColor,
  selectDisasterOverlayCohort,
} from './model.js';
import {
  DISASTER_DEFAULT_MIN_LEVEL,
  DISASTER_LEVELS,
  DISASTER_MIN_LEVELS,
  disasterLevelRadius,
  disasterPassesFilter,
  mapDisasterAnalystRecord,
} from './records.js';
export * from './model.js';
export * from './records.js';
export { createDisasterSource } from './source.js';

const CHIP_LABELS = Object.freeze({
  all: 'ALL',
  orange: 'ORANGE+',
  red: 'RED',
});

/**
 * Own one disaster-alert display: GDACS alert discs (colour = alert level)
 * and NASA EONET open events, with ambient cards.
 * @param {object} options
 * @param {{getSnapshot: Function}} options.source Snapshot source.
 * @param {object} options.overlayHost World-overlay host.
 * @param {() => number} [options.now] Clock seam.
 */
export function createDisastersLayer({
  source,
  overlayHost,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Disaster alerts require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Disaster alerts require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _rows = [];
  let _shown = [];
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  const _params = { minLevel: DISASTER_DEFAULT_MIN_LEVEL };

  function render() {
    if (!_dataSource) return;
    const nowMs = now();
    _shown = _rows.filter((row) =>
      disasterPassesFilter(row.level, _params.minLevel),
    );
    const entities = [];
    const overlayEntries = [];
    for (const row of _shown) {
      const color = disasterColor(row.level);
      const radius = disasterLevelRadius(row.level);
      const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
      entities.push(
        new Cesium.Entity({
          id: `disaster:${row.id}`,
          position,
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.22)),
            outline: true,
            outlineColor: color.withAlpha(0.9),
            outlineWidth: row.level === 'red' ? 3 : 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          point: {
            pixelSize: row.level === 'info' ? 6 : 8,
            color: color.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            type: row.type,
            level: row.level,
            source: row.source,
            title: row.title,
            country: row.country,
            severity: row.severityText,
            updated: row.updatedMs,
          },
        }),
      );
      overlayEntries.push(createDisasterOverlayEntry({ row, position, nowMs }));
    }
    _dataSource.entities.suspendEvents();
    _dataSource.entities.removeAll();
    for (const entity of entities) _dataSource.entities.add(entity);
    _dataSource.entities.resumeEvents();
    if (_enabled)
      overlayHost.setEntries(
        DISASTER_OVERLAY_SOURCE_ID,
        selectDisasterOverlayCohort(overlayEntries),
        {
          cohortLimit: DISASTER_OVERLAY_COHORT_LIMIT,
          collisionCapacity: DISASTER_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
  }

  const layer = {
    id: 'disaster-alerts',
    name: 'Disaster Alerts',
    icon: '⚠',
    source: 'GDACS · NASA EONET',
    updateInterval: 10 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Disaster layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('disaster-alerts');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _shown = [];
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(DISASTER_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(DISASTER_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(DISASTER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DISASTER_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      _loading = true;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _snapshot = snapshot;
        _rows = snapshot.rows;
        render();
        _lastUpdate = now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Disasters] Fetch error:', error);
        _lastError = error?.message || 'Disaster feed unavailable';
        return false;
      } finally {
        if (_request === request) {
          _request = null;
          _loading = false;
        }
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      overlayHost.clearSource(DISASTER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DISASTER_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _rows = [];
      _shown = [];
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getParams() {
      return { minLevel: _params.minLevel };
    },

    setParams(params = {}) {
      const minLevel = String(params?.minLevel || '');
      if (!DISASTER_MIN_LEVELS.includes(minLevel)) return false;
      if (minLevel === _params.minLevel) return true;
      _params.minLevel = minLevel;
      if (_enabled) render();
      return true;
    },

    getRowControls() {
      const counts = new Map();
      for (const row of _rows)
        counts.set(row.level, (counts.get(row.level) || 0) + 1);
      const notes = [];
      if (_snapshot)
        notes.push(
          `GDACS ${_snapshot.counts.GDACS} · EONET ${_snapshot.counts.EONET}`,
        );
      if (_shown.length !== _rows.length)
        notes.push(`${_shown.length} of ${_rows.length} shown`);
      if (_snapshot?.degraded) notes.push(_snapshot.degraded);
      return {
        chips: DISASTER_MIN_LEVELS.map((minLevel) => ({
          id: `level-${minLevel}`,
          label: CHIP_LABELS[minLevel],
          active: _params.minLevel === minLevel,
          params: { minLevel },
        })),
        legend: DISASTER_LEVELS.filter((level) => counts.has(level.id)).map(
          (level, index) => ({
            label: level.label,
            color: level.color,
            count: counts.get(level.id),
            ...(index === 0
              ? {
                  blurb:
                    'GDACS alert level estimates humanitarian impact; EONET rows are NASA-curated natural events without a level.',
                }
              : {}),
          }),
        ),
        info: notes.join(' — '),
        infoTitle:
          'Disc size follows the alert level, not the physical footprint of the event.',
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_shown.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _shown.slice(0, limit).map(mapDisasterAnalystRecord);
    },

    getStats() {
      return {
        count: _shown.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        stale: Boolean(_snapshot?.stale),
      };
    },
  };
  return layer;
}
