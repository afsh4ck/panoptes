import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readResponseJsonCapped } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/**
 * Aircraft intelligence proxy: one same-origin call that assembles everything
 * public registries know about a Mode S address — registration, type,
 * operator, route, photo and airframe specifications — so the browser never
 * talks to four community APIs itself (and never spends their goodwill twice:
 * every upstream answer is cached on disk, misses included).
 *
 * GET /api/aircraft-intel/{hex}?callsign={CALLSIGN}
 *
 * Sources, all keyless: adsbdb.com (aircraft + route), hexdb.io (aircraft +
 * route + airport fallbacks), planespotters.net (photo, requires a contact
 * User-Agent), the bundled FAA/ICAO type-specification table
 * (src/data/local_data/aircraft_types/aircraft_types.json) and the bundled
 * OurAirports extract for resolving hexdb's "EDDF-KJFK" route legs.
 */

export const AIRCRAFT_INTEL_USER_AGENT =
  'PanoptesOSINT/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
export const AIRCRAFT_INTEL_RECORD_TTL_MS = 24 * 3600_000;
export const AIRCRAFT_INTEL_PHOTO_TTL_MS = 7 * 24 * 3600_000;
export const AIRCRAFT_INTEL_AIRPORT_TTL_MS = 30 * 24 * 3600_000;
export const AIRCRAFT_INTEL_UPSTREAM_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_BYTES = 512 * 1024;
const MAX_AIRPORTS_BYTES = 64 * 1024 * 1024;
const STORE_CAP = 5000;
const HEX_PATTERN = /^[0-9a-f]{6}$/;
const CALLSIGN_PATTERN = /^[A-Z0-9]{2,8}$/;
const AIRPORT_CODE_PATTERN = /^[A-Z0-9]{3,4}$/;

const text = (value) => {
  const out = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return out && out !== 'undefined' && out !== 'null' ? out : null;
};
const num = (value) => {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
};

/** Lower-case six-hex Mode S address, or null. */
export function validHex(value) {
  const hex = String(value ?? '')
    .trim()
    .toLowerCase();
  return HEX_PATTERN.test(hex) ? hex : null;
}

/** Upper-case ICAO-style callsign, or null (blank is not an error, just absent). */
export function validCallsign(value) {
  const callsign = String(value ?? '')
    .trim()
    .toUpperCase();
  return CALLSIGN_PATTERN.test(callsign) ? callsign : null;
}

/** Split adsbdb's "A319 112" from its manufacturer so model never repeats it. */
export function splitModel(typeText, manufacturer) {
  const type = text(typeText);
  if (!type) return null;
  const maker = text(manufacturer);
  if (maker && type.toLowerCase().startsWith(maker.toLowerCase()))
    return text(type.slice(maker.length)) || type;
  return type;
}

/** adsbdb /v0/aircraft/{hex} → registry record, or null when unknown. */
export function parseAdsbdbAircraft(json) {
  const a = json?.response?.aircraft;
  if (!a || typeof a !== 'object') return null;
  const manufacturer = text(a.manufacturer);
  const model = splitModel(a.type, manufacturer);
  return {
    registration: text(a.registration),
    icaoType: text(a.icao_type)?.toUpperCase() || null,
    manufacturer,
    model,
    typeName: [manufacturer, model].filter(Boolean).join(' ') || null,
    owner: text(a.registered_owner),
    ownerCountry: text(a.registered_owner_country_name),
    ownerCountryIso:
      text(a.registered_owner_country_iso_name)?.toUpperCase() || null,
    operatorIcao:
      text(a.registered_owner_operator_flag_code)?.toUpperCase() || null,
    modeS: text(a.mode_s)?.toLowerCase() || null,
    photoFull: text(a.url_photo),
    photoThumb: text(a.url_photo_thumbnail),
  };
}

