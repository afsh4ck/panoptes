import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EXTRAPOLATION_SEC,
  extrapolateAltitude,
} from './altitudeEstimate.js';

test('a descending aircraft keeps descending while altitude is missing', () => {
  const step = extrapolateAltitude({
    previousM: 900,
    verticalRateMps: -4,
    elapsedSec: 10,
  });
  assert.deepEqual(step, { value: 860, estimated: true });
});

test('it never goes below the ground under the aircraft', () => {
  const step = extrapolateAltitude({
    previousM: 700,
    verticalRateMps: -5,
    elapsedSec: 60,
    floorM: 610,
  });
  assert.equal(step.value, 610);
});

test('level flight or unknown rate holds the height', () => {
  assert.equal(
    extrapolateAltitude({
      previousM: 11000,
      verticalRateMps: 0.2,
      elapsedSec: 30,
    }).value,
    11000,
  );
  assert.equal(
    extrapolateAltitude({
      previousM: 11000,
      verticalRateMps: null,
      elapsedSec: 30,
    }).value,
    11000,
  );
});

test('long silences are capped', () => {
  const step = extrapolateAltitude({
    previousM: 3000,
    verticalRateMps: -10,
    elapsedSec: 10_000,
  });
  assert.equal(step.value, 3000 - 10 * MAX_EXTRAPOLATION_SEC);
});
