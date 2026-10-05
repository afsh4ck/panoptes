import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ibi511RowToSource,
  iowaFeatureToSource,
  nztaFeatureToSource,
  ibi511ImageLabel,
  icelandCaptionHeading,
  icelandCameraToSource,
  qldWebcamToSource,
  parseHongKongCameras,
  parseMadridCameras,
  parseDgtCameras,
  parseCataloniaCameras,
  cataloniaFrameUrl,
  euskadiFrameUrl,
  euskadiCameraToSource,
  utmToLatLon,
  parseSpainCityCameras,
  parseWktPoint,
  safeHlsUrl,
  packCap,
} from '../../server/providers/cctv/packs.js';
import { caltransStreamUrl } from '../../server/providers/cctv/sources.js';
import { resolveCatalogCap } from '../../server/providers/cctv/cap.js';
import {
  IBI_511_SITES,
  SPAIN_CITY_SITES,
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

test('DGT DATEX II devices parse into still frames on etraffic.dgt.es', () => {
  const device = (id, body) =>
    `<ns2:device xsi:type="fse:ExtendedDevice" id="${id}" version="2">${body}</ns2:device>`;
  const camera = (
    lat,
    lon,
    province,
    url = 'https://etraffic.dgt.es/camarasEtraffic/x.jpg',
  ) =>
    `<ns2:typeOfDevice>camera</ns2:typeOfDevice>
     <loc:roadDestination>A CORUÑA</loc:roadDestination><loc:roadName>A-6</loc:roadName>
     <loc:latitude>${lat}</loc:latitude><loc:longitude>${lon}</loc:longitude>
     <lse:kilometerPoint>290.9</lse:kilometerPoint><lse:province>${province}</lse:province>
     <fse:deviceUrl>${url}</fse:deviceUrl>`;
  const xml = [
    device(176134, camera(42.2278, -5.8148, 'LEÓN')),
    device(176134, camera(42.2278, -5.8148, 'LEÓN')),
    device(2, camera(43.3, -8.4, 'CORUÑA, A')),
    device(3, camera(42.4, -2.4, 'RIOJA, LA')),
    device(4, camera(39.57, 2.65, 'BALEARS, ILLES')),
    device(5, camera(48.85, 2.35, 'PARÍS')),
    device(6, camera(40.4, -3.7, 'MADRID', '')),
    device(7, '<ns2:typeOfDevice>variableMessageSign</ns2:typeOfDevice>'),
  ].join('');
  const cameras = parseDgtCameras(xml);
  assert.deepEqual(
    cameras.map((c) => c.id),
    ['dgt-176134', 'dgt-2', 'dgt-3', 'dgt-4'],
  );
  const leon = cameras[0];
  assert.equal(leon.name, 'A-6 · PK 290.9 → A Coruña');
  assert.equal(leon.city, 'León');
  assert.equal(leon.cityId, 'es-leon');
  assert.equal(leon.url, 'https://etraffic.dgt.es/camarasEtraffic/176134.jpg');
  assert.equal(leon.feedType, 'image');
  assert.deepEqual(
    cameras.slice(1).map((c) => [c.city, c.cityId]),
    [
      ['A Coruña', 'es-a-coruna'],
      ['La Rioja', 'es-la-rioja'],
      ['Illes Balears', 'es-illes-balears'],
    ],
  );
});

test('Catalan camera links are rebuilt on their official hosts', () => {
  assert.deepEqual(
    cataloniaFrameUrl(
      'http://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc87.gif',
    ),
    {
      frameUrl:
        'http://mct.gencat.cat/mct2bo/TransitCamera?nom=nc87.gif&visualitzacio=imatge',
      key: 'sct-nc87',
    },
  );
  for (const bad of [
    'https://app.mobilitat.ad/gifs/stacoloma.gif?a=1',
    'http://mct.gencat.cat.evil.example/mct2bo/RenderService?sctidcam=x.gif',
    'http://www.bcn.cat/transit/imatges/../x.gif',
    'http://emap.terrassa.cat/it_terrassa/cam01.jpeg',
    '',
  ])
    assert.equal(cataloniaFrameUrl(bad), null);
});

test('Servei Català de Trànsit GML parses SCT, Barcelona and Terrassa cameras', () => {
  const member = (lon, lat, fields) =>
    `<gml:featureMember><cite:cameres><cite:geom><gml:Point><gml:coordinates decimal="." cs="," ts=" ">${lon},${lat}</gml:coordinates></gml:Point></cite:geom>${fields}</cite:cameres></gml:featureMember>`;
  const sct =
    '<cite:link>http://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc87.gif</cite:link><cite:font>SCT</cite:font>';
  const xml = `<wfs:FeatureCollection>${[
    member(
      2.1849528,
      41.45989301,
      `<cite:carretera>C-58</cite:carretera><cite:municipi>Nus Trinitat</cite:municipi><cite:pk>0.50</cite:pk>${sct}`,
    ),
    member(
      2.1849528,
      41.45989301,
      `<cite:carretera>C-58</cite:carretera>${sct}`,
    ),
    member(
      2.18207217,
      41.38141543,
      '<cite:carretera>Plaça Antonio López</cite:carretera><cite:municipi>Barcelona</cite:municipi><cite:link>http://www.bcn.cat/transit/imatges/PlAntonioLopez.gif?a=1</cite:link><cite:font>IMI</cite:font>',
    ),
    member(
      2.00746247,
      41.5569824,
      '<cite:carretera>Pl Dore</cite:carretera><cite:municipi>Terrassa</cite:municipi><cite:link>https://emap.terrassa.cat/it_terrassa/cam01.jpeg?a=1 &#13;\n</cite:link><cite:font>Terrassa</cite:font>',
    ),
    member(
      1.50065231,
      42.49383514,
      '<cite:carretera>Av. Santa Coloma</cite:carretera><cite:municipi>Andorra</cite:municipi><cite:link>https://app.mobilitat.ad/gifs/stacoloma.gif?a=1</cite:link><cite:font>Andorra</cite:font>',
    ),
  ].join('')}</wfs:FeatureCollection>`;
  const cameras = parseCataloniaCameras(xml);
  assert.deepEqual(
    cameras.map((c) => [c.id, c.name, c.city, c.provider]),
    [
      [
        'cat-sct-nc87',
        'C-58 · PK 0.5 · Nus Trinitat',
        'Nus Trinitat',
        'Servei Català de Trànsit',
      ],
      [
        'cat-bcn-plantoniolopez',
        'Plaça Antonio López',
        'Barcelona',
        'Ajuntament de Barcelona',
      ],
      ['cat-terrassa-cam01', 'Pl Dore', 'Terrassa', 'Ajuntament de Terrassa'],
    ],
  );
  assert.equal(cameras[0].lat, 41.45989301);
  assert.equal(cameras[0].lon, 2.1849528);
  assert.equal(
    cameras[1].url,
    'https://www.bcn.cat/transit/imatges/PlAntonioLopez.gif',
  );
  assert.equal(
    cameras[2].url,
    'https://emap.terrassa.cat/it_terrassa/cam01.jpeg',
  );
});

test('inverse UTM lands on the zone 30 central meridian and Basque cameras', () => {
  const origin = utmToLatLon(500000, 4649776.225, 30);
  assert.ok(Math.abs(origin.lat - 42) < 1e-7);
  assert.ok(Math.abs(origin.lon + 3) < 1e-9);
  const kukularra = utmToLatLon(503178.8, 4794665.86, 30);
  assert.ok(Math.abs(kukularra.lat - 43.304817) < 1e-6);
  assert.ok(Math.abs(kukularra.lon + 2.960806) < 1e-6);
});

test('Open Data Euskadi rows: frames rehomed, UTM placed, dead links dropped', () => {
  assert.equal(
    euskadiFrameUrl('https://www.trafikoa.eus/static/files/tr/camaras/819.jpg'),
    'https://apps.trafikoa.euskadi.eus/static/files/tr/camaras/819.jpg',
  );
  assert.equal(
    euskadiFrameUrl('http://www.trafikoa.net/static/files/tr/camaras/807.jpg'),
    'https://apps.trafikoa.euskadi.eus/static/files/tr/camaras/807.jpg',
  );
  assert.equal(
    euskadiFrameUrl('http://www.bizkaimove.com/camaras/cam1.jpg'),
    'https://www.bizkaimove.eus/camaras/cam1.jpg',
  );
  for (const bad of [
    'https://www.bilbao.eus/camarastrafico/codec0004/snap_c1.jpg',
    'https://www.vitoria-gasteiz.org/c11-01w/cameras?action=get&id=CAM30',
    'https://trafikoa.eus.evil.example/static/files/tr/camaras/1.jpg',
    'not a url',
  ])
    assert.equal(euskadiFrameUrl(bad), null);

  const iurreta = euskadiCameraToSource({
    cameraId: '1',
    sourceId: '1',
    cameraName: 'Iurreta',
    urlImage: 'https://www.trafikoa.eus/static/files/tr/camaras/819.jpg',
    latitude: '43.18725',
    longitude: '-2.673754',
    road: 'A-8',
    kilometer: '91.000',
  });
  assert.equal(iurreta.id, 'euskadi-1-1');
  assert.equal(iurreta.name, 'Iurreta · A-8 PK 91');
  assert.equal(iurreta.provider, 'Gobierno Vasco · Trafikoa');
  assert.equal(iurreta.lat, 43.18725);

  const kukularra = euskadiCameraToSource({
    cameraId: '77',
    sourceId: '2',
    cameraName: 'CCTV 300 - Cámara DOMO nudo Kukularra',
    urlImage: 'http://www.bizkaimove.com/camaras/cam1.jpg',
    latitude: '4794665.86',
    longitude: '503178.8',
    road: 'BI - 637',
    kilometer: '008+500',
  });
  assert.equal(kukularra.id, 'euskadi-2-77');
  assert.equal(kukularra.name, 'Cámara DOMO nudo Kukularra · BI-637 PK 8.5');
  assert.equal(kukularra.city, 'Bizkaia');
  assert.equal(kukularra.provider, 'Diputación Foral de Bizkaia');
  assert.ok(Math.abs(kukularra.lat - 43.3048) < 1e-4);

  // The same camera number in another source is another camera.
  assert.equal(
    euskadiCameraToSource({
      cameraId: '1',
      sourceId: '7',
      urlImage: 'http://www.trafikoa.net/static/files/tr/camaras/807.jpg',
      latitude: '43.29769',
      longitude: '-1.986157',
    }).id,
    'euskadi-7-1',
  );
  for (const row of [
    {
      cameraId: '4',
      sourceId: '5',
      urlImage: 'https://www.bilbao.eus/camarastrafico/codec0004/snap_c1.jpg',
      latitude: '43.2575',
      longitude: '-2.9413',
    },
    {
      cameraId: '9',
      sourceId: '1',
      urlImage: 'https://www.trafikoa.eus/static/files/tr/camaras/9.jpg',
      latitude: '',
      longitude: '',
    },
  ])
    assert.equal(euskadiCameraToSource(row), null);
});

const city = (pack) => SPAIN_CITY_SITES.find((site) => site.pack === pack);

test('Spanish city feeds: frames rebuilt on each official origin', () => {
  const malaga = parseSpainCityCameras(city('malaga'), {
    features: [
      {
        geometry: { coordinates: [-4.539063, 36.72406291, 0] },
        properties: {
          NOMBRE: 'TV87-EL BONI - CAMPANILLAS',
          URLIMAGEN:
            'https://ctraficomovilidad.malaga.eu/recursos/movilidad/camaras_trafico/TV-87.jpg\t',
        },
      },
      {
        geometry: { coordinates: [-4.53, 36.72] },
        properties: { URLIMAGEN: 'https://evil.example/x.jpg' },
      },
    ],
  });
  assert.deepEqual(
    malaga.map((c) => [c.id, c.name, c.url]),
    [
      [
        'malaga-tv-87',
        'El Boni - Campanillas',
        'https://ctraficomovilidad.malaga.eu/recursos/movilidad/camaras_trafico/TV-87.jpg',
      ],
    ],
  );

  const vitoria = parseSpainCityCameras(city('vitoria'), {
    features: [
      {
        id: 'CM06_ROI_4',
        geometry: { coordinates: [-2.67493, 42.8616] },
        properties: { nombre: 'Aguirrelanda-Portal de Arriaga' },
      },
      { id: '../CM01', geometry: { coordinates: [-2.67, 42.86] } },
    ],
  });
  assert.deepEqual(
    vitoria.map((c) => [c.id, c.url, c.provider]),
    [
      [
        'vitoria-cm06_roi_4',
        'https://www.vitoria-gasteiz.org/c11-01w/cameras?action=get&id=CM06_ROI_4',
        'Ayuntamiento de Vitoria-Gasteiz',
      ],
    ],
  );

  const vigo = parseSpainCityCameras(city('vigo'), {
    features: [
      {
        properties: {
          id: '05',
          nombre: 'Castelao - Grove',
          url: 'http://camaras.vigo.org/webcam/camv2.php?id=05',
          lat: 42.21836,
          lon: -8.74407,
        },
      },
      { properties: { id: '05&x=1', lat: 42.2, lon: -8.7 } },
    ],
  });
  assert.deepEqual(
    vigo.map((c) => [c.id, c.url]),
    [['vigo-05', 'https://camaras.vigo.org/webcam/camv2.php?id=05']],
  );

  const camara = (lat, lon, file) =>
    `<Camara><Posicion><Latitud>${lat}</Latitud><Longitud>${lon}</Longitud></Posicion><Nombre>${file}</Nombre><Fichero>${file}.jpg</Fichero><URL>www.mc30.es/xml-data/imagenes_camaras/${file}.jpg</URL></Camara>`;
  const calle30 = parseSpainCityCameras(
    city('calle30'),
    `<Camaras>${[
      camara(40.40376974, -3.66657048, '09NC39TV01'),
      camara(40.40376974, -3.66657048, '09NC39TV01'),
      camara(40.4245, -3.6648, 'M30-PK07+600D(ODONNELL)'),
      camara(40.42, -3.66, '../x'),
    ].join('')}</Camaras>`,
  );
  assert.deepEqual(
    calle30.map((c) => [c.id, c.name, c.url]),
    [
      [
        'calle30-09nc39tv01',
        'Calle 30 · 09NC39TV01',
        'https://mc30.es/xml-data/imagenes_camaras/09NC39TV01.jpg',
      ],
      [
        'calle30-m30-pk07-600d-odonnell',
        'M-30 PK 7.6 · ODONNELL',
        'https://mc30.es/xml-data/imagenes_camaras/M30-PK07+600D(ODONNELL).jpg',
      ],
    ],
  );
  assert.equal(calle30[0].cityId, 'madrid');
});

test('MeteoGalicia cameras key on their image folder, not the station', () => {
  const row = (name, folder, lat, lon) => ({
    concello: 'Bueu',
    identificador: 10904,
    imaxeCamara: `https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/${folder}/ultima.jpg`,
    lat,
    lon,
    nomeCamara: name,
    provincia: 'Pontevedra',
  });
  const cameras = parseSpainCityCameras(city('meteogalicia'), {
    listaCamaras: [
      row('Ons Praia', 'Onsplaya', 42.376904, -8.932206),
      row('Ons Porto', 'Onspuerto', 42.37694, -8.932135),
      {
        ...row('Off host', 'X', 42.3, -8.9),
        imaxeCamara:
          'https://evil.example/datosred/camaras/MeteoGalicia/X/ultima.jpg',
      },
      row('Lisboa', 'Lisboa', 38.72, -9.14),
    ],
  });
  assert.deepEqual(
    cameras.map((c) => [c.id, c.name, c.city, c.cityId]),
    [
      ['meteogalicia-onsplaya', 'Ons Praia', 'Bueu', 'es-pontevedra'],
      ['meteogalicia-onspuerto', 'Ons Porto', 'Bueu', 'es-pontevedra'],
    ],
  );
  assert.equal(
    cameras[1].url,
    'https://www.meteogalicia.gal/datosred/camaras/MeteoGalicia/Onspuerto/ultima.jpg',
  );
});

test('every Spanish city site is a distinct pack with an https catalog', () => {
  const packs = SPAIN_CITY_SITES.map((site) => site.pack);
  assert.equal(new Set(packs).size, packs.length);
  for (const site of SPAIN_CITY_SITES) {
    assert.match(site.url, /^https:\/\//);
    assert.match(site.frameOrigin, /^https:\/\//);
    assert.ok(site.bounds.south < site.bounds.north);
    assert.ok(site.bounds.west < site.bounds.east);
  }
});

test('IBI 511 labels skip placeholders, device codes and lane notes', () => {
  assert.equal(ibi511ImageLabel('I-15 at Flamingo'), 'I-15 at Flamingo');
  assert.equal(ibi511ImageLabel('N/A'), '');
  assert.equal(ibi511ImageLabel('C134'), '');
  assert.equal(
    ibi511ImageLabel('Traffic closest to the camera is traveling EAST'),
    '',
  );
  // Trimmed from https://www.511.gnb.ca/List/GetData/Cameras (2026-10-05).
  const camera = ibi511RowToSource(
    {
      images: [{ id: 1, description: 'N/A', imageUrl: '/map/Cctv/1' }],
      direction: 'Unknown',
      location: 'Aroostook River Route 2',
      latLng: {
        geography: { wellKnownText: 'POINT (-67.7337566 46.8186082)' },
      },
    },
    site('nb511'),
  );
  assert.equal(camera.name, 'Aroostook River Route 2');
  assert.equal(camera.url, 'https://www.511.gnb.ca/map/Cctv/1');
});

test('IBI 511 sites are unique packs; Alberta pages in 50s', () => {
  const packs = IBI_511_SITES.map((entry) => entry.pack);
  assert.equal(new Set(packs).size, packs.length);
  assert.equal(
    new Set(IBI_511_SITES.map((entry) => entry.env)).size,
    packs.length,
  );
  for (const entry of IBI_511_SITES)
    assert.match(entry.host, /^https:\/\/[^/]+$/);
  assert.equal(site('ab511').pageSize, 50);
  assert.equal(site('nc511').host, 'https://www.drivenc.gov');
});

test('Vegagerðin captions give a bearing only for compass words', () => {
  assert.equal(icelandCaptionHeading('Hellisheiði séð til vesturs'), 270);
  assert.equal(icelandCaptionHeading('Lónsbakki til norðurs'), 0);
  assert.equal(icelandCaptionHeading('Fjarðarheiði til norðausturs'), 45);
  assert.equal(icelandCaptionHeading('Kambar til suðvesturs'), 225);
  assert.ok(
    Number.isNaN(icelandCaptionHeading('Hellisheiði séð til Reykjavíkur')),
  );
  assert.ok(Number.isNaN(icelandCaptionHeading('Lónsbakki')));
});

test('Vegagerðin rows: frame file is the id, pinned to vegagerdin.is', () => {
  // Trimmed from https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1 (2026-10-05).
  const row = {
    Maelist_nr: 7001,
    Myndavel: 'Hellisheiði',
    NrVegur: '1',
    Skyring: 'Hellisheiði séð til vesturs',
    Slod: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg',
    Breidd: 64.018296,
    Lengd: -21.342636,
  };
  const camera = icelandCameraToSource(row);
  assert.equal(camera.id, 'iceland-hellisheidi_1');
  assert.equal(camera.headingDeg, 270);
  assert.equal(camera.headingConfidence, 'high');
  assert.equal(camera.road, '1');
  const down = icelandCameraToSource({
    ...row,
    Skyring: 'Hellisheiði séð niður á veg',
    Slod: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_3.jpg',
  });
  assert.equal(down.pitchDeg, -55);
  assert.equal(down.headingConfidence, 'low');
  assert.equal(
    icelandCameraToSource({ ...row, Slod: 'https://example.com/a.jpg' }),
    null,
  );
  assert.equal(
    icelandCameraToSource({ ...row, Breidd: 40.4, Lengd: -3.7 }),
    null,
  );
});

test('QLDTraffic webcams face their published direction', () => {
  // Trimmed from https://api.qldtraffic.qld.gov.au/v1/webcams (2026-10-05).
  const feature = {
    geometry: { coordinates: [153.0086975, -27.5551796] },
    properties: {
      id: 1,
      description: 'Archerfield - Ipswich Motorway & Granard Rd - North',
      direction: 'NorthEast',
      locality: 'Archerfield',
      image_url:
        'https://cameras.qldtraffic.qld.gov.au/Metropolitan/Archerfield_Ipswich_Mwy_sth.jpg',
    },
  };
  const camera = qldWebcamToSource(feature);
  assert.equal(camera.id, 'qld-1');
  assert.equal(camera.headingDeg, 45);
  assert.equal(camera.city, 'Archerfield');
  assert.equal(
    qldWebcamToSource({
      ...feature,
      properties: {
        ...feature.properties,
        image_url: 'https://example.com/x.jpg',
      },
    }),
    null,
  );
});
