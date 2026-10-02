import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  normalizeSatcatRecord,
  normalizeGpRecord,
  parseCelestrakArray,
  satcatEntryFresh,
  satcatProxy,
  satcatRecordUrl,
  satcatGpUrl,
  SATCAT_TTL_MS,
  SATCAT_GP_TTL_MS,
} from '../../server/providers/space/satcat.js';

const ISS_SATCAT = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  NORAD_CAT_ID: 25544,
  OBJECT_TYPE: 'PAY',
  OPS_STATUS_CODE: '+',
  OWNER: 'ISS',
  LAUNCH_DATE: '1998-11-20',
  LAUNCH_SITE: 'TYMSC',
  DECAY_DATE: '',
  PERIOD: 92.98,
  INCLINATION: 51.63,
  APOGEE: 425,
  PERIGEE: 416,
  RCS: 399.0524,
  DATA_STATUS_CODE: '',
  ORBIT_CENTER: 'EA',
  ORBIT_TYPE: 'ORB',
};

const ISS_GP = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-09-30T03:25:12.177120',
  MEAN_MOTION: 15.48692916,
  ECCENTRICITY: 0.00070362,
  INCLINATION: 51.6314,
  RA_OF_ASC_NODE: 140.6663,
  ARG_OF_PERICENTER: 204.8576,
  MEAN_ANOMALY: 155.2074,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58802,
  BSTAR: 7.1684861e-5,
  MEAN_MOTION_DOT: 3.46e-5,
  MEAN_MOTION_DDOT: 0,
};

test('normalizeSatcatRecord decodes codes and keeps numbers', () => {
  const row = normalizeSatcatRecord(ISS_SATCAT);
  assert.equal(row.norad, 25544);
  assert.equal(row.name, 'ISS (ZARYA)');
  assert.equal(row.intlDesignator, '1998-067A');
  assert.equal(row.objectTypeLabel, 'Payload');
  assert.equal(row.statusLabel, 'Operational');
  assert.equal(row.ownerLabel, 'International Space Station');
  assert.equal(
    row.launchSiteLabel,
    'Baikonur Cosmodrome (Tyuratam), Kazakhstan',
  );
  assert.equal(row.decayDate, null);
  assert.equal(row.periodMin, 92.98);
  assert.equal(row.rcsM2, 399.0524);
  assert.equal(row.orbitCenterLabel, 'Earth');
  assert.equal(row.orbitTypeLabel, 'Orbit');
  assert.equal(row.dataStatusLabel, null);
});

test('normalizeSatcatRecord handles decayed rocket bodies and unknown codes', () => {
  const row = normalizeSatcatRecord({
    OBJECT_NAME: 'SL-1 R/B',
    NORAD_CAT_ID: '1',
    OBJECT_TYPE: 'R/B',
    OPS_STATUS_CODE: 'D',
    OWNER: 'ZZZZ',
    LAUNCH_SITE: 'NOPE',
    DECAY_DATE: '1957-12-01',
    RCS: null,
    ORBIT_TYPE: 'IMP',
  });
  assert.equal(row.norad, 1);
  assert.equal(row.objectTypeLabel, 'Rocket body');
  assert.equal(row.statusLabel, 'Decayed');
  assert.equal(row.ownerLabel, 'ZZZZ');
  assert.equal(row.launchSiteLabel, 'NOPE');
  assert.equal(row.decayDate, '1957-12-01');
  assert.equal(row.rcsM2, null);
  assert.equal(row.orbitTypeLabel, 'Impact');
  assert.equal(normalizeSatcatRecord({ OBJECT_NAME: 'x' }), null);
  assert.equal(normalizeSatcatRecord(null), null);
});

test('normalizeGpRecord keeps the OMM elements', () => {
  const gp = normalizeGpRecord(ISS_GP);
  assert.equal(gp.norad, 25544);
  assert.equal(gp.epoch, '2026-09-30T03:25:12.177120');
  assert.equal(gp.meanMotion, 15.48692916);
  assert.equal(gp.inclinationDeg, 51.6314);
  assert.equal(gp.classification, 'U');
  assert.equal(gp.elementSetNo, 999);
  assert.equal(normalizeGpRecord({ EPOCH: 'x' }), null);
});

test('parseCelestrakArray treats the text miss as no rows', () => {
  assert.equal(parseCelestrakArray('No GP data found'), null);
  assert.equal(parseCelestrakArray(''), null);
  assert.equal(parseCelestrakArray('[not json'), null);
  assert.deepEqual(parseCelestrakArray('[{"a":1}]'), [{ a: 1 }]);
});

test('satcatEntryFresh applies hit and miss TTLs', () => {
  const now = 1_000_000_000_000;
  assert.equal(satcatEntryFresh(undefined, true, now, SATCAT_TTL_MS), false);
  assert.equal(satcatEntryFresh(now - 1000, true, now, SATCAT_TTL_MS), true);
  assert.equal(
    satcatEntryFresh(now - SATCAT_TTL_MS - 1, true, now, SATCAT_TTL_MS),
    false,
  );
  // A miss expires after a day regardless of the hit TTL passed in.
  assert.equal(
    satcatEntryFresh(now - 3600_000, false, now, SATCAT_TTL_MS),
    true,
  );
  assert.equal(
    satcatEntryFresh(now - 25 * 3600_000, false, now, SATCAT_TTL_MS),
    false,
  );
});

