import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraVisible, catalogCounts } from './cctvCatalogBar.js';

const cams = [
  { id: 'a', city: 'London', name: 'A3 Clapham High St', feedType: 'image' },
  { id: 'b', city: 'Tallinn', name: 'Pärnu mnt', feedType: 'hls' },
  { id: 'c', city: 'Madrid', name: 'Gran Vía', isVideo: true },
];

test('counts total and live-video cameras', () => {
  assert.deepEqual(catalogCounts(cams), { total: 3, live: 2 });
  assert.deepEqual(catalogCounts(), { total: 0, live: 0 });
});

test('live filter keeps only video cameras', () => {
  assert.equal(cameraVisible(cams[0], { liveOnly: true }), false);
  assert.equal(cameraVisible(cams[1], { liveOnly: true }), true);
});

test('search matches city and street words, ignoring accents and case', () => {
  assert.equal(cameraVisible(cams[0], { query: 'london clapham' }), true);
  assert.equal(cameraVisible(cams[2], { query: 'gran via' }), true);
  assert.equal(cameraVisible(cams[1], { query: 'parnu' }), true);
  assert.equal(cameraVisible(cams[0], { query: 'madrid' }), false);
  assert.equal(cameraVisible(null), false);
});
