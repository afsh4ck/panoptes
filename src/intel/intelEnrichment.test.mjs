import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commonsImage,
  fetchSiteWikidata,
  siteFactsFromEntity,
  siteWikidataId,
  siteWikidataRows,
  wikidataTime,
} from './siteWikidata.js';
import { buildSiteIntelModel } from './siteIntel.js';
import {
  eventContextFor,
  eventLayerFor,
  eventSelectionId,
} from './eventSelection.js';
import {
  buildEventIntelModel,
  saffirSimpson,
  timeAgo,
} from './eventIntel.js';
import {
  compassPoint,
  nearbyEntries,
  nearbySection,
  positionOf,
  recordLabel,
} from './nearby.js';

const item = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
const plain = (value) => ({ mainsnak: { datavalue: { value } } });

// Trimmed from wbgetentities for Malmen Airbase (Q6744357), 2026-10-05.
const MALMEN = {
  id: 'Q6744357',
  labels: { en: { value: 'Malmen Airbase' } },
  descriptions: {
    en: { value: 'Swedish Air Force base in Malmslatt, Sweden' },
  },
  claims: {
    P31: [item('Q695850'), item('Q1248784')],
    P17: [item('Q34')],
    P137: [item('Q783911')],
    P571: [plain({ time: '+1912-01-01T00:00:00Z', precision: 9 })],
    P2044: [
      plain({ amount: '+308', unit: 'http://www.wikidata.org/entity/Q3710' }),
    ],
    P18: [plain('SK 60 Malmen.JPG')],
  },
  sitelinks: { enwiki: { title: 'Malmen Airbase' } },
};
const LABELS = {
  Q695850: { labels: { en: { value: 'air base' }, es: { value: 'base aérea' } } },
  Q1248784: { labels: { en: { value: 'airport' } } },
  Q34: { labels: { es: { value: 'Suecia' }, en: { value: 'Sweden' } } },
  Q783911: { labels: { en: { value: 'Swedish Air Force' } } },
};

test('a site record yields its Wikidata id from tags or a wd: id', () => {
  assert.equal(
    siteWikidataId({ properties: { tags: { wikidata: 'q6744357' } } }),
    'Q6744357',
  );
  assert.equal(siteWikidataId({ id: 'wd:Q1029360', properties: {} }), 'Q1029360');
  assert.equal(siteWikidataId({ properties: { tags: { wikidata: 'nope' } } }), '');
});

test('Wikidata times, images and facts read at their stated precision', () => {
  assert.equal(wikidataTime({ time: '+1912-01-01T00:00:00Z', precision: 9 }), '1912');
  assert.equal(wikidataTime({ time: '+1985-06-00T00:00:00Z', precision: 10 }), '1985-06');
  assert.equal(wikidataTime({ time: '+1985-06-21T00:00:00Z', precision: 11 }), '1985-06-21');
  assert.deepEqual(commonsImage('SK 60 Malmen.JPG'), {
    src: 'https://commons.wikimedia.org/wiki/Special:FilePath/SK_60_Malmen.JPG?width=640',
    link: 'https://commons.wikimedia.org/wiki/File:SK_60_Malmen.JPG',
    credit: 'Wikimedia Commons',
  });
  assert.equal(commonsImage('../evil'), null);

  const facts = siteFactsFromEntity(MALMEN, LABELS, ['es', 'en']);
  assert.equal(facts.label, 'Malmen Airbase');
  assert.equal(facts.items.P31, 'base aérea, airport');
  assert.equal(facts.items.P17, 'Suecia');
  assert.equal(facts.items.P137, 'Swedish Air Force');
  assert.equal(facts.inception, '1912');
  assert.equal(facts.elevation, '94 m', 'feet are converted to metres');
  assert.equal(facts.wikipedia.href, 'https://en.wikipedia.org/wiki/Malmen_Airbase');
  const rows = siteWikidataRows(facts).filter((row) => row.value);
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Description', 'Instance of', 'Country', 'Operator', 'Opened', 'Elevation', 'Wikipedia'],
  );
});

test('nameplate capacity in megawatts reads as MW', () => {
  const facts = siteFactsFromEntity({
    id: 'Q1029360',
    claims: {
      P2109: [
        plain({ amount: '+2160', unit: 'http://www.wikidata.org/entity/Q6982035' }),
      ],
    },
  });
  assert.equal(facts.capacity, '2,160 MW');
});

