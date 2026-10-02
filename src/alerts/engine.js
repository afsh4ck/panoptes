/**
 * Alert engine: builds the rule context from the live layer catalog on a
 * timer (and on pushed events), evaluates the rules, persists what fired and
 * notifies subscribers. Host-agnostic: the window, timers and clock are all
 * injectable so the engine runs headless under node:test.
 */
import { ALERT_RULES, evaluateRules } from './rules.js';

export const ALERT_ENGINE_INTERVAL_MS = 15_000;
export const AIR_EMERGENCY_EVENT = 'gev:air-emergency';
/** Pushed events settle briefly so a burst evaluates once. */
const EVENT_SETTLE_MS = 250;
const PENDING_EVENT_CAP = 200;
const RECORD_CAP = 2000;

/** Layers a rule may read, keyed by the record bucket the context exposes. */
const RECORD_LAYERS = Object.freeze([
  'earthquakes',
  'disaster-alerts',
  'conflict-events',
  'ais-live-vessels',
  'military',
]);

/**
 * @param {object} options
 * @param {{get: (id: string) => object|undefined}|null} [options.catalog]
 *   Application layer catalog (instances by id).
 * @param {(() => Array<{id: string, enabled: boolean}>)|null} [options.getLayers]
 *   Manager rows; a layer missing here is treated as enabled when the catalog has it.
 * @param {object} options.zones Zone store (createZoneStore).
 * @param {object} options.store Alert store (createAlertStore).
 * @param {ReadonlyArray<object>} [options.rules]
 * @param {() => number} [options.now]
 * @param {number} [options.intervalMs]
 * @param {object|null} [options.windowRef] Event target for pushed window events.
 * @param {Function} [options.setIntervalImpl]
 * @param {Function} [options.clearIntervalImpl]
 * @param {Function} [options.setTimeoutImpl]
 * @param {Function} [options.clearTimeoutImpl]
 * @param {object} [options.options] Rule option overrides (ALERT_RULE_DEFAULTS).
 * @param {((lon: number, lat: number) => any)|null} [options.cesiumFromDegrees]
 *   Optional ECEF converter for the military `getNearby` fallback.
 * @param {((cartesian: any) => {lat: number, lon: number}|null)|null} [options.cesiumToDegrees]
 */
