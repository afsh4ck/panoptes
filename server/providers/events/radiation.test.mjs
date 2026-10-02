import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateSafecastMeasurements,
  normalizeSafecastDevices,
} from './safecast.js';
import { radiationProxy } from './radiation.js';

test('measurements aggregate into quarter-degree cells with CPM stats', () => {
  const cells = aggregateSafecastMeasurements([
    {
      unit: 'cpm',
      value: 30,
      latitude: 35.1,
      longitude: 139.1,
      captured_at: '2026-09-29T00:00:00Z',
    },
    {
      unit: 'cpm',
      value: 50,
      latitude: 35.2,
      longitude: 139.2,
      captured_at: '2026-09-30T00:00:00Z',
    },
    { unit: 'usv', value: 0.1, latitude: 35.2, longitude: 139.2 },
    { unit: 'cpm', value: -1, latitude: 35.2, longitude: 139.2 },
    { unit: 'cpm', value: 12, latitude: 91, longitude: 139.2 },
    { unit: 'cpm', value: 400, latitude: -33.9, longitude: 151.2 },
  ]);
  assert.equal(cells.length, 2);
  const tokyo = cells.find((cell) => cell.count === 2);
  assert.equal(tokyo.meanCpm, 40);
  assert.equal(tokyo.maxCpm, 50);
  assert.equal(tokyo.latest, '2026-09-30T00:00:00.000Z');
  assert.equal(tokyo.south, 35);
  assert.equal(tokyo.north, 35.25);
  assert.equal(tokyo.west, 139);
  assert.equal(tokyo.lat, 35.125);
  assert.equal(cells.find((cell) => cell.count === 1).maxCpm, 400);
});

test('devices keep recent Geiger readings with coordinates', () => {
  const nowMs = Date.parse('2026-09-30T00:00:00Z');
  const rows = normalizeSafecastDevices(
    [
      {
        device_urn: 'a',
        loc_lat: 37.3,
        loc_lon: 140.3,
        lnd_7318c: 37,
        when_captured: '2026-09-29T12:00:00Z',
        device_sn: 'fish',
        loc_name: 'Koriyama',
        loc_country: 'JP',
      },
      {
        device_urn: 'b',
        loc_lat: 37.3,
        loc_lon: 140.3,
        pms_pm02_5: 4,
        when_captured: '2026-09-29T12:00:00Z',
      },
      {
        device_urn: 'c',
        loc_lat: 37.3,
        loc_lon: 140.3,
        lnd_7318u: 20,
        when_captured: '2026-01-01T00:00:00Z',
      },
      { device_urn: 'd', lnd_7318u: 20, when_captured: '2026-09-29T12:00:00Z' },
    ],
    { nowMs },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'device:a');
  assert.equal(rows[0].cpm, 37);
  assert.equal(rows[0].tube, 'lnd_7318c');
  assert.equal(rows[0].name, 'fish');
  assert.equal(rows[0].country, 'JP');
});

function fakeResponse() {
  const chunks = [];
  return {
    destroyed: false,
    status: 0,
    headers: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      chunks.push(body);
    },
    body: () => JSON.parse(chunks.join('')),
  };
}

test('radiation proxy validates the window and pages measurements', async () => {
  const pages = [];
  const fetchImpl = async (url) => {
    if (url.startsWith('https://tt.safecast.org/devices'))
      return Response.json([
        {
          device_urn: 'a',
          loc_lat: 1,
          loc_lon: 2,
          lnd_7318u: 21,
          when_captured: '2026-09-29T12:00:00Z',
        },
      ]);
    const page = new URL(url).searchParams.get('page');
    pages.push(page);
    return Response.json(
      page === '1'
        ? [
            {
              unit: 'cpm',
              value: 30,
              latitude: 1,
              longitude: 2,
              captured_at: '2026-09-29T00:00:00Z',
            },
          ]
        : [],
    );
  };
  const plugin = radiationProxy({
    fetchImpl,
    now: () => Date.parse('2026-09-30T00:00:00Z'),
  });
  const bad = fakeResponse();
  await plugin._handler({ method: 'GET', url: '/?days=9', socket: {} }, bad);
  assert.equal(bad.status, 400);
  assert.equal(bad.body().error, 'invalid_days');
  const res = fakeResponse();
  await plugin._handler({ method: 'GET', url: '/?days=3', socket: {} }, res);
  assert.equal(res.status, 200);
  const payload = res.body();
  assert.equal(payload.days, 3);
  assert.equal(payload.cells.length, 1);
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.degraded, null);
  assert.deepEqual(pages, ['1']);
});
