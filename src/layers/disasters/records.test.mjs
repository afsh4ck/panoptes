import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  disasterCardModel,
  disasterLevelColor,
  disasterLevelRadius,
  disasterPassesFilter,
  disasterPriority,
  mapDisasterAnalystRecord,
  normalizeDisasterSnapshot,
} from './records.js';

const gdacs = {
  id: 'gdacs:EQ99',
  lat: -5.5,
  lon: 150.2,
  source: 'GDACS',
  type: 'EQ',
  title: 'Red earthquake alert (M 7.2) in Papua New Guinea',
  level: 'red',
  score: 3,
  severity: { value: 7.2, unit: 'M', text: 'Magnitude 7.2M, Depth:10km' },
  population: { value: 12000, unit: 'Exposed', text: '12000 people exposed' },
  country: 'Papua New Guinea',
  iso3: 'PNG',
  link: 'https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=99',
  from: '2026-09-29T00:00:00Z',
  to: null,
  updated: '2026-09-30T06:00:00Z',
  bbox: [149, 151, -6, -5],
};
const eonet = {
  id: 'eonet:EONET_1',
  lat: 12.8,
  lon: -99.5,
  source: 'EONET',
  type: 'storm',
  title: 'Hurricane Rachel',
  level: 'info',
  score: 0,
  severity: { value: 40, unit: 'kts', text: '40 kts' },
  population: { value: null, unit: '', text: '' },
  link: 'https://example.com/rachel',
  updated: '2026-09-30T00:00:00Z',
};

test('snapshot sorts red first and drops malformed rows', () => {
  const snapshot = normalizeDisasterSnapshot({
    rows: [
      eonet,
      gdacs,
      { ...gdacs, id: 'bad', lat: 'x' },
      { ...eonet, level: 'purple', type: 'zzz' },
    ],
    counts: { GDACS: 1, EONET: 2 },
    degraded: null,
  });
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].id, 'gdacs:EQ99');
  assert.equal(snapshot.rows[0].severityValue, 7.2);
  assert.equal(snapshot.rows[0].populationText, '12000 people exposed');
  assert.deepEqual(snapshot.rows[0].bbox, [149, 151, -6, -5]);
  assert.equal(snapshot.rows[1].level, 'info');
  assert.equal(snapshot.rows[1].type, 'storm');
  assert.deepEqual(snapshot.counts, { GDACS: 1, EONET: 2 });
  assert.equal(normalizeDisasterSnapshot({}), null);
});

test('levels drive colours, radii, filters and priority', () => {
  assert.equal(disasterLevelColor('red'), '#ff1744');
  assert.equal(disasterLevelColor('nope'), '#40c4ff');
  assert.equal(disasterLevelRadius('orange'), 100_000);
  assert.equal(disasterPassesFilter('green', 'all'), true);
  assert.equal(disasterPassesFilter('green', 'orange'), false);
  assert.equal(disasterPassesFilter('orange', 'orange'), true);
  assert.equal(disasterPassesFilter('orange', 'red'), false);
  const [red, info] = normalizeDisasterSnapshot({ rows: [gdacs, eonet] }).rows;
  assert.ok(disasterPriority(red) > disasterPriority(info));
});

test('card copy differs between GDACS alerts and EONET events', () => {
  const nowMs = Date.parse('2026-09-30T08:00:00Z');
  const [red, info] = normalizeDisasterSnapshot({ rows: [gdacs, eonet] }).rows;
  const alert = disasterCardModel(red, nowMs);
  assert.equal(alert.title, 'Earthquake · Papua New Guinea');
  assert.equal(alert.details[0], 'RED alert · Magnitude 7.2M, Depth:10km');
  assert.equal(alert.details[1], '12000 people exposed');
  assert.equal(
    alert.details[2],
    'Red earthquake alert (M 7.2) in Papua New Guinea',
  );
  assert.equal(alert.details[3], 'GDACS · updated 2h ago');
  const storm = disasterCardModel(info, nowMs);
  assert.equal(storm.title, 'Severe storm · Hurricane Rachel');
  assert.equal(storm.details[0], 'NASA EONET · 40 kts');
  assert.equal(storm.details.at(-1), 'EONET · updated 8h ago');
  const record = mapDisasterAnalystRecord(red);
  assert.equal(record.typeLabel, 'Earthquake');
  assert.equal(record.link, gdacs.link);
});
