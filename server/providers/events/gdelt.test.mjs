import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { buildSingleEntryZip, readZipEntries } from './zip.js';
import {
  aggregateGdeltEvents,
  createGdeltStore,
  gdeltKind,
  gdeltSlotKey,
  gdeltSlotMs,
  gdeltSlotsBefore,
  parseGdeltExport,
  parseGdeltLastUpdate,
} from './gdelt.js';

function exportLine(overrides = {}) {
  const cols = new Array(61).fill('');
  cols[0] = '1325675769';
  cols[1] = '20260930';
  cols[6] = 'UNITED STATES';
  cols[16] = 'POLICE';
  cols[26] = '193';
  cols[27] = '193';
  cols[28] = '19';
  cols[30] = '-10.0';
  cols[31] = '4';
  cols[34] = '-7.5';
  cols[51] = '3';
  cols[52] = 'Warren County, Ohio, United States';
  cols[53] = 'US';
  cols[56] = '39.4334';
  cols[57] = '-84.1666';
  cols[59] = '20260930183000';
  cols[60] = 'https://example.com/story';
  for (const [index, value] of Object.entries(overrides)) cols[index] = value;
  return cols.join('\t');
}

test('zip reader round-trips a deflated single entry', () => {
  const text = exportLine();
  const data = Buffer.from(text, 'utf8');
  const zip = buildSingleEntryZip(
    '20260930183000.export.CSV',
    data,
    deflateRawSync(data),
  );
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, '20260930183000.export.CSV');
  assert.equal(entries[0].data.toString('utf8'), text);
  assert.throws(() => readZipEntries(Buffer.alloc(10)), /zip_truncated/);
  assert.throws(
    () => readZipEntries(zip, { maxEntryBytes: 4 }),
    /zip_entry_too_large/,
  );
});

test('slot keys floor to fifteen minutes and round-trip', () => {
  const ms = Date.UTC(2026, 8, 30, 18, 37, 12);
  assert.equal(gdeltSlotKey(ms), '20260930183000');
  assert.equal(gdeltSlotMs('20260930183000'), Date.UTC(2026, 8, 30, 18, 30));
  assert.ok(Number.isNaN(gdeltSlotMs('nope')));
  const keys = gdeltSlotsBefore('20260930183000', 1);
  assert.deepEqual(keys, [
    '20260930183000',
    '20260930181500',
    '20260930180000',
    '20260930174500',
  ]);
  assert.equal(
    parseGdeltLastUpdate(
      '85563 abc http://data.gdeltproject.org/gdeltv2/20260930183000.export.CSV.zip\n',
    ),
    '20260930183000',
  );
  assert.equal(parseGdeltLastUpdate('garbage'), null);
});

test('kind mapping follows CAMEO root and base codes', () => {
  assert.equal(gdeltKind('14', '141'), 'protest');
  assert.equal(gdeltKind('14', '145'), 'riot');
  assert.equal(gdeltKind('18', '183'), 'explosion');
  assert.equal(gdeltKind('18', '182'), 'assault');
  assert.equal(gdeltKind('19', '193'), 'fight');
  assert.equal(gdeltKind('20', '201'), 'mass_violence');
  assert.equal(gdeltKind('17', '172'), 'other');
});

test('export parser keeps geolocated conflict codes only', () => {
  const text = [
    exportLine(),
    exportLine({ 0: '2', 28: '04' }), // consult — dropped
    exportLine({ 0: '3', 51: '0', 56: '', 57: '' }), // no geo — dropped
    exportLine({ 0: '4', 56: '999' }), // invalid lat — dropped
    'short\tline',
    exportLine({ 0: '5', 28: '14', 27: '145', 31: '9' }),
  ].join('\n');
  const rows = parseGdeltExport(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'fight');
  assert.equal(rows[0].lat, 39.4334);
  assert.equal(rows[0].addedMs, Date.UTC(2026, 8, 30, 18, 30));
  assert.equal(rows[0].url, 'https://example.com/story');
  assert.equal(rows[1].kind, 'riot');
  assert.equal(rows[1].mentions, 9);
});

test('aggregation folds same-cell codings and sums mentions', () => {
  const rows = parseGdeltExport(
    [
      exportLine(),
      exportLine({ 0: '2', 56: '39.44', 57: '-84.17', 31: '6' }),
      exportLine({ 0: '3', 28: '14', 27: '141', 56: '39.44', 57: '-84.17' }),
    ].join('\n'),
  );
  const aggregated = aggregateGdeltEvents(rows);
  assert.equal(aggregated.length, 2);
  const fight = aggregated.find((row) => row.kind === 'fight');
  assert.equal(fight.mentions, 10);
  assert.equal(fight.events, 2);
  assert.equal(fight.source, 'GDELT');
  assert.equal(fight.actors, 'United States vs Police');
  assert.match(fight.title, /^Armed clash · Warren County/);
  assert.equal(fight.fatalities, null);
});

test('store fetches the newest slots through the fake network and persists nothing without a path', async () => {
  const slots = new Map();
  const latest = '20260930183000';
  for (const key of gdeltSlotsBefore(latest, 3)) {
    const data = Buffer.from(exportLine({ 0: key, 59: key }), 'utf8');
    slots.set(
      key,
      buildSingleEntryZip(`${key}.export.CSV`, data, deflateRawSync(data)),
    );
  }
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith('lastupdate.txt'))
      return new Response(
        `1 x http://data.gdeltproject.org/gdeltv2/${latest}.export.CSV.zip\n`,
      );
    const key = /(\d{14})\.export/.exec(url)?.[1];
    const body = slots.get(key);
    if (!body) return new Response('missing', { status: 404 });
    return new Response(body);
  };
  const store = createGdeltStore({
    fetchImpl,
    now: () => gdeltSlotMs(latest) + 5 * 60_000,
    cachePath: null,
    log: () => {},
  });
  await store.ensure({ hours: 6 });
  const { rows, loadedSlots, expectedSlots, latestKey } = store.rows({
    hours: 6,
  });
  assert.equal(latestKey, latest);
  assert.equal(expectedSlots, 24);
  assert.ok(loadedSlots >= 8, `loaded ${loadedSlots}`);
  assert.ok(rows.length >= 1);
  assert.ok(requested.some((url) => url.endsWith('lastupdate.txt')));
});
