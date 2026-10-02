import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERFERENCE_MAX_CENTERS,
  aggregateInterferenceCells,
  boxChangeFraction,
  classifyNavIntegrity,
  interferenceCellSize,
  interferenceCountLabel,
  interferenceLevel,
  normalizeInterferenceSnapshot,
  parseInterferenceBox,
  quantizeInterferenceBox,
  tileInterferenceCenters,
  validInterferenceBox,
} from './cells.js';

test('boxes are parsed from query parameters and validated', () => {
  const box = parseInterferenceBox(
    new URLSearchParams('south=40.1&west=-4.2&north=41.9&east=-2.4'),
  );
  assert.deepEqual(box, { south: 40.1, west: -4.2, north: 41.9, east: -2.4 });
  assert.equal(
    parseInterferenceBox({ south: '10', west: '10', north: '5', east: '20' }),
    null,
    'inverted latitude',
  );
  assert.equal(parseInterferenceBox({ south: 0, west: 0, north: 1 }), null);
  assert.equal(
    validInterferenceBox({ south: -10, west: 0, north: 60, east: 10 }),
    false,
    'span over the cap',
  );
  assert.equal(
    validInterferenceBox({ south: -10, west: -181, north: 0, east: 10 }),
    false,
  );
});

test('quantization snaps outward and keeps the span cap', () => {
  assert.deepEqual(
    quantizeInterferenceBox({
      south: 40.1,
      west: -4.2,
      north: 41.9,
      east: -2.4,
    }),
    { south: 40, west: -4.5, north: 42, east: -2 },
  );
  const capped = quantizeInterferenceBox({
    south: 0.2,
    west: 0.3,
    north: 59.9,
    east: 59.8,
  });
  assert.equal(capped.north - capped.south, 60);
  assert.equal(capped.east - capped.west, 60);
  assert.equal(
    interferenceCellSize({ south: 40, west: -5, north: 42, east: -2 }),
    0.5,
  );
  assert.equal(
    interferenceCellSize({ south: 30, west: -20, north: 50, east: 10 }),
    1,
  );
});

test('tiling covers small boxes with one circle and thins large ones', () => {
  const small = tileInterferenceCenters({
    south: 40,
    west: -4.5,
    north: 42,
    east: -2,
  });
  assert.equal(small.centers.length, 1);
  assert.equal(small.partial, false);
  assert.deepEqual(small.centers[0], { lat: 41, lon: -3.25, radiusNm: 250 });
  const large = tileInterferenceCenters({
    south: 0,
    west: 0,
    north: 60,
    east: 60,
  });
  assert.ok(large.centers.length <= INTERFERENCE_MAX_CENTERS);
  assert.equal(large.partial, true);
  assert.ok(large.needed > large.centers.length);
  const lats = new Set(large.centers.map((c) => c.lat));
  const lons = new Set(large.centers.map((c) => c.lon));
  assert.equal(lats.size * lons.size, large.centers.length, 'a regular grid');
  const medium = tileInterferenceCenters({
    south: 35,
    west: -10,
    north: 45,
    east: 5,
  });
  assert.equal(medium.partial, false);
  assert.ok(medium.centers.length >= 2 && medium.centers.length <= 9);
});

test('navigation integrity verdicts follow readsb NIC/NACp', () => {
  assert.equal(classifyNavIntegrity({ nic: 8, nac_p: 9 }), 'good');
  assert.equal(classifyNavIntegrity({ nic: 5, nac_p: 9 }), 'bad');
  assert.equal(classifyNavIntegrity({ nic: 8, nac_p: 4 }), 'bad');
  assert.equal(classifyNavIntegrity({ nic: 0 }), 'bad');
  assert.equal(classifyNavIntegrity({ nac_p: 8 }), 'good');
  assert.equal(classifyNavIntegrity({}), null, 'no categories, no vote');
  assert.equal(classifyNavIntegrity({ nic: 0, alt_baro: 'ground' }), null);
  assert.equal(interferenceLevel(3, 3), 'low', 'thin samples stay low');
  assert.equal(interferenceLevel(10, 0), 'low');
  assert.equal(interferenceLevel(10, 1), 'medium');
  assert.equal(interferenceLevel(10, 3), 'high');
});

