import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_PROBE_TTL_MS,
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
