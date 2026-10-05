export const DEFAULT_CCTV_SOURCE_FILE = 'config/cctv_sources.austin.json';
/** Austin Open Data portal endpoint for traffic camera records. */
export const DEFAULT_AUSTIN_ROWS_URL =
  'https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD';
/** Default cap on Austin cameras after distance-based prioritization. */
export const DEFAULT_AUSTIN_MAX_SOURCES = 250;
/**
 * Catalog-wide safety ceiling on served cameras. Each pack already caps
 * itself (nearest-to-anchor first); this bound only matters when the packs
 * together exceed it, and it is then filled round-robin across packs (see
 * cap.js) so no region is silently dropped. The default packs offer more
 * than this, so the largest ones (Caltrans and the Georgia and Florida 511
 * sites) are thinned to an equal share; every other pack, the Spanish ones
 * included, loads whole.
 */
export const DEFAULT_CCTV_MAX_SOURCES = 21500;
/** Hard upper bound for CCTV_MAX_SOURCES; also sizes the health map. Billboards
 * share one collection and coverage geometry is built only for the visible
 * set, so the client stays responsive at this size. */
export const CCTV_MAX_SOURCES_CEILING = 30000;
/** Reference point for Austin camera prioritization (Congress & 6th). */
export const AUSTIN_DOWNTOWN = { lat: 30.2672, lon: -97.7431 };
/** Caltrans CCTV: one JSON feed per district, identical schema statewide. */
/** TxDOT ITS: one keyless JSON catalog per district (25 districts statewide). */
export const TXDOT_ORIGIN = 'https://its.txdot.gov';
export const TXDOT_CCTV_STATUS_URL = (district) =>
  `${TXDOT_ORIGIN}/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=${encodeURIComponent(district)}`;
/** Per-camera frame. Returns JSON `{snippet:<base64 jpeg>}`, not an image body;
 * media.js decodes it (fetchTxdotSnapshot) and only for this origin. */
export const TXDOT_CCTV_SNAPSHOT_URL = `${TXDOT_ORIGIN}/its/DistrictIts/GetCctvSnapshotByIcdId`;
/** Valid TxDOT district codes (the ITS map's own districtCodes list). */
export const TXDOT_DISTRICTS = new Set([
  'ABL',
  'AMA',
  'ATL',
  'AUS',
  'BMT',
  'BWD',
  'BRY',
  'CHS',
  'CRP',
  'DAL',
  'ELP',
  'FTW',
  'HOU',
  'LRD',
  'LBB',
  'LFK',
  'ODA',
  'PAR',
  'PHR',
  'SJT',
  'SAT',
  'TYL',
  'WAC',
  'WFS',
  'YKM',
]);
/** Districts fetched by default: Austin (the reference camera city) and San
 * Antonio. A statewide default was rejected: per-pack prioritization is
 * nearest-to-any-anchor, so Dallas's dense core would take most slots.
 * CCTV_TXDOT_DISTRICTS opens up the rest ("AUS,SAT,HOU,DAL,FTW" for the five
 * big metros, or any of the 25 codes). */
export const DEFAULT_TXDOT_DISTRICTS = 'AUS,SAT';
export const DEFAULT_TXDOT_MAX_SOURCES = 500;
/** Prioritization anchors: downtown cores of the metro districts a user can
 * select. Cameras rank by distance to the NEAREST anchor, so a widened
 * CCTV_TXDOT_DISTRICTS still ranks sensibly instead of against Austin alone. */
export const TXDOT_ANCHORS = [
  { lat: 30.2672, lon: -97.7431 }, // Austin
  { lat: 29.4241, lon: -98.4936 }, // San Antonio
  { lat: 29.7604, lon: -95.3698 }, // Houston
  { lat: 32.7767, lon: -96.797 }, // Dallas
  { lat: 32.7555, lon: -97.3308 }, // Fort Worth
];
/** Ground-elevation priors in metres, by district. The TxDOT payload carries
 * no elevation, and on a keyless (no-tileset) stack the client's ground snap
 * never fires, so this prior is the only height a camera gets there. Texas
 * spans sea level (Houston) to ~1,140 m (El Paso). */