/** hexdb /api/v1/aircraft/{hex} → registry record, or null when not found. */
export function parseHexdbAircraft(json) {
  if (!json || typeof json !== 'object' || json.error || !json.ModeS)
    return null;
  const manufacturer = text(json.Manufacturer);
  const model = splitModel(json.Type, manufacturer);
  return {
    registration: text(json.Registration),
    icaoType: text(json.ICAOTypeCode)?.toUpperCase() || null,
    manufacturer,
    model,
    typeName: [manufacturer, model].filter(Boolean).join(' ') || null,
    owner: text(json.RegisteredOwners),
    ownerCountry: null,
    ownerCountryIso: null,
    operatorIcao: text(json.OperatorFlagCode)?.toUpperCase() || null,
    modeS: text(json.ModeS)?.toLowerCase() || null,
    photoFull: null,
    photoThumb: null,
  };
}

function airportFromAdsbdb(a) {
  if (!a || typeof a !== 'object') return null;
  const icao = text(a.icao_code)?.toUpperCase() || null;
  const iata = text(a.iata_code)?.toUpperCase() || null;
  if (!icao && !iata) return null;
  return {
    icao,
    iata,
    name: text(a.name),
    municipality: text(a.municipality),
    country: text(a.country_name),
    countryIso: text(a.country_iso_name)?.toUpperCase() || null,
    lat: num(a.latitude),
    lon: num(a.longitude),
    elevationFt: num(a.elevation),
  };
}

/** adsbdb /v0/callsign/{cs} → airline + endpoints, or null without both ends. */
export function parseAdsbdbRoute(json) {
  const fr = json?.response?.flightroute;
  if (!fr || typeof fr !== 'object') return null;
  const origin = airportFromAdsbdb(fr.origin);
  const destination = airportFromAdsbdb(fr.destination);
  if (!origin || !destination) return null;
  const airline = fr.airline
    ? {
        name: text(fr.airline.name),
        icao: text(fr.airline.icao)?.toUpperCase() || null,
        iata: text(fr.airline.iata)?.toUpperCase() || null,
        country: text(fr.airline.country),
        countryIso: text(fr.airline.country_iso)?.toUpperCase() || null,
        callsign: text(fr.airline.callsign),
      }
    : null;
  return {
    callsign: text(fr.callsign)?.toUpperCase() || null,
    callsignIata: text(fr.callsign_iata)?.toUpperCase() || null,
    airline: airline && (airline.name || airline.icao) ? airline : null,
    origin,
    destination,
  };
}

/** hexdb /api/v1/route/icao/{cs} → ordered ICAO legs, or null. */
export function parseHexdbRoute(json) {
  const route = text(json?.route);
  if (!route || json?.error) return null;
  const legs = route
    .split('-')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => AIRPORT_CODE_PATTERN.test(code));
  if (legs.length < 2) return null;
  return {
    callsign: text(json.flight)?.toUpperCase() || null,
    legs,
    updatedAt: num(json.updatetime) ? num(json.updatetime) * 1000 : null,
  };
}

/** hexdb /api/v1/airport/icao/{code} → airport, or null. */
export function parseHexdbAirport(json) {
  if (!json || typeof json !== 'object' || json.error) return null;
  const icao = text(json.icao)?.toUpperCase() || null;
  if (!icao) return null;
  return {
    icao,
    iata: text(json.iata)?.toUpperCase() || null,
    name: text(json.airport),
    municipality: text(json.region_name),
    country: null,
    countryIso: text(json.country_code)?.toUpperCase() || null,
    lat: num(json.latitude),
    lon: num(json.longitude),
    elevationFt: null,
  };
}

/** planespotters /pub/photos/hex/{hex} → first photo, or null. */
export function parsePlanespotters(json) {
  const photo = Array.isArray(json?.photos) ? json.photos[0] : null;
  if (!photo || typeof photo !== 'object') return null;
  const thumb = text(photo.thumbnail_large?.src) || text(photo.thumbnail?.src);
  if (!thumb) return null;
  return {
    thumb,
    full: text(photo.thumbnail_large?.src) || thumb,
    link: text(photo.link),
    credit: text(photo.photographer),
    source: 'planespotters',
  };
}

/**
 * Normalize one bundled type-specification entry. Tolerates the ETL emitting
 * metres or feet (a `*Ft` twin wins only when the metric field is absent).
 */
