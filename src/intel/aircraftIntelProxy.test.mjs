import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AIRCRAFT_INTEL_USER_AGENT,
  aircraftIntelProxy,
  indexAirports,
  loadAircraftTypeSpecs,
  mergeAircraftIntel,
  normalizeSpecs,
  parseAdsbdbAircraft,
  parseAdsbdbRoute,
  parseHexdbAircraft,
  parseHexdbAirport,
  parseHexdbRoute,
  parsePlanespotters,
  splitModel,
  validCallsign,
  validHex,
} from '../../server/providers/aircraft/intel.js';

const ADSBDB_AIRCRAFT = {
  response: {
    aircraft: {
      type: 'A319 112',
      icao_type: 'A319',
      manufacturer: 'Airbus',
      mode_s: '3C6444',
      registration: 'D-AIBD',
      registered_owner_country_iso_name: 'DE',
      registered_owner_country_name: 'Germany',
      registered_owner_operator_flag_code: 'DLH',
      registered_owner: 'Lufthansa',
      url_photo: 'https://image.airport-data.com/aircraft/001742555.jpg',
      url_photo_thumbnail:
        'https://airport-data.com/images/aircraft/thumbnails/001/742/001742555.jpg',
    },
  },
};
const ADSBDB_ROUTE = {
  response: {
    flightroute: {
      callsign: 'DLH400',
      callsign_icao: 'DLH400',
      callsign_iata: 'LH400',
      airline: {
        name: 'Lufthansa',
        icao: 'DLH',
        iata: 'LH',
        country: 'Germany',
        country_iso: 'DE',
        callsign: 'LUFTHANSA',
      },
      origin: {
        country_iso_name: 'DE',
        country_name: 'Germany',
        elevation: 364,
        iata_code: 'FRA',
        icao_code: 'EDDF',
        latitude: 50.033333,
        longitude: 8.570556,
        municipality: 'Frankfurt am Main',
        name: 'Frankfurt am Main Airport',
      },
      destination: {
        country_iso_name: 'US',
        country_name: 'United States',
        elevation: 13,
        iata_code: 'JFK',
        icao_code: 'KJFK',
        latitude: 40.639801,
        longitude: -73.7789,
        municipality: 'New York',
        name: 'John F Kennedy International Airport',
      },
    },
  },
};
const HEXDB_AIRCRAFT = {
  ModeS: '3C6444',
  Registration: 'D-AIBD',
  Manufacturer: 'Airbus',
  ICAOTypeCode: 'A319',
  Type: 'A319 112',
  RegisteredOwners: 'Lufthansa',
  OperatorFlagCode: 'DLH',
};
const PLANESPOTTERS = {
  photos: [
    {
      id: '1981050',
      thumbnail: {
        src: 'https://t.plnspttrs.net/09561/1981050_77e29380db_t.jpg',
        size: { width: 200, height: 133 },
      },
      thumbnail_large: {
        src: 'https://t.plnspttrs.net/09561/1981050_77e29380db_280.jpg',
        size: { width: 422, height: 280 },
      },
      link: 'https://www.planespotters.net/photo/1981050/d-aibd-lufthansa-airbus-a319-112?utm_source=api',
      photographer: 'Steffen Müller',
    },
  ],
};

test('validators normalize case and reject anything outside the grammar', () => {
  assert.equal(validHex(' 3C6444 '), '3c6444');
  assert.equal(validHex('3c644'), null);
  assert.equal(validHex('~3c6444'), null);
  assert.equal(validCallsign('dlh400'), 'DLH400');
  assert.equal(validCallsign('A'), null);
  assert.equal(validCallsign('DLH-400'), null);
  assert.equal(splitModel('Airbus A319 112', 'Airbus'), 'A319 112');
  assert.equal(splitModel('A319 112', 'Airbus'), 'A319 112');
  assert.equal(splitModel('', 'Airbus'), null);
});

