import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGdacsRss } from './gdacs.js';
import { normalizeEonetGeojson } from './eonet.js';
import { disastersProxy } from './disasters.js';

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
<channel>
<item>
  <title>Green flood alert in Thailand</title>
  <description>On 05/10/2026, a flood started in Thailand &amp; nearby.</description>
  <link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=1104169</link>
  <pubDate>Wed, 30 Sep 2026 12:20:31 GMT</pubDate>
  <gdacs:datemodified>Fri, 18 Sep 2026 06:16:34 GMT</gdacs:datemodified>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <gdacs:fromdate>Mon, 05 Oct 2026 01:00:00 GMT</gdacs:fromdate>
  <gdacs:todate>Wed, 07 Oct 2026 01:00:00 GMT</gdacs:todate>
  <geo:Point><geo:lat>17.1053568</geo:lat><geo:long>98.9953943</geo:long></geo:Point>
  <gdacs:bbox>94.9953943 102.9953943 13.1053568 21.1053568</gdacs:bbox>
  <gdacs:eventtype>FL</gdacs:eventtype>
  <gdacs:alertlevel>Green</gdacs:alertlevel>
  <gdacs:alertscore>1</gdacs:alertscore>
  <gdacs:eventid>1104169</gdacs:eventid>
  <gdacs:episodeid>1</gdacs:episodeid>
  <gdacs:severity unit="" value="0">Magnitude 0 </gdacs:severity>
  <gdacs:population unit="Population Affected" value="0">0 deaths </gdacs:population>
  <gdacs:iso3>THA</gdacs:iso3>
  <gdacs:country>Thailand</gdacs:country>
</item>
<item>
  <title>Red earthquake alert (M 7.2)</title>
  <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=99</link>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <geo:Point><geo:lat>-5.5</geo:lat><geo:long>150.2</geo:long></geo:Point>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:alertlevel>Red</gdacs:alertlevel>
  <gdacs:alertscore>3</gdacs:alertscore>
  <gdacs:eventid>99</gdacs:eventid>
  <gdacs:episodeid>2</gdacs:episodeid>
  <gdacs:severity unit="M" value="7.2">Magnitude 7.2M, Depth:10km</gdacs:severity>
  <gdacs:population unit="Exposed" value="12000">12000 people</gdacs:population>
  <gdacs:country>Papua New Guinea</gdacs:country>
</item>
<item>
  <title>Same quake older episode</title>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <geo:Point><geo:lat>-5.5</geo:lat><geo:long>150.2</geo:long></geo:Point>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:alertlevel>Orange</gdacs:alertlevel>
  <gdacs:eventid>99</gdacs:eventid>
  <gdacs:episodeid>1</gdacs:episodeid>
</item>
<item>
  <title>Archived cyclone</title>
  <gdacs:iscurrent>false</gdacs:iscurrent>
  <geo:Point><geo:lat>10</geo:lat><geo:long>10</geo:long></geo:Point>
  <gdacs:eventtype>TC</gdacs:eventtype>
  <gdacs:alertlevel>Green</gdacs:alertlevel>
  <gdacs:eventid>7</gdacs:eventid>
</item>
<item>
  <title>No coordinates</title>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <gdacs:eventtype>DR</gdacs:eventtype>
  <gdacs:eventid>8</gdacs:eventid>