export function createAlertEngine({
  catalog = null,
  getLayers = null,
  zones,
  store,
  rules = ALERT_RULES,
  now = Date.now,
  intervalMs = ALERT_ENGINE_INTERVAL_MS,
  windowRef = typeof window !== 'undefined' ? window : null,
  setIntervalImpl = (...args) => globalThis.setInterval(...args),
  clearIntervalImpl = (...args) => globalThis.clearInterval(...args),
  setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
  clearTimeoutImpl = (...args) => globalThis.clearTimeout(...args),
  options = {},
  cesiumFromDegrees = null,
  cesiumToDegrees = null,
} = {}) {
  if (!zones?.active || !store?.add)
    throw new TypeError(
      'Alert engine requires a zone store and an alert store',
    );
  const listeners = new Map();
  const pendingEmergencies = [];
  let timer = null;
  let settleTimer = null;
  let running = false;
  let evaluating = false;
  let lastEvaluatedAt = null;
  let lastErrors = [];

  function emit(event, payload) {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch {
        /* a subscriber failure never breaks evaluation */
      }
    }
  }

  function enabledIds() {
    if (typeof getLayers !== 'function') return null;
    try {
      const rows = getLayers() || [];
      return new Set(
        rows.filter((row) => row && row.enabled).map((row) => row.id),
      );
    } catch {
      return null;
    }
  }

  function layerFor(id, enabled) {
    if (enabled && !enabled.has(id)) return null;
    try {
      return catalog?.get?.(id) || null;
    } catch {
      return null;
    }
  }

  function analystRecords(layer) {
    if (typeof layer?.getAnalystRecords !== 'function') return [];
    try {
      const rows = layer.getAnalystRecords(RECORD_CAP);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  /** Military contacts per zone through getNearby when records carry no fix. */
  function nearbyMilitary(layer, activeZones) {
    if (
      typeof layer?.getNearby !== 'function' ||
      typeof cesiumFromDegrees !== 'function' ||
      typeof cesiumToDegrees !== 'function'
    )
      return [];
    const out = [];
    for (const zone of activeZones) {
      let hits;
      try {
        hits = layer.getNearby(
          cesiumFromDegrees(zone.lon, zone.lat),
          zone.radiusKm * 1000,
          50,
        );
      } catch {
        continue;
      }
      for (const hit of Array.isArray(hits) ? hits : []) {
        let fix = null;
        try {
          fix = hit?.position ? cesiumToDegrees(hit.position) : null;
        } catch {
          fix = null;
        }
        out.push({
          icao24: hit?.icao24 || hit?.id,
          callsign: hit?.callsign || null,
          lat: fix?.lat ?? zone.lat,
          lon: fix?.lon ?? zone.lon,
          altitudeM: hit?.altitudeM ?? null,
          aircraftClass: hit?.aircraftClass ?? null,
        });
      }
    }
    return out;
  }

  function buildContext(at) {
    const enabled = enabledIds();
    const activeZones = zones.active();
    const records = {};
    for (const id of RECORD_LAYERS) {
      const layer = layerFor(id, enabled);
      records[id] = layer ? analystRecords(layer) : [];
    }
    if (
      activeZones.length &&
      records.military.every((row) => row?.lat == null)
    ) {
      const layer = layerFor('military', enabled);
      const fallback = layer ? nearbyMilitary(layer, activeZones) : [];
      if (fallback.length) records.military = fallback;
    }
    const airEmergencies = pendingEmergencies.splice(0);
    return {
      now: at,
      zones: activeZones,
      events: { airEmergencies },
      records,
      options,
    };
  }

  function evaluateNow() {
    if (evaluating) return { alerts: [], errors: [] };
    evaluating = true;
    try {
      const at = now();
      const ctx = buildContext(at);
      const { alerts, errors } = evaluateRules(rules, ctx, {
        now: at,
        isMuted: (ruleId) => store.isMuted(ruleId),
        isCoolingDown: (key, cooldownMs, when) =>
          store.isCoolingDown(key, cooldownMs, when),
      });
      const raised = [];
      for (const alert of alerts) {
        const stored = store.add(alert);
        store.remember(alert.key, at);
        if (!stored) continue;
        raised.push(stored);
        emit('alert', stored);
      }
      lastEvaluatedAt = at;
      lastErrors = errors;
      emit('evaluated', { at, raised: raised.length, errors });
      return { alerts: raised, errors };
    } finally {
      evaluating = false;
    }
  }

  function scheduleSettle() {
    if (settleTimer !== null) return;
    settleTimer = setTimeoutImpl(() => {
      settleTimer = null;
      if (running) evaluateNow();
    }, EVENT_SETTLE_MS);
  }

  function pushAirEmergency(row) {
    if (!row || typeof row !== 'object') return false;
    pendingEmergencies.push({ ...row });
    if (pendingEmergencies.length > PENDING_EVENT_CAP)
      pendingEmergencies.splice(
        0,
        pendingEmergencies.length - PENDING_EVENT_CAP,
      );
    if (running) scheduleSettle();
    return true;
  }

  const onWindowEmergency = (event) => {
    const detail = event?.detail;
    if (Array.isArray(detail)) detail.forEach(pushAirEmergency);
    else pushAirEmergency(detail);
  };

  return {
    start() {
      if (running) return;
      running = true;
      windowRef?.addEventListener?.(AIR_EMERGENCY_EVENT, onWindowEmergency);
      timer = setIntervalImpl(() => evaluateNow(), intervalMs);
      evaluateNow();
    },
    stop() {
      if (!running) return;
      running = false;
      windowRef?.removeEventListener?.(AIR_EMERGENCY_EVENT, onWindowEmergency);
      if (timer !== null) clearIntervalImpl(timer);
      timer = null;
      if (settleTimer !== null) clearTimeoutImpl(settleTimer);
      settleTimer = null;
    },
    isRunning: () => running,
    evaluateNow,
    pushAirEmergency,
    lastEvaluatedAt: () => lastEvaluatedAt,
    lastErrors: () => [...lastErrors],
    /** Rule table with the operator's mute state. */
    rules: () =>
      rules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        description: rule.description || '',
        severity: rule.severity || 'info',
        muted: store.isMuted(rule.id),
      })),
    setMuted: (ruleId, muted) => store.setMuted(ruleId, muted),
    on(event, handler) {
      if (typeof handler !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    destroy() {
      this.stop();
      listeners.clear();
      pendingEmergencies.length = 0;
    },
  };
}
