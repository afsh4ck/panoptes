import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  buildSourcesPayload,
  createSourcesBodyCache,
  encodedSourcesBody,
} from '../../server/providers/cctv/sourcesPayload.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';
import {
  CCTV_SOURCE_CACHE_MS,
  DRIVEBC_WEBCAMS_URL,
} from '../../server/providers/cctv/constants.js';
import { expandCatalogPayload } from '../layers/cctv/source.js';

const camera = (id, license, extra = {}) => ({
  id,
  name: `Camera ${id}`,
  city: 'Madrid',
  cityId: 'madrid',
  provider: 'P',
  lat: 40.4,
  lon: -3.7,
  headingDeg: 90,
  headingConfidence: 'low',
  pitchDeg: -18,
  fovDeg: 44,
  rangeM: 145,
  mountHeightM: 8,
  groundElevationM: 650,
  feedType: 'image',
  sourceKind: 'test',
  license,
  url: `https://example.test/${id}.jpg`,
  ...extra,
});

test('the sources payload ships each licence once and drops empty optional fields', () => {
  const payload = buildSourcesPayload([
    camera('a', 'CC BY'),
    camera('b', 'CC BY'),
    camera('c', 'CC BY-SA 4.0', { credit: 'City', code: 'C1' }),
    camera('d', ''),
  ]);
  assert.deepEqual(payload.licenses, ['CC BY', 'CC BY-SA 4.0']);
  assert.deepEqual(
    payload.sources.map((row) => row.licenseRef),
    [0, 0, 1, undefined],
  );
  const [a, , c] = payload.sources;
  assert.equal('license' in a, false);
  assert.equal('credit' in a, false);
  assert.equal('code' in a, false);
  assert.equal('groundHeights' in a, false);
  assert.equal('url' in a, false, 'upstream URLs never reach the browser');
  assert.equal(c.credit, 'City');
  assert.equal(c.code, 'C1');
});

test('the client restores each row licence from the shared table', () => {
  const payload = expandCatalogPayload({
    licenses: ['CC BY', 'CC BY-SA 4.0'],
    sources: [{ id: 'a', licenseRef: 1 }, { id: 'b' }, { id: 'c', license: 'own' }],
  });
  assert.deepEqual(
    payload.sources.map((row) => row.license),
    ['CC BY-SA 4.0', undefined, 'own'],
  );
});

test('the sources body is compressed for the client and reused per catalog snapshot', async () => {
  const bodiesFor = createSourcesBodyCache();
  const sources = Array.from({ length: 200 }, (_, i) => camera(`c${i}`, 'CC BY'));
  const bodies = bodiesFor(sources);
  assert.equal(bodiesFor(sources), bodies, 'same snapshot, same bodies');
  assert.notEqual(bodiesFor([...sources]), bodies, 'a new snapshot rebuilds');

  const json = JSON.parse(bodies.json.toString());
  const br = await encodedSourcesBody(bodies, 'gzip, deflate, br');
  assert.equal(br.encoding, 'br');
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body).toString()), json);
  assert.ok(br.body.length < bodies.json.length / 4);

  const gzip = await encodedSourcesBody(bodies, 'gzip, br;q=0');
  assert.equal(gzip.encoding, 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(gzip.body).toString()), json);

  const plain = await encodedSourcesBody(bodies, undefined);
  assert.equal(plain.encoding, null);
  assert.equal(plain.body, bodies.json);
});

test('a stale catalog keeps serving while the refresh runs in the background', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-cctv-swr-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  for (const name of [
    'CCTV_SOURCES_FILE',
    'CCTV_SOURCES_JSON',
    'CCTV_FORCE_AUSTIN',
    'CCTV_PREFER_AUSTIN',
    'CCTV_MAX_SOURCES',
    'CCTV_DRIVEBC_ENABLED',
  ]) {
    const previous = process.env[name];
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
    delete process.env[name];
  }
  const row = (id) => ({
    id,
    name: `Camera ${id}`,
    is_on: true,
    should_appear: true,
    location: { type: 'Point', coordinates: [-123.1, 49.28] },
    links: { imageDisplay: `/images/${id}.jpg` },
  });
  let release;
  let answer = async () => Response.json([row(1)]);
  t.mock.method(globalThis, 'fetch', async (url) =>
    String(url) === DRIVEBC_WEBCAMS_URL
      ? answer()
      : new Response('unavailable', { status: 503 }),
  );

  const getSources = createCctvCatalog({ sourceRoot });
  const first = await getSources();
  assert.deepEqual(
    first.map((source) => source.id),
    ['drivebc-1'],
  );

  // Past the TTL the next refresh hangs until released.
  t.mock.timers.tick(CCTV_SOURCE_CACHE_MS + 1);
  answer = () =>
    new Promise((resolve) => {
      release = () => resolve(Response.json([row(1), row(2)]));
    });
  assert.equal(await getSources(), first, 'the stale catalog answers at once');
  assert.equal(await getSources(), first, 'and keeps answering while it refreshes');
  release();
  let refreshed = first;
  for (let i = 0; i < 50 && refreshed === first; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    refreshed = await getSources();
  }
  assert.deepEqual(
    refreshed.map((source) => source.id),
    ['drivebc-1', 'drivebc-2'],
  );
});