test('registry parsers read adsbdb and hexdb shapes and reject misses', () => {
  const adsbdb = parseAdsbdbAircraft(ADSBDB_AIRCRAFT);
  assert.equal(adsbdb.registration, 'D-AIBD');
  assert.equal(adsbdb.icaoType, 'A319');
  assert.equal(adsbdb.typeName, 'Airbus A319 112');
  assert.equal(adsbdb.model, 'A319 112');
  assert.equal(adsbdb.owner, 'Lufthansa');
  assert.equal(adsbdb.ownerCountryIso, 'DE');
  assert.equal(adsbdb.operatorIcao, 'DLH');
  assert.equal(
    adsbdb.photoThumb,
    ADSBDB_AIRCRAFT.response.aircraft.url_photo_thumbnail,
  );
  assert.equal(parseAdsbdbAircraft({ response: 'unknown aircraft' }), null);
  assert.equal(parseAdsbdbAircraft(null), null);
  const hexdb = parseHexdbAircraft(HEXDB_AIRCRAFT);
  assert.equal(hexdb.registration, 'D-AIBD');
  assert.equal(hexdb.typeName, 'Airbus A319 112');
  assert.equal(hexdb.operatorIcao, 'DLH');
  assert.equal(hexdb.ownerCountry, null);
  assert.equal(
    parseHexdbAircraft({ status: '404', error: 'Aircraft not found.' }),
    null,
  );
});

test('route parsers keep both endpoints and hexdb legs resolve through airports', () => {
  const route = parseAdsbdbRoute(ADSBDB_ROUTE);
  assert.equal(route.callsignIata, 'LH400');
  assert.equal(route.airline.icao, 'DLH');
  assert.equal(route.origin.icao, 'EDDF');
  assert.equal(route.origin.municipality, 'Frankfurt am Main');
  assert.equal(route.destination.lat, 40.639801);
  assert.equal(
    parseAdsbdbRoute({ response: { flightroute: { origin: {} } } }),
    null,
  );
  assert.deepEqual(
    parseHexdbRoute({
      flight: 'DLH400',
      route: 'EDDF-KJFK',
      updatetime: 1747593022,
    }),
    {
      callsign: 'DLH400',
      legs: ['EDDF', 'KJFK'],
      updatedAt: 1747593022000,
    },
  );
  assert.equal(
    parseHexdbRoute({ status: '404', error: 'Route not found.' }),
    null,
  );
  assert.equal(parseHexdbRoute({ route: 'EDDF' }), null);
  const airport = parseHexdbAirport({
    country_code: 'DE',
    region_name: 'Hessen',
    iata: 'FRA',
    icao: 'EDDF',
    airport: 'Frankfurt Airport',
    latitude: 50.0333,
    longitude: 8.57056,
  });
  assert.equal(airport.name, 'Frankfurt Airport');
  assert.equal(airport.countryIso, 'DE');
  assert.equal(parseHexdbAirport({ error: 'x' }), null);
});

test('planespotters parser prefers the large thumbnail and keeps the credit', () => {
  const photo = parsePlanespotters(PLANESPOTTERS);
  assert.equal(photo.thumb, PLANESPOTTERS.photos[0].thumbnail_large.src);
  assert.equal(photo.link, PLANESPOTTERS.photos[0].link);
  assert.equal(photo.credit, 'Steffen Müller');
  assert.equal(photo.source, 'planespotters');
  assert.equal(parsePlanespotters({ photos: [] }), null);
  assert.equal(parsePlanespotters({ error: 'UA' }), null);
});

test('type specs load from a map, a wrapped map or an array, in metres or feet', () => {
  const mapText = JSON.stringify({
    A319: {
      manufacturer: 'Airbus',
      model: 'A319',
      engines: 2,
      engineType: 'Jet',
      wakeCategory: 'm',
      wingspanM: 35.8,
      lengthM: 33.84,
      tailHeightM: 11.76,
      mtowKg: 75500,
      approachSpeedKt: 138,
      source: 'faa-acd',
    },
  });
  assert.equal(loadAircraftTypeSpecs(mapText).get('A319').wakeCategory, 'M');
  const wrapped = loadAircraftTypeSpecs(
    JSON.stringify({
      types: { b738: { wingspanFt: 117.4, mtowLb: 174200, engines: '2' } },
    }),
  );
  assert.equal(wrapped.get('B738').wingspanM, 35.78);
  assert.equal(wrapped.get('B738').mtowKg, 79016);
  assert.equal(wrapped.get('B738').engines, 2);
  const rows = loadAircraftTypeSpecs(
    JSON.stringify([
      { designator: 'C172', engines: 1, engineType: 'Piston' },
      { icao: '', engines: 1 },
    ]),
  );
  assert.equal(rows.get('C172').engineType, 'Piston');
  assert.equal(rows.size, 1);
  assert.equal(loadAircraftTypeSpecs('{not json').size, 0);
  assert.equal(normalizeSpecs({ source: 'x' }), null);
  assert.equal(normalizeSpecs(null), null);
});

