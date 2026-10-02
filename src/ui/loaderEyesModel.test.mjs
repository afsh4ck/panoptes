import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTER,
  MAIN_EYE,
  ORBIT_RADIUS,
  WATCHERS,
  WATCHER_EYE,
  clientToStage,
  isBlinking,
  pupilOffset,
  trackingReadout,
  watcherPosition,
} from './loaderEyesModel.js';

test('watchers sit evenly on the orbit and move over time', () => {
  for (let i = 0; i < WATCHERS; i++) {
    const p = watcherPosition(i, 0);
    assert.ok(
      Math.abs(Math.hypot(p.x - CENTER, p.y - CENTER) - ORBIT_RADIUS) < 1e-9,
    );
  }
  const top = watcherPosition(0, 0);
  assert.ok(Math.abs(top.x - CENTER) < 1e-9 && top.y < CENTER);
  assert.notDeepEqual(watcherPosition(0, 5), top);
  assert.deepEqual(watcherPosition(0, 5, { reducedMotion: true }), top);
});

test('pupils turn toward the target and stay inside the almond', () => {
  const right = pupilOffset({ x: 0, y: 0 }, { x: 5000, y: 0 }, MAIN_EYE);
  assert.ok(right.x > 0 && Math.abs(right.y) < 1e-9);
  assert.ok(right.x <= MAIN_EYE.halfWidth - MAIN_EYE.iris);
  const up = pupilOffset({ x: 0, y: 0 }, { x: 0, y: -5000 }, WATCHER_EYE);
  assert.ok(up.y < 0 && Math.abs(up.y) < WATCHER_EYE.halfWidth * 0.62);
  assert.deepEqual(pupilOffset({ x: 1, y: 1 }, { x: 1, y: 1 }, MAIN_EYE), {
    x: 0,
    y: 0,
  });
});

test('client points map into stage units and the readout locks', () => {
  assert.deepEqual(
    clientToStage({ x: 300, y: 200 }, { left: 100, top: 0, width: 200 }),
    { x: 400, y: 400 },
  );
  const r = trackingReadout(
    { x: 500, y: 250 },
    { width: 1000, height: 500 },
    1,
  );
  assert.equal(r.title, 'TARGET LOCKED');
  assert.match(r.line, /X 500 · Y 250 · 0\.0000° 0\.0000°/);
  assert.equal(
    trackingReadout({ x: 0, y: 0 }, { width: 10, height: 10 }, 0.4).title,
    'ACQUIRING TARGET',
  );
  assert.equal(typeof isBlinking(3, 1.2), 'boolean');
});
