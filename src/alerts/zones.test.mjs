import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createZoneStore,
  haversineKm,
  isInsideZone,
  memoryStorage,
  normalizeZone,
  ZONE_MAX_COUNT,
  ZONE_STORAGE_KEY,
} from './zones.js';

test('haversineKm matches known distances', () => {
  // Madrid ↔ Barcelona ≈ 505 km.
  const km = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
  assert.ok(km > 500 && km < 510, `got ${km}`);
  assert.equal(haversineKm(10, 10, 10, 10), 0);
});

test('isInsideZone respects the radius and rejects bad input', () => {
  const zone = { lat: 40.4168, lon: -3.7038, radiusKm: 100 };
  assert.equal(isInsideZone(zone, 40.9, -3.7), true); // ~54 km north
  assert.equal(isInsideZone(zone, 41.3874, 2.1686), false); // Barcelona
  assert.equal(isInsideZone(zone, NaN, -3.7), false);
  assert.equal(isInsideZone({ ...zone, radiusKm: 0 }, 40.42, -3.7), false);
  assert.equal(isInsideZone(null, 40.42, -3.7), false);
});

test('normalizeZone clamps, names and rejects', () => {
  const zone = normalizeZone(
    { lat: 51.5, lon: -0.12, radiusKm: 7000, name: ' Thames  ' },
    { now: () => 42 },
  );
  assert.equal(zone.radiusKm, 2000);
  assert.equal(zone.name, 'Thames');
  assert.equal(zone.enabled, true);
  assert.equal(zone.createdAt, 42);
  assert.equal(normalizeZone({ lat: 95, lon: 0 }), null);
  assert.equal(normalizeZone({ lat: 0, lon: 0 }).radiusKm, 100);
  assert.match(
    normalizeZone({ lat: 1.5, lon: 2.25 }).name,
    /^Zone 1\.50, 2\.25$/,
  );
});

test('zone store persists, toggles, removes and notifies', () => {
  const storage = memoryStorage();
  const store = createZoneStore({ storage, now: () => 1000 });
  const events = [];
  store.subscribe((rows) => events.push(rows.length));
  const zone = store.add({ lat: 48.85, lon: 2.35, radiusKm: 50 });
  assert.ok(zone);
  assert.equal(zone.name, 'Zone 1');
  assert.equal(store.list().length, 1);
  assert.deepEqual(events, [1]);

  const reloaded = createZoneStore({ storage });
  assert.equal(reloaded.list()[0].id, zone.id);
  assert.ok(storage.getItem(ZONE_STORAGE_KEY).includes('"zones"'));

  store.toggle(zone.id);
  assert.equal(store.get(zone.id).enabled, false);
  assert.equal(store.active().length, 0);
  store.toggle(zone.id, true);
  assert.equal(store.containing(48.9, 2.4).length, 1);
  assert.equal(store.containing(40, 0).length, 0);

  assert.equal(store.remove(zone.id), true);
  assert.equal(store.remove(zone.id), false);
  assert.equal(store.list().length, 0);
});

test('zone store ignores corrupt storage and caps the list', () => {
  const storage = memoryStorage();
  storage.setItem(ZONE_STORAGE_KEY, '{not json');
  const store = createZoneStore({ storage });
  assert.deepEqual(store.list(), []);
  for (let i = 0; i < ZONE_MAX_COUNT + 5; i++)
    store.add({ lat: i * 0.5, lon: 0, radiusKm: 25 });
  assert.equal(store.list().length, ZONE_MAX_COUNT);
  // A throwing storage falls back to memory rather than breaking the app.
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const survivor = createZoneStore({ storage: broken });
  assert.ok(survivor.add({ lat: 0, lon: 0 }));
});