test('airport index reads codes from top-level or tag properties', () => {
  const lines = [
    JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [8.570556, 50.033333] },
      properties: {
        name: 'Frankfurt Airport',
        tags: {
          icao: 'EDDF',
          iata: 'FRA',
          municipality: 'Frankfurt',
          iso_country: 'DE',
        },
      },
    }),
    JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-73.7789, 40.639801] },
      properties: {
        name: 'JFK',
        ident: 'KJFK',
        iata_code: 'JFK',
        country: 'United States',
      },
    }),
    'not json',
    JSON.stringify({ type: 'Feature', properties: { name: 'no codes' } }),
  ].join('\n');
  const index = indexAirports(lines);
  assert.equal(index.byIcao.get('EDDF').municipality, 'Frankfurt');
  assert.equal(index.byIcao.get('EDDF').countryIso, 'DE');
  assert.equal(index.byIata.get('JFK').icao, 'KJFK');
  assert.equal(index.byIcao.get('KJFK').lat, 40.639801);
  assert.equal(index.byIcao.size, 2);
});

test('mergeAircraftIntel composes sources, photo fallbacks and honesty notes', () => {
  const aircraft = parseAdsbdbAircraft(ADSBDB_AIRCRAFT);
  const full = mergeAircraftIntel({
    hex: '3c6444',
    callsign: 'DLH400',
    aircraft,
    aircraftSource: 'adsbdb',
    route: parseAdsbdbRoute(ADSBDB_ROUTE),
    routeSource: 'adsbdb',
    photo: parsePlanespotters(PLANESPOTTERS),
    specs: loadAircraftTypeSpecs(
      JSON.stringify({
        A319: { engines: 2, engineType: 'Jet', source: 'faa-acd' },
      }),
    ).get('A319'),
    now: 1234,
  });
  assert.equal(full.found, true);
  assert.equal(full.typeName, 'Airbus A319 112');
  assert.equal(full.route.origin.icao, 'EDDF');
  assert.equal(full.route.source, 'adsbdb');
  assert.equal(full.photo.source, 'planespotters');
  assert.deepEqual(full.sources, ['adsbdb', 'planespotters', 'faa-acd']);
  assert.deepEqual(full.notes, []);
  assert.equal(full.fetchedAt, 1234);

  const fallback = mergeAircraftIntel({
    hex: '3c6444',
    callsign: 'DLH400',
    aircraft,
    aircraftSource: 'hexdb',
    photo: null,
    specs: null,
  });
  assert.equal(fallback.photo.source, 'adsbdb');
  assert.equal(
    fallback.photo.thumb,
    ADSBDB_AIRCRAFT.response.aircraft.url_photo_thumbnail,
  );
  assert.deepEqual(fallback.notes, [
    'No published route for callsign DLH400.',
    'No bundled specifications for type A319.',
  ]);

  const miss = mergeAircraftIntel({ hex: '000001' });
  assert.equal(miss.found, false);
  assert.equal(miss.registration, null);
  assert.deepEqual(miss.sources, []);
  assert.deepEqual(miss.notes, [
    'No registry match for this Mode S address (adsbdb, hexdb).',
    'No photo available for this airframe.',
  ]);
});

