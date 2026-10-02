import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftIntelUrl,
  buildAircraftIntelModel,
  emergencyForSquawk,
  fetchAircraftIntel,
  isMilitaryLive,
} from './aircraftIntel.js';
import { isIntelModel } from './intelModel.js';

const PAYLOAD = {
  found: true,
  hex: '3c6444',
  callsign: 'DLH400',
  registration: 'D-AIBD',
  icaoType: 'A319',
  typeName: 'Airbus A319 112',
  manufacturer: 'Airbus',
  model: 'A319 112',
  owner: 'Lufthansa',
  ownerCountry: 'Germany',
  ownerCountryIso: 'DE',
  operatorIcao: 'DLH',
  airline: {
    name: 'Lufthansa',
    icao: 'DLH',
    iata: 'LH',
    country: 'Germany',
    countryIso: 'DE',
    callsign: 'LUFTHANSA',
  },
  route: {
    callsign: 'DLH400',
    callsignIata: 'LH400',
    origin: {
      icao: 'EDDF',
      iata: 'FRA',
      name: 'Frankfurt am Main Airport',
      municipality: 'Frankfurt am Main',
      country: 'Germany',
      lat: 50.033333,
      lon: 8.570556,
    },
    destination: {
      icao: 'KJFK',
      iata: 'JFK',
      name: 'John F Kennedy International Airport',
      municipality: 'New York',
      country: 'United States',
      lat: 40.639801,
      lon: -73.7789,
    },
    source: 'adsbdb',
  },
  photo: {
    thumb: 'https://t.plnspttrs.net/09561/1981050_77e29380db_280.jpg',
    full: 'https://t.plnspttrs.net/09561/1981050_77e29380db_280.jpg',
    link: 'https://www.planespotters.net/photo/1981050/x',
    credit: 'Steffen Müller',
    source: 'planespotters',
  },
  specs: {
    icao: 'A319',
    manufacturer: 'Airbus',
    model: 'A319',
    engines: 2,
    engineType: 'Jet',
    wakeCategory: 'M',
    wingspanM: 35.8,
    lengthM: 33.84,
    tailHeightM: 11.76,
    mtowKg: 75500,
    approachSpeedKt: 138,
    source: 'faa-acd',
  },
  sources: ['adsbdb', 'planespotters', 'faa-acd'],
  notes: [],
  fetchedAt: 1_700_000_000_000,
};

const LIVE = {
  name: 'DLH400',
  operator: 'Lufthansa',
  callsign: 'DLH400',
  registration: 'D-AIBD',
  type: 'Airbus A319 112',
  altitude: '35,000 ft',
  speed: '460 kt',
  heading: '270°',
  route: 'FRA → JFK',
  icao24: '3c6444',
  status: 'live',
  latitude: 50.1,
  longitude: 8.6,
  klass: 'airliner',
  category: 'Large',
};

test('aircraftIntelUrl validates the hex and only appends a plausible callsign', () => {
  assert.equal(
    aircraftIntelUrl({ hex: '3C6444', callsign: 'dlh400' }),
    '/api/aircraft-intel/3c6444?callsign=DLH400',
  );
  assert.equal(
    aircraftIntelUrl({ hex: '3c6444', callsign: '   ' }),
    '/api/aircraft-intel/3c6444',
  );
  assert.equal(
    aircraftIntelUrl({ hex: '3c6444', callsign: 'A' }),
    '/api/aircraft-intel/3c6444',
  );
  assert.throws(() => aircraftIntelUrl({ hex: 'zz6444' }), /Invalid ICAO24/);
  assert.throws(() => aircraftIntelUrl({}), /Invalid ICAO24/);
});

