import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVesselIntelModel,
  decodeAisShipType,
  flagFromMmsi,
  loadSanctionsIndex,
  matchSanctionedVessel,
  resetSanctionsIndexForTest,
  DARK_AFTER_MS,
} from './vesselIntel.js';

const NOW = Date.parse('2026-09-30T18:00:00Z');

/** Shape of a src/layers/vessels/records.js record. */
const TANKER = {
  lat: 25.1,
  lon: 55.2,
  name: 'SEA DRAGON',
  mmsi: '422123456',
  reference: '422123456',
  imo: '9123456',
  type: '82',
  destination: 'BANDAR ABBAS',
  speed: 11.4,
  course: 120,
  heading: 118,
  lastPositionUtc: '2026-09-30T17:40:00.000Z',
  lastPositionEpoch: Date.parse('2026-09-30T17:40:00Z') / 1000,
  missedRefreshes: 0,
};

test('decodeAisShipType decodes categories, hazard classes and text labels', () => {
  assert.deepEqual(decodeAisShipType(70), {
    code: 70,
    label: 'Cargo ship',
    category: 'cargo',
    hazardous: null,
  });
  assert.equal(
    decodeAisShipType('82').label,
    'Tanker — hazardous cargo category B',
  );
  assert.equal(decodeAisShipType('82').hazardous, 'B');
  assert.equal(decodeAisShipType(35).category, 'military');
  assert.equal(decodeAisShipType(55).category, 'law');
  assert.equal(decodeAisShipType(51).category, 'sar');
  assert.equal(
    decodeAisShipType(69).label,
    'Passenger ship — no additional information',
  );
  assert.equal(decodeAisShipType(0).category, 'unknown');
  assert.equal(decodeAisShipType(15).label, 'Reserved type 15');
  assert.equal(decodeAisShipType('Crude oil tanker').category, 'tanker');
  assert.equal(decodeAisShipType('').label, 'Not available');
});

test('flagFromMmsi resolves the MID and station kind', () => {
  assert.deepEqual(flagFromMmsi('422123456'), {
    mmsi: '422123456',
    mid: '422',
    country: 'Iran',
    kind: 'ship',
  });
  assert.equal(flagFromMmsi(366999999).country, 'United States');
  assert.equal(flagFromMmsi('002241022').kind, 'coast-station');
  assert.equal(flagFromMmsi('002241022').country, 'Spain');
  assert.equal(flagFromMmsi('111232001').kind, 'sar-aircraft');
  assert.equal(flagFromMmsi('111232001').country, 'United Kingdom');
  assert.equal(flagFromMmsi('992351234').kind, 'aton');
  assert.equal(flagFromMmsi('970123456').kind, 'sar-transponder');
  assert.equal(flagFromMmsi('12345').kind, 'unknown');
  assert.equal(flagFromMmsi('999999999').country, null);
});

test('matchSanctionedVessel matches by IMO first, then MMSI, through both index encodings', () => {
  const index = {
    generatedAt: '2026-09-28T00:00:00Z',
    byImo: { 9123456: 0 },
    byMmsi: {
      273456789: { id: 'v2', name: 'OTHER SHIP', programs: ['RU-EU'] },
    },
    vessels: [
      {
        id: 'v1',
        name: 'SEA DRAGON',
        imo: '9123456',
        programs: ['IR-EO13902'],
        datasets: ['us_ofac_sdn'],
      },
    ],
  };
  assert.equal(
    matchSanctionedVessel(index, { imo: 'IMO 9123456' }).matchedBy,
    'IMO',
  );
  assert.equal(
    matchSanctionedVessel(index, { imo: '', mmsi: '273456789' }).name,
    'OTHER SHIP',
  );
  assert.equal(matchSanctionedVessel(index, { imo: '0', mmsi: '111' }), null);
  assert.equal(matchSanctionedVessel(null, { imo: '9123456' }), null);
});

