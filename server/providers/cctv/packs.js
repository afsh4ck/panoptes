/**
 * Camera packs added by PANOPTES: public 511 traveler-information sites on the
 * IBI platform (Georgia, Florida, Pennsylvania, Arizona, Nevada, Louisiana,
 * Idaho, Alaska, New England, North Carolina, Connecticut and eight Canadian
 * provinces and territories), Iowa DOT, Hong Kong Transport Department,
 * Waka Kotahi NZTA, Vegagerðin (Iceland), QLDTraffic (Queensland), the City of
 * Madrid (Informo) and Spain's road cameras:
 * DGT nationwide, the Servei Català de Trànsit (with Barcelona and Terrassa),
 * Open Data Euskadi, and the city and regional feeds in SPAIN_CITY_SITES
 * (Málaga, Vitoria-Gasteiz, Vigo, Madrid Calle 30, MeteoGalicia). Every source here is a camera its operator publishes
 * to the public; nothing is discovered by scanning.
 *
 * Each loader returns already-prioritized source records in the shape the
 * catalog normalizes (see normalizeSourceItem). The pure `*ToSource`
 * normalizers are exported for tests.
 */
import {
  IBI_511_PAGE_SIZE,
  IBI_511_MAX_PAGES,
  IBI_511_PAGE_CONCURRENCY,
  IOWA_CAMERAS_URL,
  IOWA_IMAGE_HOST,
  IOWA_VIDEO_HOST_PATTERN,
  DEFAULT_IOWA_MAX_SOURCES,
  IOWA_ANCHORS,
  HK_CAMERAS_URL,
  HK_IMAGE_ORIGIN,
  DEFAULT_HK_MAX_SOURCES,
  HK_CENTER,
  NZTA_CAMERAS_URL,
  NZTA_IMAGE_ORIGIN,
  DEFAULT_NZTA_MAX_SOURCES,
  NZTA_ANCHORS,
  ICELAND_CAMERAS_URL,
  ICELAND_IMAGE_ORIGIN,
  DEFAULT_ICELAND_MAX_SOURCES,
  ICELAND_BOUNDS,
  ICELAND_ANCHORS,
  QLD_CAMERAS_URL,
  QLD_IMAGE_ORIGIN,
  DEFAULT_QLD_MAX_SOURCES,
  QLD_BOUNDS,
  QLD_ANCHORS,
  MADRID_CAMERAS_URL,
  MADRID_IMAGE_ORIGIN,
  DEFAULT_MADRID_MAX_SOURCES,
  MADRID_CENTER,
  MADRID_CAMERA_POSES,
  DGT_CAMERAS_URL,
  DGT_IMAGE_ORIGIN,
  DEFAULT_DGT_MAX_SOURCES,
  DGT_ANCHORS,
  SPAIN_BOUNDS,
  CATALONIA_CAMERAS_URL,
  SCT_IMAGE_ORIGIN,
  BCN_IMAGE_ORIGIN,
  TERRASSA_IMAGE_ORIGIN,
  DEFAULT_CATALONIA_MAX_SOURCES,
  CATALONIA_ANCHORS,
  CATALONIA_PROVIDERS,
  EUSKADI_CAMERAS_URL,
  EUSKADI_MAX_PAGES,
  TRAFIKOA_IMAGE_ORIGIN,
  BIZKAIA_IMAGE_ORIGIN,
  DEFAULT_EUSKADI_MAX_SOURCES,
  EUSKADI_ANCHORS,
  EUSKADI_PROVIDERS,
  CCTV_SOURCE_FETCH_TIMEOUT_MS,
  PANOPTES_CCTV_USER_AGENT,
} from './constants.js';
import {
  toFiniteNumber,
  fallbackHeadingFromId,
  isPlausibleLatLon,
  prioritizeSources,
} from './normalize.js';
import { directionToHeading } from '../../../src/data/directionText.js';
import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from '../common/http.js';

const MB = 1024 * 1024;

/** Pose priors shared by highway packs (same personalities as Caltrans). */
function posePrior(cameraId, heading) {
  const hasHeading = Number.isFinite(heading);
  return {
    headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
  };
}

/** Per-pack cap from `CCTV_<NAME>_MAX_SOURCES`, bounded to [8, ceiling]. */
export function packCap(envName, fallback, ceiling = 8000) {
  const raw = Number(process.env[`CCTV_${envName}_MAX_SOURCES`] || fallback);
  return Number.isFinite(raw)
    ? Math.max(8, Math.min(ceiling, Math.floor(raw)))
    : fallback;
}

async function fetchJson(url, maxBytes) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': PANOPTES_CCTV_USER_AGENT,
    },
    signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  return readResponseJsonCapped(response, maxBytes);
}

/** Parse `POINT (lon lat)` well-known text into {lat, lon}, or null. */
export function parseWktPoint(text) {
  const match =
    /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(
      String(text || '').trim(),
    );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return isPlausibleLatLon(lat, lon) ? { lat, lon } : null;
}

/**
 * An HTTPS HLS playlist URL with no credentials, or ''.
 * @param {string} raw
 * @param {(url: URL) => boolean} [hostOk]
 */
