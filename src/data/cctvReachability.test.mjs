import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_PROBE_TTL_MS,
  PROVIDER_PROBE_RETRY_TTL_MS,
  PROBE_TIMEOUT_MS,
  PROBE_RETRY_TIMEOUT_MS,
  filterReachableProviders,
  isPublisherPlaceholder,
  probeSample,
} from '../../server/providers/cctv/reachability.js';

const cams = (provider, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${provider}-${i}`,
    provider,
    url: `https://example.test/${provider}/${i}.jpg`,
  }));

test('providers without a single real frame are hidden', async () => {
  const sources = [...cams('Austin', 10), ...cams('London', 10)];
  const { sources: kept, dropped } = await filterReachableProviders(sources, {
    probe: async (camera) => camera.provider === 'London',
  });
  assert.deepEqual(dropped, ['Austin']);
  assert.equal(kept.length, 10);
  assert.ok(kept.every((c) => c.provider === 'London'));
});

test('one working sample keeps the provider', async () => {
  let calls = 0;
  const { dropped } = await filterReachableProviders(cams('Mixed', 9), {
    probe: async () => ++calls === 2,
  });
  assert.deepEqual(dropped, []);
});

test('verdicts are cached for the TTL', async () => {
  const cache = new Map();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return true;
  };
  await filterReachableProviders(cams('A', 4), { probe, cache, now: 0 });
  const first = calls;
  await filterReachableProviders(cams('A', 4), { probe, cache, now: 1000 });
  assert.equal(calls, first);
  await filterReachableProviders(cams('A', 4), {
    probe,
    cache,
    now: PROVIDER_PROBE_TTL_MS + 1,
  });
  assert.ok(calls > first);
});

test('samples are spread across the provider', () => {
  const sample = probeSample(cams('P', 30), 3);
  assert.deepEqual(
    sample.map((c) => c.id),
    ['P-0', 'P-10', 'P-20'],
  );
});

test('stock no-feed cards are recognised by content', () => {
  assert.equal(isPublisherPlaceholder(Buffer.from('real jpeg bytes')), false);
  assert.equal(isPublisherPlaceholder(null), false);
});

test('one slow round is retried on other cameras with a longer deadline', async () => {
  const seen = [];
  const { dropped } = await filterReachableProviders(cams('NZTA', 12), {
    // The first round times out; the retry answers.
    probe: async (camera, { timeoutMs }) => {
      seen.push([camera.id, timeoutMs]);
      return timeoutMs === PROBE_RETRY_TIMEOUT_MS;
    },
  });
  assert.deepEqual(dropped, []);
  const first = seen.filter(([, ms]) => ms === PROBE_TIMEOUT_MS).map(([id]) => id);
  const retry = seen.filter(([, ms]) => ms === PROBE_RETRY_TIMEOUT_MS).map(([id]) => id);
  assert.equal(first.length, 3);
  assert.equal(retry.length, 3);
  assert.ok(retry.every((id) => !first.includes(id)), 'the retry samples other cameras');
});

test('a provider hidden after both rounds is checked again sooner than a healthy one', async () => {
  const cache = new Map();
  const calls = { Down: 0, Up: 0 };
  const probe = async (camera) => {
    calls[camera.provider] += 1;
    return camera.provider === 'Up';
  };
  const sources = [...cams('Down', 6), ...cams('Up', 6)];
  const { dropped } = await filterReachableProviders(sources, { probe, cache, now: 0 });
  assert.deepEqual(dropped, ['Down']);
  assert.equal(calls.Down, 6, 'both rounds ran before hiding');
  const before = { ...calls };
  await filterReachableProviders(sources, {
    probe,
    cache,
    now: PROVIDER_PROBE_RETRY_TTL_MS + 1,
  });
  assert.ok(calls.Down > before.Down, 'the hidden provider is re-probed');
  assert.equal(calls.Up, before.Up, 'the healthy one keeps its verdict');
  assert.ok(PROVIDER_PROBE_RETRY_TTL_MS < PROVIDER_PROBE_TTL_MS);
});