export const TXDOT_DISTRICT_ELEVATION_M = Object.freeze({
  ABL: 520,
  AMA: 1099,
  ATL: 105,
  AUS: 149,
  BMT: 5,
  BWD: 425,
  BRY: 111,
  CHS: 250,
  CRP: 7,
  DAL: 131,
  ELP: 1140,
  FTW: 199,
  HOU: 15,
  LRD: 132,
  LBB: 992,
  LFK: 91,
  ODA: 890,
  PAR: 185,
  PHR: 30,
  SJT: 585,
  SAT: 198,
  TYL: 165,
  WAC: 143,
  WFS: 289,
  YKM: 70,
});
export const TXDOT_DEFAULT_ELEVATION_M = 150;
export const CALTRANS_CCTV_URL = (district) =>
  `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
/** Districts fetched by default: all twelve (statewide, ~3,400 in service). */
export const DEFAULT_CALTRANS_DISTRICTS = '1,2,3,4,5,6,7,8,9,10,11,12';
export const DEFAULT_CALTRANS_MAX_SOURCES = 3500;
/** Upper bound for CCTV_CALTRANS_MAX_SOURCES. */
export const CALTRANS_MAX_SOURCES_CEILING = 4000;
/** Caltrans live video: HLS on one official streaming host (~2,100 cameras). */
export const CALTRANS_STREAM_ORIGIN = 'https://wzmedia.dot.ca.gov';
/** Prioritization anchors: metro cores across the state. */
export const CALTRANS_ANCHORS = [
  { lat: 37.7793, lon: -122.4193 }, // San Francisco
  { lat: 34.0537, lon: -118.2428 }, // Los Angeles
  { lat: 32.7157, lon: -117.1611 }, // San Diego
  { lat: 38.5816, lon: -121.4944 }, // Sacramento
  { lat: 36.7378, lon: -119.7871 }, // Fresno
  { lat: 33.9806, lon: -117.3755 }, // Riverside
  { lat: 33.7455, lon: -117.8677 }, // Santa Ana
  { lat: 40.8021, lon: -124.1637 }, // Eureka
  { lat: 35.2828, lon: -120.6596 }, // San Luis Obispo
  { lat: 37.9577, lon: -121.2908 }, // Stockton
];
/** TfL JamCams: one keyless list endpoint; frames live on a public S3 bucket. */
export const TFL_JAMCAM_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';
export const TFL_IMAGE_ORIGIN =
  'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';
export const DEFAULT_TFL_MAX_SOURCES = 250;
export const LONDON_CENTER = { lat: 51.5074, lon: -0.1278 };
/** Ontario 511: keyless CARS/511 camera catalog; frame URLs are still images. */
export const ONTARIO_511_CAMERAS_URL =
  'https://511on.ca/api/v2/get/cameras?format=json&lang=en';
export const ONTARIO_511_IMAGE_ORIGIN = 'https://511on.ca/map/Cctv/';
export const DEFAULT_ONTARIO_MAX_SOURCES = 1000;
export const ONTARIO_ANCHORS = [
  { lat: 43.4516, lon: -80.4925 }, // Kitchener
  { lat: 43.6532, lon: -79.3832 }, // Toronto
  { lat: 45.4215, lon: -75.6972 }, // Ottawa
  { lat: 43.2557, lon: -79.8711 }, // Hamilton
  { lat: 42.9849, lon: -81.2453 }, // London, Ontario
  { lat: 42.3149, lon: -83.0364 }, // Windsor
];
/** Fintraffic road weather cameras (Digitraffic): one keyless GeoJSON list
 * covering all of Finland. Each STATION carries N presets (fixed camera views)
 * that share the station position; one preset is one camera here. */
export const FINTRAFFIC_STATIONS_URL =
  'https://tie.digitraffic.fi/api/weathercam/v1/stations';
/** Frames: `<origin><presetId>.jpg`. Preset ids are synthesized into this
 * origin rather than read from the payload, so no upstream field can steer the
 * frame proxy off-host. */
export const FINTRAFFIC_IMAGE_ORIGIN = 'https://weathercam.digitraffic.fi/';
/** Digitraffic asks every client to identify itself on API calls. */
export const DIGITRAFFIC_USER = 'gods-eye-view';
export const DEFAULT_FINTRAFFIC_MAX_SOURCES = 300;
/** Ground-elevation prior, in metres, for stations that report no altitude.
 * 228 of 809 stations carry a real metre value (median 94 m); the rest report
 * 0, which means "not reported" rather than sea level — Kouvola (~80 m of real
 * elevation) reports 0. The observed median stands in for those. */
export const FINTRAFFIC_GROUND_ELEVATION_M = 90;
/** Prioritization anchors: the population centres strung along Finland's main
 * road spine (vt1 Turku, vt3 Tampere, vt4 Jyväskylä–Oulu–Rovaniemi, vt5
 * Kuopio), so a cap keeps national coverage rather than just the capital. */
export const FINLAND_ANCHORS = [
  { lat: 60.1699, lon: 24.9384 }, // Helsinki
  { lat: 60.4518, lon: 22.2666 }, // Turku
  { lat: 61.4978, lon: 23.761 }, // Tampere
  { lat: 62.2426, lon: 25.7473 }, // Jyväskylä
  { lat: 62.8924, lon: 27.677 }, // Kuopio
  { lat: 65.0121, lon: 25.4651 }, // Oulu
  { lat: 66.5039, lon: 25.7294 }, // Rovaniemi
];
/** Global cap on total CCTV sources served by the proxy: the default per-pack
 * caps summed (Austin 250 + Caltrans 300 + TfL 250 + DriveBC 250). */
/** DriveBC highway cameras (British Columbia): the keyless camera list served by
 * the DriveBC.ca site (github.com/bcgov/DriveBC.ca). The DataBC HighwayCams CSV
 * lists the same cameras but still carries retired images.drivebc.ca frame URLs,
 * so frames are built from the numeric camera id on the current image host. */
export const DRIVEBC_WEBCAMS_URL = 'https://www.drivebc.ca/api/webcams/';
export const DRIVEBC_IMAGE_URL = (id) =>
  `https://www.drivebc.ca/images/${id}.jpg`;
