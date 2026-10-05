import * as Cesium from 'cesium';
import {
  CONFLICT_DISC_LIMIT,
  CONFLICT_OVERLAY_COHORT_LIMIT,
  CONFLICT_OVERLAY_COLLISION_CAPACITY,
  CONFLICT_OVERLAY_SOURCE_ID,
  conflictColor,
  createConflictOverlayEntry,
  selectConflictOverlayCohort,
} from './model.js';
import {
  CONFLICT_DEFAULT_HOURS,
  CONFLICT_KINDS,
  CONFLICT_WINDOWS,
  conflictRadiusMeters,
  conflictWeight,
  mapConflictAnalystRecord,
} from './records.js';
export * from './model.js';
export * from './records.js';
export { createConflictSource } from './source.js';

const GDELT_NOTE = 'GDELT is machine-coded news, not verified incidents';

/**
 * Own one conflict-event display: GDELT mention clusters plus optional
 * UCDP/ACLED rows, as ground points, discs for the most-reported events and
 * ambient cards for the top cohort.
 * @param {object} options
 * @param {{getSnapshot: Function}} options.source Snapshot source.
 * @param {object} options.overlayHost World-overlay host.
 * @param {() => number} [options.now] Clock seam.
 */
export function createConflictsLayer({
  source,
  overlayHost,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Conflict events require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Conflict events require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _rows = [];
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  const _params = { hours: CONFLICT_DEFAULT_HOURS };

  function render() {
    if (!_dataSource) return;
    const nowMs = now();
    const ranked = _rows
      .slice()
      .sort((a, b) => conflictWeight(b) - conflictWeight(a));
    const entities = [];
    const overlayEntries = [];
    ranked.forEach((row, index) => {
      const color = conflictColor(row.kind);
      const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
      const disc = index < CONFLICT_DISC_LIMIT;
      entities.push(
        new Cesium.Entity({
          id: `conflict:${row.id}`,
          position,
          point: {
            pixelSize: disc ? 7 : 5,
            color: color.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(2e5, 1.4, 2e7, 0.6),
          },
          ...(disc
            ? {
                ellipse: {
                  semiMajorAxis: conflictRadiusMeters(row),
                  semiMinorAxis: conflictRadiusMeters(row),
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(0.28),
                  ),
                  outline: true,
                  outlineColor: color.withAlpha(0.85),
                  outlineWidth: 2,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
              }
            : {}),
          properties: {
            kind: row.kind,
            source: row.source,
            title: row.title,
            country: row.country,
            mentions: row.mentions,
            fatalities: row.fatalities,
            time: row.timeMs,
            url: row.url || null,
          },
        }),
      );
      if (index < CONFLICT_OVERLAY_COHORT_LIMIT * 2)
        overlayEntries.push(
          createConflictOverlayEntry({ row, position, nowMs }),
        );
    });
    _dataSource.entities.suspendEvents();
    _dataSource.entities.removeAll();
    for (const entity of entities) _dataSource.entities.add(entity);
    _dataSource.entities.resumeEvents();
    if (_enabled)
      overlayHost.setEntries(
        CONFLICT_OVERLAY_SOURCE_ID,
        selectConflictOverlayCohort(overlayEntries),
        {
          cohortLimit: CONFLICT_OVERLAY_COHORT_LIMIT,
          collisionCapacity: CONFLICT_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
  }

  const layer = {
    id: 'conflict-events',
    name: 'Conflict Events',
    icon: '⚔',
    source: 'GDELT · UCDP · ACLED',
    updateInterval: 5 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Conflict layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('conflict-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(CONFLICT_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(CONFLICT_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(CONFLICT_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CONFLICT_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      _loading = true;
      try {
        const snapshot = await source.getSnapshot({
          hours: _params.hours,
          signal: request.signal,
        });
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
        console.warn('[Data:Conflicts] Fetch error:', error);
        _lastError = error?.message || 'Conflict feed unavailable';
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
      overlayHost.clearSource(CONFLICT_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CONFLICT_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _rows = [];
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getParams() {
      return { hours: _params.hours };
    },

    setParams(params = {}) {
      const hours = Number(params?.hours);
      if (!CONFLICT_WINDOWS.includes(hours)) return false;
      if (hours === _params.hours) return true;
      _params.hours = hours;
      if (_enabled && _viewer)
        Promise.resolve()
          .then(() => layer.update(_viewer))
          .catch(() => {});
      return true;
    },

    getRowControls() {
      const counts = new Map();
      for (const row of _rows)
        counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
      const sourceCounts = _snapshot
        ? _snapshot.sources
            .map((name) => `${name} ${_snapshot.counts[name] ?? 0}`)
            .join(' · ')
        : '';
      const notes = [sourceCounts, GDELT_NOTE];
      if (_snapshot?.truncated)
        notes.push(`showing top ${_rows.length} of ${_snapshot.total}`);
      if (_snapshot?.degraded) notes.push(_snapshot.degraded);
      return {
        chips: CONFLICT_WINDOWS.map((hours) => ({
          id: `hours-${hours}`,
          label: `${hours}H`,
          active: _params.hours === hours,
          params: { hours },
        })),
        legend: CONFLICT_KINDS.filter((kind) => counts.has(kind.id)).map(
          (kind, index) => ({
            label: kind.label,
            color: kind.color,
            count: counts.get(kind.id),
            ...(index === 0
              ? {
                  blurb:
                    'Disc size follows media mentions or reported fatalities; colour is the coded event kind.',
                }
              : {}),
          }),
        ),
        info: notes.filter(Boolean).join(' — '),
        infoTitle:
          'GDELT rows are aggregated machine codings of news coverage inside the window. UCDP and ACLED rows appear only when their keys are configured.',
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_rows.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _rows
        .slice()
        .sort((a, b) => conflictWeight(b) - conflictWeight(a))
        .slice(0, limit)
        .map(mapConflictAnalystRecord);
    },

    getStats() {
      return {
        count: _rows.length,
        countLabel: _rows.length
          ? `${_rows.length} · ${_params.hours}h`
          : undefined,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        stale: Boolean(_snapshot?.stale),
        partial: Boolean(_snapshot?.truncated),
      };
    },
  };
  return layer;
}
