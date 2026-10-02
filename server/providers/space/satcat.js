import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  readResponseTextCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * CelesTrak SATCAT + GP (OMM) lookup proxy for one catalog object.
 *
 * Route: GET /api/satcat/{norad}
 *
 * Two public, keyless CelesTrak endpoints are combined per NORAD id:
 *   - SATCAT record  https://celestrak.org/satcat/records.php?CATNR=n&FORMAT=JSON
 *     (identity, owner, launch, decay, mean orbit, RCS) — changes rarely.
 *   - GP element set https://celestrak.org/NORAD/elements/gp.php?CATNR=n&FORMAT=JSON
 *     (current OMM mean elements) — refreshed daily upstream.
 *
 * CelesTrak throttles clients that re-fetch aggressively, so every answer is
 * cached in memory and on disk (`.gev-cache/satcat.json`): SATCAT rows for a
 * week, GP sets for six hours, misses for a day. On an upstream failure the
 * cached copy is served as STALE rather than relaying the error. Errors reach
 * the browser only as a sanitized reason string.
 */

export const SATCAT_TTL_MS = 7 * 24 * 3600_000;
export const SATCAT_GP_TTL_MS = 6 * 3600_000;
export const SATCAT_MISS_TTL_MS = 24 * 3600_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_DISK_ENTRIES = 2000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const FLUSH_DELAY_MS = 5_000;
const USER_AGENT =
  'gods-eye-view-satcat-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
const NORAD_PATTERN = /^[0-9]{1,9}$/;

/** SATCAT OBJECT_TYPE codes (https://celestrak.org/satcat/satcat-format.php). */
export const SATCAT_OBJECT_TYPES = Object.freeze({
  PAY: 'Payload',
  'R/B': 'Rocket body',
  DEB: 'Debris',
  UNK: 'Unknown',
});

/** SATCAT OPS_STATUS_CODE codes (https://celestrak.org/satcat/status.php). */
export const SATCAT_STATUS_CODES = Object.freeze({
  '+': 'Operational',
  '-': 'Nonoperational',
  P: 'Partially operational',
  B: 'Backup / reserve',
  S: 'Spare — awaiting activation',
  X: 'Extended mission',
  D: 'Decayed',
  '?': 'Unknown',
});

export const SATCAT_DATA_STATUS_CODES = Object.freeze({
  NCE: 'No current elements',
  NIE: 'No initial elements',
  NEA: 'No elements available',
});

export const SATCAT_ORBIT_TYPES = Object.freeze({
  ORB: 'Orbit',
  LAN: 'Landing',
  IMP: 'Impact',
  DOC: 'Docked to another cataloged object',
  'R/T': 'Roundtrip',
});

export const SATCAT_ORBIT_CENTERS = Object.freeze({
  AS: 'Asteroid',
  CO: 'Comet',
  EA: 'Earth',
  EL1: 'Earth–Sun L1',
  EL2: 'Earth–Sun L2',
  EM: 'Earth–Moon barycenter',
  JU: 'Jupiter',
  MA: 'Mars',
  ME: 'Mercury',
  MO: 'Moon',
  NE: 'Neptune',
  PL: 'Pluto',
  SA: 'Saturn',
  SS: 'Solar-system escape',
  SU: 'Sun',
  UR: 'Uranus',
  VE: 'Venus',
});

