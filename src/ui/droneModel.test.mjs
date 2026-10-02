import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPitch,
  compassPoint,
  droneClimbRate,
  droneIntent,
  droneOsd,
  droneSpeed,
  nextSpeedMultiplier,
} from './droneModel.js';

test('WASD, arrows, Shift/Q/C/E map to drone intents; Ctrl is never a drone key', () => {
  assert.equal(droneIntent('W'), 'forward');
  assert.equal(droneIntent('a'), 'left');
  assert.equal(droneIntent('ArrowRight'), 'right');
  assert.equal(droneIntent('Shift'), 'up');
  assert.equal(droneIntent('Control'), null);
  assert.equal(droneIntent('c'), 'down');
  assert.equal(droneIntent('q'), 'down');
  assert.equal(droneIntent('x'), null);
});

test('speed scales with height and wheel multiplier within bounds', () => {
  assert.equal(droneSpeed(0), 12);
  assert.ok(droneSpeed(1000) > droneSpeed(100));
  assert.equal(droneSpeed(1e7), 2500);
  assert.equal(droneSpeed(100, 2), droneSpeed(100) * 2);
  assert.ok(droneClimbRate(0) >= 6);
  assert.ok(nextSpeedMultiplier(1, -100) > 1);
  assert.ok(nextSpeedMultiplier(1, 100) < 1);
  assert.equal(nextSpeedMultiplier(8, -1), 8);
});

test('gimbal clamps and the OSD formats readings', () => {
  assert.equal(clampPitch(120), 85);
  assert.equal(clampPitch(-120), -89);
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(359), 'N');
  const osd = droneOsd({
    altMslM: 812,
    aglM: 160,
    speedMps: 20,
    climbMps: 0,
    headingDeg: 72,
    pitchDeg: -20,
    lat: 40.4,
    lon: -3.7,
    multiplier: 1,
  });
  assert.match(osd.alt, /ALT 812 m MSL · AGL 160 m/);
  assert.match(osd.speed, /72 km\/h/);
  assert.match(osd.heading, /HDG 072° ENE/);
});