export function normalizeSpecs(entry, icao = null) {
  if (!entry || typeof entry !== 'object') return null;
  const metres = (mKey, ftKey) => {
    const m = num(entry[mKey]);
    if (m !== null && m > 0) return m;
    const ft = num(entry[ftKey]);
    return ft !== null && ft > 0 ? Math.round(ft * 0.3048 * 100) / 100 : null;
  };
  const mtow = (() => {
    const kg = num(entry.mtowKg);
    if (kg !== null && kg > 0) return Math.round(kg);
    const lb = num(entry.mtowLb);
    return lb !== null && lb > 0 ? Math.round(lb * 0.45359237) : null;
  })();
  const engines = num(entry.engines);
  const specs = {
    icao: text(icao ?? entry.icao ?? entry.designator)?.toUpperCase() || null,
    manufacturer: text(entry.manufacturer),
    model: text(entry.model),
    engines: engines !== null && engines > 0 ? Math.round(engines) : null,
    engineType: text(entry.engineType),
    wakeCategory: text(entry.wakeCategory)?.toUpperCase() || null,
    wingspanM: metres('wingspanM', 'wingspanFt'),
    lengthM: metres('lengthM', 'lengthFt'),
    tailHeightM: metres('tailHeightM', 'tailHeightFt'),
    mtowKg: mtow,
    approachSpeedKt: (() => {
      const kt = num(entry.approachSpeedKt);
      return kt !== null && kt > 0 ? Math.round(kt) : null;
    })(),
    source: text(entry.source) || 'bundled',
  };
  const informative = [
    'engines',
    'engineType',
    'wakeCategory',
    'wingspanM',
    'lengthM',
    'tailHeightM',
    'mtowKg',
    'approachSpeedKt',
  ].some((key) => specs[key] !== null);
  return informative || specs.model ? specs : null;
}

/**
 * Parse the bundled aircraft_types.json into a Map keyed by ICAO designator.
 * Accepts a plain designator→entry map, `{types: {...}}`, or an array of rows
 * carrying `icao`/`designator`; anything else yields an empty map.
 */
export function loadAircraftTypeSpecs(jsonText) {
  const map = new Map();
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText ?? ''));
  } catch {
    return map;
  }
  const add = (icao, entry) => {
    const specs = normalizeSpecs(entry, icao);
    if (specs?.icao && !map.has(specs.icao)) map.set(specs.icao, specs);
  };
  if (Array.isArray(parsed)) {
    for (const row of parsed) add(row?.icao ?? row?.designator, row);
  } else if (parsed && typeof parsed === 'object') {
    const table =
      parsed.types && typeof parsed.types === 'object' ? parsed.types : parsed;
    for (const [icao, entry] of Object.entries(table)) {
      if (entry && typeof entry === 'object') add(icao, entry);
    }
  }
  return map;
}

/**
 * Index the bundled OurAirports GeoJSONL by ICAO and IATA code. Property
 * names are read defensively (top-level or under `tags`) so the extract's
 * exact schema can evolve without silently losing route resolution.
 */
export function indexAirports(geojsonlText) {
  const byIcao = new Map();
  const byIata = new Map();
  for (const line of String(geojsonlText ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let feature;
    try {
      feature = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const props = feature?.properties || {};
    const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const value = text(props[key] ?? tags[key]);
        if (value) return value;
      }
      return null;
    };
    const icao = pick('icao', 'icao_code', 'ident', 'gps_code')?.toUpperCase();
    const iata = pick('iata', 'iata_code')?.toUpperCase();
    if (!icao && !iata) continue;
    const coords = Array.isArray(feature?.geometry?.coordinates)
      ? feature.geometry.coordinates
      : [];
    const airport = {
      icao: icao && AIRPORT_CODE_PATTERN.test(icao) ? icao : null,
      iata: iata && /^[A-Z0-9]{3}$/.test(iata) ? iata : null,
      name: pick('name'),
      municipality: pick('municipality', 'subtitle', 'city'),
      country: pick('country', 'country_name'),
      countryIso: pick('iso_country', 'country_iso')?.toUpperCase() || null,
      lat: num(coords[1]),
      lon: num(coords[0]),
      elevationFt: num(pick('elevation_ft', 'elevationFt')),
    };
    if (airport.icao && !byIcao.has(airport.icao))
      byIcao.set(airport.icao, airport);
    if (airport.iata && !byIata.has(airport.iata))
      byIata.set(airport.iata, airport);
  }
  return { byIcao, byIata };
}