export const DEFAULT_DRIVEBC_MAX_SOURCES = 250;
/** Prioritization anchors: downtown Vancouver and Victoria. */
export const DRIVEBC_ANCHORS = [
  { lat: 49.2827, lon: -123.1207 }, // Vancouver
  { lat: 48.4284, lon: -123.3656 }, // Victoria
];
/** Tallinn intersection cameras: curated catalog + public stills on ristmikud.tallinn.ee. */
export const DEFAULT_TALLINN_SOURCE_FILE = 'config/cctv_sources.tallinn.json';
export const DEFAULT_TALLINN_MAX_SOURCES = 255;
export const TALLINN_IMAGE_ORIGIN = 'https://ristmikud.tallinn.ee/';
export const TALLINN_CENTER = { lat: 59.437, lon: 24.753 };
/** Transpordiamet / Tarktee road-weather cameras: keyless DATEX2 feeds. */
export const TARKTEE_LOCATIONS_URL =
  'https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraLocations';
export const TARKTEE_IMAGES_URL =
  'https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraImages';
export const TARKTEE_IMAGE_ORIGIN = 'https://tarktee.transpordiamet.ee/images/';
export const DEFAULT_TARKTEE_MAX_SOURCES = 179;
export const TARKTEE_ANCHORS = [
  { lat: 59.437, lon: 24.753 }, // Tallinn
  { lat: 58.378, lon: 26.729 }, // Tartu
  { lat: 58.3859, lon: 24.4971 }, // Pärnu
  { lat: 59.3797, lon: 28.1791 }, // Narva
];
/** Warendorf (Germany): the Marktplatz municipal webcam from a curated catalog file. */
export const DEFAULT_WARENDORF_SOURCE_FILE =
  'config/cctv_sources.warendorf.json';
export const WARENDORF_IMAGE_ORIGINS = Object.freeze([
  'http://webcam.warendorf.de/',
  'https://www.kreis-warendorf.de/',
]);
/** Live Traffic NSW (Transport for NSW): keyless public camera catalog. */
export const NSW_CAMERAS_URL =
  'https://data.livetraffic.com/cameras/traffic-cam.json';
export const NSW_IMAGE_ORIGIN = 'https://webcams.transport.nsw.gov.au/';
export const DEFAULT_NSW_MAX_SOURCES = 250;
export const SYDNEY_CENTER = { lat: -33.8688, lon: 151.2093 };
/**
 * The NSW webcam host answers non-browser clients with HTTP 200 and a short
 * HTML body instead of the frame (verified 2026-09-13), so the proxy
 * identifies as a browser for that one host. See media.js.
 */
export const NSW_IMAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/**
 * Longest NSW `view` sentence still usable as a label. NSW occasionally
 * repurposes `view` for a multi-paragraph works notice; real descriptions top
 * out around 120 characters.
 */
export const NSW_MAX_VIEW_LABEL = 140;
/** Open Calgary traffic cameras: one keyless Socrata endpoint for the whole
 * city; frames are stills on a City of Calgary host. */
export const DEFAULT_CALGARY_ROWS_URL =
  'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=500';
/** The only origin Calgary camera frames may come from. The catalog publishes
 * most rows as `http://`; that host serves HTTPS and 301-redirects to it, so
 * URLs are upgraded and then pinned here before registration. */
export const CALGARY_IMAGE_ORIGIN = 'https://trafficcam.calgary.ca/';
export const DEFAULT_CALGARY_MAX_SOURCES = 220;
/** Centre Street / 7 Avenue: the prioritization anchor. */
export const CALGARY_DOWNTOWN = { lat: 51.0461, lon: -114.0626 };
/** Hard ceiling on the Calgary catalog body. The whole city is ~215 rows and
 * under 100 KB; this only exists so an upstream that streams an unbounded
 * body cannot be buffered without limit. */
export const CALGARY_MAX_CATALOG_BYTES = 4 * 1024 * 1024;

/** DelDOT CCTV: one keyless statewide JSON catalog; live video via RTMP-over-HTTP (rtmpt:80). */
export const DELDOT_CCTV_URL = 'https://tmc.deldot.gov/json/videocamera.json';
export const DEFAULT_DELDOT_MAX_SOURCES = 300;
export const DELDOT_ANCHORS = [
  { lat: 39.7459, lon: -75.5466 }, // Wilmington (New Castle)
  { lat: 39.1582, lon: -75.5244 }, // Dover (Kent)
  { lat: 38.6906, lon: -75.3877 }, // Georgetown (Sussex)
];
/** Camera CATALOGS change rarely; 15 min keeps multi-megabyte upstream list refetches (Austin rows.json + 4 Caltrans districts + TfL + Ontario 511) infrequent. Frames are fetched per-request and are unaffected. */
export const CCTV_SOURCE_CACHE_MS = 15 * 60 * 1000;
/** Per-provider catalog-fetch timeout. Bounds the worst-case refresh so one
 * stalled upstream can't leave getCctvSources (and thus every CCTV route)
 * pending forever — a hung fetch aborts, the loader returns [], and
 * serve-stale/other packs take over. */
// Twenty-odd packs download in parallel at startup; slower catalogs (Austin,
// TfL, DriveBC) need headroom so they are not dropped from the catalog.
export const CCTV_SOURCE_FETCH_TIMEOUT_MS = 40 * 1000;
/** Individual CCTV image fetches must settle before the active 10-second
 * client refresh cadence. A bounded miss can fall through to Street View or
 * the synthetic frame instead of leaving the browser preview pending. */
