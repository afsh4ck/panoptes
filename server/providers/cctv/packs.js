/**
 * Camera packs added by PANOPTES: public 511 traveler-information sites on the
 * IBI platform (Georgia, Florida, Pennsylvania, Arizona, Nevada, Louisiana,
 * Idaho, Alaska, New England), Iowa DOT, Hong Kong Transport Department and
 * Waka Kotahi NZTA. Every source here is a camera its operator publishes to
 * the public; nothing is discovered by scanning.
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
    String(image.description || row?.location || '').trim() ||
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
  const pageUrl = (start) => {
    const query = JSON.stringify({
      columns: [],
      start,
      length: IBI_511_PAGE_SIZE,
    });
    return `${site.host}/List/GetData/Cameras?query=${encodeURIComponent(query)}&lang=en`;
  };
  try {
    const first = await fetchJson(pageUrl(0), 4 * MB);
    const total = Math.min(
      Number(first?.recordsTotal) || 0,
      IBI_511_PAGE_SIZE * IBI_511_MAX_PAGES,
    );
    const rows = Array.isArray(first?.data) ? [...first.data] : [];
    const starts = [];
    for (
      let start = IBI_511_PAGE_SIZE;
      start < total;
      start += IBI_511_PAGE_SIZE
    )
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