/** SATCAT OWNER / source codes (https://celestrak.org/satcat/sources.php). */
export const SATCAT_OWNERS = Object.freeze({
  AB: 'Arab Satellite Communications Organization',
  ABS: 'Asia Broadcast Satellite',
  AC: 'Asia Satellite Telecommunications Company (AsiaSat)',
  ALG: 'Algeria',
  ANG: 'Angola',
  ARGN: 'Argentina',
  ARM: 'Armenia',
  ASRA: 'Austria',
  AUS: 'Australia',
  AZER: 'Azerbaijan',
  BEL: 'Belgium',
  BELA: 'Belarus',
  BERM: 'Bermuda',
  BGD: 'Bangladesh',
  BHR: 'Bahrain',
  BHUT: 'Bhutan',
  BOL: 'Bolivia',
  BRAZ: 'Brazil',
  BUL: 'Bulgaria',
  BWA: 'Botswana',
  CA: 'Canada',
  CHBZ: 'China / Brazil',
  CHTU: 'China / Türkiye',
  CHLE: 'Chile',
  CIS: 'Commonwealth of Independent States (former USSR)',
  COL: 'Colombia',
  CRI: 'Costa Rica',
  CZCH: 'Czech Republic',
  DEN: 'Denmark',
  DJI: 'Djibouti',
  ECU: 'Ecuador',
  EGYP: 'Egypt',
  ESA: 'European Space Agency',
  ESRO: 'European Space Research Organization',
  EST: 'Estonia',
  ETH: 'Ethiopia',
  EUME: 'EUMETSAT',
  EUTE: 'EUTELSAT',
  FGER: 'France / Germany',
  FIN: 'Finland',
  FR: 'France',
  FRIT: 'France / Italy',
  GER: 'Germany',
  GHA: 'Ghana',
  GLOB: 'Globalstar',
  GREC: 'Greece',
  GRSA: 'Greece / Saudi Arabia',
  GUAT: 'Guatemala',
  HRV: 'Croatia',
  HUN: 'Hungary',
  IM: 'INMARSAT',
  IND: 'India',
  INDO: 'Indonesia',
  IRAN: 'Iran',
  IRAQ: 'Iraq',
  IRID: 'Iridium',
  IRL: 'Ireland',
  ISRA: 'Israel',
  ISRO: 'Indian Space Research Organisation',
  ISS: 'International Space Station',
  IT: 'Italy',
  ITSO: 'INTELSAT',
  JPN: 'Japan',
  KAZ: 'Kazakhstan',
  KEN: 'Kenya',
  LAOS: 'Laos',
  LKA: 'Sri Lanka',
  LTU: 'Lithuania',
  LUXE: 'Luxembourg',
  MA: 'Morocco',
  MALA: 'Malaysia',
  MCO: 'Monaco',
  MDA: 'Moldova',
  MEX: 'Mexico',
  MMR: 'Myanmar',
  MNE: 'Montenegro',
  MNG: 'Mongolia',
  MUS: 'Mauritius',
  NATO: 'NATO',
  NETH: 'Netherlands',
  NICO: 'New ICO',
  NIG: 'Nigeria',
  NKOR: 'North Korea',
  NOR: 'Norway',
  NPL: 'Nepal',
  NZ: 'New Zealand',
  O3B: 'O3b Networks',
  ORB: 'ORBCOMM',
  PAKI: 'Pakistan',
  PERU: 'Peru',
  POL: 'Poland',
  POR: 'Portugal',
  PRC: "People's Republic of China",
  PRY: 'Paraguay',
  PRES: 'China / European Space Agency',
  QAT: 'Qatar',
  RASC: 'RascomStar-QAF',
  ROC: 'Taiwan',
  ROM: 'Romania',
  RP: 'Philippines',
  RWA: 'Rwanda',
  SAFR: 'South Africa',
  SAUD: 'Saudi Arabia',
  SDN: 'Sudan',
  SEAL: 'Sea Launch',
  SEN: 'Senegal',
  SES: 'SES',
  SGJP: 'Singapore / Japan',
  SING: 'Singapore',
  SKOR: 'Republic of Korea',
  SLB: 'Solomon Islands',
  SPN: 'Spain',
  STCT: 'Singapore / Taiwan',
  SVN: 'Slovenia',
  SWED: 'Sweden',
  SWTZ: 'Switzerland',
  TBD: 'To be determined',
  THAI: 'Thailand',
  TMMC: 'Turkmenistan / Monaco',
  TUN: 'Tunisia',
  TURK: 'Türkiye',
  UAE: 'United Arab Emirates',
  UK: 'United Kingdom',
  UKR: 'Ukraine',
  UNK: 'Unknown',
  URY: 'Uruguay',
  US: 'United States',
  USBZ: 'United States / Brazil',
  VAT: 'Vatican City',
  VENZ: 'Venezuela',
  VTNM: 'Vietnam',
  ZWE: 'Zimbabwe',
});

