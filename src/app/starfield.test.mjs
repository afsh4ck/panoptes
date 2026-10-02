import test from 'node:test';
import assert from 'node:assert/strict';
import { faceStars, seededRandom, starColor } from './starfield.js';

test('the star sky is deterministic for a seed', () => {
  const a = faceStars(seededRandom(7), 2048, 50);
  const b = faceStars(seededRandom(7), 2048, 50);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, faceStars(seededRandom(8), 2048, 50));
});

test('stars stay on the face, faint ones dominate and only bright ones glow', () => {
  const stars = faceStars(seededRandom(1), 1024, 4000);
  for (const star of stars) {
    assert.ok(star.x >= 0 && star.x < 1024 && star.y >= 0 && star.y < 1024);
    assert.ok(star.alpha > 0 && star.alpha <= 1.05);
  }
  const faint = stars.filter((s) => s.radius < 0.6).length;
  const halos = stars.filter((s) => s.halo).length;
  assert.ok(faint > stars.length * 0.6);
  assert.ok(halos > 0 && halos < stars.length * 0.05);
  assert.equal(starColor(0.5).length, 3);
});