export const CCTV_FRAME_FETCH_TIMEOUT_MS = 8 * 1000;

/** Maximum buffered snapshot size. */
export const CCTV_FRAME_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Deadline for upstream response headers; live bodies keep streaming afterward. */
export const CCTV_MEDIA_FETCH_TIMEOUT_MS = 15 * 1000;
/** Silence a live body may carry before the relay gives up on it. Twice the
 * header deadline, because a camera that is merely slow between frames is far
 * more common than one that has died mid-stream, and a viewer would rather
 * wait than be dropped. */
export const CCTV_MEDIA_IDLE_TIMEOUT_MS = 30 * 1000;
/** Declared size ceiling for fixed media responses. */
export const CCTV_MEDIA_MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Public 511 traveler-information sites on the IBI/Arcadis platform (the same
 * engine as Ontario 511). Each publishes a keyless camera list at
 * `/List/GetData/Cameras` (DataTables JSON, 100 rows per page) and frames at
 * `/map/Cctv/<imageId>`. Some also publish an open HLS stream per camera;
 * streams flagged `isVideoAuthRequired` need a session token from the site
 * and are left as still frames.
 */
export const IBI_511_PAGE_SIZE = 100;
/* A site may set its own `pageSize` when it rejects longer pages. */
/** Bounds the paging loop: 80 pages = 8,000 cameras per site. */
export const IBI_511_MAX_PAGES = 80;
/** Pages fetched in parallel per site. */
export const IBI_511_PAGE_CONCURRENCY = 4;
export const IBI_511_SITES = Object.freeze([
  Object.freeze({
    pack: 'ga511',
    env: 'GA511',
    host: 'https://511ga.org',
    provider: 'Georgia 511 (GDOT)',
    region: 'Georgia',
    bounds: [30.3, -85.7, 35.1, -80.7],
    defaultMax: 2500,
    anchors: [
      { lat: 33.749, lon: -84.388 }, // Atlanta
      { lat: 32.0809, lon: -81.0912 }, // Savannah
      { lat: 32.4609, lon: -84.9877 }, // Columbus
      { lat: 33.4735, lon: -82.0105 }, // Augusta
    ],
    elevationM: 250,
  }),
  Object.freeze({
    pack: 'fl511',
    env: 'FL511',
    host: 'https://fl511.com',
    provider: 'FL511 (FDOT)',
    region: 'Florida',
    bounds: [24.3, -87.7, 31.1, -79.8],
    defaultMax: 3000,
    anchors: [
      { lat: 25.7617, lon: -80.1918 }, // Miami
      { lat: 28.5384, lon: -81.3789 }, // Orlando
      { lat: 27.9506, lon: -82.4572 }, // Tampa
      { lat: 30.3322, lon: -81.6557 }, // Jacksonville
      { lat: 30.4383, lon: -84.2807 }, // Tallahassee
    ],
    elevationM: 10,
  }),
  Object.freeze({
    pack: 'pa511',
    env: 'PA511',
    host: 'https://www.511pa.com',
    provider: '511PA (PennDOT)',
    region: 'Pennsylvania',
    bounds: [39.6, -80.6, 42.3, -74.6],
    defaultMax: 1600,
    anchors: [
      { lat: 39.9526, lon: -75.1652 }, // Philadelphia
      { lat: 40.4406, lon: -79.9959 }, // Pittsburgh
      { lat: 40.2732, lon: -76.8867 }, // Harrisburg
    ],
    elevationM: 200,
  }),
  Object.freeze({
    pack: 'az511',
    env: 'AZ511',
    host: 'https://az511.com',
    provider: 'AZ511 (ADOT)',
    region: 'Arizona',
    bounds: [31.2, -115.0, 37.1, -108.9],
    defaultMax: 700,
    anchors: [
      { lat: 33.4484, lon: -112.074 }, // Phoenix
      { lat: 32.2226, lon: -110.9747 }, // Tucson
      { lat: 35.1983, lon: -111.6513 }, // Flagstaff
    ],
    elevationM: 400,
  }),
  Object.freeze({
    pack: 'nv511',
    env: 'NV511',
    host: 'https://www.nvroads.com',
    provider: 'NVRoads (NDOT)',
    region: 'Nevada',
    bounds: [35.0, -120.1, 42.1, -113.9],
    defaultMax: 700,
    anchors: [
      { lat: 36.1699, lon: -115.1398 }, // Las Vegas
      { lat: 39.5296, lon: -119.8138 }, // Reno
    ],
    elevationM: 1200,
  }),
  Object.freeze({
    pack: 'la511',
    env: 'LA511',
    host: 'https://511la.org',
    provider: '511LA (LADOTD)',
    region: 'Louisiana',
    bounds: [28.8, -94.1, 33.1, -88.7],
    defaultMax: 400,
    anchors: [
      { lat: 29.9511, lon: -90.0715 }, // New Orleans
      { lat: 30.4515, lon: -91.1871 }, // Baton Rouge
      { lat: 32.5252, lon: -93.7502 }, // Shreveport
    ],
    elevationM: 10,
  }),
  Object.freeze({
    pack: 'id511',
    env: 'ID511',
    host: 'https://511.idaho.gov',
    provider: 'Idaho 511 (ITD)',
    region: 'Idaho',
    bounds: [41.9, -117.3, 49.1, -111.0],
    defaultMax: 500,
    anchors: [
      { lat: 43.615, lon: -116.2023 }, // Boise
      { lat: 47.6777, lon: -116.7805 }, // Coeur d'Alene
      { lat: 42.5629, lon: -114.4609 }, // Twin Falls
    ],
    elevationM: 900,
  }),
  Object.freeze({
    pack: 'ak511',
    env: 'AK511',
    host: 'https://511.alaska.gov',
    provider: 'Alaska 511 (DOT&PF)',
    region: 'Alaska',
    bounds: [51.0, -180.0, 71.6, -129.9],
    defaultMax: 200,
    anchors: [
      { lat: 61.2181, lon: -149.9003 }, // Anchorage
      { lat: 64.8378, lon: -147.7164 }, // Fairbanks
      { lat: 58.3019, lon: -134.4197 }, // Juneau
    ],
    elevationM: 100,
  }),
  Object.freeze({
    pack: 'ne511',
    env: 'NE511',
    host: 'https://www.newengland511.org',
    provider: 'New England 511',
    region: 'New England',
    bounds: [40.9, -73.8, 47.5, -66.9],
    defaultMax: 450,
    anchors: [
      { lat: 42.3601, lon: -71.0589 }, // Boston
      { lat: 43.6591, lon: -70.2568 }, // Portland, ME
      { lat: 44.4759, lon: -73.2121 }, // Burlington, VT
      { lat: 43.2081, lon: -71.5376 }, // Concord, NH
    ],
    elevationM: 80,
  }),
  Object.freeze({
    pack: 'nc511',
    env: 'NC511',
    host: 'https://www.drivenc.gov',
    provider: 'DriveNC (NCDOT)',
    region: 'North Carolina',
    bounds: [33.7, -84.4, 36.7, -75.3],
    defaultMax: 1200,
    anchors: [
      { lat: 35.2271, lon: -80.8431 }, // Charlotte
      { lat: 35.7796, lon: -78.6382 }, // Raleigh
      { lat: 36.0726, lon: -79.792 }, // Greensboro
      { lat: 35.5951, lon: -82.5515 }, // Asheville
      { lat: 34.2104, lon: -77.8868 }, // Wilmington
    ],
    elevationM: 200,
  }),
  Object.freeze({
    pack: 'ct511',
    env: 'CTROADS',
    host: 'https://ctroads.org',
    provider: 'CTroads (CTDOT)',
    region: 'Connecticut',
    bounds: [40.9, -73.8, 42.1, -71.7],
    defaultMax: 400,
    anchors: [
      { lat: 41.7658, lon: -72.6734 }, // Hartford
      { lat: 41.3083, lon: -72.9279 }, // New Haven
      { lat: 41.1865, lon: -73.1952 }, // Bridgeport
      { lat: 41.0534, lon: -73.5387 }, // Stamford
    ],
    elevationM: 50,
  }),
  Object.freeze({
    pack: 'ab511',
    env: 'AB511',
    host: 'https://511.alberta.ca',
    provider: '511 Alberta',
    region: 'Alberta',
    /** 511.alberta.ca answers HTTP 500 to pages longer than 50 rows. */
    pageSize: 50,
    bounds: [48.9, -120.1, 60.1, -109.9],
    defaultMax: 400,
    anchors: [
      { lat: 51.0447, lon: -114.0719 }, // Calgary
      { lat: 53.5461, lon: -113.4938 }, // Edmonton
      { lat: 52.2681, lon: -113.8112 }, // Red Deer
      { lat: 49.6956, lon: -112.8451 }, // Lethbridge
    ],
    elevationM: 900,
  }),
  Object.freeze({
    pack: 'ns511',
    env: 'NS511',
    host: 'https://511.novascotia.ca',
    provider: '511 Nova Scotia',
    region: 'Nova Scotia',
    bounds: [43.3, -66.5, 47.1, -59.6],
    defaultMax: 100,
    anchors: [
      { lat: 44.6488, lon: -63.5752 }, // Halifax
      { lat: 45.3669, lon: -63.2654 }, // Truro
      { lat: 46.1368, lon: -60.1942 }, // Sydney, NS
    ],
    elevationM: 40,
  }),
  Object.freeze({
    pack: 'nb511',
    env: 'NB511',
    host: 'https://www.511.gnb.ca',
    provider: '511 New Brunswick',
    region: 'New Brunswick',
    bounds: [44.5, -69.1, 48.1, -63.7],
    defaultMax: 100,
    anchors: [
      { lat: 46.0878, lon: -64.7782 }, // Moncton
      { lat: 45.2733, lon: -66.0633 }, // Saint John
      { lat: 45.9636, lon: -66.6431 }, // Fredericton
    ],
    elevationM: 60,
  }),
  Object.freeze({
    pack: 'sk511',
    env: 'SK511',
    host: 'https://hotline.gov.sk.ca',
    provider: 'Saskatchewan Highway Hotline',
    region: 'Saskatchewan',
    bounds: [48.9, -110.1, 60.1, -101.3],
    defaultMax: 100,
    anchors: [
      { lat: 50.4452, lon: -104.6189 }, // Regina
      { lat: 52.1332, lon: -106.67 }, // Saskatoon
    ],
    elevationM: 550,
  }),
  Object.freeze({
    pack: 'mb511',
    env: 'MB511',
    host: 'https://www.manitoba511.ca',
    provider: 'Manitoba 511',
    region: 'Manitoba',
    bounds: [48.9, -102.1, 60.1, -88.9],
    defaultMax: 100,
    anchors: [
      { lat: 49.8951, lon: -97.1384 }, // Winnipeg
      { lat: 49.8485, lon: -99.95 }, // Brandon
    ],
    elevationM: 240,
  }),
  Object.freeze({
    pack: 'nl511',
    env: 'NL511',
    host: 'https://www.511nl.ca',
    provider: '511 Newfoundland and Labrador',
    region: 'Newfoundland and Labrador',
    bounds: [46.5, -67.9, 60.5, -52.5],
    defaultMax: 100,
    anchors: [
      { lat: 47.5615, lon: -52.7126 }, // St. John's
      { lat: 48.9564, lon: -54.6089 }, // Gander
      { lat: 48.95, lon: -57.9522 }, // Corner Brook
    ],
    elevationM: 60,
  }),
  Object.freeze({
    pack: 'yt511',
    env: 'YT511',
    host: 'https://511yukon.ca',
    provider: '511 Yukon',
    region: 'Yukon',
    bounds: [59.9, -141.1, 69.7, -123.8],
    defaultMax: 50,
    anchors: [
      { lat: 60.7212, lon: -135.0568 }, // Whitehorse
    ],
    elevationM: 700,
  }),
  Object.freeze({
    pack: 'pe511',
    env: 'PE511',
    host: 'https://511.gov.pe.ca',
    provider: '511 PEI',
    region: 'Prince Edward Island',
    bounds: [45.9, -64.5, 47.1, -61.9],
    defaultMax: 30,
    anchors: [
      { lat: 46.2382, lon: -63.1311 }, // Charlottetown
    ],
    elevationM: 20,
  }),
]);