/** SATCAT LAUNCH_SITE codes (https://celestrak.org/satcat/launchsites.php). */
export const SATCAT_LAUNCH_SITES = Object.freeze({
  AFETR: 'Cape Canaveral / Eastern Range, Florida, USA',
  AFWTR: 'Vandenberg / Western Range, California, USA',
  ANDSP: 'Andøya Spaceport, Norway',
  ALCLC: 'Alcântara Launch Center, Brazil',
  BOS: 'Bowen Orbital Spaceport, Australia',
  CAS: 'Canaries Airspace (air launch)',
  DLS: 'Dombarovskiy, Russia',
  ERAS: 'Eastern Range Airspace (air launch)',
  FRGUI: "Europe's Spaceport, Kourou, French Guiana",
  HGSTR: 'Hammaguir, Algeria',
  JJSLA: 'Jeju Island sea launch area, Republic of Korea',
  JSC: 'Jiuquan Satellite Launch Center, China',
  KODAK: 'Kodiak / Pacific Spaceport Complex, Alaska, USA',
  KSCUT: 'Uchinoura Space Center, Japan',
  KWAJ: 'Kwajalein Atoll, Marshall Islands',
  KYMSC: 'Kapustin Yar, Russia',
  NSC: 'Naro Space Center, Republic of Korea',
  PLMSC: 'Plesetsk Cosmodrome, Russia',
  RLLB: 'Rocket Lab Launch Complex, Mahia, New Zealand',
  SCSLA: 'South China Sea launch area, China',
  SEAL: 'Sea Launch platform (mobile)',
  SEMLS: 'Semnan, Iran',
  SMTS: 'Shahrud, Iran',
  SNMLP: 'San Marco platform, Kenya',
  SPKII: 'Space Port Kii, Japan',
  SRILR: 'Satish Dhawan Space Centre, India',
  SUBL: 'Submarine launch (mobile)',
  SVOBO: 'Svobodny, Russia',
  TAISC: 'Taiyuan Satellite Launch Center, China',
  TANSC: 'Tanegashima Space Center, Japan',
  TYMSC: 'Baikonur Cosmodrome (Tyuratam), Kazakhstan',
  UNK: 'Unknown',
  VOSTO: 'Vostochny Cosmodrome, Russia',
  WLPIS: 'Wallops Island, Virginia, USA',
  WOMRA: 'Woomera, Australia',
  WRAS: 'Western Range Airspace (air launch)',
  WSC: 'Wenchang Satellite Launch Site, China',
  XICLF: 'Xichang Satellite Launch Center, China',
  YAVNE: 'Palmachim / Yavne, Israel',
  YSLA: 'Yellow Sea launch area, China',
  YUN: 'Sohae / Yunsong, North Korea',
});

const text = (value) => {
  const t = String(value ?? '').trim();
  return t || null;
};
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Upstream SATCAT record URL for one catalog number. */
export function satcatRecordUrl(norad) {
  return `https://celestrak.org/satcat/records.php?CATNR=${norad}&FORMAT=JSON`;
}

/** Upstream GP (OMM JSON) URL for one catalog number. */
export function satcatGpUrl(norad) {
  return `https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=JSON`;
}

/**
 * Normalize one raw SATCAT row into stable, decoded fields.
 * @param {object} raw CelesTrak SATCAT JSON row.
 * @returns {object|null} Null when the row has no usable catalog number.
 */
export function normalizeSatcatRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const norad = Number(raw.NORAD_CAT_ID);
  if (!Number.isSafeInteger(norad) || norad <= 0) return null;
  const objectType = text(raw.OBJECT_TYPE);
  const status = text(raw.OPS_STATUS_CODE);
  const owner = text(raw.OWNER);
  const launchSite = text(raw.LAUNCH_SITE);
  const dataStatus = text(raw.DATA_STATUS_CODE);
  const orbitCenter = text(raw.ORBIT_CENTER);
  const orbitType = text(raw.ORBIT_TYPE);
  return {
    norad,
    name: text(raw.OBJECT_NAME),
    intlDesignator: text(raw.OBJECT_ID),
    objectType,
    objectTypeLabel: SATCAT_OBJECT_TYPES[objectType] || objectType || 'Unknown',
    status,
    statusLabel: status
      ? SATCAT_STATUS_CODES[status] || `Status ${status}`
      : 'Unknown',
    owner,
    ownerLabel: owner ? SATCAT_OWNERS[owner] || owner : null,
    launchDate: text(raw.LAUNCH_DATE),
    launchSite,
    launchSiteLabel: launchSite
      ? SATCAT_LAUNCH_SITES[launchSite] || launchSite
      : null,
    decayDate: text(raw.DECAY_DATE),
    periodMin: num(raw.PERIOD),
    inclinationDeg: num(raw.INCLINATION),
    apogeeKm: num(raw.APOGEE),
    perigeeKm: num(raw.PERIGEE),
    rcsM2: num(raw.RCS),
    dataStatus,
    dataStatusLabel: dataStatus
      ? SATCAT_DATA_STATUS_CODES[dataStatus] || dataStatus
      : null,
    orbitCenter,
    orbitCenterLabel: orbitCenter
      ? SATCAT_ORBIT_CENTERS[orbitCenter] || orbitCenter
      : null,
    orbitType,
    orbitTypeLabel: orbitType
      ? SATCAT_ORBIT_TYPES[orbitType] || orbitType
      : null,
  };
}

