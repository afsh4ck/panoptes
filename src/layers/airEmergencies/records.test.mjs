import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMERGENCY_SQUAWKS,
  normalizeEmergencyAircraft,
  normalizeEmergencyFeeds,
  normalizeEmergencySnapshot,
} from './records.js';

const NOW = 1_700_000_000_000;

const aircraft = (overrides = {}) => ({
  hex: 'ABC123',
  flight: 'DLH400  ',
  r: 'D-AIBD',
  t: 'A319',
  squawk: '7700',
  emergency: 'general',
  lat: 50.03,
  lon: 8.57,
  alt_baro: 27500,
  gs: 415.3,
  track: 267.9,
  seen_pos: 2.5,
  seen: 0.4,
  category: 'A3',
  ...overrides,
});

test('normalizes one readsb aircraft into an emergency row', () => {
  const row = normalizeEmergencyAircraft(aircraft(), NOW, null);
  assert.deepEqual(row, {
    hex: 'abc123',
    callsign: 'DLH400',
    registration: 'D-AIBD',
    type: 'A319',
    squawk: '7700',
    emergency: 'general',
    lat: 50.03,
    lon: 8.57,
    altFt: 27500,
    onGround: false,
    gsKt: 415.3,
    track: 267.9,
    seen: 2.5,
    category: 'A3',
    observedAtMs: NOW - 2500,
  });
});

test('ground contacts, missing positions and non-emergency squawks', () => {
  const ground = normalizeEmergencyAircraft(
    aircraft({ alt_baro: 'ground', emergency: 'none' }),
    NOW,
  );
  assert.equal(ground.onGround, true);
  assert.equal(ground.altFt, 0);
  assert.equal(ground.emergency, null);
  assert.equal(normalizeEmergencyAircraft(aircraft({ lat: null }), NOW), null);
  assert.equal(
    normalizeEmergencyAircraft(aircraft({ lat: 91 }), NOW),
    null,
    'out-of-range latitude is rejected',
  );
  assert.equal(
    normalizeEmergencyAircraft(aircraft({ squawk: '1200' }), NOW),
    null,
    'a non-emergency squawk without a feed hint is rejected',
  );
  assert.equal(
    normalizeEmergencyAircraft(aircraft({ squawk: undefined }), NOW, '7600')
      .squawk,
    '7600',
    'the feed hint fills a missing squawk',
  );
  assert.equal(normalizeEmergencyAircraft(aircraft({ hex: 'zz' }), NOW), null);
  assert.equal(
    normalizeEmergencyAircraft(aircraft({ hex: '~a1b2c3' }), NOW).hex,
    '~a1b2c3',
    'TIS-B prefixed addresses are kept',
  );
});

test('feeds merge by hex, keep the fresher fix and order by severity', () => {
  const feeds = [
    {
      squawk: '7600',
      payload: {
        ac: [
          aircraft({ hex: 'b00002', squawk: '7600', seen_pos: 9 }),
          aircraft({ hex: 'b00001', squawk: '7600', seen_pos: 1 }),
        ],
      },
    },
    {
      squawk: '7700',
      payload: {
        ac: [
          aircraft({ hex: 'b00001', squawk: '7700', seen_pos: 0.5 }),
          aircraft({ hex: 'c00001', squawk: '7700' }),
          { hex: 'broken' },
        ],
      },
    },
    {
      squawk: '7500',
      payload: { ac: [aircraft({ hex: 'a00001', squawk: '7500' })] },
    },
    { squawk: '7500', payload: null },
  ];
  const rows = normalizeEmergencyFeeds(feeds, NOW);
  assert.deepEqual(
    rows.map((row) => [row.hex, row.squawk]),
    [
      ['a00001', '7500'],
      ['b00001', '7700'],
      ['c00001', '7700'],
      ['b00002', '7600'],
    ],
  );
  assert.equal(normalizeEmergencyFeeds(null, NOW).length, 0);
});

test('proxy snapshots are validated whole and deduplicated', () => {
  const good = {
    rows: [
      { hex: 'ABC123', squawk: '7700', lat: 1, lon: 2, altFt: 100, seen: 3 },
      { hex: 'abc123', squawk: '7700', lat: 1, lon: 2 },
      { hex: 'def456', squawk: 7500, lat: -1, lon: -2, onGround: true },
    ],
    fetchedAt: NOW,
    stale: true,
    partial: false,
  };
  const snapshot = normalizeEmergencySnapshot(good);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].hex, 'abc123');
  assert.equal(snapshot.rows[1].squawk, '7500');
  assert.equal(snapshot.rows[1].onGround, true);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.fetchedAt, NOW);
  assert.equal(normalizeEmergencySnapshot({ rows: 'nope' }), null);
  assert.equal(
    normalizeEmergencySnapshot({
      rows: [{ hex: 'abc123', squawk: '1200', lat: 1, lon: 2 }],
    }),
    null,
    'one malformed row rejects the whole snapshot',
  );
  assert.deepEqual([...EMERGENCY_SQUAWKS], ['7500', '7600', '7700']);
});
