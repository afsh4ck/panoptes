import { readResponseJsonCapped } from '../sources/httpBody.js';
import {
  cleanText,
  createIntelModel,
  fmtAltitude,
  fmtDate,
  fmtLength,
  fmtMass,
  fmtNumber,
  fmtSpeed,
  intelRow,
  intelSection,
  sanitizeHref,
} from './intelModel.js';

/**
 * Aircraft intel: fetch the same-origin `/api/aircraft-intel` payload and
 * fold it, together with the live contact the flights/military layers already
 * publish, into one IntelModel for the intel panel. Pure apart from the fetch.
 */

export const AIRCRAFT_INTEL_ACCENT = '#f5a524';
export const MILITARY_INTEL_ACCENT = '#f5a524';
export const AIRCRAFT_INTEL_MAX_BYTES = 1024 * 1024;
export const EMERGENCY_SQUAWKS = Object.freeze({
  7500: 'HIJACK · 7500',
  7600: 'RADIO FAILURE · 7600',
  7700: 'EMERGENCY · 7700',
});
const HEX_PATTERN = /^[0-9a-f]{6}$/i;
const CALLSIGN_PATTERN = /^[A-Z0-9]{2,8}$/i;
const WAKE_LABELS = Object.freeze({
  L: 'L · Light',
  M: 'M · Medium',
  H: 'H · Heavy',
  J: 'J · Super',
  'L/M': 'L/M · Light-Medium',
});
const CLASS_LABELS = Object.freeze({
  airliner: 'Airliner',
  widebody: 'Wide-body',
  quadjet: 'Quad-jet',
  turboprop: 'Turboprop',
  bizjet: 'Business jet',
  light: 'Light aircraft',
  helicopter: 'Helicopter',
  fastjet: 'Fast jet',
  uav: 'Unmanned',
  glider: 'Glider',
});

/** Same-origin URL for one contact; throws on a malformed Mode S address. */
export function aircraftIntelUrl({ hex, callsign } = {}) {
  const id = String(hex ?? '')
    .trim()
    .toLowerCase();
  if (!HEX_PATTERN.test(id)) throw new TypeError(`Invalid ICAO24 hex: ${hex}`);
  const cs = String(callsign ?? '')
    .trim()
    .toUpperCase();
  const query = CALLSIGN_PATTERN.test(cs)
    ? `?callsign=${encodeURIComponent(cs)}`
    : '';
  return `/api/aircraft-intel/${id}${query}`;
}

/**
 * Request the assembled registry payload. Network and HTTP failures throw;
 * the caller decides whether to render a live-only model instead.
 */
export async function fetchAircraftIntel({
  hex,
  callsign,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
} = {}) {
  const url = aircraftIntelUrl({ hex, callsign });
  signal?.throwIfAborted();
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`aircraft-intel HTTP ${response.status}`);
  const payload = await readResponseJsonCapped(
    response,
    AIRCRAFT_INTEL_MAX_BYTES,
    signal,
  );
  signal?.throwIfAborted();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Malformed aircraft intel payload');
  return payload;
}

/** Human label for an emergency squawk, or null for an ordinary code. */
export function emergencyForSquawk(squawk) {
  const code = String(squawk ?? '').trim();
  return Object.hasOwn(EMERGENCY_SQUAWKS, code)
    ? EMERGENCY_SQUAWKS[code]
    : null;
}

/** Whether the live contact came through the military lane. */
export function isMilitaryLive(live = {}) {
  return (
    live?.military === true ||
    live?.layerId === 'military' ||
    /^military/i.test(String(live?.layerName || ''))
  );
}

const airportText = (airport) => {
  if (!airport) return '';
  const code = airport.iata || airport.icao || '';
  const place = [airport.name, airport.municipality, airport.country]
    .map((value) => cleanText(value, 64))
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(', ');
  return [code, place].filter(Boolean).join(' · ');
};

const coordText = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    : '';

function numberOrText(value, formatter, fallback) {
  const number = Number(value);
  if (
    value !== '' &&
    value !== null &&
    value !== undefined &&
    Number.isFinite(number)
  )
    return formatter(number);
  return cleanText(fallback);
}

/**
 * Build the IntelModel for one aircraft.
 * @param {object} options
 * @param {object|null} [options.payload] `/api/aircraft-intel` response (null when the fetch failed).
 * @param {object} [options.live] The layer's published context properties plus optional numeric twins
 *   (altitudeFt, speedKt, headingDeg, verticalRateFpm, squawk, emergency, category, klass, layerId,
 *   latitude, longitude, positionSource, originCountry).
 * @param {number} [options.now] Epoch ms for freshness notes.
 */