/** Iowa DOT traffic cameras: keyless ArcGIS feature service; ~700 publish live
 * fMP4 HLS on videoN.iowadot.gov, frames on atmsqf.iowadot.gov. */
export const IOWA_CAMERAS_URL =
  'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query';
export const IOWA_IMAGE_HOST = 'atmsqf.iowadot.gov';
/** Video hosts look like video2.iowadot.gov:8888. */
export const IOWA_VIDEO_HOST_PATTERN =
  /^video\d{1,2}\.iowadot\.gov(?::\d{2,5})?$/;
export const DEFAULT_IOWA_MAX_SOURCES = 1300;
export const IOWA_ANCHORS = [
  { lat: 41.5868, lon: -93.625 }, // Des Moines
  { lat: 41.9779, lon: -91.6656 }, // Cedar Rapids
  { lat: 41.2619, lon: -95.8608 }, // Council Bluffs / Omaha
  { lat: 41.5236, lon: -90.5776 }, // Davenport
];

/** Hong Kong Transport Department traffic snapshots (DATA.GOV.HK, keyless). */
export const HK_CAMERAS_URL =
  'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml';
export const HK_IMAGE_ORIGIN = 'https://tdcctv.data.one.gov.hk/';
export const DEFAULT_HK_MAX_SOURCES = 1100;
export const HK_CENTER = { lat: 22.3193, lon: 114.1694 };