</item>
</channel></rss>`;

test('GDACS RSS parser keeps current geolocated events, latest episode wins', () => {
  const rows = parseGdacsRss(RSS);
  assert.equal(rows.length, 2);
  const flood = rows.find((row) => row.id === 'gdacs:FL1104169');
  assert.equal(flood.type, 'FL');
  assert.equal(flood.level, 'green');
  assert.equal(flood.lat, 17.1053568);
  assert.equal(flood.country, 'Thailand');
  assert.equal(flood.iso3, 'THA');
  assert.equal(
    flood.link,
    'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104169',
  );
  assert.match(flood.description, /Thailand & nearby/);
  assert.deepEqual(
    flood.bbox,
    [94.9953943, 102.9953943, 13.1053568, 21.1053568],
  );
  assert.equal(flood.from, '2026-10-05T01:00:00.000Z');
  assert.equal(flood.updated, '2026-09-18T06:16:34.000Z');
  const quake = rows.find((row) => row.id === 'gdacs:EQ99');
  assert.equal(quake.level, 'red');
  assert.equal(quake.episode, 2);
  assert.equal(quake.severity.value, 7.2);
  assert.equal(quake.severity.unit, 'M');
  assert.equal(quake.population.value, 12000);
  assert.equal(parseGdacsRss(RSS, { includeArchived: true }).length, 3);
  assert.deepEqual(parseGdacsRss(''), []);
});

test('EONET folding keeps the latest geometry per event', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'EONET_1',
          title: 'Hurricane Rachel',
          date: '2026-09-27T18:00:00Z',
          magnitudeValue: 35,
          magnitudeUnit: 'kts',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          sources: [{ id: 'JTWC', url: 'https://example.com/rachel' }],
          closed: null,
        },
        geometry: { type: 'Point', coordinates: [-98.9, 12.7] },
      },
      {
        type: 'Feature',
        properties: {
          id: 'EONET_1',
          title: 'Hurricane Rachel',
          date: '2026-09-28T00:00:00Z',
          magnitudeValue: 40,
          magnitudeUnit: 'kts',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          sources: [],
          closed: null,
        },
        geometry: { type: 'Point', coordinates: [-99.5, 12.8] },
      },
      {
        type: 'Feature',
        properties: {
          id: 'EONET_2',
          title: 'Wildfire',
          date: '2026-09-20T00:00:00Z',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10],
            ],
          ],
        },
      },
      { type: 'Feature', properties: { id: 'EONET_3' }, geometry: null },
    ],
  };
  const rows = normalizeEonetGeojson(geojson);
  assert.equal(rows.length, 2);
  const rachel = rows.find((row) => row.id === 'eonet:EONET_1');
  assert.equal(rachel.lon, -99.5);
  assert.equal(rachel.type, 'storm');
  assert.equal(rachel.level, 'info');
  assert.equal(rachel.severity.text, '40 kts');
  assert.equal(rachel.link, 'https://example.com/rachel');
  const fire = rows.find((row) => row.id === 'eonet:EONET_2');
  assert.equal(fire.type, 'wildfire');
  assert.equal(fire.lat, 10.8);
  assert.equal(fire.lon, 10.8);
});

function fakeResponse() {
  const chunks = [];
  return {
    destroyed: false,
    status: 0,
    headers: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      chunks.push(body);
    },
    body: () => JSON.parse(chunks.join('')),
  };
}

test('disasters proxy merges upstreams, serves cache and names a failed source', async () => {
  let eonetCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('gdacs')) return new Response(RSS);
    eonetCalls += 1;
    return new Response('nope', { status: 500 });
  };
  const plugin = disastersProxy({ fetchImpl, now: () => 1_000 });
  const res = fakeResponse();
  await plugin._handler({ method: 'GET', url: '/', socket: {} }, res);
  assert.equal(res.status, 200);
  const payload = res.body();
  assert.equal(payload.rows.length, 2);
  assert.equal(payload.rows[0].level, 'red');
  assert.equal(payload.degraded, 'EONET unavailable');
  assert.deepEqual(payload.counts, { GDACS: 2, EONET: 0 });
  assert.equal(res.headers['X-Disasters-Cache'], 'MISS');
  const again = fakeResponse();
  await plugin._handler({ method: 'GET', url: '/', socket: {} }, again);
  assert.equal(again.headers['X-Disasters-Cache'], 'HIT');
  assert.equal(eonetCalls, 1);
  const post = fakeResponse();
  await plugin._handler({ method: 'POST', url: '/', socket: {} }, post);
  assert.equal(post.status, 405);
});