/**
 * Normalize one raw GP (OMM) row.
 * @param {object} raw CelesTrak gp.php JSON row.
 * @returns {object|null}
 */
export function normalizeGpRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const norad = Number(raw.NORAD_CAT_ID);
  if (!Number.isSafeInteger(norad) || norad <= 0) return null;
  return {
    norad,
    name: text(raw.OBJECT_NAME),
    intlDesignator: text(raw.OBJECT_ID),
    epoch: text(raw.EPOCH),
    meanMotion: num(raw.MEAN_MOTION),
    eccentricity: num(raw.ECCENTRICITY),
    inclinationDeg: num(raw.INCLINATION),
    raanDeg: num(raw.RA_OF_ASC_NODE),
    argPerigeeDeg: num(raw.ARG_OF_PERICENTER),
    meanAnomalyDeg: num(raw.MEAN_ANOMALY),
    bstar: num(raw.BSTAR),
    meanMotionDot: num(raw.MEAN_MOTION_DOT),
    revAtEpoch: num(raw.REV_AT_EPOCH),
    elementSetNo: num(raw.ELEMENT_SET_NO),
    classification: text(raw.CLASSIFICATION_TYPE),
    ephemerisType: num(raw.EPHEMERIS_TYPE),
  };
}

/**
 * CelesTrak answers a miss with a plain-text sentence ("No GP data found"),
 * not an empty JSON array. Anything that is not a JSON array is a miss.
 * @param {string} body Upstream response text.
 * @returns {Array<object>|null} Parsed rows, or null for a miss.
 */
