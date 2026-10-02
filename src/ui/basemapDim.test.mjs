import test from 'node:test';
import assert from 'node:assert/strict';
import { dimFactor } from './basemapDim.js';

test('dim amount maps to a bounded brightness factor', () => {
  assert.equal(dimFactor(0), 1);
  assert.equal(dimFactor(-1), 1);
  assert.equal(dimFactor('x'), 1);
  assert.ok(Math.abs(dimFactor(0.38) - 0.62) < 1e-9);
  assert.ok(Math.abs(dimFactor(5) - 0.2) < 1e-9);
});
