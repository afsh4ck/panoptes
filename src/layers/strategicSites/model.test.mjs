import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classColor,
  hasRealName,
  parseSiteLines,
  selectLabelCohort,
  sitePriority,
} from './model.js';

test('parses GeoJSONL points and skips malformed or out-of-range rows', () => {
  const text = [
    JSON.stringify({
      id: 'a',
      geometry: { coordinates: [-6.35, 36.62] },
      properties: { name: 'Base Naval de Rota', class: 'naval_base' },
    }),
    'not json',
    JSON.stringify({
      id: 'b',
      geometry: { coordinates: [200, 10] },
      properties: {},
    }),
    JSON.stringify({
      id: 'c',
      geometry: { coordinates: [10, 'x'] },
      properties: {},
    }),
    '',
  ].join('\n');
  const rows = parseSiteLines(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].lat, 36.62);
});

test('generic ETL fallback names are not treated as real names', () => {
  assert.equal(hasRealName('Military base (Spain)'), false);
  assert.equal(hasRealName('Air base'), false);
  assert.equal(hasRealName('Base Naval de Rota'), true);
});

test('named major sites outrank unnamed minor ones', () => {
  const major = sitePriority({
    name: 'Rota',
    class: 'naval_base',
    tags: { wikidata: 'Q1' },
  });
  const minor = sitePriority({ name: 'Barracks', class: 'barracks' });
  assert.ok(major > minor);
  assert.equal(classColor('naval_base', '#000'), '#4dabf7');
  assert.equal(classColor('unknown', '#123456'), '#123456');
});

test('label cohort keeps the best candidate per grid cell and caps the total', () => {
  const rec = (priority) => ({ priority });
  const cohort = selectLabelCohort(
    [
      { record: rec(1), x: 10, y: 10 },
      { record: rec(5), x: 20, y: 20 },
      { record: rec(3), x: 300, y: 10 },
      { record: rec(2), x: 600, y: 10 },
    ],
    { gridPx: 100, max: 2 },
  );
  assert.deepEqual(
    cohort.map((c) => c.record.priority),
    [5, 3],
  );
});