export function parseCelestrakArray(body) {
  const trimmed = String(body || '').trim();
  if (!trimmed.startsWith('[')) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * Whether a cache entry still answers without an upstream round trip.
 * @param {number|undefined} at Fetch time (epoch ms) or undefined.
 * @param {boolean} hasData Whether the cached value was a hit.
 * @param {number} now Current epoch ms.
 * @param {number} hitTtlMs TTL for hits.
 * @returns {boolean}
 */
export function satcatEntryFresh(at, hasData, now, hitTtlMs) {
  if (!Number.isFinite(at)) return false;
  return now - at < (hasData ? hitTtlMs : SATCAT_MISS_TTL_MS);
}

/** Vite plugin: bounded, cached CelesTrak SATCAT/GP lookups. */
export function satcatProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
} = {}) {
  const cachePath = path.join(cacheDir, 'satcat.json');
  /** @type {Map<number, {satAt?: number, satcat?: object|null, gpAt?: number, gp?: object|null}>} */
  const mem = new Map();
  const inFlight = new Map();
  let diskLoaded = false;
  let dirty = false;
  let flushTimer = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function loadDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      const records =
        parsed && typeof parsed.records === 'object' ? parsed.records : {};
      for (const [key, entry] of Object.entries(records)) {
        const norad = Number(key);
        if (Number.isSafeInteger(norad) && entry && typeof entry === 'object')
          mem.set(norad, entry);
      }
    } catch {
      /* first run or unreadable cache */
    }
  }

  async function flushDisk() {
    if (!dirty) return;
    dirty = false;
    try {
      const entries = [...mem.entries()].sort(
        (a, b) =>
          Math.max(b[1].satAt || 0, b[1].gpAt || 0) -
          Math.max(a[1].satAt || 0, a[1].gpAt || 0),
      );
      for (const [norad] of entries.slice(MAX_DISK_ENTRIES)) mem.delete(norad);
      const records = Object.fromEntries(
        entries
          .slice(0, MAX_DISK_ENTRIES)
          .map(([norad, entry]) => [String(norad), entry]),
      );
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify({ records }), 'utf8');
    } catch {
      dirty = true; // retry on the next flush
      console.warn('[satcat-proxy] cache write failed');
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushDisk();
    }, FLUSH_DELAY_MS);
    flushTimer.unref?.();
  }

  async function fetchText(url) {
    const upstream = await fetchImpl(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
    });
    const body = await readResponseTextCapped(upstream, MAX_RESPONSE_BYTES);
    if (!upstream.ok) {
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.upstreamStatus = upstream.status;
      throw error;
    }
    return body;
  }

  async function refreshSatcat(norad) {
    const rows = parseCelestrakArray(await fetchText(satcatRecordUrl(norad)));
    const row = rows?.find((entry) => Number(entry?.NORAD_CAT_ID) === norad);
    return row ? normalizeSatcatRecord(row) : null;
  }

  async function refreshGp(norad) {
    const rows = parseCelestrakArray(await fetchText(satcatGpUrl(norad)));
    const row = rows?.find((entry) => Number(entry?.NORAD_CAT_ID) === norad);
    return row ? normalizeGpRecord(row) : null;
  }

  /**
   * Resolve one catalog number through the cache, refreshing only the part
   * (SATCAT row or GP set) whose TTL has lapsed.
   * @param {number} norad
   * @returns {Promise<{entry: object, cache: string, failed: boolean}>}
   */
  async function resolve(norad) {
    await loadDisk();
    const entry = mem.get(norad) || {};
    const t = now();
    const satFresh = satcatEntryFresh(
      entry.satAt,
      Boolean(entry.satcat),
      t,
      SATCAT_TTL_MS,
    );
    const gpFresh = satcatEntryFresh(
      entry.gpAt,
      Boolean(entry.gp),
      t,
      SATCAT_GP_TTL_MS,
    );
    if (satFresh && gpFresh) return { entry, cache: 'HIT', failed: false };
    const { promise } = coalesceProxyRequest(
      inFlight,
      String(norad),
      async () => {
        const next = { ...entry };
        let failed = false;
        if (!satFresh) {
          try {
            next.satcat = await refreshSatcat(norad);
            next.satAt = now();
          } catch {
            failed = true;
          }
        }
        if (!gpFresh) {
          try {
            next.gp = await refreshGp(norad);
            next.gpAt = now();
          } catch {
            failed = true;
          }
        }
        mem.set(norad, next);
        dirty = true;
        scheduleFlush();
        const hadPrior =
          Number.isFinite(entry.satAt) || Number.isFinite(entry.gpAt);
        return {
          entry: next,
          cache: failed ? (hadPrior ? 'STALE' : 'ERROR') : 'MISS',
          failed,
        };
      },
    );
    return promise;
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/satcat', async (req, res) => {
      const send = (status, payload, cacheState = 'NONE') => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store',
          'X-GEV-Cache': cacheState,
        });
        res.end(JSON.stringify(payload));
      };
      try {
        const raw = String(req.url || '')
          .split('?')[0]
          .replace(/^\/+/, '');
        if (!NORAD_PATTERN.test(raw))
          return send(400, { error: 'invalid catalog number' });
        const norad = Number(raw);
        if (!Number.isSafeInteger(norad) || norad <= 0)
          return send(400, { error: 'invalid catalog number' });
        if (!allow(clientKey(req))) return send(429, { error: 'rate limited' });
        const { entry, cache, failed } = await resolve(norad);
        const satcat = entry.satcat || null;
        const gp = entry.gp || null;
        if (failed && !satcat && !gp)
          return send(502, { error: 'satcat upstream unavailable' }, cache);
        return send(
          200,
          {
            found: Boolean(satcat || gp),
            norad,
            satcat,
            gp,
            fetchedAt: Number.isFinite(entry.satAt) ? entry.satAt : null,
            gpFetchedAt: Number.isFinite(entry.gpAt) ? entry.gpAt : null,
            stale: failed,
            source: 'CelesTrak SATCAT + GP',
          },
          cache,
        );
      } catch {
        console.error('[satcat-proxy] request failed');
        return send(500, { error: 'satcat proxy error' }, 'ERROR');
      }
    });
  };

  return {
    name: 'satcat-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
    /** Test seam: resolve without HTTP plumbing. */
    _resolveForTest: resolve,
    _flushForTest: flushDisk,
  };
}
