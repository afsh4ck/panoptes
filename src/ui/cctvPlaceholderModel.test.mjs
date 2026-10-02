import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEHOLDER_SAMPLE,
  looksLikePublisherPlaceholder,
} from './cctvPlaceholderModel.js';

const { width, height } = PLACEHOLDER_SAMPLE;
const frame = (paint) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data.set([r, g, b, 255], i);
    }
  return data;
};

test('a flat grey card with a line of white text is a placeholder', () => {
  const card = frame((x, y) =>
    y > 10 && y < 16 && x > 6 && x < 42 && (x + y) % 3 === 0
      ? [250, 250, 250]
      : [128, 128, 128],
  );
  assert.equal(looksLikePublisherPlaceholder(card), true);
});

test('a textured grey street scene is not a placeholder', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const street = frame(() => {
    const v = 100 + Math.floor(rand() * 70);
    return [v, v + 2, v + 4];
  });
  assert.equal(looksLikePublisherPlaceholder(street), false);
});

test('a colourful scene is not a placeholder', () => {
  const scene = frame((x, y) => [40 + x * 3, 90 + y * 4, 60]);
  assert.equal(looksLikePublisherPlaceholder(scene), false);
});

test('tiny or empty inputs are ignored', () => {
  assert.equal(looksLikePublisherPlaceholder(new Uint8ClampedArray(16)), false);
  assert.equal(looksLikePublisherPlaceholder(null), false);
});
