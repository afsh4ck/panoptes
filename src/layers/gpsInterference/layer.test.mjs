import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  GPS_INTERFERENCE_INFO,
  GPS_INTERFERENCE_MAX_CAMERA_HEIGHT_M,
  createGpsInterferenceLayer,
} from './index.js';

function harness(source, { height = 2_000_000, view = [-5, 40, -2, 42] } = {}) {
  const sources = [];
  const timers = [];
  const listeners = [];
  const viewer = {
    camera: {
      positionCartographic: { height, latitude: 0.7, longitude: -0.06 },
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(...view),
      moveEnd: {
        addEventListener(fn) {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      },
    },
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createGpsInterferenceLayer({
    source,
    render: { governorRequestRender: () => {} },
    now: () => 7000,
    setTimeoutImpl: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutImpl: () => {},
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, timers, listeners };
}

const cells = [
  { lat: 40, lon: -5, size: 0.5, total: 8, bad: 4, ratio: 0.5, level: 'high' },
  { lat: 40.5, lon: -5, size: 0.5, total: 2, bad: 0, ratio: 0, level: 'low' },
];

test('a refresh paints one draped rectangle per cell and reports stats', async () => {
  const boxes = [];
  const h = harness({
    getCells: async (box) => {
      boxes.push(box);
      return { cells, partial: true, stale: false, aircraftSampled: 10 };
    },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.deepEqual(boxes, [{ south: 40, west: -5, north: 42, east: -2 }]);
  assert.equal(h.sources[0].entities.values.length, 2);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.countLabel, '1 cell degraded');
  assert.equal(stats.cells, 2);
  assert.equal(stats.partial, true);
  assert.equal(stats.aircraftSampled, 10);
  assert.equal(stats.lastUpdate, 7000);
  assert.equal(stats.status, '');
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].lat, 40.25);
  assert.equal(records[0].level, 'high');
  assert.equal(h.layer.getRowControls().info, GPS_INTERFERENCE_INFO);
  assert.equal(h.layer.getRowControls().legend.length, 3);
  h.layer.destroy(h.viewer);
  assert.equal(h.sources.length, 0);
  assert.equal(h.listeners.length, 0, 'moveEnd listener released');
});

test('a continental camera never fires a point query', async () => {
  let calls = 0;
  const h = harness(
    {
      getCells: async () => {
        calls += 1;
        return { cells, partial: false, aircraftSampled: 1 };
      },
    },
    { height: GPS_INTERFERENCE_MAX_CAMERA_HEIGHT_M + 1 },
  );
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(calls, 0);
  assert.equal(h.layer.getStats().status, 'zoom-in');
  h.viewer.camera.positionCartographic.height = 500_000;
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().status, '');
  h.layer.destroy(h.viewer);
});

test('camera settles refetch only after the view moved enough', async () => {
  let calls = 0;
  const h = harness({
    getCells: async () => {
      calls += 1;
      return { cells, partial: false, aircraftSampled: 1 };
    },
  });
  await h.layer.update(h.viewer);
  assert.equal(calls, 1);
  // Same view: settle → debounce → skipped.
  h.listeners[0]();
  assert.equal(h.timers.length, 1);
  await h.timers.pop()();
  assert.equal(calls, 1, 'an unchanged view reuses the answer');
  // Small nudge inside the 25% threshold.
  h.viewer.camera.computeViewRectangle = () =>
    Cesium.Rectangle.fromDegrees(-4.9, 40.1, -1.9, 42.1);
  h.listeners[0]();
  await h.timers.pop()();
  assert.equal(calls, 1);
  // A real pan.
  h.viewer.camera.computeViewRectangle = () =>
    Cesium.Rectangle.fromDegrees(-3, 41, 0, 43);
  h.listeners[0]();
  await h.timers.pop()();
  assert.equal(calls, 2);
  h.layer.destroy(h.viewer);
});

test('disable clears the display and a late answer cannot repaint it', async () => {
  let resolve, signal;
  const h = harness({
    getCells(box, options) {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const pending = h.layer.update(h.viewer);
  h.layer.disable();
  assert.equal(signal.aborted, true);
  h.layer.enable(h.viewer);
  resolve({ cells, partial: false, aircraftSampled: 3 });
  assert.equal(await pending, false);
  assert.equal(h.sources[0].entities.values.length, 0);
  assert.equal(h.layer.getStats().count, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the previous cells and reports the error', async () => {
  let fail = false;
  const h = harness({
    getCells: async () => {
      if (fail) throw new Error('GPS interference HTTP 502');
      return { cells, partial: false, aircraftSampled: 3 };
    },
  });
  await h.layer.update(h.viewer);
  fail = true;
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.layer.getStats().error, 'GPS interference HTTP 502');
  assert.equal(h.sources[0].entities.values.length, 2);
  h.layer.destroy(h.viewer);
});