function fakeServer() {
  const routes = new Map();
  return {
    middlewares: {
      use(mount, handler) {
        routes.set(mount, handler);
      },
    },
    async request(url, remoteAddress = '127.0.0.1') {
      const handler = routes.get('/api/aircraft-intel');
      const req = { url, socket: { remoteAddress } };
      let status = 0;
      let headers = {};
      let body = '';
      await new Promise((resolve) => {
        const res = {
          writeHead(code, hdrs) {
            status = code;
            headers = hdrs;
          },
          end(chunk) {
            body = String(chunk ?? '');
            resolve();
          },
        };
        handler(req, res);
      });
      return { status, headers, body: body ? JSON.parse(body) : null };
    },
  };
}

function jsonResponse(status, body) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('the middleware assembles all sources once, caches misses and persists to disk', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aircraft-intel-'));
  try {
    const specsPath = path.join(dir, 'aircraft_types.json');
    await writeFile(
      specsPath,
      JSON.stringify({
        A319: {
          engines: 2,
          engineType: 'Jet',
          wakeCategory: 'M',
          wingspanM: 35.8,
          source: 'faa-acd',
        },
      }),
    );
    const cachePath = path.join(dir, 'cache.json');
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(url);
      assert.equal(options.headers['User-Agent'], AIRCRAFT_INTEL_USER_AGENT);
      if (url === 'https://api.adsbdb.com/v0/aircraft/3c6444')
        return jsonResponse(200, ADSBDB_AIRCRAFT);
      if (url === 'https://api.adsbdb.com/v0/callsign/DLH400')
        return jsonResponse(200, ADSBDB_ROUTE);
      if (url === 'https://api.planespotters.net/pub/photos/hex/3c6444')
        return jsonResponse(200, PLANESPOTTERS);
      if (url === 'https://api.adsbdb.com/v0/aircraft/000001')
        return jsonResponse(404, { response: 'unknown aircraft' });
      if (url === 'https://hexdb.io/api/v1/aircraft/000001')
        return jsonResponse(404, {
          status: '404',
          error: 'Aircraft not found.',
        });
      if (url === 'https://api.planespotters.net/pub/photos/hex/000001')
        return jsonResponse(200, { photos: [] });
      throw new Error(`unexpected upstream ${url}`);
    };
    let clock = 1_000_000;
    const plugin = aircraftIntelProxy({
      fetchImpl,
      now: () => clock,
      cachePath,
      specsPath,
      airportsPath: path.join(dir, 'missing.geojsonl'),
      persistIntervalMs: 0,
      logger: { error() {} },
    });
    const server = fakeServer();
    plugin.configureServer(server);

    const first = await server.request('/3c6444?callsign=dlh400');
    assert.equal(first.status, 200);
    assert.equal(first.headers['Cache-Control'], 'no-store');
    assert.equal(first.body.found, true);
    assert.equal(first.body.registration, 'D-AIBD');
    assert.equal(first.body.route.destination.iata, 'JFK');
    assert.equal(first.body.photo.credit, 'Steffen Müller');
    assert.equal(first.body.specs.wingspanM, 35.8);
    assert.deepEqual(first.body.sources, [
      'adsbdb',
      'planespotters',
      'faa-acd',
    ]);
    assert.equal(calls.length, 3);

    const second = await server.request('/3C6444?callsign=DLH400');
    assert.equal(second.body.registration, 'D-AIBD');
    assert.equal(
      calls.length,
      3,
      'a fresh cache answers without upstream calls',
    );

    const miss = await server.request('/000001');
    assert.equal(miss.status, 200);
    assert.equal(miss.body.found, false);
    assert.equal(calls.length, 6);
    await server.request('/000001');
    assert.equal(calls.length, 6, 'a definite miss is negatively cached');

    assert.equal((await server.request('/xyz')).status, 400);
    assert.equal((await server.request('/3c6444?callsign=bad-cs')).status, 400);

    await plugin._persist();
    const persisted = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.equal(persisted.aircraft['3c6444'].source, 'adsbdb');
    assert.equal(persisted.aircraft['000001'].data, null);
    assert.equal(persisted.routes.DLH400.source, 'adsbdb');

    // Photo entries outlive the 24 h registry TTL; the registry refetches, the photo does not.
    clock += 25 * 3600_000;
    await server.request('/3c6444?callsign=DLH400');
    assert.deepEqual(calls.slice(6), [
      'https://api.adsbdb.com/v0/aircraft/3c6444',
      'https://api.adsbdb.com/v0/callsign/DLH400',
    ]);
    plugin._stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('hexdb fills in when adsbdb has no record and legs resolve via the bundled airports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aircraft-intel-'));
  try {
    const airportsPath = path.join(dir, 'airports.geojsonl');
    await writeFile(
      airportsPath,
      [
        JSON.stringify({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.570556, 50.033333] },
          properties: {
            name: 'Frankfurt Airport',
            tags: {
              icao: 'EDDF',
              iata: 'FRA',
              municipality: 'Frankfurt',
              iso_country: 'DE',
            },
          },
        }),
      ].join('\n'),
    );
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url === 'https://api.adsbdb.com/v0/aircraft/3c6444')
        return jsonResponse(404, { response: 'unknown aircraft' });
      if (url === 'https://hexdb.io/api/v1/aircraft/3c6444')
        return jsonResponse(200, HEXDB_AIRCRAFT);
      if (url === 'https://api.adsbdb.com/v0/callsign/DLH400')
        return jsonResponse(404, { response: 'unknown callsign' });
      if (url === 'https://hexdb.io/api/v1/route/icao/DLH400')
        return jsonResponse(200, {
          flight: 'DLH400',
          route: 'EDDF-KJFK',
          updatetime: 1747593022,
        });
      if (url === 'https://hexdb.io/api/v1/airport/icao/KJFK')
        return jsonResponse(200, {
          country_code: 'US',
          region_name: 'New York',
          iata: 'JFK',
          icao: 'KJFK',
          airport: 'John F Kennedy International Airport',
          latitude: 40.6398,
          longitude: -73.7789,
        });
      if (url === 'https://api.planespotters.net/pub/photos/hex/3c6444')
        throw new Error('network down');
      throw new Error(`unexpected upstream ${url}`);
    };
    const plugin = aircraftIntelProxy({
      fetchImpl,
      now: () => 5,
      cachePath: path.join(dir, 'cache.json'),
      specsPath: path.join(dir, 'missing.json'),
      airportsPath,
      persistIntervalMs: 0,
      logger: { error() {} },
    });
    const server = fakeServer();
    plugin.configureServer(server);
    const result = await server.request('/3c6444?callsign=DLH400');
    assert.equal(result.status, 200);
    assert.equal(result.body.found, true);
    assert.equal(result.body.owner, 'Lufthansa');
    assert.equal(result.body.route.source, 'hexdb');
    assert.equal(result.body.route.origin.name, 'Frankfurt Airport');
    assert.equal(result.body.route.origin.countryIso, 'DE');
    assert.equal(
      result.body.route.destination.name,
      'John F Kennedy International Airport',
    );
    assert.equal(
      result.body.photo,
      null,
      'hexdb has no photo and planespotters failed',
    );
    assert.deepEqual(result.body.sources, ['hexdb']);
    assert.ok(
      result.body.notes.includes('No photo available for this airframe.'),
    );
    assert.ok(
      result.body.notes.includes('No bundled specifications for type A319.'),
    );
    // The transient planespotters failure was not cached: a retry hits upstream again.
    await server.request('/3c6444?callsign=DLH400');
    assert.equal(
      calls.filter((url) => url.includes('planespotters')).length,
      2,
    );
    assert.equal(
      calls.filter((url) => url.includes('/aircraft/3c6444')).length,
      2,
      'registry answers were cached',
    );
    plugin._stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rate limiting answers 429 with Retry-After once a client exhausts its window', async () => {
  const plugin = aircraftIntelProxy({
    fetchImpl: async () => jsonResponse(404, {}),
    now: () => 1,
    cachePath: path.join(os.tmpdir(), `aircraft-intel-${process.pid}-rl.json`),
    persistIntervalMs: 0,
    logger: { error() {} },
  });
  const server = fakeServer();
  plugin.configureServer(server);
  let last;
  for (let i = 0; i < 121; i++)
    last = await server.request('/000001', '10.0.0.9');
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
  plugin._stop();
});
