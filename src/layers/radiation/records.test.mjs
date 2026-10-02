import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapRadiationAnalystRecords,
  normalizeRadiationSnapshot,
  radiationBand,
  radiationColor,
} from './records.js';

test('bands classify CPM with a green floor', () => {
  assert.equal(radiationBand(0).id, 'background');
  assert.equal(radiationBand(29.9).id, 'background');
  assert.equal(radiationBand(30).id, 'elevated');
  assert.equal(radiationBand(250).id, 'high');
  assert.equal(radiationBand(5000).id, 'alert');
  assert.equal(radiationBand(NaN).id, 'background');
  assert.equal(radiationColor(600), '#ff1744');
});

test('snapshot keeps valid cells and devices only', () => {
  const snapshot = normalizeRadiationSnapshot({
    cells: [
      {
        id: 'cell:140:556',
        south: 35,
        west: 139,
        north: 35.25,
        east: 139.25,
        count: 2,
        meanCpm: 40,
        maxCpm: 50,
        latest: '2026-09-30T00:00:00Z',
      },
      { id: 'bad', south: 35, west: 139, north: 34, east: 139.25, meanCpm: 40 },
      { id: 'nocpm', south: 0, west: 0, north: 1, east: 1 },
    ],
    devices: [
      {
        id: 'device:a',
        lat: 37.3,
        lon: 140.3,
        cpm: 37,
        name: 'fish',
        place: 'Koriyama',
        country: 'JP',
        tube: 'lnd_7318c',
        captured: '2026-09-29T12:00:00Z',
      },
      { id: 'device:b', lat: 100, lon: 140.3, cpm: 37 },
      { id: '', lat: 1, lon: 1, cpm: 1 },
    ],
    days: 3,
    counts: { measurements: 5000 },
    degraded: 'Safecast devices unavailable',
  });
  assert.equal(snapshot.cells.length, 1);
  assert.equal(snapshot.cells[0].lat, 35.125);
  assert.equal(snapshot.cells[0].latestMs, Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(snapshot.devices.length, 1);
  assert.equal(snapshot.devices[0].tube, 'lnd_7318c');
  assert.equal(snapshot.days, 3);
  assert.equal(snapshot.counts.measurements, 5000);
  assert.equal(snapshot.degraded, 'Safecast devices unavailable');
  assert.equal(normalizeRadiationSnapshot({ cells: [] }), null);
  const records = mapRadiationAnalystRecords(snapshot);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, 'device');
  assert.equal(records[1].kind, 'cell');
  assert.equal(records[1].band, 'elevated');
});
