import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fighterHudGeometry,
  fighterLadderRungs,
  flightPathAngleDeg,
  formatVerticalSpeed,
  machFromMps,
  pixelsPerDegree,
} from './fighterHudModel.js';

test('the ladder has rungs every 5 degrees without the horizon', () => {
  const rungs = fighterLadderRungs(30, 5);
  assert.equal(rungs.length, 12);
  assert.ok(!rungs.includes(0));
  assert.deepEqual([rungs[0], rungs.at(-1)], [-30, 30]);
});

test('pixels per degree follow the field of view', () => {
  assert.equal(pixelsPerDegree(60, 720), 12);
  assert.equal(pixelsPerDegree(0, 720), 12);
});

test('climbing puts the flight-path marker above the waterline', () => {
  const climb = flightPathAngleDeg(100, 10);
  assert.ok(climb > 5 && climb < 6);
  assert.equal(flightPathAngleDeg(0, 0), 0);
  const g = fighterHudGeometry({ cameraPitchDeg: 0, flightPathDeg: climb });
  assert.ok(g.fpmOffsetPx < 0);
  const nose = fighterHudGeometry({ cameraPitchDeg: 10 });
  assert.equal(nose.ladderShiftPx, 120);
  assert.equal(fighterHudGeometry({ cameraRollDeg: 15 }).rollDeg, -15);
});

test('symbology stays on the glass', () => {
  const g = fighterHudGeometry({ cameraPitchDeg: 80, viewportHeight: 720 });
  assert.ok(g.ladderShiftPx <= 720 * 0.32);
});

test('readouts', () => {
  assert.equal(machFromMps(340.3), 1);
  assert.equal(machFromMps(null), null);
  assert.equal(formatVerticalSpeed(12.44), '+12.4');
  assert.equal(formatVerticalSpeed(-3), '−3.0');
  assert.equal(formatVerticalSpeed(0.01), '0.0');
  assert.equal(formatVerticalSpeed(undefined), '---');
});