test('the site lookup makes two keyless calls and survives a missing entity', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const ids = new URL(url).searchParams.get('ids');
    const entities = ids === 'Q6744357' ? { Q6744357: MALMEN } : LABELS;
    return Response.json({ entities });
  };
  const facts = await fetchSiteWikidata({ wikidata: 'Q6744357', fetchImpl, languages: ['en'] });
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.startsWith('https://www.wikidata.org/w/api.php?')));
  assert.ok(urls.every((url) => new URL(url).searchParams.get('origin') === '*'));
  assert.equal(facts.items.P17, 'Sweden');
  assert.equal(await fetchSiteWikidata({ wikidata: 'bad', fetchImpl }), null);
  const missing = await fetchSiteWikidata({
    wikidata: 'Q1',
    fetchImpl: async () => Response.json({ entities: { Q1: { id: 'Q1', missing: '' } } }),
  });
  assert.equal(missing, null);
});

test('the site dossier shows Wikidata facts, photo and article', () => {
  const payload = { ...siteFactsFromEntity(MALMEN, LABELS, ['en']), fetchedAt: 5 };
  const model = buildSiteIntelModel({
    subject: { id: 'base-1', layerId: 'strategic-military-bases' },
    live: {
      id: 'base-1',
      layerId: 'strategic-military-bases',
      latitude: 58.4,
      longitude: 15.5,
      properties: { name: 'Malmen', class: 'air_base', tags: { wikidata: 'Q6744357' } },
    },
    payload,
  });
  const wikidata = model.sections.find((section) => section.heading === 'WIKIDATA');
  assert.ok(wikidata.rows.some((row) => row.label === 'Operator' && row.value === 'Swedish Air Force'));
  assert.equal(model.photo.credit, 'Wikimedia Commons');
  assert.ok(model.links.some((link) => link.href === 'https://en.wikipedia.org/wiki/Malmen_Airbase'));
  assert.equal(model.fetchedAt, 5);
});

test('event markers map to their layer, and cyclone pieces to the storm', () => {
  assert.equal(eventLayerFor('earthquake:us7000abcd').layerId, 'earthquakes');
  assert.equal(eventLayerFor('aircraft:abc'), null);
  assert.equal(eventSelectionId('cyclone:al052026:cone:3'), 'cyclone:al052026:center');
  const context = eventContextFor({
    id: 'earthquake:us7000abcd',
    properties: { mag: 5.24, place: '42 km SW of Anchorage' },
    position: { lat: 61.02, lon: -150.41 },
  });
  assert.equal(context.layerId, 'earthquakes');
  assert.equal(context.label, 'M5.2 · 42 km SW of Anchorage');
  assert.equal(context.latitude, 61.02);
  assert.equal(
    eventContextFor({ id: 'earthquake:x', properties: {}, position: null }),
    null,
  );
});

test('an earthquake dossier reads PAGER, tsunami flag, intensities and USGS links', () => {
  const now = Date.UTC(2026, 9, 5, 12);
  const model = buildEventIntelModel({
    subject: { id: 'earthquake:us1', layerId: 'earthquakes' },
    live: {
      id: 'earthquake:us1',
      layerId: 'earthquakes',
      layerName: 'Earthquakes (24h)',
      source: 'USGS',
      latitude: 61.02,
      longitude: -150.41,
      properties: {
        mag: 6.4,
        magType: 'mww',
        place: 'Alaska Peninsula',
        time: now - 30 * 60_000,
        depth: 35.2,
        alert: 'orange',
        tsunami: true,
        felt: 120,
        cdi: 5.4,
        mmi: 6.6,
        status: 'reviewed',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1',
      },
    },
    nowMs: now,
  });
  assert.equal(model.kind, 'event');
  assert.equal(model.title, 'M6.4 · Alaska Peninsula');
  assert.deepEqual(
    model.badges.map((badge) => badge.label),
    ['PAGER ORANGE', 'TSUNAMI FLAG', 'REVIEWED'],
  );
  const rows = Object.fromEntries(model.sections.flatMap((s) => s.rows).map((r) => [r.label, r.value]));
  assert.equal(rows.Magnitude, '6.4 mww');
  assert.equal(rows.Depth, '35.2 km · shallow');
  assert.equal(rows['Max reported intensity'], 'V');
  assert.equal(rows['ShakeMap intensity'], 'VII');
  assert.match(rows.Time, /30 min ago$/);
  assert.deepEqual(
    model.links.map((link) => link.label),
    ['USGS event page', 'ShakeMap', 'Did You Feel It?'],
  );
});

