import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FROZEN_FRAME_MS,
  createFrameFreshness,
} from '../../server/providers/cctv/freshness.js';
import { frameFreshnessLabel } from '../layers/cctv/freshness.js';

const image = (text) => Buffer.from(text);
const MIN = 60_000;

test('a first sighting dates nothing; a change seen by the proxy does', () => {
  const freshness = createFrameFreshness();
  assert.deepEqual(freshness.observe('cam', image('a'), { now: 0 }), {
    frameTime: null,
    frozen: false,
  });
  assert.deepEqual(freshness.observe('cam', image('b'), { now: 5 * MIN }), {
    frameTime: 5 * MIN,
    frozen: false,
  });
});

test('the same bytes for an hour are reported frozen, and a change clears it', () => {
  const freshness = createFrameFreshness();
  freshness.observe('cam', image('a'), { now: 0 });
  assert.equal(
    freshness.observe('cam', image('a'), { now: FROZEN_FRAME_MS - 1 }).frozen,
    false,
  );
  assert.equal(
    freshness.observe('cam', image('a'), { now: FROZEN_FRAME_MS }).frozen,
    true,
  );
  const changed = freshness.observe('cam', image('b'), {
    now: FROZEN_FRAME_MS + MIN,
  });
  assert.deepEqual(changed, { frameTime: FROZEN_FRAME_MS + MIN, frozen: false });
});

test("the publisher's Last-Modified dates the frame unless it is in the future", () => {
  const freshness = createFrameFreshness();
  const now = 100 * MIN;
  assert.equal(
    freshness.observe('cam', image('a'), { lastModified: 90 * MIN, now })
      .frameTime,
    90 * MIN,
  );
  assert.equal(
    freshness.observe('cam', image('a'), { lastModified: now + 10 * MIN, now })
      .frameTime,
    null,
  );
  assert.equal(
    freshness.observe('cam', image('a'), { lastModified: NaN, now }).frameTime,
    null,
  );
});

test('cameras are tracked independently and the oldest entry is evicted at the cap', () => {
  const freshness = createFrameFreshness({ maxEntries: 2 });
  freshness.observe('a', image('x'), { now: 0 });
  freshness.observe('b', image('x'), { now: 0 });
  freshness.observe('c', image('x'), { now: 0 });
  // 'a' was evicted: seeing new bytes again is a first sighting, not a change.
  assert.equal(freshness.observe('a', image('y'), { now: MIN }).frameTime, null);
  assert.equal(freshness.observe('c', image('y'), { now: MIN }).frameTime, MIN);
});

test('the panel label reads the still age, or FROZEN', () => {
  const now = 10 * 60 * MIN;
  assert.equal(frameFreshnessLabel(null, false, now), '');
  assert.equal(frameFreshnessLabel(undefined, false, now), '');
  assert.equal(frameFreshnessLabel(now - 20_000, false, now), 'IMG <1 MIN');
  assert.equal(frameFreshnessLabel(now - 4 * MIN, false, now), 'IMG 4 MIN');
  assert.equal(frameFreshnessLabel(now - 3 * 60 * MIN, false, now), 'IMG 3 H');
  assert.equal(frameFreshnessLabel(now - 4 * MIN, true, now), 'FROZEN');
});
