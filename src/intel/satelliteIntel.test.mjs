import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSatelliteIntelModel,
  classifyOrbitRegime,
  describeAge,
  fetchSatelliteIntel,
  julianDateToMs,
  orbitalElementsFromGp,
  orbitalElementsFromSatrec,
  orbitalSpeedKmS,
  rcsSizeClass,
  safeHttpUrl,
  satelliteIntelLinks,
  EARTH_RADIUS_KM,
} from './satelliteIntel.js';

const D2R = Math.PI / 180;
const NOW = Date.parse('2026-09-30T18:00:00Z');

/** ISS-like SGP4 record fields (satellite.js stores rad/min and radians). */
const ISS_SATREC = {
  satnum: '25544',
  no: (15.48692916 * 2 * Math.PI) / 1440,
  ecco: 0.00070362,
  inclo: 51.6314 * D2R,
  nodeo: 140.6663 * D2R,
  argpo: 204.8576 * D2R,
  mo: 155.2074 * D2R,
  bstar: 7.1684861e-5,
  // 2026-09-30T03:25:12Z as a Julian date
  jdsatepoch: 2440587.5 + Date.parse('2026-09-30T03:25:12Z') / 86400000,
};

const PAYLOAD = {
  found: true,
  norad: 25544,
  fetchedAt: NOW - 60_000,
  satcat: {
    norad: 25544,
    name: 'ISS (ZARYA)',
    intlDesignator: '1998-067A',
    objectType: 'PAY',
    objectTypeLabel: 'Payload',
    status: '+',
    statusLabel: 'Operational',
    owner: 'ISS',
    ownerLabel: 'International Space Station',
    launchDate: '1998-11-20',
    launchSite: 'TYMSC',
    launchSiteLabel: 'Baikonur Cosmodrome (Tyuratam), Kazakhstan',
    decayDate: null,
    periodMin: 92.98,
    inclinationDeg: 51.63,
    apogeeKm: 425,
    perigeeKm: 416,
    rcsM2: 399.0524,
    dataStatus: null,
    dataStatusLabel: null,
    orbitCenter: 'EA',
    orbitCenterLabel: 'Earth',
    orbitType: 'ORB',
    orbitTypeLabel: 'Orbit',
  },
  gp: {
    norad: 25544,
    name: 'ISS (ZARYA)',
    intlDesignator: '1998-067A',
    epoch: '2026-09-30T03:25:12.177120',
    meanMotion: 15.48692916,
    eccentricity: 0.00070362,
    inclinationDeg: 51.6314,
    raanDeg: 140.6663,
    argPerigeeDeg: 204.8576,
    meanAnomalyDeg: 155.2074,
    bstar: 7.1684861e-5,
    meanMotionDot: 3.46e-5,
    revAtEpoch: 58802,
    elementSetNo: 999,
    classification: 'U',
    ephemerisType: 0,
  },
};

test('orbital elements from a satrec match the ISS orbit', () => {
  const el = orbitalElementsFromSatrec(ISS_SATREC);
  assert.ok(el);
  assert.ok(Math.abs(el.periodMin - 92.98) < 0.05, `period ${el.periodMin}`);
  assert.ok(Math.abs(el.inclinationDeg - 51.6314) < 1e-6);
  assert.ok(Math.abs(el.apogeeKm - 425) < 8, `apogee ${el.apogeeKm}`);
  assert.ok(Math.abs(el.perigeeKm - 416) < 8, `perigee ${el.perigeeKm}`);
  assert.ok(Math.abs(el.semiMajorAxisKm - (EARTH_RADIUS_KM + 420)) < 10);
  assert.equal(el.source, 'loaded TLE (layer)');
  assert.ok(Math.abs(el.epochMs - Date.parse('2026-09-30T03:25:12Z')) < 1000);
  assert.equal(orbitalElementsFromSatrec(null), null);
  assert.equal(orbitalElementsFromSatrec({ no: 0 }), null);
});

test('orbital elements from a GP record agree with the satrec path', () => {
  const fromGp = orbitalElementsFromGp(PAYLOAD.gp);
  const fromSatrec = orbitalElementsFromSatrec(ISS_SATREC);
  assert.ok(Math.abs(fromGp.periodMin - fromSatrec.periodMin) < 1e-6);
  assert.ok(Math.abs(fromGp.apogeeKm - fromSatrec.apogeeKm) < 1e-3);
  assert.equal(fromGp.source, 'CelesTrak GP');
  assert.equal(fromGp.epochMs, Date.parse('2026-09-30T03:25:12.177Z'));
  assert.equal(orbitalElementsFromGp({ meanMotion: null }), null);
});

