import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_RULES,
  ALERT_RULE_IDS,
  collectConflictClusters,
  collectQuakes,
  evaluateRules,
} from './rules.js';

const NOW = 1_700_000_000_000;
const madrid = {
  id: 'z1',
  name: 'Madrid',
  lat: 40.4168,
  lon: -3.7038,
  radiusKm: 100,
  enabled: true,
};

function run(ctx, gates = {}) {
  return evaluateRules(ALERT_RULES, { now: NOW, ...ctx }, gates).alerts;
}

test('rule table is well formed', () => {
  assert.ok(ALERT_RULE_IDS.includes('air-emergency'));
  assert.equal(new Set(ALERT_RULE_IDS).size, ALERT_RULE_IDS.length);
  for (const rule of ALERT_RULES) {
    assert.equal(typeof rule.evaluate, 'function');
    assert.ok(rule.cooldownMs > 0);
    assert.deepEqual(rule.evaluate({}), []); // empty context never throws
  }
});

test('air emergencies are critical and escalate inside a zone', () => {
  const alerts = run({
    zones: [madrid],
    events: {
      airEmergencies: [
        {
          hex: 'ABC123',
          callsign: 'IBE123',
          squawk: '7700',
          lat: 40.5,
          lon: -3.6,
          altFt: 12000,
          type: 'A320',
        },
        { hex: 'def456', squawk: '7600', lat: 55, lon: 10 },
      ],
    },
  });
  const base = alerts.filter((a) => a.ruleId === 'air-emergency');
  assert.equal(base.length, 2);
  assert.equal(base[0].severity, 'critical');
  assert.match(base[0].title, /EMERGENCY 7700 · IBE123/);
  assert.match(base[0].detail, /A320 · 12,000 ft/);
  assert.equal(base[0].key, 'air-emergency:abc123:7700');
  const zoned = alerts.filter((a) => a.ruleId === 'zone-emergency');
  assert.equal(zoned.length, 1);
  assert.match(zoned[0].title, /^Madrid: EMERGENCY 7700/);
  assert.equal(zoned[0].severity, 'critical');
  assert.equal(zoned[0].zoneId, 'z1');
});

test('quakes: thresholds, recency and zone escalation', () => {
  const records = {
    earthquakes: [
      {
        id: 'big',
        magnitude: 6.4,
        lat: 40.5,
        lon: -3.5,
        timeMs: NOW - 60_000,
        place: 'near Madrid',
        depthKm: 10,
      },
      { id: 'mid', magnitude: 5.2, lat: 0, lon: 0, timeMs: NOW - 60_000 },
      { id: 'small', magnitude: 4.9, lat: 0, lon: 0, timeMs: NOW - 60_000 },
      { id: 'old', magnitude: 7.0, lat: 0, lon: 0, timeMs: NOW - 5 * 3600_000 },
    ],
  };
  const base = collectQuakes({ now: NOW, records });
  assert.deepEqual(
    base.map((a) => [a.key, a.severity]),
    [
      ['quake:big', 'critical'],
      ['quake:mid', 'warn'],
    ],
  );
  assert.equal(base[0].title, 'M6.4 earthquake');
  assert.match(base[0].detail, /near Madrid · 10 km deep/);
  const alerts = run({ zones: [madrid], records });
  const zoned = alerts.filter((a) => a.ruleId === 'zone-quake');
  assert.equal(zoned.length, 1);
  assert.equal(zoned[0].key, 'zone-quake:z1:quake:big');
  // Configurable threshold.
  const strict = run({ records, options: { quakeWarnMag: 6.0 } });
  assert.equal(strict.filter((a) => a.ruleId === 'quake-major').length, 1);
});

test('disaster alerts map GDACS levels and tolerate aliases', () => {
  const alerts = run({
    records: {
      'disaster-alerts': [
        {
          id: 'fl1',
          level: 'Red',
          title: 'Flood in X',
          type: 'FL',
          country: 'X',
          lat: 1,
          lon: 1,
        },
        { id: 'tc1', alertLevel: 'orange', title: 'Cyclone Y', lat: 2, lon: 2 },
        { id: 'eq1', level: 'green', title: 'quiet', lat: 3, lon: 3 },
      ],
    },
  });
  const rows = alerts.filter((a) => a.ruleId === 'disaster-red');
  assert.deepEqual(
    rows.map((a) => [a.key, a.severity]),
    [
      ['disaster:fl1:red', 'critical'],
      ['disaster:tc1:orange', 'warn'],
    ],
  );
  assert.match(rows[0].detail, /FL · X · RED alert/);
});