test('aggregation deduplicates by hex, clips to the box and grades cells', () => {
  const box = { south: 40, west: -5, north: 42, east: -2 };
  const point = [
    { hex: 'A1', lat: 40.2, lon: -4.8, nic: 8, seen_pos: 3 },
    { hex: 'a2', lat: 40.3, lon: -4.7, nic: 4 },
    { hex: 'a3', lat: 40.4, lon: -4.6, nic: 9 },
    { hex: 'a4', lat: 40.1, lon: -4.9, nac_p: 3 },
    { hex: 'a5', lat: 40.45, lon: -4.55, nic: 7 },
    { hex: 'a6', lat: 40.2, lon: -4.6, nic: 2, alt_baro: 'ground' },
    { hex: 'zz', lat: 10, lon: 10, nic: 0 },
    { hex: 'b1', lat: 41.7, lon: -2.2, nic: 9 },
    { lat: 41.7, lon: -2.2, nic: 1 },
  ];
  const mil = [{ hex: 'a1', lat: 40.24, lon: -4.82, nic: 3, seen_pos: 0.5 }];
  const { cells, aircraftSampled } = aggregateInterferenceCells(
    [point, mil],
    box,
    0.5,
  );
  assert.equal(aircraftSampled, 6);
  assert.equal(cells.length, 2);
  assert.deepEqual(cells[0], {
    lat: 40,
    lon: -5,
    size: 0.5,
    total: 5,
    bad: 3,
    ratio: 0.6,
    level: 'high',
  });
  assert.deepEqual(cells[1], {
    lat: 41.5,
    lon: -2.5,
    size: 0.5,
    total: 1,
    bad: 0,
    ratio: 0,
    level: 'low',
  });
});

test('snapshots are validated whole and levels recomputed from counts', () => {
  const snapshot = normalizeInterferenceSnapshot({
    cells: [
      { lat: 40, lon: -5, size: 0.5, total: 10, bad: 4, level: 'low' },
      { lat: 40, lon: -5, size: 0.5, total: 1, bad: 0 },
      { lat: 41, lon: -5, size: 0.5, total: 2, bad: 2, level: 'high' },
    ],
    fetchedAt: 123,
    partial: true,
    aircraftSampled: 12,
    box: { south: 40, west: -5, north: 42, east: -2 },
    cellSize: 0.5,
  });
  assert.equal(snapshot.cells.length, 2);
  assert.equal(snapshot.cells[0].level, 'high');
  assert.equal(snapshot.cells[1].level, 'low');
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.aircraftSampled, 12);
  assert.equal(snapshot.cellSize, 0.5);
  assert.deepEqual(snapshot.box, { south: 40, west: -5, north: 42, east: -2 });
  assert.equal(normalizeInterferenceSnapshot({ cells: {} }), null);
  assert.equal(
    normalizeInterferenceSnapshot({
      cells: [{ lat: 40, lon: -5, size: 0.5, total: 1, bad: 2 }],
    }),
    null,
    'bad above total rejects the body',
  );
  assert.equal(
    normalizeInterferenceSnapshot({
      cells: [{ lat: 40, lon: -5, size: 0.25, total: 1, bad: 0 }],
    }),
    null,
    'unknown cell size rejects the body',
  );
});

test('view change fraction and chip labels', () => {
  const a = { south: 40, west: -5, north: 42, east: -2 };
  assert.equal(boxChangeFraction(a, { ...a }), 0);
  assert.equal(
    boxChangeFraction(a, { south: 50, west: 10, north: 52, east: 13 }),
    1,
  );
  const nudged = boxChangeFraction(a, {
    south: 40.1,
    west: -4.9,
    north: 42.1,
    east: -1.9,
  });
  assert.ok(nudged > 0 && nudged < 0.25, `small pan is ${nudged}`);
  const panned = boxChangeFraction(a, {
    south: 41,
    west: -3,
    north: 43,
    east: 0,
  });
  assert.ok(panned > 0.25, `half-screen pan is ${panned}`);
  assert.equal(interferenceCountLabel([]), '');
  assert.equal(interferenceCountLabel([{ level: 'low' }]), '1 cells nominal');
  assert.equal(
    interferenceCountLabel([{ level: 'low' }, { level: 'high' }]),
    '1 cell degraded',
  );
  assert.equal(
    interferenceCountLabel([{ level: 'medium' }, { level: 'high' }]),
    '2 cells degraded',
  );
});
