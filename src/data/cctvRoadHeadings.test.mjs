import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angleDiff,
  bearingDeg,
  kmUpBearing,
  nearestRoadAxis,
  normalizeRoadRef,
  resolveRoadHeading,
} from './cctvRoadHeadings.js';
import {
  joinRoadHeadings,
  loadRoadHeadings,
} from '../../server/providers/cctv/roadHeadings.js';

const camera = { lat: 42.0, lon: -5.0 };
/** A straight line through `camera` heading `bearing`, ±200 m, in [lon, lat]. */
const lineThrough = (bearing, offsetEastM = 0, props = {}) => {
  const rad = (bearing * Math.PI) / 180;
  const mLat = 1 / 111_320;
  const mLon = 1 / (111_320 * Math.cos((camera.lat * Math.PI) / 180));
  const point = (t) => [
    camera.lon + (offsetEastM + t * Math.sin(rad)) * mLon,
    camera.lat + t * Math.cos(rad) * mLat,
  ];
  return { coordinates: [point(-200), point(200)], ...props };
};

test('road numbers compare without punctuation and split OSM ref lists', () => {
  assert.equal(normalizeRoadRef('A-6'), 'A6');
  assert.equal(normalizeRoadRef(' ap 9 '), 'AP9');
  const axis = nearestRoadAxis(camera, [lineThrough(45, 0, { ref: 'E-70;A-6' })], 'A6');
  assert.equal(axis?.matchedRef, true);
});

test('bearings and angle differences', () => {
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 1e-9);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-9);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 190), 180);
});

test('the same numbered road wins over a nearer unrelated road', () => {
  const axis = nearestRoadAxis(
    camera,
    [
      lineThrough(90, 5, { ref: 'N-120', class: 'primary' }),
      lineThrough(20, 80, { ref: 'A-6', class: 'motorway' }),
    ],
    'A-6',
  );
  assert.equal(axis.matchedRef, true);
  assert.ok(Math.abs(axis.axisDeg - 20) < 0.5);
});

test('without a numbered match only a nearby major road counts', () => {
  const near = nearestRoadAxis(
    camera,
    [
      lineThrough(10, 20, { class: 'residential' }),
      lineThrough(120, 40, { class: 'trunk' }),
    ],
    'A-6',
  );
  assert.equal(near.matchedRef, false);
  assert.ok(Math.abs(near.axisDeg - 120) < 0.5);
  assert.equal(
    nearestRoadAxis(camera, [lineThrough(0, 90, { class: 'trunk' })], 'A-6'),
    null,
    'a major road 90 m away is not the camera road',
  );
});

test('kilometres grow towards the nearest consistent neighbour on the road', () => {
  const here = { lat: 42.0, lon: -5.0, kmPoint: 100 };
  // 5 km north at PK 105; a PK 101 point 30 km away is a different stretch.
  const ahead = { lat: 42.045, lon: -5.0, kmPoint: 105 };
  const stray = { lat: 42.3, lon: -5.0, kmPoint: 101 };
  assert.ok(angleDiff(kmUpBearing(here, [here, ahead, stray]), 0) < 1);
  const behind = { lat: 41.955, lon: -5.0, kmPoint: 104 };
  assert.ok(angleDiff(kmUpBearing(here, [here, behind]), 0) > 179);
  assert.ok(Number.isNaN(kmUpBearing(here, [here])));
});

test('travel direction turns the road axis into a facing', () => {
  // Road drawn at 200°, kilometres growing towards 15°: "up" is 20°.
  assert.deepEqual(
    resolveRoadHeading({ axisDeg: 200, kmUpDeg: 15, travelDirection: 'positive' }),
    { headingDeg: 20, confidence: 'medium' },
  );
  assert.deepEqual(
    resolveRoadHeading({ axisDeg: 200, kmUpDeg: 15, travelDirection: 'negative' }),
    { headingDeg: 200, confidence: 'medium' },
  );
  assert.deepEqual(
    resolveRoadHeading({ axisDeg: 200, kmUpDeg: 15, travelDirection: 'both' }),
    { headingDeg: 20, confidence: 'low' },
  );
  // A neighbour at right angles to the road says nothing about the direction.
  assert.deepEqual(
    resolveRoadHeading({ axisDeg: 200, kmUpDeg: 110, travelDirection: 'positive' }),
    { headingDeg: 200, confidence: 'low' },
  );
  assert.equal(resolveRoadHeading({ axisDeg: NaN }), null);
});

test('the catalog only replaces synthetic bearings of cameras that did not move', () => {
  const sources = [
    { id: 'a', lat: 42, lon: -5, headingDeg: 7, headingConfidence: 'low' },
    { id: 'b', lat: 42, lon: -5, headingDeg: 7, headingConfidence: 'high' },
    { id: 'c', lat: 42.01, lon: -5, headingDeg: 7, headingConfidence: 'low' },
    { id: 'd', lat: 42, lon: -5, headingDeg: 7, headingConfidence: 'low', poseSource: 'curated' },
  ];
  const entry = { headingDeg: 20, confidence: 'medium', lat: 42, lon: -5 };
  joinRoadHeadings(sources, { a: entry, b: entry, c: entry, d: entry });
  assert.deepEqual(
    sources.map((s) => [s.id, s.headingDeg, s.headingConfidence]),
    [
      ['a', 20, 'medium'],
      ['b', 7, 'high'],
      ['c', 7, 'low'],
      ['d', 7, 'low'],
    ],
  );
  assert.deepEqual(loadRoadHeadings('/nonexistent-root'), {});
});

test('a facing that points away from the named far destination stays an estimate', () => {
  // Positive and up at 20°, but the feed says the camera looks towards 200°.
  assert.deepEqual(
    resolveRoadHeading({
      axisDeg: 200,
      kmUpDeg: 15,
      travelDirection: 'positive',
      destinationDeg: 200,
    }),
    { headingDeg: 20, confidence: 'low' },
  );
  assert.deepEqual(
    resolveRoadHeading({
      axisDeg: 200,
      kmUpDeg: 15,
      travelDirection: 'positive',
      destinationDeg: 60,
    }),
    { headingDeg: 20, confidence: 'medium' },
  );
});