/**
 * Compose the response the browser renders. Pure: every upstream part is an
 * argument, so the merge is testable without a network.
 */
export function mergeAircraftIntel({
  hex,
  callsign = null,
  aircraft = null,
  aircraftSource = null,
  route = null,
  routeSource = null,
  photo = null,
  specs = null,
  now = Date.now(),
}) {
  const sources = [];
  const notes = [];
  if (aircraft && aircraftSource) sources.push(aircraftSource);
  else notes.push('No registry match for this Mode S address (adsbdb, hexdb).');
  if (route && routeSource) sources.push(routeSource);
  else if (callsign) notes.push(`No published route for callsign ${callsign}.`);
  let picture = null;
  if (photo?.thumb) {
    picture = {
      thumb: photo.thumb,
      full: photo.full || photo.thumb,
      link: photo.link || null,
      credit: photo.credit || null,
      source: photo.source || 'planespotters',
    };
    sources.push(picture.source);
  } else if (aircraft?.photoThumb || aircraft?.photoFull) {
    picture = {
      thumb: aircraft.photoThumb || aircraft.photoFull,
      full: aircraft.photoFull || aircraft.photoThumb,
      link: null,
      credit: 'airport-data.com via adsbdb',
      source: 'adsbdb',
    };
  } else notes.push('No photo available for this airframe.');
  if (specs) sources.push(specs.source || 'bundled');
  else if (aircraft?.icaoType)
    notes.push(`No bundled specifications for type ${aircraft.icaoType}.`);
  return {
    found: Boolean(aircraft),
    hex,
    callsign,
    registration: aircraft?.registration || null,
    icaoType: aircraft?.icaoType || null,
    typeName: aircraft?.typeName || null,
    manufacturer: aircraft?.manufacturer || specs?.manufacturer || null,
    model: aircraft?.model || specs?.model || null,
    owner: aircraft?.owner || null,
    ownerCountry: aircraft?.ownerCountry || null,
    ownerCountryIso: aircraft?.ownerCountryIso || null,
    operatorIcao: aircraft?.operatorIcao || route?.airline?.icao || null,
    airline: route?.airline || null,
    route:
      route?.origin && route?.destination
        ? {
            callsign: route.callsign || callsign,
            callsignIata: route.callsignIata || null,
            origin: route.origin,
            destination: route.destination,
            source: routeSource,
          }
        : null,
    photo: picture,
    specs,
    sources: [...new Set(sources)],
    notes,
    fetchedAt: now,
  };
}

/**
 * Vite plugin: same-origin aircraft intel with disk-persisted per-source caches.
 * Every option is a test seam; production callers pass nothing.
 * @returns {import('vite').Plugin}
 */