test('conflict clusters need N events in one ~50 km cell', () => {
  const events = [];
  for (let i = 0; i < 8; i++)
    events.push({
      id: `e${i}`,
      lat: 33.5 + i * 0.01,
      lon: 36.3,
      title: 'Shelling reported',
      timeMs: NOW,
    });
  events.push({ id: 'lone', lat: -20, lon: 30, title: 'other', timeMs: NOW });
  const clusters = collectConflictClusters({
    now: NOW,
    records: { 'conflict-events': events },
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 8);
  assert.match(clusters[0].title, /8 events/);
  assert.ok(Math.abs(clusters[0].lat - 33.535) < 0.01);
  const fewer = collectConflictClusters({
    now: NOW,
    records: { 'conflict-events': events.slice(0, 7) },
  });
  assert.equal(fewer.length, 0);
  // Zone rule: three events inside the zone is activity.
  const zone = {
    ...madrid,
    lat: 33.5,
    lon: 36.3,
    radiusKm: 50,
    name: 'Damascus',
  };
  const alerts = run({ zones: [zone], records: { 'conflict-events': events } });
  const zoned = alerts.find((a) => a.ruleId === 'zone-conflict');
  assert.ok(zoned);
  assert.match(zoned.title, /^Damascus: 8 conflict events/);
  assert.equal(zoned.severity, 'critical');
});

test('zone military aircraft and vessels use analyst records', () => {
  const alerts = run({
    zones: [madrid, { ...madrid, id: 'z2', name: 'Off', enabled: false }],
    records: {
      military: [
        {
          icao24: 'ae1234',
          callsign: 'RCH123',
          lat: 40.6,
          lon: -3.5,
          altitudeM: 9000,
          aircraftClass: 'transport',
        },
        { icao24: 'ae9999', callsign: 'FAR', lat: 10, lon: 10 },
      ],
      'ais-live-vessels': [
        { mmsi: '123', name: 'FRIGATE', lat: 40.3, lon: -3.8, shipType: 35 },
        { mmsi: '456', name: 'TANKER', lat: 40.3, lon: -3.8, shipType: 80 },
        {
          mmsi: '789',
          name: 'PATROL',
          lat: 40.3,
          lon: -3.8,
          shipType: 'Military ops',
        },
      ],
    },
  });
  const air = alerts.filter((a) => a.ruleId === 'zone-military-air');
  assert.equal(air.length, 1);
  assert.equal(air[0].key, 'zone-mil:z1:ae1234');
  assert.match(air[0].title, /^Madrid: military aircraft RCH123/);
  assert.match(air[0].detail, /transport · 29,528 ft/);
  const sea = alerts.filter((a) => a.ruleId === 'zone-vessel-military');
  assert.deepEqual(
    sea.map((a) => a.key),
    ['zone-vessel:z1:123', 'zone-vessel:z1:789'],
  );
});

test('evaluateRules honours mutes, cooldowns, dedupe and rule errors', () => {
  const rules = [
    ...ALERT_RULES,
    {
      id: 'boom',
      label: 'Boom',
      cooldownMs: 1,
      evaluate: () => {
        throw new Error('nope');
      },
    },
    {
      id: 'dupe',
      label: 'Dupe',
      cooldownMs: 1,
      evaluate: () => [{ key: 'quake:big', title: 'again' }],
    },
  ];
  const ctx = {
    now: NOW,
    records: {
      earthquakes: [{ id: 'big', magnitude: 6.4, lat: 1, lon: 1, timeMs: NOW }],
    },
  };
  const all = evaluateRules(rules, ctx);
  assert.deepEqual(all.errors, ['boom: nope']);
  assert.equal(all.alerts.filter((a) => a.key === 'quake:big').length, 1);
  assert.equal(all.alerts[0].ruleId, 'quake-major');
  assert.equal(all.alerts[0].at, NOW);
  assert.equal(all.alerts[0].cooldownMs, 24 * 3600_000);

  const muted = evaluateRules(rules, ctx, {
    isMuted: (id) => id === 'quake-major',
  });
  assert.equal(muted.alerts[0].ruleId, 'dupe');

  const cooling = evaluateRules(rules, ctx, {
    isCoolingDown: (key, cooldownMs, now) =>
      key === 'quake:big' && now === NOW && cooldownMs > 0,
  });
  assert.equal(cooling.alerts.length, 0);
});
