import assert from 'node:assert/strict';
import test from 'node:test';
import { gpsInterferenceProxy } from '../../../server/providers/aircraft/gps-interference.js';

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => JSON.stringify(payload),
  };
}

function mount(plugin) {
  let handler = null;
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        assert.equal(path, '/api/gps-interference');
        handler = fn;
      },
    },
  });
  return handler;
}

async function call(handler, query, { method = 'GET', ip = '127.0.0.1' } = {}) {
  const res = {
    destroyed: false,
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  await handler(
    { method, url: `/?${query}`, socket: { remoteAddress: ip } },
    res,
  );
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

const QUERY = 'south=40.1&west=-4.6&north=41.9&east=-2.4';

test('aggregates point and military feeds into cells and caches per box', async () => {
  let clock = 1000;
  const calls = [];
  const plugin = gpsInterferenceProxy({
    now: () => clock,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/v2/mil'))
        return jsonResponse({
          ac: [{ hex: 'm1', lat: 40.2, lon: -4.4, nic: 2 }],
        });
      return jsonResponse({
        ac: [
          { hex: 'p1', lat: 40.2, lon: -4.4, nic: 8 },
          { hex: 'p2', lat: 40.3, lon: -4.3, nic: 8 },
          { hex: 'p3', lat: 40.4, lon: -4.2, nic: 9 },
          { hex: 'p4', lat: 40.1, lon: -4.1, nic: 4 },
          { hex: 'p5', lat: 40.45, lon: -4.45, nic: 7 },
        ],
      });
    },
  });
  const handler = mount(plugin);
  const first = await call(handler, QUERY);
  assert.equal(first.status, 200);
  assert.equal(first.headers['X-GPS-Cache'], 'MISS');
  assert.equal(first.json.cellSize, 0.5);
  assert.deepEqual(first.json.box, {
    south: 40,
    west: -5,
    north: 42,
    east: -2,
  });
  assert.equal(first.json.partial, false);
  assert.equal(first.json.aircraftSampled, 6);
  assert.deepEqual(first.json.cells, [
    {
      lat: 40,
      lon: -4.5,
      size: 0.5,
      total: 6,
      bad: 2,
      ratio: 0.333,
      level: 'high',
    },
  ]);
  assert.ok(calls.some((url) => url.includes('/v2/point/41/-3.5/250')));
  assert.ok(calls.some((url) => url.endsWith('/v2/mil')));
  const before = calls.length;
  const second = await call(
    handler,
    'south=40.2&west=-4.9&north=41.8&east=-2.1',
  );
  assert.equal(
    second.headers['X-GPS-Cache'],
    'HIT',
    'a nearby view shares the answer',
  );
  assert.equal(calls.length, before);
});

test('invalid boxes, wrong methods, stale answers and cold failures', async () => {
  let clock = 1000;
  let fail = false;
  const plugin = gpsInterferenceProxy({
    now: () => clock,
    fetchImpl: async () => {
      if (fail) throw new Error('down');
      return jsonResponse({ ac: [{ hex: 'x', lat: 40.5, lon: -3, nic: 9 }] });
    },
  });
  const handler = mount(plugin);
  assert.equal(
    (await call(handler, 'south=1&west=1&north=0&east=2')).status,
    400,
  );
  assert.equal((await call(handler, '')).status, 400);
  const post = await call(handler, QUERY, { method: 'POST' });
  assert.equal(post.status, 405);
  fail = true;
  const cold = await call(handler, QUERY);
  assert.equal(cold.status, 502);
  assert.deepEqual(cold.json, { error: 'gps_interference_unavailable' });
  fail = false;
  assert.equal((await call(handler, QUERY)).status, 200);
  clock += 91_000;
  fail = true;
  const stale = await call(handler, QUERY);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['X-GPS-Cache'], 'STALE');
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.cells.length, 1);
});

test('the shared upstream budget marks thinned answers partial', async () => {
  let calls = 0;
  const plugin = gpsInterferenceProxy({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        ac: [{ hex: `h${calls}`, lat: 30, lon: 5, nic: 9 }],
      });
    },
  });
  const handler = mount(plugin);
  // A box needing nine circles plus the military feed exceeds nothing yet…
  const wide = await call(handler, 'south=0&west=0&north=59&east=59');
  assert.equal(wide.status, 200);
  assert.equal(wide.json.partial, true, 'nine circles cannot cover 59°×59°');
  const used = calls;
  // …but the next distinct wide box exhausts the 20-per-minute budget.
  const next = await call(handler, 'south=-59&west=-59&north=0&east=0');
  assert.equal(next.status, 200);
  assert.ok(calls - used < 10, 'remaining budget bounded the second fan-out');
  assert.equal(next.json.partial, true);
});