export function buildAircraftIntelModel({
  payload = null,
  live = {},
  now = Date.now(),
} = {}) {
  const data = payload && typeof payload === 'object' ? payload : null;
  const hex = cleanText(
    data?.hex || live?.icao24 || live?.hex,
    6,
  ).toLowerCase();
  const callsign = cleanText(data?.callsign || live?.callsign, 8).toUpperCase();
  const registration = cleanText(data?.registration || live?.registration, 12);
  const military = isMilitaryLive(live);
  const squawkAlert = emergencyForSquawk(live?.squawk);
  const stale = /stale/i.test(String(live?.status || ''));

  const title =
    callsign || registration || (hex ? hex.toUpperCase() : '') || 'AIRCRAFT';
  const typeName = cleanText(data?.typeName || live?.type, 96);
  const operator = cleanText(
    data?.airline?.name || data?.owner || live?.operator,
    96,
  );
  const subtitle = [typeName, operator].filter(Boolean).join(' · ');

  const badges = [];
  if (squawkAlert) badges.push({ label: squawkAlert, tone: 'alert' });
  if (live?.emergency && !squawkAlert)
    badges.push({
      label: `EMERGENCY · ${cleanText(live.emergency, 24)}`,
      tone: 'alert',
    });
  if (military) badges.push({ label: 'MILITARY', tone: 'warn' });
  if (stale) badges.push({ label: 'STALE FIX', tone: 'warn' });
  if (data?.found) badges.push({ label: 'REGISTRY MATCH', tone: 'ok' });
  else if (data) badges.push({ label: 'NO REGISTRY MATCH', tone: 'warn' });
  else badges.push({ label: 'LIVE ONLY', tone: 'neutral' });
  if (live?.onGround === true || /ground/i.test(String(live?.altitude || '')))
    badges.push({ label: 'ON GROUND', tone: 'neutral' });

  const specs =
    data?.specs && typeof data.specs === 'object' ? data.specs : null;
  const klassLabel =
    CLASS_LABELS[String(live?.klass || '').toLowerCase()] ||
    cleanText(live?.klass, 24);

  const identity = intelSection('IDENTITY', [
    intelRow('Registration', registration, { mono: true }),
    intelRow('ICAO 24-bit', hex.toUpperCase(), { mono: true }),
    intelRow('Callsign', callsign, { mono: true }),
    intelRow('ICAO type', data?.icaoType, { mono: true }),
    intelRow('Type', typeName),
    intelRow('Manufacturer', data?.manufacturer),
    intelRow('Model', data?.model),
    intelRow('Class', klassLabel),
    intelRow('Emitter category', live?.category),
    intelRow(
      'Registered in',
      data?.ownerCountry
        ? `${data.ownerCountry}${data.ownerCountryIso ? ` (${data.ownerCountryIso})` : ''}`
        : '',
    ),
    intelRow('Origin country (ADS-B)', live?.originCountry),
  ]);

  const operatorSection = intelSection('OPERATOR', [
    intelRow('Registered owner', data?.owner),
    intelRow('Operator ICAO', data?.operatorIcao, { mono: true }),
    intelRow(
      'Airline',
      data?.airline?.name
        ? `${data.airline.name}${
            data.airline.icao || data.airline.iata
              ? ` (${[data.airline.icao, data.airline.iata].filter(Boolean).join(' / ')})`
              : ''
          }`
        : '',
    ),
    intelRow('Airline country', data?.airline?.country),
    intelRow('Airline callsign', data?.airline?.callsign),
    intelRow(
      'Operator (live feed)',
      live?.operator &&
        live.operator !== data?.owner &&
        live.operator !== data?.airline?.name
        ? live.operator
        : '',
    ),
  ]);

  const route =
    data?.route && typeof data.route === 'object' ? data.route : null;
  const routeSection = intelSection('ROUTE', [
    intelRow(
      'Flight',
      route?.callsignIata
        ? `${route.callsignIata} (${route.callsign || callsign})`
        : '',
    ),
    intelRow('Origin', airportText(route?.origin)),
    intelRow('Destination', airportText(route?.destination)),
    intelRow(
      'Origin position',
      coordText(route?.origin?.lat, route?.origin?.lon),
      { mono: true },
    ),
    intelRow(
      'Destination position',
      coordText(route?.destination?.lat, route?.destination?.lon),
      { mono: true },
    ),
    intelRow('Route (live feed)', !route && live?.route ? live.route : ''),
    intelRow(
      'Route source',
      route?.source
        ? `${route.source} (published route for the callsign, not today's flight plan)`
        : '',
    ),
  ]);

  const specsSection = intelSection('AIRFRAME SPECS', [
    intelRow(
      'Engines',
      specs?.engines
        ? `${specs.engines} × ${cleanText(specs.engineType, 24) || 'engine'}`
        : cleanText(specs?.engineType, 24),
    ),
    intelRow(
      'Wake category',
      WAKE_LABELS[specs?.wakeCategory] || specs?.wakeCategory,
    ),
    intelRow('Wingspan', fmtLength(specs?.wingspanM)),
    intelRow('Length', fmtLength(specs?.lengthM)),
    intelRow('Tail height', fmtLength(specs?.tailHeightM)),
    intelRow('Max takeoff weight', fmtMass(specs?.mtowKg)),
    intelRow(
      'Approach speed',
      specs?.approachSpeedKt ? fmtSpeed(specs.approachSpeedKt) : '',
    ),
    intelRow('Specs source', specs?.source),
  ]);

  const telemetry = intelSection('LIVE TELEMETRY', [
    intelRow(
      'Altitude',
      numberOrText(live?.altitudeFt, fmtAltitude, live?.altitude),
    ),
    intelRow(
      'Ground speed',
      numberOrText(live?.speedKt, fmtSpeed, live?.speed),
    ),
    intelRow(
      'Heading',
      numberOrText(
        live?.headingDeg,
        (deg) => `${fmtNumber(deg)}°`,
        live?.heading,
      ),
    ),
    intelRow(
      'Vertical rate',
      numberOrText(
        live?.verticalRateFpm,
        (fpm) => `${fpm > 0 ? '+' : ''}${fmtNumber(fpm)} ft/min`,
        live?.verticalRate,
      ),
    ),
    intelRow(
      'Squawk',
      live?.squawk
        ? `${cleanText(live.squawk, 4)}${squawkAlert ? ` — ${squawkAlert}` : ''}`
        : '',
      { mono: true },
    ),
    intelRow(
      'Position',
      coordText(Number(live?.latitude), Number(live?.longitude)),
      { mono: true },
    ),
    intelRow('Position source', live?.positionSource || live?.source),
    intelRow('Fix status', live?.status),
  ]);

  const militarySection = military
    ? intelSection('MILITARY', [
        intelRow('Operator', live?.operator || data?.owner),
        intelRow('Type', live?.type || typeName),
        intelRow('Serial / registration', registration, { mono: true }),
        intelRow('Feed', 'adsb.lol military lane (community ADS-B)'),
        intelRow(
          'Caveat',
          'Identity comes from community registries; capability and mission are never inferred.',
        ),
      ])
    : null;

  const links = [];
  if (hex) {
    links.push({
      label: 'planespotters.net',
      href: `https://www.planespotters.net/hex/${hex.toUpperCase()}`,
    });
    links.push({
      label: 'ADS-B Exchange',
      href: `https://globe.adsbexchange.com/?icao=${hex}`,
    });
    links.push({ label: 'adsb.lol', href: `https://adsb.lol/?icao=${hex}` });
    links.push({
      label: 'adsbdb record (JSON)',
      href: `https://api.adsbdb.com/v0/aircraft/${hex}`,
    });
  }
  if (callsign) {
    links.push({
      label: 'FlightAware',
      href: `https://flightaware.com/live/flight/${callsign}`,
    });
    links.push({
      label: 'Flightradar24',
      href: `https://www.flightradar24.com/data/flights/${callsign.toLowerCase()}`,
    });
  } else if (registration) {
    links.push({
      label: 'Flightradar24',
      href: `https://www.flightradar24.com/data/aircraft/${registration.toLowerCase()}`,
    });
  }
  if (data?.photo?.link)
    links.push({ label: 'Photo page', href: data.photo.link });

  const notes = [];
  if (!data)
    notes.push('Registry lookup unavailable — showing the live contact only.');
  for (const note of Array.isArray(data?.notes) ? data.notes : [])
    notes.push(note);
  if (data?.fetchedAt && now - data.fetchedAt > 6 * 3600_000)
    notes.push(`Registry data cached ${fmtDate(data.fetchedAt)}.`);

  return createIntelModel({
    kind: 'aircraft',
    id: hex || callsign || registration || 'unknown',
    title,
    subtitle,
    accent: military ? MILITARY_INTEL_ACCENT : AIRCRAFT_INTEL_ACCENT,
    badges,
    photo: data?.photo?.thumb
      ? {
          src: sanitizeHref(data.photo.thumb),
          link: data.photo.link || data.photo.full || null,
          credit: data.photo.credit
            ? `${data.photo.credit} · ${data.photo.source || 'photo'}`
            : data.photo.source || null,
        }
      : null,
    sections: [
      identity,
      operatorSection,
      routeSection,
      specsSection,
      telemetry,
      militarySection,
    ].filter(Boolean),
    links,
    raw: { payload: data, live: live && typeof live === 'object' ? live : {} },
    fetchedAt: data?.fetchedAt || null,
    notes,
  });
}