test('buildVesselIntelModel decodes a sanctioned hazardous tanker', () => {
  const sanctions = {
    generatedAt: '2026-09-28T00:00:00Z',
    byImo: { 9123456: 0 },
    byMmsi: {},
    vessels: [
      {
        id: 'v1',
        name: 'SEA DRAGON',
        imo: '9123456',
        flag: 'Iran',
        programs: ['IR-EO13902'],
        datasets: ['us_ofac_sdn'],
        sanctions: ['OFAC SDN listing'],
        lastSeen: '2026-09-27',
        url: 'https://www.opensanctions.org/entities/v1/',
      },
    ],
  };
  const model = buildVesselIntelModel({ live: TANKER, sanctions, nowMs: NOW });
  assert.equal(model.kind, 'vessel');
  assert.equal(model.id, 'vessel:422123456');
  assert.equal(model.title, 'SEA DRAGON');
  assert.equal(model.subtitle, 'Tanker · Iran · → BANDAR ABBAS');
  assert.equal(model.accent, '#ff5c5c');
  assert.deepEqual(
    model.sections.map((section) => section.heading),
    ['IDENTITY', 'VOYAGE', 'CLASSIFICATION', 'SANCTIONS SCREEN'],
  );
  const identity = Object.fromEntries(
    model.sections[0].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(identity.MMSI, '422123456');
  assert.equal(identity.IMO, '9123456');
  assert.equal(identity['Flag (MMSI MID)'], 'Iran (MID 422)');
  const voyage = Object.fromEntries(
    model.sections[1].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(voyage.Speed, '11.4 kn (21 km/h)');
  assert.equal(voyage['Course / heading'], '120° / 118°');
  assert.equal(voyage['Last position'], '25.1000°, 55.2000°');
  assert.equal(voyage.Reported, '2026-09-30 17:40 UTC (20 min ago)');
  const classification = Object.fromEntries(
    model.sections[2].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(
    classification['AIS ship type'],
    'Tanker — hazardous cargo category B (82)',
  );
  assert.equal(classification['Hazardous cargo'], 'Category B');
  const screen = Object.fromEntries(
    model.sections[3].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(screen.Match, 'Listed vessel (matched by IMO)');
  assert.equal(screen.Programs, 'IR-EO13902');
  assert.equal(screen.Measures, 'OFAC SDN listing');
  assert.equal(
    model.sections[3].rows.find((row) => row.href)?.href,
    'https://www.opensanctions.org/entities/v1/',
  );
  assert.deepEqual(
    model.badges.map((badge) => badge.label),
    ['SANCTIONED', 'HAZMAT B'],
  );
  assert.equal(model.badges[0].tone, 'alert');
  assert.deepEqual(
    model.links.map((link) => link.label),
    [
      'VesselFinder',
      'BalticShipping',
      'MarineTraffic search',
      'OpenSanctions search',
    ],
  );
  assert.equal(
    model.links[0].href,
    'https://www.vesselfinder.com/vessels/details/9123456',
  );
});

test('buildVesselIntelModel flags dark and military contacts from the context record', () => {
  const model = buildVesselIntelModel({
    live: {
      id: 'ais-338000001',
      layerId: 'ais-live-vessels',
      label: 'USNS PATROL',
      latitude: 36.8,
      longitude: -76.3,
      properties: {
        mmsi: '338000001',
        type: '35',
        speedKt: 0,
        course: 0,
        destination: '',
      },
    },
    sanctions: {
      generatedAt: '2026-09-28T00:00:00Z',
      byImo: {},
      byMmsi: {},
      vessels: [],
    },
    nowMs: NOW,
  });
  assert.equal(model.title, 'USNS PATROL');
  assert.deepEqual(
    model.badges.map((badge) => badge.label),
    ['MILITARY'],
  );
  assert.equal(model.subtitle, 'Military operations · United States');
  const screen = model.sections.find(
    (section) => section.heading === 'SANCTIONS SCREEN',
  );
  assert.match(screen.rows[0].value, /No match by IMO\/MMSI .*2026-09-28/);
  const identity = Object.fromEntries(
    model.sections[0].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(identity.IMO, '—');
  assert.equal(
    model.links[0].href,
    'https://www.vesselfinder.com/?mmsi=338000001',
  );

  const dark = buildVesselIntelModel({
    live: {
      ...TANKER,
      type: '70',
      imo: '',
      lastPositionEpoch: (NOW - DARK_AFTER_MS - 60_000) / 1000,
      lastPositionUtc: '',
    },
    nowMs: NOW,
  });
  assert.deepEqual(
    dark.badges.map((badge) => badge.label),
    ['DARK'],
  );
  assert.ok(dark.notes.some((note) => /No AIS position for 6\.0 h/.test(note)));
  const screenUnloaded = dark.sections.find(
    (section) => section.heading === 'SANCTIONS SCREEN',
  );
  assert.equal(screenUnloaded.rows[0].value, 'Sanctions index not loaded');
  assert.equal(buildVesselIntelModel({ live: null }), null);
});

test('loadSanctionsIndex tolerates a missing bundle and caches the result', async () => {
  resetSanctionsIndexForTest();
  let calls = 0;
  const missing = await loadSanctionsIndex({
    fetchImpl: async () => {
      calls++;
      return { ok: false, status: 404 };
    },
  });
  assert.equal(missing, null);
  await loadSanctionsIndex({
    fetchImpl: async () => ({ ok: true, json: async () => ({ vessels: [] }) }),
  });
  assert.equal(calls, 1, 'second call reuses the cached promise');
  resetSanctionsIndexForTest();
  const index = await loadSanctionsIndex({
    url: 'https://example.invalid/sanctioned_vessels.json',
    fetchImpl: async (target) => ({
      ok: true,
      json: async () => ({ vessels: [], url: String(target) }),
    }),
  });
  assert.equal(index.url, 'https://example.invalid/sanctioned_vessels.json');
  resetSanctionsIndexForTest();
});
