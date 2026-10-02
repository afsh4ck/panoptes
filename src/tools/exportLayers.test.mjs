import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectLayerRecords,
  countPositioned,
  exportFilename,
  recordPosition,
  renderExport,
  toCsv,
  toGeoJson,
  toKml,
} from './exportLayers.js';

const layers = () => [
  {
    id: 'earthquakes',
    name: 'Earthquakes',
    enabled: true,
    source: 'USGS',
    getAnalystRecords: () => [
      { id: 'q1', name: 'M5.1 - Chile', lat: -33.4, lon: -70.6, mag: 5.1 },
      { id: 'q2', name: 'no position', mag: 2.0 },
    ],
  },
  {
    id: 'flights',
    name: 'Live Flights',
    enabled: true,
    getAnalystRecords: () => [
      {
        id: 'abc123',
        callsign: 'IBE, "6250"',
        latitude: 40.1,
        longitude: -3.5,
        route: { origin: 'MAD' },
      },
    ],
  },
  {
    id: 'off',
    name: 'Disabled',
    enabled: false,
    getAnalystRecords: () => [{ lat: 1, lon: 1 }],
  },
  { id: 'plain', name: 'No records', enabled: true },
  {
    id: 'broken',
    name: 'Throws',
    enabled: true,
    getAnalystRecords: () => {
      throw new Error('boom');
    },
  },
];

test('recordPosition accepts every field spelling and rejects bad values', () => {
  assert.deepEqual(recordPosition({ lat: 1, lon: 2 }), { lat: 1, lon: 2 });
  assert.deepEqual(recordPosition({ latitude: '1.5', longitude: '2.5' }), {
    lat: 1.5,
    lon: 2.5,
  });
  assert.deepEqual(recordPosition({ lat: 1, lng: 2 }), { lat: 1, lon: 2 });
  assert.equal(recordPosition({ lat: 91, lon: 0 }), null);
  assert.equal(recordPosition({ lat: 'x', lon: 0 }), null);
  assert.equal(recordPosition(null), null);
});

test('collectLayerRecords keeps enabled layers with records only', () => {
  const collections = collectLayerRecords({ layers: layers(), maxPerLayer: 1 });
  assert.deepEqual(
    collections.map((c) => [c.layerId, c.records.length]),
    [
      ['earthquakes', 1],
      ['flights', 1],
    ],
  );
  assert.equal(collections[0].source, 'USGS');
});

test('toGeoJson emits positioned features tagged with their layer', () => {
  const geojson = toGeoJson(collectLayerRecords({ layers: layers() }), {
    generatedAt: 0,
  });
  assert.equal(geojson.type, 'FeatureCollection');
  assert.equal(geojson.generatedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(geojson.features.length, 2);
  const [quake, flight] = geojson.features;
  assert.deepEqual(quake.geometry, {
    type: 'Point',
    coordinates: [-70.6, -33.4],
  });
  assert.equal(quake.properties.layer, 'earthquakes');
  assert.equal(quake.properties.mag, 5.1);
  assert.equal(quake.properties.lat, undefined);
  assert.equal(flight.properties.route, '{"origin":"MAD"}');
  assert.equal(countPositioned(collectLayerRecords({ layers: layers() })), 2);
});

test('toCsv writes RFC 4180 rows over the union of keys', () => {
  const csv = toCsv(collectLayerRecords({ layers: layers() }));
  const lines = csv.split('\r\n');
  assert.equal(
    lines[0],
    'layer,layerName,id,name,lat,lon,mag,callsign,latitude,longitude,route',
  );
  assert.equal(
    lines[1],
    'earthquakes,Earthquakes,q1,M5.1 - Chile,-33.4,-70.6,5.1,,,,',
  );
  assert.ok(lines[3].includes('"IBE, ""6250"""'));
  assert.equal(lines.at(-1), '');
  assert.equal(toCsv([]), '');
  assert.equal(toCsv([{ a: 'x\ny' }]), 'a\r\n"x\ny"\r\n');
});

test('toKml nests placemarks in per-layer folders and escapes XML', () => {
  const kml = toKml(collectLayerRecords({ layers: layers() }), {
    name: 'A & B',
  });
  assert.ok(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(kml.includes('<name>A &amp; B</name>'));
  assert.equal((kml.match(/<Folder>/g) || []).length, 2);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.ok(kml.includes('<coordinates>-70.6,-33.4,0</coordinates>'));
  assert.ok(kml.includes('IBE, &quot;6250&quot;'));
});

test('renderExport and exportFilename cover every format', () => {
  const collections = collectLayerRecords({ layers: layers() });
  assert.equal(
    renderExport('geojson', collections).mime,
    'application/geo+json',
  );
  assert.equal(renderExport('csv', collections).mime, 'text/csv');
  assert.ok(renderExport('kml', collections).text.includes('<kml'));
  assert.throws(
    () => renderExport('xlsx', collections),
    /Unknown export format/,
  );
  assert.equal(
    exportFilename('geojson', '20260930T000000Z'),
    'panoptes-layers-20260930T000000Z.geojson',
  );
  assert.throws(() => exportFilename('pdf', 'x'));
});
