import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ibi511RowToSource,
  iowaFeatureToSource,
  nztaFeatureToSource,
  parseHongKongCameras,
  parseMadridCameras,
  parseWktPoint,
  safeHlsUrl,
  packCap,
} from '../../server/providers/cctv/packs.js';
import { caltransStreamUrl } from '../../server/providers/cctv/sources.js';
import { resolveCatalogCap } from '../../server/providers/cctv/cap.js';
import {
  IBI_511_SITES,
  CCTV_MAX_SOURCES_CEILING,
  DEFAULT_CCTV_MAX_SOURCES,
} from '../../server/providers/cctv/constants.js';

const site = (pack) => IBI_511_SITES.find((entry) => entry.pack === pack);

// Trimmed from https://www.nvroads.com/List/GetData/Cameras (2026-10-01).
const nevadaRow = {
  images: [
    {
      id: 7391,
      description: 'I-15 at Flamingo',
      imageUrl: '/map/Cctv/7391',
      videoUrl:
        'https://d1wse3.its.nv.gov/vegasxcd03/d84c424f-d6bb-44df-9c77-5fb45dcb5caf_lvflirxcd03_public.stream/playlist.m3u8',
      videoType: 'application/x-mpegURL',
      isVideoAuthRequired: false,
      videoDisabled: false,
      disabled: false,
      blocked: false,
    },
  ],
  roadway: 'I-15',
  direction: 'Northbound',
  location: 'I-15 at Flamingo',
  latLng: {
    geography: { wellKnownText: 'POINT (-115.181818 36.115113)' },
  },
};

// Trimmed from https://511ga.org/List/GetData/Cameras (video is auth-gated).
const georgiaRow = {
  images: [
    {
      id: 18551,
      description: 'BART-0209: SR 140 at Princeton Blvd (BARTOW)',
      videoUrl:
        'https://sfs-msc-pub-lq-01.navigator.dot.ga.gov:443/rtplive/BART-CCTV-0209/playlist.m3u8',
      videoType: 'application/x-mpegURL',
      isVideoAuthRequired: true,
      videoDisabled: false,
      disabled: false,
      blocked: false,
    },
  ],
  roadway: 'SR 140',
  direction: 'Eastbound',
  latLng: { geography: { wellKnownText: 'POINT (-84.91445 34.37697)' } },
};

test('IBI 511 rows: open streams go live, auth-gated streams stay frames', () => {
  const nevada = ibi511RowToSource(nevadaRow, site('nv511'));
  assert.equal(nevada.id, 'nv511-7391');
  assert.equal(nevada.feedType, 'hls');
  assert.match(
    nevada.url,
    /^https:\/\/d1wse3\.its\.nv\.gov\/.+playlist\.m3u8$/,
  );
  assert.equal(nevada.snapshotUrl, 'https://www.nvroads.com/map/Cctv/7391');
  assert.equal(nevada.headingConfidence, 'high');
  assert.equal(nevada.headingDeg, 0);

  const georgia = ibi511RowToSource(georgiaRow, site('ga511'));
  assert.equal(georgia.feedType, 'image');
  assert.equal(georgia.url, 'https://511ga.org/map/Cctv/18551');
  assert.equal(georgia.lat, 34.37697);
  assert.equal(georgia.headingDeg, 90);
});

test('IBI 511 rows outside the site bounds, disabled or unplaced are dropped', () => {
  const nv = site('nv511');
  assert.equal(
    ibi511RowToSource(
      {
        ...nevadaRow,
        latLng: { geography: { wellKnownText: 'POINT (2 41)' } },
      },
      nv,
    ),
    null,
  );
  assert.equal(
    ibi511RowToSource(
      { ...nevadaRow, images: [{ ...nevadaRow.images[0], disabled: true }] },
      nv,
    ),
    null,
  );
  assert.equal(ibi511RowToSource({ ...nevadaRow, latLng: null }, nv), null);
});

test('HLS URLs must be HTTPS playlists without credentials', () => {
  assert.equal(safeHlsUrl('http://x.example/a.m3u8'), '');
  assert.equal(safeHlsUrl('https://u:p@x.example/a.m3u8'), '');
  assert.equal(safeHlsUrl('https://x.example/a.mp4'), '');
  assert.equal(
    safeHlsUrl('https://x.example/live/a.m3u8'),
    'https://x.example/live/a.m3u8',
  );
  assert.deepEqual(parseWktPoint('POINT (-84.9 34.3)'), {
    lat: 34.3,
    lon: -84.9,
  });
  assert.equal(parseWktPoint('POINT (500 10)'), null);
});

test('Iowa DOT features: pinned frame host and video hosts', () => {
  const feature = {
    attributes: {
      device_id: 1,
      COMMON_ID: 'CBTV74',
      Desc_: 'CB - I-680 @ MM 1.1 (130th St)',
      ImageURL:
        'https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/cbtv74hd.jpeg',
      VideoURL:
        'https://video2.iowadot.gov:8888/councilbluffs/cbtv74lb/playlist.m3u8',
      latitude: 41.3,
      longitude: -95.9,
      REGION: 'Council Bluffs',
    },
  };
  const camera = iowaFeatureToSource(feature);
  assert.equal(camera.id, 'iowa-cbtv74');
  assert.equal(camera.feedType, 'hls');
  assert.equal(camera.snapshotUrl, feature.attributes.ImageURL);
  const offHost = iowaFeatureToSource({
    attributes: {
      ...feature.attributes,
      VideoURL: 'https://evil.example/live/playlist.m3u8',
    },
  });
  assert.equal(offHost.feedType, 'image');
  assert.equal(
    iowaFeatureToSource({
      attributes: {
        ...feature.attributes,
        ImageURL: 'https://evil.example/a.jpg',
      },
    }),
    null,
  );
});