/** Waka Kotahi NZTA traffic cameras (Journeys map cache, keyless). */
export const NZTA_CAMERAS_URL =
  'https://www.journeys.nzta.govt.nz/assets/map-data-cache/cameras.json';
export const NZTA_IMAGE_ORIGIN = 'https://www.trafficnz.info/camera/';
export const DEFAULT_NZTA_MAX_SOURCES = 350;
export const NZTA_ANCHORS = [
  { lat: -36.8485, lon: 174.7633 }, // Auckland
  { lat: -41.2865, lon: 174.7762 }, // Wellington
  { lat: -43.5321, lon: 172.6362 }, // Christchurch
];

/** Vegagerðin (Icelandic Road and Coastal Administration) road webcams: keyless
 * open-data JSON with WGS84 positions; frames on www.vegagerdin.is. */
export const ICELAND_CAMERAS_URL =
  'https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1';
export const ICELAND_IMAGE_ORIGIN = 'https://www.vegagerdin.is/vgdata/';
export const DEFAULT_ICELAND_MAX_SOURCES = 500;
export const ICELAND_BOUNDS = {
  south: 63.2,
  west: -24.6,
  north: 66.6,
  east: -13.4,
};
export const ICELAND_ANCHORS = [
  { lat: 64.1466, lon: -21.9426 }, // Reykjavík
  { lat: 65.6885, lon: -18.1262 }, // Akureyri
  { lat: 65.2653, lon: -14.3948 }, // Egilsstaðir
];

/** QLDTraffic (Queensland Department of Transport and Main Roads) webcams:
 * GeoJSON from the QLDTraffic API (CC BY 4.0 on data.qld.gov.au). The API
 * answers 401 without the key TMR hands out with its API specification, so
 * the pack loads only when QLDTRAFFIC_API_KEY is set. */
