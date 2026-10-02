import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIR_EMERGENCY_EVENT, createAlertEngine } from './engine.js';
import { createAlertStore } from './store.js';
import { createZoneStore, memoryStorage } from './zones.js';

const NOW = 1_700_000_000_000;

/** Deterministic timers: run() fires everything due at the current clock. */
function fakeTimers(start) {
  let clock = start;
  const intervals = new Map();
  const timeouts = new Map();
  let id = 0;
  return {
    now: () => clock,
    setInterval: (fn, ms) => {
      intervals.set(++id, { fn, ms, next: clock + ms });
      return id;
    },
    clearInterval: (handle) => intervals.delete(handle),
    setTimeout: (fn, ms) => {
      timeouts.set(++id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout: (handle) => timeouts.delete(handle),
    advance(ms) {
      clock += ms;
      for (const [handle, entry] of [...timeouts]) {
        if (entry.at <= clock) {
          timeouts.delete(handle);
          entry.fn();
        }
      }
      for (const entry of intervals.values()) {
        while (entry.next <= clock) {
          entry.next += entry.ms;
          entry.fn();
        }
      }
    },
    pending: () => intervals.size + timeouts.size,
  };
}

function fakeWindow() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => {
      handlers.set(type, [...(handlers.get(type) || []), fn]);
    },
    removeEventListener: (type, fn) => {
      handlers.set(
        type,
        (handlers.get(type) || []).filter((h) => h !== fn),
      );
    },
    dispatch: (type, detail) => {
      for (const fn of handlers.get(type) || []) fn({ detail });
    },
    count: (type) => (handlers.get(type) || []).length,
  };
}

function harness({ layers = {}, enabled = null, zones: zoneRows = [] } = {}) {
  const timers = fakeTimers(NOW);
  const windowRef = fakeWindow();
  const zones = createZoneStore({ storage: memoryStorage(), now: timers.now });
  for (const row of zoneRows) zones.add(row);
  const store = createAlertStore({ storage: memoryStorage(), now: timers.now });
  const catalog = { get: (id) => layers[id] };
  const engine = createAlertEngine({
    catalog,
    getLayers: enabled
      ? () =>
          Object.keys(layers).map((id) => ({ id, enabled: enabled.has(id) }))
      : null,
    zones,
    store,
    now: timers.now,
    windowRef,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    intervalMs: 15_000,
  });
  return { timers, windowRef, zones, store, engine };
}

test('engine requires its stores', () => {
  assert.throws(() => createAlertEngine({}), /zone store/);
});

test('evaluateNow reads enabled layers, raises once and records cooldowns', () => {
  let quake = {
    id: 'q1',
    magnitude: 6.5,
    lat: 1,
    lon: 1,
    timeMs: NOW - 1000,
    place: 'Sea',
  };
  const layers = {
    earthquakes: { getAnalystRecords: () => [quake] },
    'disaster-alerts': {
      getAnalystRecords: () => {
        throw new Error('feed down');
      },
    },
  };
  const { engine, store } = harness({
    layers,
    enabled: new Set(['earthquakes', 'disaster-alerts']),
  });
  const raised = [];
  engine.on('alert', (alert) => raised.push(alert));
  const first = engine.evaluateNow();
  assert.equal(first.alerts.length, 1);
  assert.equal(raised[0].key, 'quake:q1');
  assert.equal(raised[0].ruleId, 'quake-major');
  assert.equal(store.list().length, 1);
  assert.equal(store.lastSeenAt('quake:q1'), NOW);
  // The same quake in the next snapshot is inside its cooldown.
  const second = engine.evaluateNow();
  assert.equal(second.alerts.length, 0);
  assert.equal(store.list().length, 1);
  assert.equal(engine.lastEvaluatedAt(), NOW);
});

test('disabled layers contribute nothing even when the catalog has them', () => {
  const layers = {
    earthquakes: {
      getAnalystRecords: () => [
        { id: 'q', magnitude: 7, lat: 0, lon: 0, timeMs: NOW },
      ],
    },
  };
  const { engine } = harness({ layers, enabled: new Set() });
  assert.equal(engine.evaluateNow().alerts.length, 0);
  // Without a manager row source the catalog decides.
  const open = harness({ layers });
  assert.equal(open.engine.evaluateNow().alerts.length, 1);
});

test('start schedules the interval, listens for emergencies and stop releases both', () => {
  const { engine, timers, windowRef, store } = harness({
    layers: {},
    zones: [{ name: 'Madrid', lat: 40.4168, lon: -3.7038, radiusKm: 100 }],
  });
  const evaluated = [];
  engine.on('evaluated', (info) => evaluated.push(info));
  engine.start();
  assert.equal(engine.isRunning(), true);
  assert.equal(windowRef.count(AIR_EMERGENCY_EVENT), 1);
  assert.equal(evaluated.length, 1); // immediate pass on start
  timers.advance(15_000);
  assert.equal(evaluated.length, 2);

  windowRef.dispatch(AIR_EMERGENCY_EVENT, {
    hex: 'abc123',
    callsign: 'TEST1',
    squawk: '7700',
    lat: 40.5,
    lon: -3.6,
  });
  assert.equal(evaluated.length, 2); // settles first
  timers.advance(250);
  assert.equal(evaluated.length, 3);
  const keys = store
    .list()
    .map((a) => a.key)
    .sort();
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => k === 'air-emergency:abc123:7700'));
  assert.ok(keys.some((k) => k.startsWith('zone-emergency:')));
  assert.equal(
    store.list().find((a) => a.ruleId === 'zone-emergency').severity,
    'critical',
  );

  engine.stop();
  assert.equal(engine.isRunning(), false);
  assert.equal(windowRef.count(AIR_EMERGENCY_EVENT), 0);
  assert.equal(timers.pending(), 0);
  timers.advance(60_000);
  assert.equal(evaluated.length, 3);
});

test('muting through the engine silences a rule', () => {
  const layers = {
    earthquakes: {
      getAnalystRecords: () => [
        { id: 'q', magnitude: 7, lat: 0, lon: 0, timeMs: NOW },
      ],
    },
  };
  const { engine } = harness({ layers });
  assert.equal(engine.setMuted('quake-major'), true);
  assert.equal(engine.rules().find((r) => r.id === 'quake-major').muted, true);
  assert.equal(engine.evaluateNow().alerts.length, 0);
});

test('military getNearby fallback feeds zone rules when records lack a fix', () => {
  const zone = { name: 'Madrid', lat: 40.4168, lon: -3.7038, radiusKm: 100 };
  const layers = {
    military: {
      getAnalystRecords: () => [],
      getNearby: (center, range) => {
        assert.deepEqual(center, { lon: zone.lon, lat: zone.lat });
        assert.equal(range, 100_000);
        return [{ icao24: 'ae0001', callsign: 'RCH1', position: { x: 1 } }];
      },
    },
  };
  const timers = fakeTimers(NOW);
  const zones = createZoneStore({ storage: memoryStorage(), now: timers.now });
  zones.add(zone);
  const store = createAlertStore({ storage: memoryStorage(), now: timers.now });
  const engine = createAlertEngine({
    catalog: { get: (id) => layers[id] },
    zones,
    store,
    now: timers.now,
    windowRef: null,
    cesiumFromDegrees: (lon, lat) => ({ lon, lat }),
    cesiumToDegrees: () => ({ lat: 40.5, lon: -3.6 }),
  });
  const { alerts } = engine.evaluateNow();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key.startsWith('zone-mil:'), true);
  assert.equal(alerts[0].lat, 40.5);
});