test('julianDateToMs converts the Unix epoch', () => {
  assert.equal(julianDateToMs(2440587.5), 0);
  assert.equal(julianDateToMs(NaN), null);
});

test('classifyOrbitRegime distinguishes the main regimes', () => {
  assert.equal(
    classifyOrbitRegime(orbitalElementsFromSatrec(ISS_SATREC)).regime,
    'LEO',
  );
  const sso = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 14.6,
      eccentricity: 0.001,
      inclinationDeg: 97.8,
    }),
  );
  assert.equal(sso.regime, 'LEO');
  assert.match(sso.label, /sun-synchronous/);
  const geo = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 1.00272,
      eccentricity: 0.0002,
      inclinationDeg: 0.05,
    }),
  );
  assert.equal(geo.regime, 'GEO');
  const gso = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 1.00272,
      eccentricity: 0.0002,
      inclinationDeg: 12,
    }),
  );
  assert.equal(gso.regime, 'GSO');
  const meo = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 2.0057,
      eccentricity: 0.001,
      inclinationDeg: 55,
    }),
  );
  assert.equal(meo.regime, 'MEO');
  const molniya = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 2.006,
      eccentricity: 0.72,
      inclinationDeg: 63.4,
    }),
  );
  assert.equal(molniya.regime, 'MOLNIYA');
  const heo = classifyOrbitRegime(
    orbitalElementsFromGp({
      meanMotion: 3,
      eccentricity: 0.4,
      inclinationDeg: 28,
    }),
  );
  assert.equal(heo.regime, 'HEO');
  assert.equal(classifyOrbitRegime(null).regime, 'UNKNOWN');
});

test('vis-viva speed and RCS size classes', () => {
  const el = orbitalElementsFromSatrec(ISS_SATREC);
  const speed = orbitalSpeedKmS({
    radiusKm: EARTH_RADIUS_KM + 420,
    semiMajorAxisKm: el.semiMajorAxisKm,
  });
  assert.ok(Math.abs(speed - 7.66) < 0.05, `speed ${speed}`);
  assert.equal(orbitalSpeedKmS({ radiusKm: 0, semiMajorAxisKm: 1 }), null);
  assert.equal(rcsSizeClass(0.05), 'small');
  assert.equal(rcsSizeClass(0.5), 'medium');
  assert.equal(rcsSizeClass(399), 'large');
  assert.equal(rcsSizeClass(null), null);
});

test('describeAge reads in both directions', () => {
  assert.equal(describeAge(NOW - 30_000, NOW), '30 s ago');
  assert.equal(describeAge(NOW - 20 * 60_000, NOW), '20 min ago');
  assert.equal(describeAge(NOW + 3 * 3600_000, NOW), 'in 3.0 h');
  assert.equal(describeAge(NaN, NOW), '');
});

test('links are http(s) only', () => {
  const links = satelliteIntelLinks(25544, 'ISS (ZARYA)');
  assert.equal(links.length, 4);
  assert.ok(links.every((link) => link.href.startsWith('https://')));
  assert.deepEqual(satelliteIntelLinks(-1, 'x'), []);
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(
    safeHttpUrl('https://example.org/a?b=1'),
    'https://example.org/a?b=1',
  );
});

