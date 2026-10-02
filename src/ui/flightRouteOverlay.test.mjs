import test from 'node:test';
import assert from 'node:assert/strict';
import { routeHeights } from './flightRouteOverlay.js';

test('flown leg climbs from the runway to the aircraft altitude', () => {
  const h = routeHeights(5, 11000, 'flown');
  assert.equal(h[0], 60);
  assert.equal(h.at(-1), 11000);
  for (let i = 1; i < h.length; i++) assert.ok(h[i] >= h[i - 1]);
  // Fast initial climb: most of the altitude within the first half.
  assert.ok(h[2] > 11000 * 0.8);
});

test('remaining leg stays high, then descends onto the destination', () => {
  const h = routeHeights(5, 11000, 'remaining');
  assert.equal(h[0], 11000);
  assert.equal(h.at(-1), 60);
  assert.ok(h[2] > 11000 * 0.8);
});

test('low or unknown altitude still lifts the line off the ground', () => {
  assert.ok(routeHeights(3, null, 'flown').at(-1) >= 1500);
});