test('Hong Kong TD XML parses into pinned still-frame cameras', () => {
  const xml = `<?xml version="1.0"?><image-list><image><key>H429F</key><region>Hong Kong Island</region><district>Southern</district><description>Aberdeen Praya Road near Fish Market [H429F]</description><latitude>22.24845</latitude><longitude>114.1505</longitude><url>https://tdcctv.data.one.gov.hk/H429F.JPG</url></image><image><key>../x</key><latitude>22.3</latitude><longitude>114.1</longitude></image></image-list>`;
  const cameras = parseHongKongCameras(xml);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].id, 'hk-h429f');
  assert.equal(cameras[0].name, 'Aberdeen Praya Road near Fish Market');
  assert.equal(cameras[0].url, 'https://tdcctv.data.one.gov.hk/H429F.JPG');
});

test('NZTA features skip offline cameras and pin frames to trafficnz.info', () => {
  const feature = {
    type: 'Feature',
    properties: {
      ExternalId: 706,
      Name: 'SH1 WBB Groynes Dr South',
      Offline: 0,
      UnderMaintenance: 0,
    },
    geometry: { type: 'Point', coordinates: [172.61162, -43.449229] },
  };
  const camera = nztaFeatureToSource(feature);
  assert.equal(camera.url, 'https://www.trafficnz.info/camera/706.jpg');
  assert.equal(
    nztaFeatureToSource({
      ...feature,
      properties: { ...feature.properties, Offline: 1 },
    }),
    null,
  );
});

test('Caltrans live streams are pinned to the official streaming host', () => {
  assert.equal(
    caltransStreamUrl({
      imageData: {
        streamingVideoURL:
          'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8',
      },
    }),
    'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8',
  );
  for (const bad of [
    'https://evil.example/D7/x.m3u8',
    'http://wzmedia.dot.ca.gov/D7/x.m3u8',
    'https://wzmedia.dot.ca.gov/D7/x.mp4',
    '',
  ])
    assert.equal(
      caltransStreamUrl({ imageData: { streamingVideoURL: bad } }),
      '',
    );
});

test('catalog ceiling admits the larger PANOPTES catalog', () => {
  assert.ok(DEFAULT_CCTV_MAX_SOURCES >= 15000);
  assert.ok(CCTV_MAX_SOURCES_CEILING >= DEFAULT_CCTV_MAX_SOURCES);
  assert.equal(resolveCatalogCap(undefined), DEFAULT_CCTV_MAX_SOURCES);
  assert.equal(resolveCatalogCap(10 ** 9), CCTV_MAX_SOURCES_CEILING);
  const previous = process.env.CCTV_GA511_MAX_SOURCES;
  process.env.CCTV_GA511_MAX_SOURCES = '3';
  assert.equal(packCap('GA511', 2500), 8);
  process.env.CCTV_GA511_MAX_SOURCES = 'abc';
  assert.equal(packCap('GA511', 2500), 2500);
  if (previous === undefined) delete process.env.CCTV_GA511_MAX_SOURCES;
  else process.env.CCTV_GA511_MAX_SOURCES = previous;
});

test('Madrid Informo KML parses into pinned still-frame cameras with surveyed poses', () => {
  const kml = `<kml><Document>
    <Placemark><description>&lt;img src=https://informo.madrid.es/cameras/Camara01314.jpg?v=22060 /&gt;</description>
      <ExtendedData><Data name="Numero"><Value>01314</Value></Data><Data name="Nombre"><Value>CALLAO - GRAN VIA</Value></Data></ExtendedData>
      <Point><coordinates>-3.70549647487068,40.4201376524201,10 </coordinates></Point></Placemark>
    <Placemark><ExtendedData><Data name="Numero"><Value>06303</Value></Data><Data name="Nombre"><Value>PLAZA DE CASTILLA (NORTE)</Value></Data></ExtendedData>
      <Point><coordinates>-3.68894207537291,40.466063829633,10 </coordinates></Point></Placemark>
    <Placemark><ExtendedData><Data name="Numero"><Value>../x</Value></Data></ExtendedData>
      <Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>
    <Placemark><ExtendedData><Data name="Numero"><Value>99999</Value></Data></ExtendedData>
      <Point><coordinates>2.17,41.38,0</coordinates></Point></Placemark>
  </Document></kml>`;
  const cameras = parseMadridCameras(kml);
  assert.equal(cameras.length, 2);
  const callao = cameras[0];
  assert.equal(callao.id, 'madrid-01314');
  assert.equal(callao.name, 'Callao - Gran Via');
  assert.equal(callao.url, 'https://informo.madrid.es/cameras/Camara01314.jpg');
  assert.equal(callao.headingDeg, 105);
  assert.equal(callao.headingConfidence, 'high');
  assert.equal(cameras[1].name, 'Plaza de Castilla (Norte)');
  assert.equal(cameras[1].headingConfidence, 'low');
});