test('buildSatelliteIntelModel assembles identity, orbit, live, pass and classification', () => {
  const model = buildSatelliteIntelModel({
    payload: PAYLOAD,
    live: {
      id: '25544',
      layerId: 'satellites',
      latitude: -12.3,
      longitude: 45.6,
      properties: {
        name: 'ISS (ZARYA)',
        noradId: '25544',
        class: 'STATION · ISS',
        altitude: '419 km',
      },
    },
    satrec: ISS_SATREC,
    nowMs: NOW,
    observer: { latDeg: 40.4, lonDeg: -3.7, label: 'Madrid' },
    nextPass: {
      status: 'ok',
      pass: {
        riseMs: NOW + 1800_000,
        setMs: NOW + 2400_000,
        maxElevDeg: 62.5,
        maxElevMs: NOW + 2100_000,
        riseAzDeg: 231,
        visible: true,
      },
    },
  });
  assert.equal(model.kind, 'satellite');
  assert.equal(model.id, 'satellite:25544');
  assert.equal(model.title, 'ISS (ZARYA)');
  assert.match(
    model.subtitle,
    /Payload · International Space Station · Low Earth orbit/,
  );
  const headings = model.sections.map((section) => section.heading);
  assert.deepEqual(headings, [
    'IDENTITY',
    'ORBIT',
    'LIVE (SGP4)',
    'NEXT PASS · Madrid',
    'CLASSIFICATION',
    'ELEMENT SET',
  ]);
  const identity = Object.fromEntries(
    model.sections[0].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(identity['NORAD ID'], '25544');
  assert.equal(identity['COSPAR ID'], '1998-067A');
  assert.equal(identity['Owner / source'], 'International Space Station (ISS)');
  assert.equal(identity.Status, 'Operational');
  assert.match(identity['Radar cross-section'], /399\.1 m² \(large\)/);
  const orbit = Object.fromEntries(
    model.sections[1].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(orbit.Regime, 'Low Earth orbit (LEO)');
  assert.match(orbit.Period, /^93\.0 min$/);
  assert.equal(orbit['Elements source'], 'loaded TLE (layer)');
  assert.match(orbit['Elements epoch'], /2026-09-30 03:25 UTC \(14\.6 h ago\)/);
  const live = Object.fromEntries(
    model.sections[2].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(live['Sub-satellite point'], '-12.300°, 45.600°');
  assert.equal(live.Altitude, '419 km');
  assert.match(live['Orbital speed'], /^7\.6\d km\/s/);
  const pass = Object.fromEntries(
    model.sections[3].rows.map((row) => [row.label, row.value]),
  );
  assert.match(pass.Rise, /in 30 min/);
  assert.equal(pass.Duration, '10.0 min');
  assert.equal(pass['Naked-eye visible'], 'Yes');
  const badges = model.badges.map((badge) => badge.label);
  assert.deepEqual(badges, ['PAYLOAD', 'OPERATIONAL', 'LEO', 'STATION · ISS']);
  assert.equal(model.badges[1].tone, 'ok');
  assert.equal(model.fetchedAt, NOW - 60_000);
  assert.ok(model.notes.some((note) => /SATCAT/.test(note)));
  assert.ok(model.links.length >= 3);
});

test('buildSatelliteIntelModel degrades without a proxy payload or satrec', () => {
  const model = buildSatelliteIntelModel({
    payload: { found: false, norad: 99999, satcat: null, gp: null },
    live: {
      noradId: 99999,
      name: 'MYSTERY',
      group: 'gps-ops',
      latitude: 1,
      longitude: 2,
      altitudeM: 20_200_000,
    },
    nowMs: NOW,
  });
  assert.equal(model.title, 'MYSTERY');
  assert.equal(model.accent, '#4fd8ff');
  assert.ok(model.notes.some((note) => /No SATCAT record/.test(note)));
  const orbit = model.sections.find((section) => section.heading === 'ORBIT');
  assert.equal(orbit.rows[0].value, 'Unknown orbit');
  assert.equal(orbit.rows[1].value, 'Not available');
  const classification = model.sections.find(
    (section) => section.heading === 'CLASSIFICATION',
  );
  assert.equal(classification.rows[0].value, 'NAV · GPS');
  assert.equal(model.badges.at(-1).label, 'NAV · GPS');
});

test('buildSatelliteIntelModel falls back to the SATCAT mean orbit and reports no pass', () => {
  const model = buildSatelliteIntelModel({
    payload: { ...PAYLOAD, gp: null },
    live: null,
    nowMs: NOW,
    observer: { latDeg: 0, lonDeg: 0 },
    nextPass: { status: 'none' },
  });
  const orbit = model.sections.find((section) => section.heading === 'ORBIT');
  assert.equal(orbit.rows[0].value, 'Low Earth orbit (LEO)');
  assert.equal(orbit.rows.at(-1).value, 'SATCAT mean orbit');
  const pass = model.sections.find(
    (section) => section.heading === 'NEXT PASS',
  );
  assert.equal(pass.rows[0].value, 'No pass above 10° elevation');
  assert.ok(
    !model.sections.some((section) => section.heading === 'ELEMENT SET'),
  );
});

test('fetchSatelliteIntel validates ids and reads the proxy JSON', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    text: async () => JSON.stringify({ found: true, norad: 25544, url }),
  });
  const payload = await fetchSatelliteIntel({ norad: '25544', fetchImpl });
  assert.equal(payload.url, '/api/satcat/25544');
  await assert.rejects(
    () => fetchSatelliteIntel({ norad: 'x', fetchImpl }),
    /catalog number/,
  );
  await assert.rejects(
    () =>
      fetchSatelliteIntel({
        norad: 1,
        fetchImpl: async () => ({
          ok: false,
          status: 502,
          headers: { get: () => null },
        }),
      }),
    /SATCAT HTTP 502/,
  );
});
