/**
 * Launch / spacecraft intelligence card model.
 *
 * Pure. Accepts either the layer's normalized launch record (see
 * `normalizeRocketLaunches` in `src/layers/launches/model.js`) or a raw Launch
 * Library 2 launch object, and reduces both to one IntelModel:
 * `{kind, id, title, subtitle, accent, badges, photo, sections, links, raw,
 *   fetchedAt, notes}`.
 */

import { createIntelModel, sanitizeHref } from './intelModel.js';

const text = (value) => {
  const t = String(value ?? '').trim();
  return t && t !== 'undefined' && t !== 'null' ? t : '';
};
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';
const truncate = (value, max = 240) => {
  const t = text(value);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Only absolute http(s) links reach the card (shared contract rule). */
export function safeHttpUrl(value) {
  return sanitizeHref(value);
}

function fmtUtc(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * T-minus / T-plus text for a launch time.
 * @param {string|null} iso Launch time.
 * @param {number} nowMs
 * @returns {string} e.g. "T-02:14:05", "T+3 d 4 h", or '' when unknown.
 */
export function describeCountdown(iso, nowMs) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return '';
  const delta = ms - nowMs;
  const sign = delta >= 0 ? 'T-' : 'T+';
  const abs = Math.abs(delta);
  if (abs < 86_400_000) {
    const h = Math.floor(abs / 3_600_000);
    const m = Math.floor((abs % 3_600_000) / 60_000);
    const s = Math.floor((abs % 60_000) / 1000);
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  return `${sign}${d} d ${h} h`;
}

/** True for an untouched Launch Library 2 launch object. */
export function isRawLaunchLibraryLaunch(launch) {
  return Boolean(
    launch &&
    typeof launch === 'object' &&
    (text(launch.net) ||
      launch.rocket?.configuration ||
      launch.launch_service_provider ||
      launch.window_start),
  );
}

function coordinate(pad, key, index) {
  const direct = finite(pad?.[key]);
  if (direct !== null) return direct;
  const parts = String(pad?.location?.coordinates || '')
    .split(',')
    .map((v) => finite(v));
  return parts[index] ?? null;
}

function payloadFromRaw(flight, index) {
  const payload = flight?.payload || flight || {};
  return {
    id: String(flight?.id || payload.id || `payload-${index}`),
    name: text(payload.name || flight?.name) || 'Unnamed payload',
    type: text(payload.type?.name || flight?.type?.name) || null,
    manufacturer: text(payload.manufacturer?.name) || null,
    operator: text(payload.operator?.name) || null,
    destination: text(flight?.destination || payload.destination) || null,
    amount: finite(flight?.amount) ?? 1,
    massKg: finite(payload.mass),
  };
}

function stageFromRaw(stage, category, index) {
  const landing = stage?.landing || {};
  const launcher = stage?.launcher || stage?.spacecraft || {};
  const success = landing.success;
  return {
    id: String(stage?.id || landing.id || `${category}-${index}`),
    category,
    name:
      [text(stage?.type?.name || stage?.type), text(launcher.serial_number)]
        .filter(Boolean)
        .join(' · ') || `${category} stage ${index + 1}`,
    serial: text(launcher.serial_number) || null,
    reused: stage?.reused === true,
    flightNumber: finite(stage?.launcher_flight_number),
    status:
      success === true
        ? 'RECOVERED'
        : success === false
          ? 'LOST'
          : landing.attempt === true
            ? 'RECOVERY ATTEMPT'
            : text(landing.type?.name).toUpperCase() ||
              text(launcher.status?.name).toUpperCase() ||
              'NO RECOVERY DATA',
    recoveryType: text(landing.type?.name) || null,
    destination:
      text(landing.landing_location?.name || landing.type?.name) || null,
    downrangeKm: finite(landing.downrange_distance),
  };
}

/**
 * Reduce a raw LL2 launch or a normalized layer record to one shape.
 * @param {object} launch
 * @returns {object|null}
 */
export function normalizeLaunchForIntel(launch) {
  if (!launch || typeof launch !== 'object') return null;
  if (isRawLaunchLibraryLaunch(launch)) {
    const configuration = launch.rocket?.configuration || {};
    const provider = launch.launch_service_provider || {};
    const mission = launch.mission || {};
    const pad = launch.pad || {};
    const image =
      typeof launch.image === 'string'
        ? launch.image
        : text(launch.image?.image_url || launch.image?.thumbnail_url);
    const payloads = (
      launch.rocket?.payloads ||
      launch.payloads ||
      mission.payloads ||
      []
    ).map(payloadFromRaw);
    const stages = [
      ...(launch.rocket?.launcher_stage || []).map((stage, index) =>
        stageFromRaw(stage, 'LAUNCHER', index),
      ),
      ...(launch.rocket?.spacecraft_stage
        ? [launch.rocket.spacecraft_stage]
            .flat()
            .filter(Boolean)
            .map((stage, index) => stageFromRaw(stage, 'SPACECRAFT', index))
        : []),
    ];
    return {
      id: text(launch.id || launch.slug || launch.name) || 'launch',
      slug: text(launch.slug) || null,
      name: text(launch.name) || 'Unnamed launch',
      vehicle:
        text(configuration.full_name || configuration.name) ||
        text(launch.name).split(' | ')[0] ||
        null,
      vehicleFamily:
        text(configuration.family?.[0]?.name || configuration.family) || null,
      vehicleVariant: text(configuration.variant) || null,
      status: text(launch.status?.name) || 'Unknown',
      statusAbbrev: text(launch.status?.abbrev) || null,
      statusDescription: text(launch.status?.description) || null,
      launchTime: text(launch.net) || text(launch.window_start) || null,
      windowStart: text(launch.window_start) || null,
      windowEnd: text(launch.window_end) || null,
      netPrecision: text(launch.net_precision?.name) || null,
      probability: finite(launch.probability),
      weatherConcerns: text(launch.weather_concerns) || null,
      holdReason: text(launch.holdreason) || null,
      failReason: text(launch.failreason) || null,
      provider: text(provider.name) || null,
      providerAbbrev: text(provider.abbrev) || null,
      providerType: text(provider.type?.name || provider.type) || null,
      providerCountry:
        text(
          Array.isArray(provider.country)
            ? provider.country.map((c) => c?.name || c).join(', ')
            : provider.country_code,
        ) || null,
      missionName: text(mission.name) || null,
      missionDescription: text(mission.description) || null,
      missionType: text(mission.type) || null,
      orbit: mission.orbit
        ? {
            name: text(mission.orbit.name) || null,
            abbrev: text(mission.orbit.abbrev) || null,
          }
        : null,
      agencies: Array.isArray(mission.agencies)
        ? mission.agencies.map((agency) => text(agency?.name)).filter(Boolean)
        : [],
      program: Array.isArray(launch.program)
        ? launch.program.map((program) => text(program?.name)).filter(Boolean)
        : [],
      pad: {
        name: text(pad.name) || null,
        location: text(pad.location?.name) || null,
        country: text(pad.country?.name || pad.location?.country_code) || null,
        lat: coordinate(pad, 'latitude', 1),
        lon: coordinate(pad, 'longitude', 0),
        wiki: safeHttpUrl(pad.wiki_url),
        map: safeHttpUrl(pad.map_url),
        totalLaunches: finite(pad.total_launch_count),
      },
      payloads,
      recoveryStages: stages,
      timeline: Array.isArray(launch.timeline)
        ? launch.timeline.map((event) => ({
            name:
              text(event?.type?.abbrev || event?.type?.name || event?.name) ||
              'Mission event',
            relativeTime: text(event?.relative_time) || null,
          }))
        : [],
      image: safeHttpUrl(image),
      webcastUrls: (launch.vid_urls || launch.vidURLs || [])
        .map((entry) =>
          safeHttpUrl(typeof entry === 'string' ? entry : entry?.url),
        )
        .filter(Boolean),
      infoUrls: (launch.info_urls || launch.infoURLs || [])
        .map((entry) =>
          safeHttpUrl(typeof entry === 'string' ? entry : entry?.url),
        )
        .filter(Boolean),
      source: 'Launch Library 2',
      raw: launch,
    };
  }
  const orbit =
    launch.orbit && typeof launch.orbit === 'object'
      ? {
          name: text(launch.orbit.name) || null,
          abbrev: text(launch.orbit.abbrev) || null,
        }
      : typeof launch.orbit === 'string'
        ? { name: launch.orbit, abbrev: null }
        : null;
  return {
    id: text(launch.id) || 'launch',
    slug: null,
    name: text(launch.name) || 'Unnamed launch',
    vehicle: text(launch.vehicle) || text(launch.name).split(' | ')[0] || null,
    vehicleFamily: null,
    vehicleVariant: null,
    status: text(launch.status) || 'Unknown',
    statusAbbrev: null,
    statusDescription: null,
    launchTime: text(launch.launchTime) || null,
    windowStart: null,
    windowEnd: null,
    netPrecision: null,
    probability: null,
    weatherConcerns: null,
    holdReason: null,
    failReason: null,
    provider: text(launch.provider) || null,
    providerAbbrev: null,
    providerType: null,
    providerCountry: null,
    missionName: text(launch.missionName) || null,
    missionDescription: text(launch.mission) || null,
    missionType: null,
    orbit,
    agencies: [],
    program: [],
    pad: {
      name: text(launch.launchSite) || null,
      location: null,
      country: null,
      lat: finite(launch.lat),
      lon: finite(launch.lon),
      wiki: null,
      map: null,
      totalLaunches: null,
    },
    payloads: Array.isArray(launch.payloads) ? launch.payloads : [],
    recoveryStages: Array.isArray(launch.recoveryStages)
      ? launch.recoveryStages
      : [],
    timeline: Array.isArray(launch.timeline) ? launch.timeline : [],
    image: null,
    webcastUrls: [],
    infoUrls: [],
    source: text(launch.source) || 'Launch Library 2',
    raw: launch,
  };
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (/success/.test(s)) return 'ok';
  if (/fail|hold|abort/.test(s)) return 'alert';
  if (/partial/.test(s)) return 'warn';
  if (/go|in flight|launch/.test(s)) return 'neutral';
  return 'neutral';
}

/**
 * Build the launch intel model.
 * @param {{launch: object, nowMs?: number}} options
 * @returns {object|null} IntelModel, or null without a launch.
 */
export function buildLaunchIntelModel({ launch, nowMs = Date.now() } = {}) {
  const info = normalizeLaunchForIntel(launch);
  if (!info) return null;
  const sections = [];
  const notes = [];
  const countdown = describeCountdown(info.launchTime, nowMs);

  const mission = [
    { label: 'Launch', value: info.name },
    { label: 'Status', value: info.status },
  ];
  if (info.statusDescription)
    mission.push({
      label: 'Status detail',
      value: truncate(info.statusDescription, 160),
    });
  if (info.launchTime)
    mission.push({
      label: 'NET',
      value: `${fmtUtc(info.launchTime)}${countdown ? ` (${countdown})` : ''}`,
    });
  if (info.windowStart && info.windowEnd && info.windowStart !== info.windowEnd)
    mission.push({
      label: 'Window',
      value: `${fmtUtc(info.windowStart)} → ${fmtUtc(info.windowEnd)}`,
    });
  if (info.netPrecision)
    mission.push({ label: 'NET precision', value: info.netPrecision });
  if (info.missionName)
    mission.push({ label: 'Mission', value: info.missionName });
  if (info.missionType)
    mission.push({ label: 'Mission type', value: info.missionType });
  if (info.orbit?.name)
    mission.push({
      label: 'Target orbit',
      value: info.orbit.abbrev
        ? `${info.orbit.name} (${info.orbit.abbrev})`
        : info.orbit.name,
    });
  if (info.program.length)
    mission.push({ label: 'Program', value: info.program.join(', ') });
  if (info.agencies.length)
    mission.push({ label: 'Agencies', value: info.agencies.join(', ') });
  if (Number.isFinite(info.probability))
    mission.push({
      label: 'Go probability',
      value: `${fmt(info.probability)}%`,
    });
  if (info.weatherConcerns)
    mission.push({
      label: 'Weather',
      value: truncate(info.weatherConcerns, 120),
    });
  if (info.holdReason)
    mission.push({
      label: 'Hold reason',
      value: truncate(info.holdReason, 160),
    });
  if (info.failReason)
    mission.push({ label: 'Failure', value: truncate(info.failReason, 200) });
  if (info.missionDescription)
    mission.push({
      label: 'Description',
      value: truncate(info.missionDescription, 400),
    });
  sections.push({ heading: 'MISSION', rows: mission });

  const vehicle = [];
  if (info.vehicle) vehicle.push({ label: 'Vehicle', value: info.vehicle });
  if (info.vehicleFamily)
    vehicle.push({ label: 'Family', value: info.vehicleFamily });
  if (info.vehicleVariant)
    vehicle.push({ label: 'Variant', value: info.vehicleVariant });
  if (vehicle.length) sections.push({ heading: 'VEHICLE', rows: vehicle });

  if (info.payloads.length) {
    const rows = info.payloads.slice(0, 12).map((payload) => {
      const detail = [
        payload.type,
        Number.isFinite(payload.massKg) ? `${fmt(payload.massKg)} kg` : null,
        payload.operator || payload.manufacturer,
        payload.destination,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        label:
          payload.amount > 1
            ? `${payload.name} ×${payload.amount}`
            : payload.name,
        value: detail || '—',
      };
    });
    if (info.payloads.length > 12)
      rows.push({
        label: 'More',
        value: `${info.payloads.length - 12} further payloads`,
      });
    sections.push({ heading: 'PAYLOADS', rows });
  }

  if (info.recoveryStages.length) {
    sections.push({
      heading: 'RECOVERY',
      rows: info.recoveryStages.slice(0, 8).map((stage) => ({
        label: stage.name || stage.category,
        value: [
          stage.status,
          stage.destination,
          Number.isFinite(stage.downrangeKm)
            ? `${fmt(stage.downrangeKm)} km downrange`
            : null,
          stage.reused
            ? `reused${Number.isFinite(stage.flightNumber) ? ` · flight ${stage.flightNumber}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    });
  }

  const provider = [];
  if (info.provider)
    provider.push({
      label: 'Provider',
      value:
        info.providerAbbrev && info.providerAbbrev !== info.provider
          ? `${info.provider} (${info.providerAbbrev})`
          : info.provider,
    });
  if (info.providerType)
    provider.push({ label: 'Type', value: info.providerType });
  if (info.providerCountry)
    provider.push({ label: 'Country', value: info.providerCountry });
  if (provider.length) sections.push({ heading: 'PROVIDER', rows: provider });

  const pad = [];
  if (info.pad.name) pad.push({ label: 'Pad', value: info.pad.name });
  if (info.pad.location)
    pad.push({ label: 'Location', value: info.pad.location });
  if (info.pad.country) pad.push({ label: 'Country', value: info.pad.country });
  if (Number.isFinite(info.pad.lat) && Number.isFinite(info.pad.lon))
    pad.push({
      label: 'Coordinates',
      value: `${fmt(info.pad.lat, 4)}°, ${fmt(info.pad.lon, 4)}°`,
      mono: true,
    });
  if (Number.isFinite(info.pad.totalLaunches))
    pad.push({
      label: 'Launches from pad',
      value: fmt(info.pad.totalLaunches),
    });
  if (pad.length) sections.push({ heading: 'PAD', rows: pad });

  if (info.timeline.length) {
    sections.push({
      heading: 'TIMELINE',
      rows: info.timeline.slice(0, 16).map((event) => ({
        label: event.name,
        value: event.relativeTime || '—',
        mono: true,
      })),
    });
  }

  const links = [];
  for (const [index, href] of info.webcastUrls.entries())
    links.push({
      label: index === 0 ? 'Webcast' : `Webcast ${index + 1}`,
      href,
    });
  for (const [index, href] of info.infoUrls.slice(0, 3).entries())
    links.push({
      label: index === 0 ? 'Mission info' : `Info ${index + 1}`,
      href,
    });
  if (info.pad.wiki)
    links.push({ label: 'Pad on Wikipedia', href: info.pad.wiki });
  if (info.pad.map) links.push({ label: 'Pad map', href: info.pad.map });
  if (info.slug)
    links.push({
      label: 'Space Launch Now',
      href: `https://spacelaunchnow.me/launch/${encodeURIComponent(info.slug)}`,
    });
  if (/^[0-9a-f-]{36}$/i.test(info.id))
    links.push({
      label: 'Launch Library 2 record',
      href: `https://ll.thespacedevs.com/2.3.0/launches/${info.id}/`,
    });
  const query = info.missionName || info.name;
  if (query)
    links.push({
      label: 'Wikipedia search',
      href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`,
    });

  const badges = [
    { label: info.status.toUpperCase(), tone: statusTone(info.status) },
  ];
  if (countdown) badges.push({ label: countdown, tone: 'neutral' });
  if (info.orbit?.abbrev)
    badges.push({ label: info.orbit.abbrev.toUpperCase(), tone: 'neutral' });

  notes.push('Source: Launch Library 2 (The Space Devs). Times are UTC.');
  if (!isRawLaunchLibraryLaunch(launch))
    notes.push(
      'Built from the layer record; webcast and provider detail need the raw feed object.',
    );

  return createIntelModel({
    kind: 'launch',
    id: `launch:${info.id}`,
    title: truncate(info.missionName || info.name, 80),
    subtitle: [info.vehicle, info.provider, info.status]
      .filter(Boolean)
      .join(' · '),
    accent: '#ffb347',
    badges,
    photo: info.image
      ? { src: info.image, link: info.image, credit: 'Launch Library 2' }
      : null,
    sections,
    links,
    raw: info,
    fetchedAt: null,
    notes,
  });
}