export function aircraftIntelProxy({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  cachePath = path.join(process.cwd(), '.gev-cache', 'aircraft-intel.json'),
  specsPath = path.join(
    process.cwd(),
    'src',
    'data',
    'local_data',
    'aircraft_types',
    'aircraft_types.json',
  ),
  airportsPath = path.join(
    process.cwd(),
    'src',
    'data',
    'local_data',
    'airports',
    'airports.geojsonl',
  ),
  fs = fsp,
  logger = console,
  persistIntervalMs = 15_000,
} = {}) {
  /** Per-source stores: key → {at, data, source}. `data: null` is a cached miss. */
  let cache = { aircraft: {}, routes: {}, photos: {}, airports: {} };
  let loaded = false;
  let dirty = false;
  let persistTimer = null;
  const inflight = new Map();
  let specsTable = null;
  let airportsIndex = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 120, globalMax: 600 });

  const ttlFor = (store) =>
    store === 'photos'
      ? AIRCRAFT_INTEL_PHOTO_TTL_MS
      : store === 'airports'
        ? AIRCRAFT_INTEL_AIRPORT_TTL_MS
        : AIRCRAFT_INTEL_RECORD_TTL_MS;
  const fresh = (store, entry) => entry && now() - entry.at < ttlFor(store);

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      cache = {
        aircraft: parsed.aircraft ?? {},
        routes: parsed.routes ?? {},
        photos: parsed.photos ?? {},
        airports: parsed.airports ?? {},
      };
    } catch {
      /* first run or unreadable cache — start empty */
    }
    if (persistIntervalMs > 0) {
      persistTimer = setInterval(persist, persistIntervalMs);
      persistTimer.unref?.();
    }
  }

  async function persist() {
    if (!dirty) return;
    dirty = false;
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
    } catch {
      dirty = true; // retry on the next tick
    }
  }

  function remember(store, key, data, source = null) {
    const bucket = cache[store];
    bucket[key] = { at: now(), data, source };
    dirty = true;
    const keys = Object.keys(bucket);
    if (keys.length > STORE_CAP) {
      keys
        .sort((a, b) => bucket[a].at - bucket[b].at)
        .slice(0, keys.length - STORE_CAP)
        .forEach((old) => delete bucket[old]);
    }
  }

  async function upstreamJson(url) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': AIRCRAFT_INTEL_USER_AGENT,
      },
      signal: AbortSignal.timeout(AIRCRAFT_INTEL_UPSTREAM_TIMEOUT_MS),
      redirect: 'error',
    });
    if (response.status === 404) {
      await response.body?.cancel?.().catch?.(() => {});
      return { status: 404, json: null };
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      return { status: response.status, json: null };
    }
    return {
      status: response.status,
      json: await readResponseJsonCapped(response, MAX_UPSTREAM_BYTES),
    };
  }

  /** One coalesced lookup per (store, key); stale entries survive outages. */
  function lookup(store, key, resolve) {
    const entry = cache[store][key];
    if (fresh(store, entry)) return Promise.resolve(entry);
    const inflightKey = `${store}:${key}`;
    if (!inflight.has(inflightKey)) {
      inflight.set(
        inflightKey,
        (async () => {
          try {
            const result = await resolve();
            if (result !== undefined) {
              remember(
                store,
                key,
                result?.data ?? null,
                result?.source ?? null,
              );
              return cache[store][key];
            }
            return entry ?? null; // transient failure: keep stale if any
          } catch {
            return entry ?? null;
          } finally {
            inflight.delete(inflightKey);
          }
        })(),
      );
    }
    return inflight.get(inflightKey);
  }

  /** adsbdb first, hexdb when adsbdb has no record; a double miss is cached. */
  const resolveAircraft = (hex) => async () => {
    let adsbdbStatus = null;
    try {
      const { status, json } = await upstreamJson(
        `https://api.adsbdb.com/v0/aircraft/${hex}`,
      );
      adsbdbStatus = status;
      const parsed = json ? parseAdsbdbAircraft(json) : null;
      if (parsed) return { data: parsed, source: 'adsbdb' };
    } catch {
      /* fall through to hexdb */
    }
    let hexdbStatus = null;
    try {
      const { status, json } = await upstreamJson(
        `https://hexdb.io/api/v1/aircraft/${hex}`,
      );
      hexdbStatus = status;
      const parsed = json ? parseHexdbAircraft(json) : null;
      if (parsed) return { data: parsed, source: 'hexdb' };
    } catch {
      /* both unreachable */
    }
    const definite = [adsbdbStatus, hexdbStatus].every(
      (status) => status === 404 || status === 200,
    );
    return definite ? { data: null, source: null } : undefined;
  };

  async function resolveAirport(code) {
    if (!airportsIndex) {
      try {
        const { size } = await fs.stat(airportsPath);
        if (size > MAX_AIRPORTS_BYTES)
          throw new Error('airports extract too large');
        airportsIndex = indexAirports(await fs.readFile(airportsPath, 'utf8'));
      } catch {
        airportsIndex = { byIcao: new Map(), byIata: new Map() };
      }
    }
    const bundled =
      airportsIndex.byIcao.get(code) || airportsIndex.byIata.get(code);
    if (bundled) return bundled;
    const entry = await lookup('airports', code, async () => {
      try {
        const { status, json } = await upstreamJson(
          `https://hexdb.io/api/v1/airport/icao/${code}`,
        );
        if (status === 404) return { data: null, source: null };
        const parsed = json ? parseHexdbAirport(json) : null;
        return parsed ? { data: parsed, source: 'hexdb' } : undefined;
      } catch {
        return undefined;
      }
    });
    return entry?.data || { icao: code, iata: null, name: null };
  }

  const resolveRoute = (callsign) => async () => {
    let adsbdbStatus = null;
    try {
      const { status, json } = await upstreamJson(
        `https://api.adsbdb.com/v0/callsign/${callsign}`,
      );
      adsbdbStatus = status;
      const parsed = json ? parseAdsbdbRoute(json) : null;
      if (parsed) return { data: parsed, source: 'adsbdb' };
    } catch {
      /* fall through to hexdb */
    }
    let hexdbStatus = null;
    try {
      const { status, json } = await upstreamJson(
        `https://hexdb.io/api/v1/route/icao/${callsign}`,
      );
      hexdbStatus = status;
      const parsed = json ? parseHexdbRoute(json) : null;
      if (parsed) {
        const [first, last] = [parsed.legs[0], parsed.legs.at(-1)];
        const [origin, destination] = await Promise.all([
          resolveAirport(first),
          resolveAirport(last),
        ]);
        return {
          data: {
            callsign: parsed.callsign || callsign,
            callsignIata: null,
            airline: null,
            origin,
            destination,
            legs: parsed.legs,
          },
          source: 'hexdb',
        };
      }
    } catch {
      /* both unreachable */
    }
    const definite = [adsbdbStatus, hexdbStatus].every(
      (status) => status === 404 || status === 200,
    );
    return definite ? { data: null, source: null } : undefined;
  };

  const resolvePhoto = (hex) => async () => {
    try {
      const { status, json } = await upstreamJson(
        `https://api.planespotters.net/pub/photos/hex/${hex}`,
      );
      if (status === 404) return { data: null, source: null };
      if (!json) return undefined;
      const parsed = parsePlanespotters(json);
      return parsed
        ? { data: parsed, source: 'planespotters' }
        : { data: null, source: null };
    } catch {
      return undefined;
    }
  };

  async function specsFor(icaoType) {
    if (!icaoType) return null;
    if (!specsTable) {
      try {
        specsTable = loadAircraftTypeSpecs(
          await fs.readFile(specsPath, 'utf8'),
        );
      } catch {
        specsTable = new Map();
      }
    }
    return specsTable.get(String(icaoType).toUpperCase()) || null;
  }

  async function resolve(hex, callsign) {
    await loadOnce();
    const [aircraftEntry, routeEntry, photoEntry] = await Promise.all([
      lookup('aircraft', hex, resolveAircraft(hex)),
      callsign ? lookup('routes', callsign, resolveRoute(callsign)) : null,
      lookup('photos', hex, resolvePhoto(hex)),
    ]);
    const aircraft = aircraftEntry?.data || null;
    const specs = await specsFor(aircraft?.icaoType);
    return mergeAircraftIntel({
      hex,
      callsign,
      aircraft,
      aircraftSource: aircraftEntry?.source || null,
      route: routeEntry?.data || null,
      routeSource: routeEntry?.source || null,
      photo: photoEntry?.data || null,
      specs,
      now: now(),
    });
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/aircraft-intel', async (req, res) => {
      const send = (status, body, extra = {}) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...extra,
        });
        res.end(JSON.stringify(body));
      };
      try {
        if (!allow(clientKey(req))) {
          return send(
            429,
            { error: 'aircraft intel rate limited' },
            {
              'Retry-After': '60',
            },
          );
        }
        const url = new URL(String(req.url || '/'), 'http://localhost');
        const hex = validHex(url.pathname.split('/').filter(Boolean)[0]);
        if (!hex) return send(400, { error: 'invalid hex' });
        const rawCallsign = url.searchParams.get('callsign');
        const callsign = rawCallsign ? validCallsign(rawCallsign) : null;
        if (rawCallsign && !callsign)
          return send(400, { error: 'invalid callsign' });
        const payload = await resolve(hex, callsign);
        return send(200, payload);
      } catch (error) {
        logger.error?.('[aircraft-intel] request failed');
        return send(500, { error: 'aircraft intel proxy error' });
      }
    });
  };

  return {
    name: 'aircraft-intel-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
    // Test seams — not part of the Vite plugin contract.
    _resolve: resolve,
    _persist: persist,
    _stop() {
      if (persistTimer) clearInterval(persistTimer);
      persistTimer = null;
    },
  };
}