export function safeHlsUrl(raw, hostOk = () => true) {
  try {
    const url = new URL(String(raw || '').trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/\.m3u8$/i.test(url.pathname) ||
      !hostOk(url)
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

/**
 * One IBI 511 DataTables row → camera source, or null.
 * The first enabled image of the site is the camera; its frame is
 * `<host>/map/Cctv/<imageId>`. An open HLS stream (not auth-gated, not
 * disabled) makes the camera live.
 * @param {object} row DataTables row from `/List/GetData/Cameras`.
 * @param {object} site Entry of IBI_511_SITES.
 */
/**
 * An IBI image description worth showing as the camera name, or ''. Some
 * sites fill it with a placeholder ("N/A"), a bare device code ("C134") or a
 * note about which lanes face the camera; the row location reads better then.
 * @param {unknown} description
 */
export function ibi511ImageLabel(description) {
  const text = String(description || '').trim();
  if (!text) return '';
  if (/^(n\/?a|none|unknown|-+)$/i.test(text)) return '';
  if (/^[a-z]{0,3}[-_ ]?\d{1,5}$/i.test(text)) return '';
  if (/^traffic closest to the camera/i.test(text)) return '';
  return text;
}

export function ibi511RowToSource(row, site) {
  const images = Array.isArray(row?.images) ? row.images : [];
  const image = images.find(
    (candidate) =>
      candidate &&
      !candidate.disabled &&
      !candidate.blocked &&
      Number.isInteger(Number(candidate.id)),
  );
  if (!image) return null;
  const point = parseWktPoint(row?.latLng?.geography?.wellKnownText);
  if (!point) return null;
  const [south, west, north, east] = site.bounds;
  if (
    point.lat < south ||
    point.lat > north ||
    point.lon < west ||
    point.lon > east
  )
    return null;
  const imageId = Number(image.id);
  const cameraId = `${site.pack}-${imageId}`;
  const frameUrl = `${site.host}/map/Cctv/${imageId}`;
  const stream =
    image.videoUrl &&
    !image.isVideoAuthRequired &&
    !image.videoDisabled &&
    /mpegurl/i.test(String(image.videoType || 'application/x-mpegURL'))
      ? safeHlsUrl(image.videoUrl)
      : '';
  const label =
    ibi511ImageLabel(image.description) ||
    String(row?.location || '').trim() ||
    `${site.region} camera ${imageId}`;
  const heading = directionToHeading(row?.direction, true);
  return {
    id: cameraId,
    name: label,
    city: String(row?.city || row?.county || row?.roadway || site.region),
    cityId: site.pack,
    provider: site.provider,
    lat: point.lat,
    lon: point.lon,
    ...posePrior(cameraId, heading),
    groundElevationM: site.elevationM,
    feedType: stream ? 'hls' : 'image',
    url: stream || frameUrl,
    snapshotUrl: frameUrl,
    live: Boolean(stream),
    sourceKind: 'ibi-511',
    license: `Public ${site.provider} traveler-information camera`,
  };
}

/**
 * Fetch every camera of one IBI 511 site (paged, bounded concurrency).
 * @param {object} site Entry of IBI_511_SITES.
 */
export async function loadIbi511Sources(site) {
  const pageSize = site.pageSize || IBI_511_PAGE_SIZE;
  const pageUrl = (start) => {
    const query = JSON.stringify({
      columns: [],
      start,
      length: pageSize,
    });
    return `${site.host}/List/GetData/Cameras?query=${encodeURIComponent(query)}&lang=en`;
  };
  try {
    const first = await fetchJson(pageUrl(0), 4 * MB);
    const total = Math.min(
      Number(first?.recordsTotal) || 0,
      pageSize * IBI_511_MAX_PAGES,
    );
    const rows = Array.isArray(first?.data) ? [...first.data] : [];
    const starts = [];
    for (let start = pageSize; start < total; start += pageSize)
      starts.push(start);
    for (let i = 0; i < starts.length; i += IBI_511_PAGE_CONCURRENCY) {
      const batch = starts.slice(i, i + IBI_511_PAGE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((start) => fetchJson(pageUrl(start), 4 * MB)),
      );
      for (const result of settled)
        if (result.status === 'fulfilled' && Array.isArray(result.value?.data))
          rows.push(...result.value.data);
    }
    const cameras = [];
    const seen = new Set();
    for (const row of rows) {
      const camera = ibi511RowToSource(row, site);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    const prioritized = prioritizeSources(
      cameras,
      packCap(site.env, site.defaultMax),
      site.anchors,
    );
    console.log(
      `[CCTV] Loaded ${site.provider}: ${cameras.length} cameras, ${cameras.filter((c) => c.live).length} live (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      `[CCTV] ${site.provider} download error:`,
      error?.message || error,
    );
    return [];
  }
}

/**
 * One Iowa DOT ArcGIS feature → camera source, or null. Frames must come from
 * the DOT snapshot host and streams from its videoN hosts.
 * @param {{attributes: object}} feature
 */
export function iowaFeatureToSource(feature) {
  const a = feature?.attributes || {};
  const lat = toFiniteNumber(a.latitude);
  const lon = toFiniteNumber(a.longitude);
  if (!isPlausibleLatLon(lat, lon)) return null;
  if (lat < 40.3 || lat > 43.6 || lon < -96.7 || lon > -90.0) return null;
  let frameUrl = '';
  try {
    const url = new URL(String(a.ImageURL || ''));
    if (url.protocol === 'https:' && url.hostname === IOWA_IMAGE_HOST)
      frameUrl = url.href;
  } catch {
    frameUrl = '';
  }
  if (!frameUrl) return null;
  const stream = safeHlsUrl(a.VideoURL, (url) =>
    IOWA_VIDEO_HOST_PATTERN.test(url.host),
  );
  const id = String(a.COMMON_ID || a.device_id || a.FID || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id)) return null;
  const cameraId = `iowa-${id.toLowerCase()}`;
  const label = String(a.Desc_ || a.ImageName || `Iowa DOT ${id}`).trim();
  return {
    id: cameraId,
    name: label,
    city: String(a.REGION || a.Route || 'Iowa'),
    cityId: 'iowa',
    provider: 'Iowa DOT',
    lat,
    lon,
    ...posePrior(cameraId, directionToHeading(label)),
    groundElevationM: 300,
    feedType: stream ? 'hls' : 'image',
    url: stream || frameUrl,
    snapshotUrl: frameUrl,
    live: Boolean(stream),
    sourceKind: 'iowa-dot',
    license: 'Public Iowa DOT traffic camera',
  };
}

export async function loadIowaSourcesFromOpenData() {
  try {
    const params = new URLSearchParams({
      where: '1=1',
      outFields:
        'device_id,COMMON_ID,Desc_,ImageName,ImageURL,VideoURL,latitude,longitude,REGION,Route,FID',
      returnGeometry: 'false',
      resultRecordCount: '2000',
      f: 'json',
    });
    const payload = await fetchJson(`${IOWA_CAMERAS_URL}?${params}`, 8 * MB);
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const cameras = [];
    const seen = new Set();
    for (const feature of features) {
      const camera = iowaFeatureToSource(feature);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    const prioritized = prioritizeSources(
      cameras,
      packCap('IOWA', DEFAULT_IOWA_MAX_SOURCES, 3000),
      IOWA_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded Iowa DOT cameras: ${cameras.length}, ${cameras.filter((c) => c.live).length} live (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] Iowa DOT download error:', error?.message || error);
    return [];
  }
}

function xmlField(block, tag) {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return match ? match[1].trim() : '';
}

/**
 * Parse the Hong Kong TD camera location XML into camera sources.
 * @param {string} xml
 */
export function parseHongKongCameras(xml) {
  const cameras = [];
  for (const match of String(xml || '').matchAll(
    /<image>([\s\S]*?)<\/image>/g,
  )) {
    const block = match[1];
    const key = xmlField(block, 'key');
    if (!/^[A-Za-z0-9]{2,16}$/.test(key)) continue;
    const lat = toFiniteNumber(xmlField(block, 'latitude'));
    const lon = toFiniteNumber(xmlField(block, 'longitude'));
    if (!isPlausibleLatLon(lat, lon)) continue;
    if (lat < 22.1 || lat > 22.6 || lon < 113.8 || lon > 114.5) continue;
    const description = xmlField(block, 'description')
      .replace(/&amp;/g, '&')
      .replace(/\s*\[[A-Za-z0-9]+\]\s*$/, '');
    const frameUrl = `${HK_IMAGE_ORIGIN}${key}.JPG`;
    const cameraId = `hk-${key.toLowerCase()}`;
    cameras.push({
      id: cameraId,
      name: description || `Hong Kong TD ${key}`,
      city:
        xmlField(block, 'district') || xmlField(block, 'region') || 'Hong Kong',
      cityId: 'hong-kong',
      provider: 'Hong Kong Transport Department',
      lat,
      lon,
      ...posePrior(cameraId, NaN),
      groundElevationM: 10,
      feedType: 'image',
      url: frameUrl,
      snapshotUrl: frameUrl,
      sourceKind: 'hk-td',
      license:
        'DATA.GOV.HK terms of use; Transport Department traffic snapshot',
    });
  }
  return cameras;
}

export async function loadHongKongSourcesFromOpenData() {
  try {
    const response = await fetch(HK_CAMERAS_URL, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await readResponseTextCapped(response, 4 * MB);
    const cameras = parseHongKongCameras(xml);
    const prioritized = prioritizeSources(
      cameras,
      packCap('HK', DEFAULT_HK_MAX_SOURCES, 2000),
      [HK_CENTER],
    );
    console.log(
      `[CCTV] Loaded Hong Kong TD cameras: ${cameras.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Hong Kong TD download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * One NZTA camera GeoJSON feature → camera source, or null. Offline and
 * under-maintenance cameras are skipped; frames are pinned to trafficnz.info.
 * @param {object} feature
 */
export function nztaFeatureToSource(feature) {
  const p = feature?.properties || {};
  if (Number(p.Offline) || Number(p.UnderMaintenance)) return null;
  const [lon, lat] = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates.map(Number)
    : [];
  if (!isPlausibleLatLon(lat, lon)) return null;
  if (lat < -47.5 || lat > -34 || lon < 166 || lon > 179) return null;
  const id = Number(p.ExternalId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const frameUrl = `${NZTA_IMAGE_ORIGIN}${id}.jpg`;
  const cameraId = `nzta-${id}`;
  const label = String(p.Name || '').trim() || `NZTA camera ${id}`;
  return {
    id: cameraId,
    name: label,
    city: String(p.RegionName || p.Region || 'New Zealand'),
    cityId: 'nzta',
    provider: 'Waka Kotahi NZTA',
    lat,
    lon,
    ...posePrior(
      cameraId,
      directionToHeading(`${label} ${p.Description || ''}`),
    ),
    groundElevationM: 40,
    feedType: 'image',
    url: frameUrl,
    snapshotUrl: frameUrl,
    sourceKind: 'nzta',
    license: 'Waka Kotahi NZTA traffic camera (CC BY 4.0 data)',
  };
}

export async function loadNztaSourcesFromOpenData() {
  try {
    const payload = await fetchJson(NZTA_CAMERAS_URL, 4 * MB);
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const cameras = features.map(nztaFeatureToSource).filter(Boolean);
    const unique = [...new Map(cameras.map((c) => [c.id, c])).values()];
    const prioritized = prioritizeSources(
      unique,
      packCap('NZTA', DEFAULT_NZTA_MAX_SOURCES, 1000),
      NZTA_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded NZTA cameras: ${unique.length} online (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] NZTA download error:', error?.message || error);
    return [];
  }
}

/** Icelandic compass words (accents folded) → bearing in degrees. */
const ICELAND_COMPASS = Object.freeze({
  nordur: 0,
  nordaustur: 45,
  austur: 90,
  sudaustur: 135,
  sudur: 180,
  sudvestur: 225,
  vestur: 270,
  nordvestur: 315,
});

/**
 * Facing named in a Vegagerðin caption ("Hellisheiði séð til vesturs" = seen
 * towards the west), or NaN. Place names after "til" ("til Reykjavíkur") are
 * not bearings and stay NaN.
 * @param {string} caption
 */
export function icelandCaptionHeading(caption) {
  const text = String(caption || '')
    .toLowerCase()
    .replace(/ð/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const match =
    /\btil\s+((?:nord|sud)?(?:austur|vestur|vestu)|nordur|sudur)s?\b/.exec(
      text,
    );
  if (!match) return NaN;
  return ICELAND_COMPASS[match[1].replace(/vestu$/, 'vestur')] ?? NaN;
}

/**
 * One Vegagerðin webcam row → camera source, or null. A station carries
 * several cameras, so the frame file name is the id.
 * @param {object} row
 */
export function icelandCameraToSource(row) {
  const frameUrl = String(row?.Slod || '').trim();
  if (!frameUrl.startsWith(ICELAND_IMAGE_ORIGIN)) return null;
  const file = /([\w-]+)\.jpe?g$/i.exec(frameUrl)?.[1];
  if (!file) return null;
  const lat = toFiniteNumber(row?.Breidd);
  const lon = toFiniteNumber(row?.Lengd);
  if (!isPlausibleLatLon(lat, lon) || !inBounds(lat, lon, ICELAND_BOUNDS))
    return null;
  const cameraId = `iceland-${file.toLowerCase()}`;
  const caption = String(row?.Skyring || '').trim();
  const station = String(row?.Myndavel || '').trim();
  const road = String(row?.NrVegur || '').trim();
  const prior = posePrior(cameraId, icelandCaptionHeading(caption));
  // "séð niður á veg" = looking down onto the road.
  if (/nidur a veg|niður á veg/i.test(caption)) prior.pitchDeg = -55;
  return {
    id: cameraId,
    name: caption || station || `Iceland camera ${file}`,
    city: station || 'Iceland',
    cityId: 'iceland',
    provider: 'Vegagerðin',
    ...(road ? { road } : {}),
    lat,
    lon,
    ...prior,
    groundElevationM: 100,
    feedType: 'image',
    url: frameUrl,
    snapshotUrl: frameUrl,
    sourceKind: 'iceland',
    license: 'Vegagerðin open data (no fees or conditions)',
  };
}

export async function loadIcelandSourcesFromVegagerdin() {
  try {
    const rows = await fetchJson(ICELAND_CAMERAS_URL, 4 * MB);
    const cameras = (Array.isArray(rows) ? rows : [])
      .map(icelandCameraToSource)
      .filter(Boolean);
    const unique = [...new Map(cameras.map((c) => [c.id, c])).values()];
    const prioritized = prioritizeSources(
      unique,
      packCap('ICELAND', DEFAULT_ICELAND_MAX_SOURCES, 1000),
      ICELAND_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded Vegagerðin cameras: ${unique.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] Vegagerðin download error:', error?.message || error);
    return [];
  }
}

/**
 * One QLDTraffic webcam GeoJSON feature → camera source, or null. `direction`
 * is the way the camera faces.
 * @param {object} feature
 */
export function qldWebcamToSource(feature) {
  const p = feature?.properties || {};
  const frameUrl = String(p.image_url || '').trim();
  if (!frameUrl.startsWith(QLD_IMAGE_ORIGIN)) return null;
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [lon, lat] = Array.isArray(feature?.geometry?.coordinates)
    ? feature.geometry.coordinates.map(Number)
    : [];
  if (!isPlausibleLatLon(lat, lon) || !inBounds(lat, lon, QLD_BOUNDS))
    return null;
  const cameraId = `qld-${id}`;
  return {
    id: cameraId,
    name: String(p.description || '').trim() || `QLDTraffic camera ${id}`,
    city: String(p.locality || p.district || 'Queensland'),
    cityId: 'qld',
    provider: 'QLDTraffic (TMR Queensland)',
    lat,
    lon,
    ...posePrior(cameraId, directionToHeading(p.direction, true)),
    groundElevationM: 30,
    feedType: 'image',
    url: frameUrl,
    snapshotUrl: frameUrl,
    sourceKind: 'qld',
    license: 'QLDTraffic, State of Queensland (CC BY 4.0)',
  };
}

export async function loadQldSourcesFromQldTraffic() {
  const key = String(process.env.QLDTRAFFIC_API_KEY || '').trim();
  if (!key) return [];
  try {
    const payload = await fetchJson(
      `${QLD_CAMERAS_URL}?apikey=${encodeURIComponent(key)}`,
      4 * MB,
    );
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const cameras = features.map(qldWebcamToSource).filter(Boolean);
    const unique = [...new Map(cameras.map((c) => [c.id, c])).values()];
    const prioritized = prioritizeSources(
      unique,
      packCap('QLD', DEFAULT_QLD_MAX_SOURCES, 1000),
      QLD_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded QLDTraffic cameras: ${unique.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] QLDTraffic download error:', error?.message || error);
    return [];
  }
}

/** Decode the handful of XML entities the Informo KML uses in names. */
function decodeXmlText(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * "PLAZA DE CASTILLA (NORTE)" → "Plaza de Castilla (Norte)", "MONTCADA I
 * REIXAC" → "Montcada i Reixac": Spanish and Catalan particles stay lowercase,
 * except last ("TUNEL BAILEN I" ends in a numeral).
 */
function placeTitleCase(name) {
  const small = new Set([
    'de',
    'del',
    'la',
    'las',
    'el',
    'los',
    'y',
    'a',
    'i',
    'les',
    'els',
    'dels',
  ]);
  return String(name || '')
    .trim()
    .toLowerCase()
    .split(/(\s+|-|\(|\/)/)
    .map((word, index, parts) =>
      index > 0 && index < parts.length - 1 && small.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
}

/**
 * Parse the City of Madrid Informo CCTV KML into still-frame cameras. Frames
 * are rebuilt from the camera number and pinned to informo.madrid.es; the
 * cache-busting `?v=` the KML carries is dropped.
 * @param {string} kml
 */
export function parseMadridCameras(kml) {
  const cameras = [];
  const seen = new Set();
  for (const match of String(kml || '').matchAll(
    /<Placemark>([\s\S]*?)<\/Placemark>/g,
  )) {
    const block = match[1];
    const number = (/<Data name="Numero">\s*<Value>([^<]*)<\/Value>/.exec(
      block,
    ) || [])[1]?.trim();
    if (!/^\d{3,6}$/.test(number || '') || seen.has(number)) continue;
    const coords = (/<coordinates>([^<]*)<\/coordinates>/.exec(block) || [])[1];
    const [lon, lat] = String(coords || '')
      .trim()
      .split(',')
      .map(Number);
    if (!isPlausibleLatLon(lat, lon)) continue;
    if (lat < 40.2 || lat > 40.65 || lon < -3.95 || lon > -3.45) continue;
    const rawName = decodeXmlText(
      (/<Data name="Nombre">\s*<Value>([^<]*)<\/Value>/.exec(block) || [])[1],
    );
    seen.add(number);
    const cameraId = `madrid-${number}`;
    const frameUrl = `${MADRID_IMAGE_ORIGIN}Camara${number}.jpg`;
    const surveyed = MADRID_CAMERA_POSES[number];
    cameras.push({
      id: cameraId,
      name: rawName ? placeTitleCase(rawName) : `Madrid camera ${number}`,
      city: 'Madrid',
      cityId: 'madrid',
      provider: 'Ayuntamiento de Madrid',
      lat,
      lon,
      ...(surveyed
        ? { ...surveyed, headingConfidence: 'high' }
        : posePrior(cameraId, NaN)),
      groundElevationM: 655,
      feedType: 'image',
      url: frameUrl,
      snapshotUrl: frameUrl,
      sourceKind: 'madrid-informo',
      license:
        'Ayuntamiento de Madrid · informo.madrid.es (cámaras de tráfico públicas)',
    });
  }
  return cameras;
}

export async function loadMadridSourcesFromInformo() {
  try {
    const response = await fetch(MADRID_CAMERAS_URL, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const kml = await readResponseTextCapped(response, 4 * MB);
    const cameras = parseMadridCameras(kml);
    const prioritized = prioritizeSources(
      cameras,
      packCap('MADRID', DEFAULT_MADRID_MAX_SOURCES, 1000),
      [MADRID_CENTER],
    );
    console.log(
      `[CCTV] Loaded Madrid Informo cameras: ${cameras.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Madrid Informo download error:',
      error?.message || error,
    );
    return [];
  }
}

const slug = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** DGT writes provinces article-last ("CORUÑA, A", "BALEARS, ILLES"). */
function provinceName(raw) {
  const text = String(raw || '').trim();
  const swapped = /^(.+?),\s*(a|o|el|la|las|los|les|illes)$/i.exec(text);
  const name = placeTitleCase(swapped ? `${swapped[2]} ${swapped[1]}` : text);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const inBounds = (lat, lon, b) =>
  lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

/** Road kilometre point, "016+500" (km+m) or "91.000" → 16.5 / 91; NaN if absent. */
function kilometerPoint(raw) {
  const text = String(raw ?? '').trim();
  const plus = /^(\d{1,4})\+(\d{1,4})$/.exec(text);
  if (plus) return Number(plus[1]) + Number(plus[2]) / 1000;
  return text ? toFiniteNumber(text) : NaN;
}

/**
 * Parse the DGT DATEX II DevicePublication into still-frame cameras. Only
 * camera devices that publish an image are kept, and the frame URL is rebuilt
 * from the device id on etraffic.dgt.es whatever the feed says.
 * @param {string} xml
 */
export function parseDgtCameras(xml) {
  const cameras = [];
  const seen = new Set();
  for (const match of String(xml || '').matchAll(
    /<ns2:device\b[^>]*\bid="(\d{1,9})"[^>]*>([\s\S]*?)<\/ns2:device>/g,
  )) {
    const [, id, block] = match;
    if (seen.has(id)) continue;
    if (!/<ns2:typeOfDevice>\s*camera\s*</.test(block)) continue;
    if (!/<fse:deviceUrl>\s*https?:\/\//.test(block)) continue;
    const field = (tag) =>
      decodeXmlText((new RegExp(`<${tag}>([^<]*)<`).exec(block) || [])[1]);
    const lat = toFiniteNumber(field('loc:latitude'));
    const lon = toFiniteNumber(field('loc:longitude'));
    if (!isPlausibleLatLon(lat, lon) || !inBounds(lat, lon, SPAIN_BOUNDS)) {
      continue;
    }
    seen.add(id);
    const road = field('loc:roadName');
    const km = kilometerPoint(field('lse:kilometerPoint'));
    const towards = placeTitleCase(field('loc:roadDestination'));
    const province = provinceName(field('lse:province'));
    const cameraId = `dgt-${id}`;
    const frameUrl = `${DGT_IMAGE_ORIGIN}${id}.jpg`;
    cameras.push({
      id: cameraId,
      name:
        [road, Number.isFinite(km) ? `PK ${km}` : '']
          .filter(Boolean)
          .join(' · ') + (towards ? ` → ${towards}` : '') || `DGT camera ${id}`,
      city: province || 'España',
      cityId: province ? `es-${slug(province)}` : 'es',
      provider: 'DGT',
      lat,
      lon,
      ...posePrior(cameraId, NaN),
      feedType: 'image',
      url: frameUrl,
      snapshotUrl: frameUrl,
      // Road, kilometre point and travel direction feed the road-aligned
      // bearings (scripts/precompute-cctv-road-headings.mjs).
      road,
      kmPoint: km,
      travelDirection: field('lse:tpegDirectionRoad'),
      towards,
      sourceKind: 'dgt-datex2',
      license: 'DGT · Punto de Acceso Nacional (nap.dgt.es) · CC BY',
    });
  }
  return cameras;
}

export async function loadDgtSourcesFromNap() {
  try {
    const response = await fetch(DGT_CAMERAS_URL, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await readResponseTextCapped(response, 16 * MB);
    const cameras = parseDgtCameras(xml);
    const prioritized = prioritizeSources(
      cameras,
      packCap('DGT', DEFAULT_DGT_MAX_SOURCES, 4000),
      DGT_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded DGT (Spain) cameras: ${cameras.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] DGT download error:', error?.message || error);
    return [];
  }
}

/**
 * Frame URL for one row of the Catalan list, rebuilt on its official host:
 * the SCT render link becomes the frame endpoint it redirects to, and the
 * Barcelona / Terrassa links drop their cache-buster (and stray whitespace).
 * Any other host (Andorra) is not registered.
 * @param {string} link
 * @returns {{ frameUrl: string, key: string } | null}
 */
export function cataloniaFrameUrl(link) {
  const text = decodeXmlText(link);
  const sct =
    /^https?:\/\/mct\.gencat\.cat\/mct2bo\/RenderService\?sctidcam=([a-z0-9_]{1,24})\.(gif|jpe?g)\b/i.exec(
      text,
    );
  if (sct) {
    return {
      frameUrl: `${SCT_IMAGE_ORIGIN}?nom=${sct[1]}.${sct[2]}&visualitzacio=imatge`,
      key: `sct-${sct[1].toLowerCase()}`,
    };
  }
  const bcn =
    /^https?:\/\/www\.bcn\.cat\/transit\/imatges\/([a-z0-9_]{1,48})\.(gif|jpe?g)\b/i.exec(
      text,
    );
  if (bcn) {
    return {
      frameUrl: `${BCN_IMAGE_ORIGIN}${bcn[1]}.${bcn[2]}`,
      key: `bcn-${bcn[1].toLowerCase()}`,
    };
  }
  const terrassa =
    /^https:\/\/emap\.terrassa\.cat\/it_terrassa\/(cam\d{1,3})\.(jpe?g)\b/i.exec(
      text,
    );
  if (terrassa) {
    return {
      frameUrl: `${TERRASSA_IMAGE_ORIGIN}${terrassa[1]}.${terrassa[2]}`,
      key: `terrassa-${terrassa[1].toLowerCase()}`,
    };
  }
  return null;
}

/**
 * Parse the Servei Català de Trànsit camera list (WFS GML, EPSG:4326
 * "lon,lat" points) into still-frame cameras.
 * @param {string} xml
 */
export function parseCataloniaCameras(xml) {
  const cameras = [];
  const seen = new Set();
  for (const match of String(xml || '').matchAll(
    /<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g,
  )) {
    const block = match[1];
    const field = (tag) =>
      decodeXmlText((new RegExp(`<cite:${tag}>([^<]*)<`).exec(block) || [])[1]);
    const frame = cataloniaFrameUrl(field('link'));
    if (!frame || seen.has(frame.key)) continue;
    const coords = (/<gml:coordinates[^>]*>([^<]*)</.exec(block) || [])[1];
    const [lon, lat] = String(coords || '')
      .trim()
      .split(',')
      .map(Number);
    if (!isPlausibleLatLon(lat, lon)) continue;
    if (lat < 40.4 || lat > 42.95 || lon < 0.1 || lon > 3.4) continue;
    seen.add(frame.key);
    const source = field('font');
    const road = field('carretera');
    const place = placeTitleCase(field('municipi'));
    const pk = kilometerPoint(field('pk'));
    const cameraId = `cat-${frame.key}`;
    cameras.push({
      id: cameraId,
      name:
        source === 'SCT'
          ? [road, Number.isFinite(pk) ? `PK ${pk}` : '', place]
              .filter(Boolean)
              .join(' · ')
          : road || place || cameraId,
      city: place || 'Catalunya',
      cityId: place ? `cat-${slug(place)}` : 'cat',
      provider: CATALONIA_PROVIDERS[source] || 'Servei Català de Trànsit',
      lat,
      lon,
      ...posePrior(cameraId, NaN),
      feedType: 'image',
      url: frame.frameUrl,
      snapshotUrl: frame.frameUrl,
      road: source === 'SCT' ? road : '',
      kmPoint: pk,
      sourceKind: 'catalonia-sct',
      license:
        'Generalitat de Catalunya · Servei Català de Trànsit (dades obertes)',
    });
  }
  return cameras;
}

export async function loadCataloniaSourcesFromSct() {
  try {
    const response = await fetch(CATALONIA_CAMERAS_URL, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await readResponseTextCapped(response, 4 * MB);
    const cameras = parseCataloniaCameras(xml);
    const prioritized = prioritizeSources(
      cameras,
      packCap('CATALONIA', DEFAULT_CATALONIA_MAX_SOURCES, 1000),
      CATALONIA_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded Catalonia (SCT) cameras: ${cameras.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Catalonia SCT download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Inverse UTM (WGS84 / ETRS89 ellipsoid, northern hemisphere): easting and
 * northing in metres to degrees. Sub-metre over a zone, which is plenty for
 * placing a camera.
 * @param {number} easting
 * @param {number} northing
 * @param {number} zone
 */
export function utmToLatLon(easting, northing, zone) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const mu =
    northing /
    k0 /
    (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const t1 = tan1 * tan1;
  const c1 = ep2 * cos1 * cos1;
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const d = x / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) *
          d ** 6) /
          720);
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lon =
    lon0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) /
        120) /
      cos1;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/**
 * Frame URL for an Open Data Euskadi camera, on the host that serves it today,
 * or null for links that no longer serve frames.
 * @param {string} raw
 */
export function euskadiFrameUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const trafikoa = /^\/static\/files\/tr\/camaras\/(\d{1,6})\.jpg$/i.exec(
    url.pathname,
  );
  if (
    trafikoa &&
    /^(www\.)?trafikoa\.(eus|net)$|^(apps|www)\.trafikoa\.euskadi\.eus$/.test(
      host,
    )
  ) {
    return `${TRAFIKOA_IMAGE_ORIGIN}${trafikoa[1]}.jpg`;
  }
  const bizkaia = /^\/camaras\/(cam\d{1,4})\.jpg$/i.exec(url.pathname);
  if (bizkaia && /^www\.bizkaimove\.(com|eus)$/.test(host)) {
    return `${BIZKAIA_IMAGE_ORIGIN}${bizkaia[1]}.jpg`;
  }
  return null;
}

/** Area each Euskadi source covers (the feed's `address` is the direction). */
const EUSKADI_AREAS = Object.freeze({
  1: 'Euskadi',
  2: 'Bizkaia',
  3: 'Araba',
  4: 'Gipuzkoa',
  5: 'Bilbao',
  6: 'Vitoria-Gasteiz',
  7: 'Donostia-San Sebastián',
});

/**
 * One Open Data Euskadi camera row → source record, or null when it has no
 * frame we can serve or no usable position. Camera ids repeat across
 * sources, so the id carries both.
 * @param {object} row
 */
export function euskadiCameraToSource(row) {
  const frameUrl = euskadiFrameUrl(row?.urlImage);
  if (!frameUrl) return null;
  let lat = toFiniteNumber(row?.latitude);
  let lon = toFiniteNumber(row?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // The API ships ETRS89 / UTM 30N northing and easting in these fields.
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    ({ lat, lon } = utmToLatLon(lon, lat, 30));
  }
  if (!isPlausibleLatLon(lat, lon)) return null;
  if (lat < 42.3 || lat > 43.6 || lon < -3.6 || lon > -1.6) return null;
  const rawId = String(row?.cameraId ?? '').replace(/[^\w-]/g, '');
  const sourceId = String(row?.sourceId ?? '').replace(/[^\w-]/g, '');
  if (!rawId || !sourceId) return null;
  const cameraId = `euskadi-${sourceId}-${rawId}`;
  const title = decodeXmlText(row?.cameraName)
    .replace(/^CCTV\s*\d+\s*-\s*/i, '')
    .trim();
  const road = String(row?.road || '')
    .replace(/\s+-\s+/g, '-')
    .trim();
  const km = kilometerPoint(row?.kilometer);
  return {
    id: cameraId,
    name:
      [title, road && Number.isFinite(km) ? `${road} PK ${km}` : road]
        .filter(Boolean)
        .join(' · ') || `Euskadi camera ${rawId}`,
    city: EUSKADI_AREAS[row?.sourceId] || 'Euskadi',
    cityId: `eus-${slug(EUSKADI_AREAS[row?.sourceId] || 'euskadi')}`,
    provider: EUSKADI_PROVIDERS[row?.sourceId] || 'Open Data Euskadi',
    lat,
    lon,
    ...posePrior(cameraId, NaN),
    feedType: 'image',
    url: frameUrl,
    snapshotUrl: frameUrl,
    road,
    kmPoint: km,
    sourceKind: 'euskadi-traffic',
    license: 'Open Data Euskadi · API de tráfico (CC BY 4.0)',
  };
}

export async function loadEuskadiSourcesFromOpenData() {
  try {
    const rows = [];
    let pages = 1;
    for (let page = 1; page <= pages && page <= EUSKADI_MAX_PAGES; page++) {
      const response = await fetch(`${EUSKADI_CAMERAS_URL}?_page=${page}`, {
        headers: {
          'User-Agent': PANOPTES_CCTV_USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await readResponseJsonCapped(response, 2 * MB);
      pages = Math.max(1, Math.floor(toFiniteNumber(body?.totalPages) || 1));
      rows.push(...(Array.isArray(body?.cameras) ? body.cameras : []));
    }
    // The feed repeats some frames under several ids; keep the first.
    const seenFrames = new Set();
    const cameras = [];
    for (const row of rows) {
      const source = euskadiCameraToSource(row);
      if (!source || seenFrames.has(source.url)) continue;
      seenFrames.add(source.url);
      cameras.push(source);
    }
    const prioritized = prioritizeSources(
      cameras,
      packCap('EUSKADI', DEFAULT_EUSKADI_MAX_SOURCES, 1000),
      EUSKADI_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded Open Data Euskadi cameras: ${cameras.length} of ${rows.length} rows (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Open Data Euskadi download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * "M30-PK07+600D(ODONNELL)" → "M-30 PK 7.6 · ODONNELL" (the abbreviated place
 * stays as published); tunnel cameras only have a code.
 */
function calle30Name(code) {
  const pk = /^M30-PK(\d{1,3})\+(\d{1,3})[A-Z]{0,4}(?:\((.+)\))?/i.exec(code);
  if (!pk) return `Calle 30 · ${code}`;
  const km = Number(pk[1]) + Number(pk[2]) / 1000;
  return [`M-30 PK ${km}`, pk[3] || ''].filter(Boolean).join(' · ');
}

/**
 * Row parsers for SPAIN_CITY_SITES. Each turns a feed body into
 * `{ key, name, lat, lon, frameUrl, city?, cityId? }` rows; the frame is
 * rebuilt on the site's own origin from an id that passed a strict pattern.
 */
const SPAIN_CITY_PARSERS = Object.freeze({
  malaga: (body, site) =>
    (body?.features || []).map((feature) => {
      const props = feature?.properties || {};
      const file = /\/(TV-\d{1,4})\.jpg\s*$/i.exec(
        String(props.URLIMAGEN || ''),
      );
      if (!file) return null;
      const [lon, lat] = feature?.geometry?.coordinates || [];
      const code = file[1].toUpperCase();
      return {
        key: code.toLowerCase(),
        name: placeTitleCase(
          String(props.NOMBRE || '').replace(/^TV\d+\s*-\s*/i, ''),
        ),
        lat,
        lon,
        frameUrl: `${site.frameOrigin}${code}.jpg`,
      };
    }),
  vitoria: (body, site) =>
    (body?.features || []).map((feature) => {
      const id = String(feature?.id ?? '');
      if (!/^CM\d{1,3}(_ROI_\d{1,2})?$/i.test(id)) return null;
      const [lon, lat] = feature?.geometry?.coordinates || [];
      return {
        key: id.toLowerCase(),
        name: String(feature?.properties?.nombre || '').trim(),
        lat,
        lon,
        frameUrl: `${site.frameOrigin}${id}`,
      };
    }),
  vigo: (body, site) =>
    (body?.features || []).map((feature) => {
      const props = feature?.properties || {};
      const id = String(props.id ?? '');
      if (!/^\d{1,3}$/.test(id)) return null;
      return {
        key: id,
        name: String(props.nombre || '').trim(),
        lat: props.lat ?? feature?.geometry?.coordinates?.[1],
        lon: props.lon ?? feature?.geometry?.coordinates?.[0],
        frameUrl: `${site.frameOrigin}${id}`,
      };
    }),
  calle30: (xml, site) =>
    [...String(xml || '').matchAll(/<Camara>([\s\S]*?)<\/Camara>/g)].map(
      (match) => {
        const field = (tag) =>
          decodeXmlText(
            (new RegExp(`<${tag}>([^<]*)<`).exec(match[1]) || [])[1],
          );
        const file = /^([A-Za-z0-9+().-]{1,48})\.jpg$/i.exec(field('Fichero'));
        if (!file) return null;
        return {
          key: slug(file[1]),
          name: calle30Name(file[1]),
          lat: field('Latitud'),
          lon: field('Longitud'),
          frameUrl: `${site.frameOrigin}${file[1]}.jpg`,
        };
      },
    ),
  meteogalicia: (body, site) =>
    (body?.listaCamaras || []).map((row) => {
      const path =
        /^https:\/\/www\.meteogalicia\.gal\/datosred\/camaras\/(MeteoGalicia|MedioRural)\/([A-Za-z0-9_-]{1,48})\/ultima\.jpg$/.exec(
          String(row?.imaxeCamara || '').trim(),
        );
      if (!path) return null;
      const province = String(row?.provincia || '').trim();
      return {
        // `identificador` is the station; Ons and Cíes carry two cameras each.
        key: slug(
          path[1] === 'MeteoGalicia' ? path[2] : `${path[1]}-${path[2]}`,
        ),
        name: String(row?.nomeCamara || '').trim(),
        city: String(row?.concello || '').trim(),
        cityId: province ? `es-${slug(province)}` : '',
        lat: row?.lat,
        lon: row?.lon,
        frameUrl: `${site.frameOrigin}${path[1]}/${path[2]}/ultima.jpg`,
      };
    }),
});

/**
 * Parse one SPAIN_CITY_SITES feed (parsed JSON, or the XML text for Calle 30)
 * into still-frame cameras.
 * @param {object} site - SPAIN_CITY_SITES entry.
 * @param {object|string} body
 */
export function parseSpainCityCameras(site, body) {
  const parse = SPAIN_CITY_PARSERS[site?.format];
  if (!parse) return [];
  const cameras = [];
  const seen = new Set();
  for (const row of parse(body, site)) {
    if (!row?.key) continue;
    const lat = toFiniteNumber(row.lat);
    const lon = toFiniteNumber(row.lon);
    if (!isPlausibleLatLon(lat, lon) || !inBounds(lat, lon, site.bounds)) {
      continue;
    }
    const cameraId = `${site.pack}-${row.key}`;
    if (seen.has(cameraId)) continue;
    seen.add(cameraId);
    cameras.push({
      id: cameraId,
      name: row.name || `${site.city} camera ${row.key}`,
      city: row.city || site.city,
      cityId: row.cityId || site.cityId,
      provider: site.provider,
      lat,
      lon,
      ...posePrior(cameraId, NaN),
      feedType: 'image',
      url: row.frameUrl,
      snapshotUrl: row.frameUrl,
      sourceKind: `es-${site.pack}`,
      license: site.license,
    });
  }
  return cameras;
}

/** @param {object} site - SPAIN_CITY_SITES entry. */
export async function loadSpainCitySources(site) {
  try {
    const response = await fetch(site.url, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await readResponseTextCapped(response, 4 * MB);
    const body = /^\s*</.test(text) ? text : JSON.parse(text);
    const cameras = parseSpainCityCameras(site, body);
    const prioritized = prioritizeSources(
      cameras,
      packCap(site.env, site.defaultMax, 1000),
      [site.anchor],
    );
    console.log(
      `[CCTV] Loaded ${site.provider} cameras: ${cameras.length} (using ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      `[CCTV] ${site.provider} download error:`,
      error?.message || error,
    );
    return [];
  }
}
