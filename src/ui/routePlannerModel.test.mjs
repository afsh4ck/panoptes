import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingDeg,
  buildTimeline,
  clockAfter,
  parseCoordinates,
  planFlight,
  positionAtTime,
  segmentMeters,
  suggestedSpeed,
} from './routePlannerModel.js';

const MADRID = { lat: 40.4168, lon: -3.7038, name: 'Madrid' };
const BARCELONA = { lat: 41.3874, lon: 2.1686, name: 'Barcelona' };

test('coordinates parse as lat, lon', () => {
  assert.deepEqual(parseCoordinates('40.4168, -3.7038'), {
    lat: 40.4168,
    lon: -3.7038,
    name: '40.4168, -3.7038',
  });
  assert.equal(parseCoordinates('Madrid'), null);
  assert.equal(parseCoordinates('95, 10'), null);
});

test('geometry helpers', () => {
  const m = segmentMeters([0, 0], [0, 1]);
  assert.ok(Math.abs(m - 111_195) < 50);
  assert.ok(Math.abs(bearingDeg([0, 0], [0, 1]) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg([0, 0], [1, 0]) - 90) < 0.01);
});

test('a flight plan climbs, cruises and descends', () => {
  const plan = planFlight(MADRID, BARCELONA);
  assert.ok(plan.distanceM > 480_000 && plan.distanceM < 520_000);
  assert.ok(plan.durationS > 45 * 60 && plan.durationS < 90 * 60);
  assert.equal(plan.heights[0], 0);
  assert.equal(plan.heights.at(-1), 0);
  assert.ok(Math.max(...plan.heights) > 9000);
  assert.match(plan.steps[0].instruction, /Take off from Madrid/);
  assert.match(plan.steps.at(-1).instruction, /Land at Barcelona/);
});

test('timeline maps time to distance through step durations', () => {
  const route = {
    geometry: [
      [0, 0],
      [0, 0.01],
      [0, 0.02],
    ],
    distanceM: 2224,
    durationS: 300,
    steps: [
      { index: 0, distanceM: 1112, durationS: 100 },
      { index: 1, distanceM: 1112, durationS: 200 },
      { index: 2, distanceM: 0, durationS: 0 },
    ],
  };
  const timeline = buildTimeline(route);
  assert.equal(timeline.durationS, 300);
  const half = positionAtTime(timeline, 100);
  assert.ok(Math.abs(half.lat - 0.01) < 1e-4);
  assert.equal(half.stepIndex, 0);
  const later = positionAtTime(timeline, 200);
  assert.ok(Math.abs(later.lat - 0.015) < 1e-4);
  assert.equal(later.stepIndex, 1);
  assert.equal(later.remainingS, 100);
  const end = positionAtTime(timeline, 999);
  assert.equal(end.done, true);
  assert.ok(end.remainingM < 1);
});

test('speed suggestion plays a route in about a minute and a half', () => {
  assert.equal(suggestedSpeed(20 * 60), 10);
  assert.equal(suggestedSpeed(80 * 60), 60);
  assert.equal(suggestedSpeed(9 * 3600), 300);
  assert.equal(suggestedSpeed(30), 1);
});

test('arrival clock', () => {
  assert.equal(clockAfter(90 * 60, new Date(2026, 0, 1, 10, 0)), '11:30');
});

test('a short hop flies low and slow', () => {
  const plan = planFlight(
    { lat: 40.4168, lon: -3.7038, name: 'Sol' },
    { lat: 40.4153, lon: -3.6844, name: 'Retiro' },
  );
  assert.ok(Math.max(...plan.heights) <= 400);
  const kmh = plan.distanceM / 1000 / (plan.durationS / 3600);
  assert.ok(kmh < 260, `${kmh} km/h`);
});