test('fire, disaster, conflict, cyclone and GPS cells get their own dossier', () => {
  const now = Date.UTC(2026, 9, 5, 12);
  const build = (layerId, properties) =>
    buildEventIntelModel({
      subject: { id: `${layerId}:1`, layerId },
      live: { id: `${layerId}:1`, layerId, latitude: 40, longitude: -3, properties },
      nowMs: now,
    });
  const fire = build('local-firms', {
    frp: 42.5,
    confidence: 'high',
    confidencePct: 93,
    brightness: 345.1,
    acquired: now - 2 * 3_600_000,
    sensor: 'VIIRS',
    satellite: 'N20',
    daynight: 'night',
  });
  assert.equal(fire.title, 'Fire · FRP 42.5 MW');
  assert.ok(fire.links[0].href.startsWith('https://firms.modaps.eosdis.nasa.gov/map/'));
  const disaster = build('disaster-alerts', {
    title: 'Flood in Valencia',
    level: 'red',
    type: 'Flood',
    link: 'https://www.gdacs.org/report.aspx?eventid=1',
    source: 'GDACS',
  });
  assert.equal(disaster.badges[0].label, 'RED ALERT');
  assert.equal(disaster.links[0].label, 'GDACS report');
  const conflict = build('conflict-events', { kind: 'Battles', fatalities: 3, source: 'UCDP' });
  assert.ok(conflict.badges.some((badge) => badge.label === '3 FATALITIES'));
  const storm = build('weather-cyclones', {
    name: 'ALPHA',
    classification: 'HU',
    windKt: 120,
    pressureHpa: 940,
    movementDeg: 315,
    movementKt: 12,
    advisoryUrl: 'https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/x.shtml',
  });
  assert.equal(storm.title, 'Hurricane ALPHA');
  assert.equal(storm.badges[0].label, 'CATEGORY 4');
  const gps = build('gps-interference', { level: 'high', total: 20, bad: 9, ratio: 0.45 });
  const gpsRows = Object.fromEntries(gps.sections[0].rows.map((r) => [r.label, r.value]));
  assert.equal(gpsRows['Degraded share'], '45%');
  assert.equal(saffirSimpson(63), '');
  assert.equal(saffirSimpson(140), 'Category 5');
  assert.equal(timeAgo(now - 3 * 86_400_000, now), '3 d ago');
});

test('nearby lists the closest records per layer, skips the subject and orbits', () => {
  const origin = { lat: 40.4168, lon: -3.7038 };
  const collections = [
    {
      layerId: 'earthquakes',
      name: 'Earthquakes',
      records: [
        { id: 'self', lat: 40.4168, lon: -3.7038, magnitude: 4.1 },
        { id: 'q1', lat: 40.5, lon: -3.7, magnitude: 3.2, place: 'Madrid' },
        { id: 'far', lat: 42, lon: -3.7 },
      ],
    },
    {
      layerId: 'cctv',
      name: 'Cameras',
      records: [
        { id: 'madrid-01314', name: 'Callao', lat: 40.42, lon: -3.7055 },
        { id: 'madrid-2', name: 'Two', lat: 40.43, lon: -3.7 },
        { id: 'madrid-3', name: 'Three', lat: 40.44, lon: -3.7 },
        { id: 'madrid-4', name: 'Four', lat: 40.45, lon: -3.7 },
      ],
    },
    { layerId: 'satellites', name: 'Satellites', records: [{ id: 's', lat: 40.4, lon: -3.7 }] },
  ];
  const entries = nearbyEntries(origin, collections, { subjectLayerId: 'earthquakes' });
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['Callao', 'Two', 'Three', 'M3.2 Madrid'],
  );
  assert.equal(entries[0].cameraId, 'madrid-01314');
  const section = nearbySection(entries);
  assert.equal(section.heading, 'NEARBY · 50 KM');
  assert.match(section.rows[0].value, /^Callao · \d+ m [NESW]+$/);
  assert.deepEqual(section.rows[0].fly, { lat: 40.42, lon: -3.7055 });
  assert.equal(section.rows[0].camera, 'madrid-01314');
  assert.equal(nearbySection([]), null);
  assert.equal(compassPoint(350), 'N');
  assert.equal(compassPoint(135), 'SE');
  assert.deepEqual(positionOf({ latitude: 1, longitude: 2 }), { lat: 1, lon: 2 });
  assert.equal(recordLabel({ callsign: 'IBE123' }), 'IBE123');
});
