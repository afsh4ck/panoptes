import test from 'node:test';
import assert from 'node:assert/strict';
import { radiationContext } from './index.js';

test('a clicked Safecast device becomes an INTEL context', () => {
  const ctx = radiationContext({
    id: 'radiation:dev-1',
    lat: 40.4167891,
    lon: -3.7038123,
    props: {
      kind: 'device',
      name: 'bGeigie Nano',
      cpm: 42,
      tube: 'LND7317',
      captured: Date.UTC(2026, 9, 2, 8),
    },
  });
  assert.equal(ctx.layerId, 'radiation');
  assert.equal(ctx.label, 'bGeigie Nano');
  assert.equal(ctx.properties.tags.cpm, 42);
  assert.equal(ctx.properties.tags.tube, 'LND7317');
  assert.equal(ctx.properties.tags.last_reading, '2026-10-02T08:00:00.000Z');
  assert.equal(ctx.latitude, 40.416789);
  assert.ok(ctx.properties.tags.level);
});

test('a measurement cell reports mean, max and sample count', () => {
  const ctx = radiationContext({
    id: 'radiation:cell-9',
    lat: 35,
    lon: 139,
    props: { kind: 'cell', meanCpm: 18, maxCpm: 60, count: 240 },
  });
  assert.equal(ctx.label, 'Safecast measurement cell');
  assert.deepEqual(
    [
      ctx.properties.tags.mean_cpm,
      ctx.properties.tags.max_cpm,
      ctx.properties.tags.measurements,
    ],
    [18, 60, 240],
  );
  assert.equal(ctx.properties.tags.last_reading, null);
});