test('upstream URLs target CelesTrak JSON endpoints', () => {
  assert.equal(
    satcatRecordUrl(25544),
    'https://celestrak.org/satcat/records.php?CATNR=25544&FORMAT=JSON',
  );
  assert.equal(
    satcatGpUrl(25544),
    'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON',
  );
});

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => body,
  };
}

function fakeServer() {
  const routes = new Map();
  return {
    routes,
    middlewares: {
      use(route, handler) {
        routes.set(route, handler);
      },
    },
  };
}

function fakeResponse() {
  const out = { status: 0, headers: null, body: '', headersSent: false };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
      out.headersSent = true;
    },
    end(body) {
      out.body = body;
    },
    get headersSent() {
      return out.headersSent;
    },
  };
}

async function tempCacheDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'gev-satcat-'));
}

test('satcat proxy combines SATCAT and GP, caches, and serves stale on failure', async () => {
  const cacheDir = await tempCacheDir();
  let clock = 1_700_000_000_000;
  const calls = [];
  let failing = false;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (failing) throw new Error('offline');
    if (url.includes('/satcat/records.php'))
      return textResponse(JSON.stringify([ISS_SATCAT]));
    return textResponse(JSON.stringify([ISS_GP]));
  };
  const plugin = satcatProxy({ fetchImpl, now: () => clock, cacheDir });
  const server = fakeServer();
  plugin.configureServer(server);
  const handler = server.routes.get('/api/satcat');
  assert.ok(handler);

  const req = { url: '/25544', socket: { remoteAddress: '127.0.0.1' } };
  const first = fakeResponse();
  await handler(req, first);
  assert.equal(first.out.status, 200);
  assert.equal(first.out.headers['X-GEV-Cache'], 'MISS');
  const payload = JSON.parse(first.out.body);
  assert.equal(payload.found, true);
  assert.equal(payload.satcat.ownerLabel, 'International Space Station');
  assert.equal(payload.gp.meanMotion, 15.48692916);
  assert.equal(payload.stale, false);
  assert.equal(calls.length, 2);

  // Within TTL: no upstream traffic.
  clock += 60_000;
  const second = fakeResponse();
  await handler(req, second);
  assert.equal(second.out.headers['X-GEV-Cache'], 'HIT');
  assert.equal(calls.length, 2);

  // GP TTL lapses first: only gp.php is refetched.
  clock += SATCAT_GP_TTL_MS;
  const third = fakeResponse();
  await handler(req, third);
  assert.equal(third.out.headers['X-GEV-Cache'], 'MISS');
  assert.equal(calls.length, 3);
  assert.match(calls[2], /gp\.php/);

  // Upstream down after the GP TTL lapses again: stale copy, not an error.
  clock += SATCAT_GP_TTL_MS;
  failing = true;
  const fourth = fakeResponse();
  await handler(req, fourth);
  assert.equal(fourth.out.status, 200);
  assert.equal(fourth.out.headers['X-GEV-Cache'], 'STALE');
  assert.equal(JSON.parse(fourth.out.body).stale, true);
  assert.equal(JSON.parse(fourth.out.body).gp.norad, 25544);

  // Persisted to disk for the next process.
  await plugin._flushForTest();
  const disk = JSON.parse(
    await fsp.readFile(path.join(cacheDir, 'satcat.json'), 'utf8'),
  );
  assert.equal(disk.records['25544'].satcat.name, 'ISS (ZARYA)');
  await fsp.rm(cacheDir, { recursive: true, force: true });
});

test('satcat proxy rejects bad ids, reports misses, and fails closed without cache', async () => {
  const cacheDir = await tempCacheDir();
  const fetchImpl = async (url) => {
    if (url.includes('CATNR=999999')) throw new Error('offline');
    return textResponse('No GP data found');
  };
  const plugin = satcatProxy({ fetchImpl, now: () => Date.now(), cacheDir });
  const server = fakeServer();
  plugin.configureServer(server);
  const handler = server.routes.get('/api/satcat');
  const socket = { remoteAddress: '10.0.0.1' };

  const bad = fakeResponse();
  await handler({ url: '/abc', socket }, bad);
  assert.equal(bad.out.status, 400);
  const tooLong = fakeResponse();
  await handler({ url: '/1234567890', socket }, tooLong);
  assert.equal(tooLong.out.status, 400);

  const miss = fakeResponse();
  await handler({ url: '/424242?x=1', socket }, miss);
  assert.equal(miss.out.status, 200);
  const payload = JSON.parse(miss.out.body);
  assert.equal(payload.found, false);
  assert.equal(payload.satcat, null);
  assert.equal(payload.gp, null);

  const down = fakeResponse();
  await handler({ url: '/999999', socket }, down);
  assert.equal(down.out.status, 502);
  assert.equal(down.out.headers['X-GEV-Cache'], 'ERROR');
  await fsp.rm(cacheDir, { recursive: true, force: true });
});