test('fetchAircraftIntel requests the same-origin proxy and surfaces HTTP failures', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(PAYLOAD), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const payload = await fetchAircraftIntel({
    hex: '3c6444',
    callsign: 'DLH400',
    fetchImpl,
  });
  assert.deepEqual(calls, ['/api/aircraft-intel/3c6444?callsign=DLH400']);
  assert.equal(payload.registration, 'D-AIBD');
  await assert.rejects(
    fetchAircraftIntel({
      hex: '3c6444',
      fetchImpl: async () => new Response('nope', { status: 503 }),
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    fetchAircraftIntel({
      hex: '3c6444',
      fetchImpl: async () => new Response('[]', { status: 200 }),
    }),
    /Malformed/,
  );
});

test('a full payload produces every section with real values and sanitized links', () => {
  const model = buildAircraftIntelModel({
    payload: PAYLOAD,
    live: LIVE,
    now: PAYLOAD.fetchedAt + 1000,
  });
  assert.equal(isIntelModel(model), true);
  assert.equal(model.kind, 'aircraft');
  assert.equal(model.id, '3c6444');
  assert.equal(model.title, 'DLH400');
  assert.equal(model.subtitle, 'Airbus A319 112 · Lufthansa');
  assert.deepEqual(model.badges, [{ label: 'REGISTRY MATCH', tone: 'ok' }]);
  assert.deepEqual(
    model.sections.map((section) => section.heading),
    ['IDENTITY', 'OPERATOR', 'ROUTE', 'AIRFRAME SPECS', 'LIVE TELEMETRY'],
  );
  const rows = Object.fromEntries(
    model.sections.flatMap((s) =>
      s.rows.map((r) => [`${s.heading}/${r.label}`, r.value]),
    ),
  );
  assert.equal(rows['IDENTITY/Registration'], 'D-AIBD');
  assert.equal(rows['IDENTITY/ICAO 24-bit'], '3C6444');
  assert.equal(rows['IDENTITY/ICAO type'], 'A319');
  assert.equal(rows['IDENTITY/Registered in'], 'Germany (DE)');
  assert.equal(rows['IDENTITY/Class'], 'Airliner');
  assert.equal(rows['OPERATOR/Airline'], 'Lufthansa (DLH / LH)');
  assert.equal(
    rows['ROUTE/Origin'],
    'FRA · Frankfurt am Main Airport, Frankfurt am Main, Germany',
  );
  assert.equal(
    rows['ROUTE/Destination'],
    'JFK · John F Kennedy International Airport, New York, United States',
  );
  assert.equal(rows['ROUTE/Flight'], 'LH400 (DLH400)');
  assert.equal(rows['AIRFRAME SPECS/Engines'], '2 × Jet');
  assert.equal(rows['AIRFRAME SPECS/Wake category'], 'M · Medium');
  assert.equal(rows['AIRFRAME SPECS/Wingspan'], '35.8 m (117.5 ft)');
  assert.equal(
    rows['AIRFRAME SPECS/Max takeoff weight'],
    '75,500 kg (166,449 lb)',
  );
  assert.equal(rows['AIRFRAME SPECS/Approach speed'], '138 kt · 256 km/h');
  assert.equal(rows['LIVE TELEMETRY/Altitude'], '35,000 ft');
  assert.equal(rows['LIVE TELEMETRY/Position'], '50.1000, 8.6000');
  assert.equal(model.photo.src, PAYLOAD.photo.thumb);
  assert.equal(model.photo.credit, 'Steffen Müller · planespotters');
  const hrefs = model.links.map((link) => link.href);
  assert.ok(hrefs.includes('https://www.planespotters.net/hex/3C6444'));
  assert.ok(hrefs.includes('https://globe.adsbexchange.com/?icao=3c6444'));
  assert.ok(hrefs.includes('https://flightaware.com/live/flight/DLH400'));
  assert.ok(
    hrefs.includes('https://www.flightradar24.com/data/flights/dlh400'),
  );
  assert.ok(hrefs.includes(PAYLOAD.photo.link));
  assert.ok(hrefs.every((href) => href.startsWith('https://')));
  assert.deepEqual(model.notes, []);
  assert.equal(model.fetchedAt, PAYLOAD.fetchedAt);
  assert.equal(model.raw.payload, PAYLOAD);
});

test('numeric live twins are formatted and stale/emergency/military states become badges', () => {
  const model = buildAircraftIntelModel({
    payload: {
      ...PAYLOAD,
      found: false,
      registration: null,
      specs: null,
      route: null,
      photo: null,
      notes: ['No registry match for this Mode S address (adsbdb, hexdb).'],
    },
    live: {
      ...LIVE,
      layerId: 'military',
      operator: 'USAF',
      type: 'KC-135R',
      registration: '62-3500',
      status: 'stale (missed polls)',
      squawk: '7700',
      altitudeFt: 29_000,
      speedKt: 420,
      headingDeg: 91.4,
      verticalRateFpm: -1200,
      onGround: false,
    },
  });
  assert.deepEqual(model.badges, [
    { label: 'EMERGENCY · 7700', tone: 'alert' },
    { label: 'MILITARY', tone: 'warn' },
    { label: 'STALE FIX', tone: 'warn' },
    { label: 'NO REGISTRY MATCH', tone: 'warn' },
  ]);
  assert.equal(model.accent, '#f5a524');
  const headings = model.sections.map((section) => section.heading);
  assert.ok(headings.includes('MILITARY'));
  assert.ok(!headings.includes('AIRFRAME SPECS'));
  const rows = Object.fromEntries(
    model.sections.flatMap((s) =>
      s.rows.map((r) => [`${s.heading}/${r.label}`, r.value]),
    ),
  );
  assert.equal(rows['LIVE TELEMETRY/Altitude'], 'FL290 · 29,000 ft (8,839 m)');
  assert.equal(rows['LIVE TELEMETRY/Ground speed'], '420 kt · 778 km/h');
  assert.equal(rows['LIVE TELEMETRY/Heading'], '91°');
  assert.equal(rows['LIVE TELEMETRY/Vertical rate'], '-1,200 ft/min');
  assert.equal(rows['LIVE TELEMETRY/Squawk'], '7700 — EMERGENCY · 7700');
  assert.equal(rows['MILITARY/Operator'], 'USAF');
  assert.equal(rows['ROUTE/Route (live feed)'], 'FRA → JFK');
  assert.ok(
    model.notes.includes(
      'No registry match for this Mode S address (adsbdb, hexdb).',
    ),
  );
});

test('a failed fetch still yields a live-only model with an honest note', () => {
  const model = buildAircraftIntelModel({
    payload: null,
    live: { icao24: 'abc123', callsign: '', status: 'live' },
  });
  assert.equal(model.title, 'ABC123');
  assert.deepEqual(model.badges, [{ label: 'LIVE ONLY', tone: 'neutral' }]);
  assert.equal(model.photo, null);
  assert.deepEqual(model.notes, [
    'Registry lookup unavailable — showing the live contact only.',
  ]);
  assert.deepEqual(
    model.sections.map((section) => section.heading),
    ['IDENTITY', 'LIVE TELEMETRY'],
  );
});

test('squawk and military helpers', () => {
  assert.equal(emergencyForSquawk('7500'), 'HIJACK · 7500');
  assert.equal(emergencyForSquawk(7600), 'RADIO FAILURE · 7600');
  assert.equal(emergencyForSquawk('1200'), null);
  assert.equal(emergencyForSquawk(null), null);
  assert.equal(isMilitaryLive({ layerId: 'military' }), true);
  assert.equal(isMilitaryLive({ layerName: 'Military Flights' }), true);
  assert.equal(isMilitaryLive({ layerId: 'flights' }), false);
});
