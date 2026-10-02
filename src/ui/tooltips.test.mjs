import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTooltip } from './tooltips.js';

const viewport = { width: 1000, height: 800 };
const rect = (left, top, width = 40, height = 30) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

test('bubbles sit above and centred on their anchor', () => {
  const p = placeTooltip(rect(480, 400), { width: 120, height: 30 }, viewport);
  assert.equal(p.side, 'top');
  assert.equal(p.left, 440);
  assert.equal(p.top, 360);
  assert.equal(p.arrow, 60);
});

test('anchors at the top edge get the bubble below', () => {
  const p = placeTooltip(rect(480, 5), { width: 120, height: 30 }, viewport);
  assert.equal(p.side, 'bottom');
  assert.equal(p.top, 45);
});

test('bubbles never leave the viewport sideways', () => {
  const left = placeTooltip(rect(0, 400), { width: 200, height: 30 }, viewport);
  assert.equal(left.left, 8);
  assert.ok(left.arrow >= 12);
  const right = placeTooltip(
    rect(980, 400),
    { width: 200, height: 30 },
    viewport,
  );
  assert.equal(right.left, 1000 - 200 - 8);
});
