import * as Cesium from 'cesium';
import {
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
} from '../../renderGovernor.js';
import {
  EMERGENCY_OVERLAY_SOURCE_ID,
  EMERGENCY_OVERLAY_COHORT_LIMIT,
  EMERGENCY_OVERLAY_COLLISION_CAPACITY,
  buildEmergencyCard,
  diffNewEmergencies,
  emergencyAccent,
  emergencyCountLabel,
  emergencyLabel,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createEmergencySquawkSource } from './source.js';
export {
  EMERGENCY_SQUAWKS,
  EMERGENCY_SQUAWK_MEANING,
  normalizeEmergencySnapshot,
} from './records.js';

const FOOT_TO_M = 0.3048;
/** Ground ring radius: visible from a continental view, not a runway one. */
const RING_RADIUS_M = 12_000;
const PULSE_PERIOD_MS = 1800;
const RENDER_OWNER = 'air-emergencies';
/** Fired once per newly observed emergency contact (detail: analyst record + accent). */
export const AIR_EMERGENCY_EVENT = 'gev:air-emergency';

const DEFAULT_RENDER = Object.freeze({
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
});

function defaultDispatch(type, detail) {
  if (
    typeof window === 'undefined' ||
    typeof CustomEvent === 'undefined' ||
    typeof window.dispatchEvent !== 'function'
  )
    return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

/**
 * Own one emergency-squawk display (7500 / 7600 / 7700), its refresh
 * lifecycle, the pulsing markers and the new-contact notification.
 * @param {object} options
 * @param {{getSnapshot: Function}} options.source Snapshot source.
 * @param {object} options.overlayHost World-overlay host (cards).
 * @param {object} [options.render] Render governor seam.
 * @param {Function} [options.dispatchEvent] Window event seam.
 * @param {Function} [options.now] Clock seam.
 */
export function createAirEmergenciesLayer({
  source,
  overlayHost,
  render = DEFAULT_RENDER,
  dispatchEvent = defaultDispatch,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Air emergencies require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Air emergencies require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _rows = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _partial = false;
  let _loading = false;
  let _enabled = false;
  let _holding = false;
  /** hex → last seen ms; survives disable/enable so a toggle cannot re-alert. */
  const _memory = new Map();

  const pulse = () =>
    0.5 +
    0.5 * Math.sin(((now() % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2);

  function syncRenderHold() {
    const wanted = _enabled && _count > 0;
    if (wanted && !_holding) {
      render.holdContinuousRender(RENDER_OWNER);
      _holding = true;
    } else if (!wanted && _holding) {
      render.releaseContinuousRender(RENDER_OWNER);
      _holding = false;
    }
  }

  function clearDisplay() {
    _dataSource?.entities.removeAll();
    overlayHost.clearSource(EMERGENCY_OVERLAY_SOURCE_ID);
  }

  function buildEntities(rows) {
    const entities = [];
    const cards = [];
    for (const row of rows) {
      const accent = Cesium.Color.fromCssColorString(
        emergencyAccent(row.squawk),
      );
      const altM =
        row.onGround || !Number.isFinite(row.altFt) ? 0 : row.altFt * FOOT_TO_M;
      const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat, altM);
      const ground = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
      entities.push(
        new Cesium.Entity({
          id: `air-emergency:${row.hex}`,
          position,
          point: {
            pixelSize: new Cesium.CallbackProperty(
              () => 9 + 5 * pulse(),
              false,
            ),
            color: accent,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: row.onGround
              ? Cesium.HeightReference.CLAMP_TO_GROUND
              : Cesium.HeightReference.NONE,
          },
          properties: {
            hex: row.hex,
            squawk: row.squawk,
            callsign: row.callsign,
            registration: row.registration,
            type: row.type,
            emergency: row.emergency,
          },
        }),
      );
      entities.push(
        new Cesium.Entity({
          id: `air-emergency-ring:${row.hex}`,
          position: ground,
          ellipse: {
            // Static axes: a per-frame radius would re-tessellate clamped
            // ground geometry every frame. Only the fill alpha breathes.
            semiMajorAxis: RING_RADIUS_M,
            semiMinorAxis: RING_RADIUS_M,
            material: new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(
                () => accent.withAlpha(0.08 + 0.24 * pulse()),
                false,
              ),
            ),
            outline: true,
            outlineColor: accent.withAlpha(0.9),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
      cards.push({ ...buildEmergencyCard(row), position });
    }
    return { entities, cards };
  }

  function notifyNewContacts(rows, at) {
    for (const row of diffNewEmergencies(_memory, rows, at)) {
      try {
        dispatchEvent(AIR_EMERGENCY_EVENT, {
          layerId: 'air-emergencies',
          at,
          hex: row.hex,
          label: emergencyLabel(row),
          accent: emergencyAccent(row.squawk),
          ...mapAnalystRecord(row),
        });
      } catch {
        /* a listener fault must never break the refresh */
      }
    }
  }

  const layer = {
    id: 'air-emergencies',
    name: 'Air Emergencies',
    icon: '🆘',
    source: 'adsb.lol · LIVE',
    updateInterval: 20000,

    init(viewer) {
      if (_viewer)
        throw new Error('Air emergencies layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('air-emergencies');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(EMERGENCY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:AirEmergencies] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(EMERGENCY_OVERLAY_SOURCE_ID, true);
      syncRenderHold();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(EMERGENCY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EMERGENCY_OVERLAY_SOURCE_ID, false);
      syncRenderHold();
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
        const rows = Array.isArray(snapshot) ? snapshot : snapshot?.rows || [];
        const { entities, cards } = buildEntities(rows);
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        overlayHost.setEntries(EMERGENCY_OVERLAY_SOURCE_ID, cards, {
          cohortLimit: EMERGENCY_OVERLAY_COHORT_LIMIT,
          collisionCapacity: EMERGENCY_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        });
        const at = now();
        _rows = rows;
        _count = rows.length;
        _lastUpdate = at;
        _lastError = null;
        _stale = snapshot?.stale === true;
        _partial = snapshot?.partial === true;
        syncRenderHold();
        notifyNewContacts(rows, at);
        render.governorRequestRender('air-emergencies');
        console.log(`[Data:AirEmergencies] Updated: ${_count} contacts`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:AirEmergencies] Fetch error:', error);
        _lastError = error?.message || 'Emergency feed unavailable';
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
      overlayHost.clearSource(EMERGENCY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EMERGENCY_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      syncRenderHold();
      _viewer = null;
    },

    /** Current rows (copies) for panels that list active emergencies. */
    getEmergencies() {
      return _enabled ? _rows.map((row) => ({ ...row })) : [];
    },

    /**
     * JSON-safe records for the analyst query engine. On-demand; [] while
     * disabled or empty.
     * @param {number} [maxCount=500]
     */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_dataSource?.show || !_rows.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      return _rows.slice(0, limit).map(mapAnalystRecord);
    },

    getStats() {
      return {
        count: _count,
        countLabel: emergencyCountLabel(_count),
        // adsb.lol is this layer's primary feed, not a fallback.
        fallback: false,
        // An empty answer is the normal case: say so instead of a bare dash.
        ...(_lastUpdate && _count === 0 && !_lastError
          ? { loadingLabel: 'no active emergencies' }
          : {}),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        partial: _partial,
        loading: _loading,
      };
    },
  };
  // Keep the disable/clear path reachable for tests and cleanup callers.
  layer._clearDisplay = clearDisplay;
  return layer;
}
