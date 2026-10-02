import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conflictCardModel,
  conflictKindColor,
  conflictRadiusMeters,
  conflictWeight,
  formatConflictAge,
  mapConflictAnalystRecord,
  normalizeConflictRow,
  normalizeConflictSnapshot,
} from './records.js';

const row = {
  id: 'gdelt:fight|20260930|635|705',
  lat: 31.7667,
  lon: 35.2333,
  time: '2026-09-30T18:45:00.000Z',
  source: 'GDELT',
  kind: 'fight',
  title: 'Armed clash · Jerusalem, Israel',
  actors: 'Israel vs Oman',
  country: 'IS',
  url: 'https://example.com/story',
  goldstein: -10,
  mentions: 12,
  fatalities: null,
  events: 3,
};

test('rows normalize and invalid rows drop without rejecting the snapshot', () => {
  const snapshot = normalizeConflictSnapshot({
    rows: [
      row,
      { ...row, id: 'x', lat: 95 },
      { ...row, id: 'y', time: 'nope' },
      { ...row, id: 'z', kind: 'weird', source: 'NOPE', url: 'javascript:x' },
      row,
    ],
    hours: 72,
    sources: ['GDELT', 'BOGUS'],
    counts: { GDELT: 5 },
    total: 9000,
    truncated: true,
    degraded: null,
    coverage: { loadedSlots: 8, expectedSlots: 288 },
  });
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[1].kind, 'other');
  assert.equal(snapshot.rows[1].source, 'GDELT');
  assert.equal(snapshot.rows[1].url, '');
  assert.equal(snapshot.hours, 72);
  assert.deepEqual(snapshot.sources, ['GDELT']);
  assert.equal(snapshot.counts.GDELT, 5);
  assert.equal(snapshot.total, 9000);
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(snapshot.coverage, { loadedSlots: 8, expectedSlots: 288 });
  assert.equal(normalizeConflictSnapshot({ rows: 'no' }), null);
  assert.equal(normalizeConflictRow(null), null);
});

test('weights, radii and colours follow the evidence', () => {
  const normalized = normalizeConflictRow(row);
  assert.equal(conflictWeight(normalized), 12);
  assert.equal(
    conflictWeight({ ...normalized, source: 'ACLED', fatalities: 3 }),
    3 * 50 + 12 + 100,
  );
  assert.ok(conflictRadiusMeters(normalized) > 6000);
  assert.equal(conflictRadiusMeters({ mentions: 0 }), 6000);
  assert.equal(conflictRadiusMeters({ fatalities: 1e6 }), 60_000);
  assert.equal(conflictKindColor('battle'), '#b71c1c');
  assert.equal(conflictKindColor('nope'), '#9e9e9e');
});

test('card copy carries the honesty note for GDELT rows only', () => {
  const nowMs = Date.parse('2026-09-30T20:45:00Z');
  const gdelt = conflictCardModel(normalizeConflictRow(row), nowMs);
  assert.equal(gdelt.title, 'Armed clash · Jerusalem, Israel');
  assert.equal(gdelt.details[0], 'GDELT · Armed clash');
  assert.equal(gdelt.details[1], 'Israel vs Oman');
  assert.equal(gdelt.details[2], '12 media mentions · 3 codings · 2h ago');
  assert.match(gdelt.details[3], /Machine-coded/);
  const acled = conflictCardModel(
    normalizeConflictRow({
      ...row,
      id: 'acled:1',
      source: 'ACLED',
      kind: 'battle',
      mentions: null,
      fatalities: 1,
      events: 1,
    }),
    nowMs,
  );
  assert.equal(acled.details.length, 3);
  assert.equal(acled.details[2], '1 reported fatality · 2h ago');
  assert.equal(formatConflictAge(nowMs, nowMs - 30 * 60_000), '30m');
  assert.equal(formatConflictAge(nowMs, nowMs - 3 * 86_400_000), '3d');
});

test('analyst records stay flat and JSON-safe', () => {
  const record = mapConflictAnalystRecord(normalizeConflictRow(row));
  assert.equal(record.kindLabel, 'Armed clash');
  assert.equal(record.timeMs, Date.parse(row.time));
  assert.equal(record.fatalities, null);
  assert.equal(JSON.parse(JSON.stringify(record)).mentions, 12);
});
