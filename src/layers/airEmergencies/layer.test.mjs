import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIR_EMERGENCY_EVENT,
  EMERGENCY_OVERLAY_SOURCE_ID,
  createAirEmergenciesLayer,
} from './index.js';

const row = (overrides = {}) => ({
  hex: 'abc123',
  callsign: 'DLH400',
  registration: 'D-AIBD',
  type: 'A319',
  squawk: '7700',
  emergency: 'general',
  lat: 50,
  lon: 8,
  altFt: 27500,
  onGround: false,
  gsKt: 415,
  track: 268,
  seen: 2,
  category: 'A3',
  observedAtMs: 1000,
  ...overrides,
});

function harness(source) {
  const sources = [];
  const published = [];
  const holds = [];
  const events = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createAirEmergenciesLayer({
    source,
    overlayHost: {
      setEntries(id, entries) {
        published.push({ id, entries });
      },
      setVisible() {},
      clearSource() {},
    },
    render: {
      holdContinuousRender: (owner) => holds.push(`hold:${owner}`),
      releaseContinuousRender: (owner) => holds.push(`release:${owner}`),
      governorRequestRender: () => {},
    },
    dispatchEvent: (type, detail) => events.push({ type, detail }),
    now: () => 5000,
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, published, holds, events };
}

test('a snapshot paints markers, publishes cards and holds the render loop', async () => {
  const h = harness({
    getSnapshot: async () => ({
      rows: [row(), row({ hex: 'def456', squawk: '7600', onGround: true })],
      stale: true,
      partial: true,
    }),
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.sources[0].entities.values.length, 4, 'marker + ring per row');
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].id, EMERGENCY_OVERLAY_SOURCE_ID);
  assert.deepEqual(
    h.published[0].entries.map((entry) => entry.title),
    ['7700 · DLH400', '7600 · DLH400'],
  );
  assert.ok(h.published[0].entries.every((entry) => entry.position));
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.countLabel, '2 emergencies');
  assert.equal(stats.stale, true);
  assert.equal(stats.partial, true);
  assert.equal(stats.lastUpdate, 5000);
  assert.deepEqual(h.holds, ['hold:air-emergencies']);
  assert.equal(h.layer.getAnalystRecords().length, 2);
  assert.equal(h.layer.getEmergencies()[0].hex, 'abc123');
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.holds, [
    'hold:air-emergencies',
    'release:air-emergencies',
  ]);
  assert.equal(h.sources.length, 0);
});

test('only newly seen contacts raise the emergency event, even across a toggle', async () => {
  let rows = [row()];
  const h = harness({ getSnapshot: async () => ({ rows }) });
  await h.layer.update(h.viewer);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, AIR_EMERGENCY_EVENT);
  assert.equal(h.events[0].detail.squawk, '7700');
  assert.equal(h.events[0].detail.name, 'DLH400');
  assert.equal(h.events[0].detail.layerId, 'air-emergencies');
  await h.layer.update(h.viewer);
  assert.equal(h.events.length, 1, 'a repeat snapshot is silent');
  h.layer.disable(h.viewer);
  h.layer.enable(h.viewer);
  rows = [row(), row({ hex: 'def456', squawk: '7500' })];
  await h.layer.update(h.viewer);
  assert.equal(h.events.length, 2);
  assert.equal(h.events[1].detail.hex, 'def456');
  h.layer.destroy(h.viewer);
});

test('an empty snapshot releases the render hold and clears the count', async () => {
  let rows = [row()];
  const h = harness({ getSnapshot: async () => ({ rows }) });
  await h.layer.update(h.viewer);
  rows = [];
  await h.layer.update(h.viewer);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.layer.getStats().countLabel, '');
  assert.deepEqual(h.holds, [
    'hold:air-emergencies',
    'release:air-emergencies',
  ]);
  assert.equal(h.sources[0].entities.values.length, 0);
  h.layer.destroy(h.viewer);
});

test('a late refresh cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve, signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve({ rows: [row()] });
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.published.length, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('a failed refresh keeps the last rows and reports the error', async () => {
  let fail = false;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('adsb.lol HTTP 502');
      return { rows: [row()] };
    },
  });
  await h.layer.update(h.viewer);
  fail = true;
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.error, 'adsb.lol HTTP 502');
  h.layer.destroy(h.viewer);
});