export const QLD_CAMERAS_URL = 'https://api.qldtraffic.qld.gov.au/v1/webcams';
export const QLD_IMAGE_ORIGIN = 'https://cameras.qldtraffic.qld.gov.au/';
export const DEFAULT_QLD_MAX_SOURCES = 200;
export const QLD_BOUNDS = {
  south: -29.3,
  west: 137.9,
  north: -9.1,
  east: 153.7,
};
export const QLD_ANCHORS = [
  { lat: -27.4698, lon: 153.0251 }, // Brisbane
  { lat: -28.0167, lon: 153.4 }, // Gold Coast
  { lat: -16.9186, lon: 145.7781 }, // Cairns
  { lat: -19.259, lon: 146.8169 }, // Townsville
];

/** City of Madrid traffic cameras (Informo, Ayuntamiento de Madrid, keyless). */
export const MADRID_CAMERAS_URL =
  'https://informo.madrid.es/informo/tmadrid/CCTV.kml';
export const MADRID_IMAGE_ORIGIN = 'https://informo.madrid.es/cameras/';
export const DEFAULT_MADRID_MAX_SOURCES = 400;
export const MADRID_CENTER = { lat: 40.4168, lon: -3.7038 };
/**
 * Surveyed poses for central Madrid cameras (heading read from the frame:
 * the direction the street recedes in the picture). Every other camera keeps
 * the low-confidence prior until it is surveyed.
 */
export const MADRID_CAMERA_POSES = Object.freeze({
  '01314': {
    headingDeg: 105,
    pitchDeg: -16,
    fovDeg: 62,
    rangeM: 230,
    mountHeightM: 14,
  },
  '01335': {
    headingDeg: 170,
    pitchDeg: -14,
    fovDeg: 56,
    rangeM: 160,
    mountHeightM: 9,
  },
});

/**
 * DGT (Dirección General de Tráfico) road cameras: the DATEX II v3.7
 * DevicePublication on the National Access Point, CC BY. It covers Spain
 * except Catalonia and the Basque Country, which run their own traffic
 * services (packs below). The v3.6 URL now 301-redirects here.
 */
export const DGT_CAMERAS_URL =
  'https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml';
export const DGT_IMAGE_ORIGIN = 'https://etraffic.dgt.es/camarasEtraffic/';
export const DEFAULT_DGT_MAX_SOURCES = 2200;
export const DGT_ANCHORS = [
  { lat: 40.4168, lon: -3.7038 }, // Madrid
  { lat: 39.4699, lon: -0.3763 }, // València
  { lat: 37.3891, lon: -5.9845 }, // Sevilla
  { lat: 41.6488, lon: -0.8891 }, // Zaragoza
  { lat: 43.3623, lon: -8.4115 }, // A Coruña
  { lat: 36.7213, lon: -4.4214 }, // Málaga
];
/** Spain, including the Balearic and Canary Islands, Ceuta and Melilla. */
export const SPAIN_BOUNDS = Object.freeze({
  south: 27.4,
  north: 44.0,
  west: -18.4,
  east: 4.6,
});

/**
 * Servei Català de Trànsit camera list (WFS GML, keyless). Besides the SCT's
 * own road cameras it carries the Ajuntament de Barcelona and Terrassa city
 * cameras; Andorra's rows are outside Spain and their images are gone.
 */
export const CATALONIA_CAMERAS_URL =
  'https://www.gencat.cat/transit/opendata/cameres.xml';
/**
 * The list's `RenderService` link 302s to this frame endpoint on the same host.
 * Plain HTTP, as the list itself links it: over HTTPS the host offers a
 * Diffie-Hellman key OpenSSL 3 refuses (ERR_SSL_DH_KEY_TOO_SMALL).
 */
export const SCT_IMAGE_ORIGIN = 'http://mct.gencat.cat/mct2bo/TransitCamera';
export const BCN_IMAGE_ORIGIN = 'https://www.bcn.cat/transit/imatges/';
export const TERRASSA_IMAGE_ORIGIN = 'https://emap.terrassa.cat/it_terrassa/';
export const DEFAULT_CATALONIA_MAX_SOURCES = 300;
export const CATALONIA_ANCHORS = [{ lat: 41.3874, lon: 2.1686 }]; // Barcelona
export const CATALONIA_PROVIDERS = Object.freeze({
  SCT: 'Servei Català de Trànsit',
  IMI: 'Ajuntament de Barcelona',
  Terrassa: 'Ajuntament de Terrassa',
});

/**
 * Open Data Euskadi traffic API (keyless, paged): cameras of the Basque traffic
 * agencies, with ETRS89 / UTM 30N easting and northing in the `longitude` /
 * `latitude` fields. Only image links that still serve frames are kept: the
 * Trafikoa ones (rehomed on apps.trafikoa.euskadi.eus) and the Diputación de
 * Bizkaia ones (bizkaimove.eus). The Bilbao and Vitoria-Gasteiz links in the
 * feed answer 404 or a "no signal" placeholder (checked 2026-10-03).
 */
export const EUSKADI_CAMERAS_URL =
  'https://api.euskadi.eus/traffic/v1.0/cameras';
export const EUSKADI_MAX_PAGES = 40;
export const TRAFIKOA_IMAGE_ORIGIN =
  'https://apps.trafikoa.euskadi.eus/static/files/tr/camaras/';
