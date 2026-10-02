import assert from 'node:assert/strict';
import test from 'node:test';
import { emergencySquawkProxy } from '../../../server/providers/aircraft/emergency.js';

function jsonResponse(payload, { status = 200, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === 'retry-after' ? retryAfter : null) },
    body: null,
    text: async () => JSON.stringify(payload),
  };
}

function mount(plugin) {
  let handler = null;
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        assert.equal(path, '/api/adsblol/emergency');
        handler = fn;
      },
    },
  });
  return handler;
}

async function call(handler, { method = 'GET', ip = '127.0.0.1' } = {}) {
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
  await handler({ method, url: '/', socket: { remoteAddress: ip } }, res);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

const ac = (hex, squawk, extra = {}) => ({
  hex,
  squawk,
  flight: `FL${hex.slice(-2)}`,
  lat: 10,
  lon: 20,
  alt_baro: 5000,
  seen_pos: 1,
  ...extra,
});

test('serves merged rows, then the cache, then partial answers', async () => {
  let clock = 1000;
  const calls = [];
  let failSeven6 = false;
  const plugin = emergencySquawkProxy({
    now: () => clock,
    fetchImpl: async (url) => {
      calls.push(url);
      const squawk = url.slice(-4);
      if (squawk === '7600' && failSeven6)
        return jsonResponse({}, { status: 500 });
      return jsonResponse({ ac: [ac(`a0000${squawk[1]}`, squawk)] });
    },
  });
  const handler = mount(plugin);
  const first = await call(handler);
  assert.equal(first.status, 200);
  assert.equal(first.headers['X-ADS-B-Cache'], 'MISS');
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.deepEqual(
    first.json.rows.map((row) => row.squawk),
    ['7500', '7700', '7600'],
  );
  assert.equal(first.json.partial, false);
  assert.equal(first.json.stale, false);
  assert.equal(calls.length, 3);
  const second = await call(handler);
  assert.equal(second.headers['X-ADS-B-Cache'], 'HIT');
  assert.equal(calls.length, 3, 'a fresh cache costs no upstream call');
  clock += 13_000;
  failSeven6 = true;
  const third = await call(handler);
  assert.equal(third.headers['X-ADS-B-Cache'], 'MISS');
  assert.equal(third.json.partial, true);
  assert.deepEqual(third.json.sources, {
    7500: 'ok',
    7600: 'error',
    7700: 'ok',
  });
  assert.equal(third.json.rows.length, 2);
});

test('a total upstream failure serves stale, cools down, or relays 502', async () => {
  let clock = 1000;
  let mode = 'ok';
  const plugin = emergencySquawkProxy({
    now: () => clock,
    fetchImpl: async (url) => {
      if (mode === 'rate')
        return jsonResponse({}, { status: 429, retryAfter: '40' });
      if (mode === 'throw') throw new Error('socket hang up');
      return jsonResponse({
        ac: [ac(`b0000${url.slice(-3, -2)}`, url.slice(-4))],
      });
    },
  });
  const handler = mount(plugin);
  const cold = await (async () => {
    mode = 'throw';
    return call(handler);
  })();
  assert.equal(cold.status, 502);
  assert.deepEqual(cold.json, { error: 'emergency_feed_unavailable' });
  mode = 'ok';
  assert.equal((await call(handler)).status, 200);
  clock += 13_000;
  mode = 'rate';
  const stale = await call(handler);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.rows.length, 3);
  clock += 1000;
  mode = 'ok';
  const cooling = await call(handler);
  assert.equal(
    cooling.headers['X-ADS-B-Cache'],
    'STALE',
    'cooldown keeps upstream idle',
  );
  assert.equal(cooling.headers['X-ADS-B-Upstream-Status'], '429');
  clock += 41_000;
  const recovered = await call(handler);
  assert.equal(recovered.headers['X-ADS-B-Cache'], 'MISS');
});

test('rejects non-GET requests and rate-limits a chatty client', async () => {
  const plugin = emergencySquawkProxy({
    fetchImpl: async () => jsonResponse({ ac: [] }),
  });
  const handler = mount(plugin);
  const post = await call(handler, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  let limited = null;
  for (let i = 0; i < 70; i++) {
    const result = await call(handler, { ip: '10.0.0.9' });
    if (result.status === 429) {
      limited = result;
      break;
    }
  }
  assert.ok(limited, 'the per-client limiter eventually answers 429');
  assert.equal(limited.headers['Retry-After'], '60');
});