export const BIZKAIA_IMAGE_ORIGIN = 'https://www.bizkaimove.eus/camaras/';
export const DEFAULT_EUSKADI_MAX_SOURCES = 400;
export const EUSKADI_ANCHORS = [
  { lat: 43.263, lon: -2.935 }, // Bilbao
  { lat: 43.3183, lon: -1.9812 }, // Donostia-San Sebastián
  { lat: 42.8467, lon: -2.6716 }, // Vitoria-Gasteiz
];
export const EUSKADI_PROVIDERS = Object.freeze({
  1: 'Gobierno Vasco · Trafikoa',
  2: 'Diputación Foral de Bizkaia',
  3: 'Diputación Foral de Álava',
  4: 'Diputación Foral de Gipuzkoa',
  5: 'Ayuntamiento de Bilbao',
  6: 'Ayuntamiento de Vitoria-Gasteiz',
  7: 'Ayuntamiento de Donostia-San Sebastián',
});

/**
 * Spanish city and regional camera services published as open data, one pack
 * each (`CCTV_<env>_ENABLED`, `CCTV_<env>_MAX_SOURCES`). `format` picks the
 * row parser in packs.js, which rebuilds every frame on `frameOrigin` from the
 * camera's own id. Left out (checked 2026-10-03): València, whose viewer
 * streams video over WebSocket and forbids showing the images on other
 * websites, and Bilbao, whose dataset only links frames that now return 404.
 */
export const SPAIN_CITY_SITES = Object.freeze([
  Object.freeze({
    pack: 'malaga',
    env: 'MALAGA',
    format: 'malaga',
    url: 'https://datosabiertos.malaga.eu/recursos/transporte/trafico/da_camarasTrafico-4326.geojson',
    frameOrigin:
      'https://ctraficomovilidad.malaga.eu/recursos/movilidad/camaras_trafico/',
    city: 'Málaga',
    cityId: 'es-malaga',
    provider: 'Ayuntamiento de Málaga',
    license: 'Ayuntamiento de Málaga · datos abiertos (CC BY 4.0)',
    anchor: { lat: 36.7213, lon: -4.4214 },
    bounds: { south: 36.6, north: 36.8, west: -4.65, east: -4.3 },
    defaultMax: 200,
  }),
  Object.freeze({
    pack: 'vitoria',
    env: 'VITORIA',
    format: 'vitoria',
    url: 'https://www.vitoria-gasteiz.org/c11-01w/cameras?action=list&format=GEOJSON',
    frameOrigin:
      'https://www.vitoria-gasteiz.org/c11-01w/cameras?action=get&id=',
    city: 'Vitoria-Gasteiz',
    cityId: 'eus-vitoria-gasteiz',
    provider: 'Ayuntamiento de Vitoria-Gasteiz',
    license: 'Ayuntamiento de Vitoria-Gasteiz · datos abiertos',
    anchor: { lat: 42.8467, lon: -2.6716 },
    bounds: { south: 42.78, north: 42.92, west: -2.78, east: -2.58 },
    defaultMax: 60,
  }),
  Object.freeze({
    pack: 'vigo',
    env: 'VIGO',
    format: 'vigo',
    url: 'https://datos.vigo.org/data/trafico/camaras-trafico.geojson',
    // The listed http:// links 301 to this origin; frames carry no
    // Content-Type, which the proxy accepts only for JPEG bytes.
    frameOrigin: 'https://camaras.vigo.org/webcam/camv2.php?id=',
    city: 'Vigo',
    cityId: 'es-vigo',
    provider: 'Concello de Vigo',
    license: 'Concello de Vigo · datos abiertos (datos.vigo.org)',
    anchor: { lat: 42.2406, lon: -8.7207 },
    bounds: { south: 42.15, north: 42.3, west: -8.85, east: -8.55 },
    defaultMax: 80,
  }),
  Object.freeze({
    pack: 'calle30',
    env: 'CALLE30',
    format: 'calle30',
    url: 'https://mc30.es/xml-data/camaras.xml',
    // The list links www.mc30.es, which 301s to this host.
    frameOrigin: 'https://mc30.es/xml-data/imagenes_camaras/',
    city: 'Madrid',
    cityId: 'madrid',
    provider: 'Madrid Calle 30',
    license: 'Madrid Calle 30 · Ayuntamiento de Madrid, datos abiertos (CC BY)',
    anchor: MADRID_CENTER,
    bounds: { south: 40.33, north: 40.53, west: -3.8, east: -3.6 },
    defaultMax: 60,
  }),
  Object.freeze({
    pack: 'meteogalicia',
    env: 'METEOGALICIA',
    format: 'meteogalicia',
    url: 'https://servizos.meteogalicia.gal/mgrss/observacion/jsonCamaras.action',
    frameOrigin: 'https://www.meteogalicia.gal/datosred/camaras/',
    city: 'Galicia',
    cityId: 'es-galicia',
    provider: 'MeteoGalicia (Xunta de Galicia)',
    license: 'MeteoGalicia · Xunta de Galicia (CC BY-SA 4.0)',
    anchor: { lat: 42.8782, lon: -8.5448 }, // Santiago de Compostela
    bounds: { south: 41.8, north: 43.85, west: -9.35, east: -6.7 },
    defaultMax: 60,
  }),
]);

/** One identifying User-Agent for the catalog fetches added by PANOPTES. */
export const PANOPTES_CCTV_USER_AGENT =
  'PanoptesOSINT/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
