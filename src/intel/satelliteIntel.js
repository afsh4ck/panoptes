import { readResponseJsonCapped } from '../sources/httpBody.js';
import {
  satelliteClassColor,
  satelliteClassLabel,
} from '../data/satelliteClass.js';
import { createIntelModel, sanitizeHref } from './intelModel.js';

/**
 * Satellite intelligence card model.
 *
 * Pure: no Cesium, no satellite.js. Orbital elements are read either from the
 * SGP4 record the satellites layer already holds (`satrec`, via
 * `getTrackedSatellite()`) or from the CelesTrak GP set the `/api/satcat`
 * proxy returns; both reduce to the same Keplerian summary. Live position
 * comes from the layer's per-frame propagation (`getTrackedInfo()` or the
 * shared context record), and the next pass from the layer's own
 * `getNextSatellitePass()` — the card never propagates anything itself.
 *
 * Output follows the shared IntelModel contract:
 * `{kind, id, title, subtitle, accent, badges, photo, sections, links, raw,
 *   fetchedAt, notes}`.
 */

export const EARTH_RADIUS_KM = 6378.137;
export const MU_KM3_S2 = 398600.4418;
const SIDEREAL_DAY_MIN = 1436.07;
const RAD = 180 / Math.PI;
const MAX_INTEL_BYTES = 256 * 1024;

const finite = (value) => (Number.isFinite(value) ? value : null);
const text = (value) => {
  const t = String(value ?? '').trim();
  return t && t !== 'undefined' && t !== 'null' ? t : '';
};
const fmt = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';
const fmtKm = (value, digits = 0) =>
  Number.isFinite(value) ? `${fmt(value, digits)} km` : '—';
const fmtDeg = (value, digits = 2) =>
  Number.isFinite(value) ? `${fmt(value, digits)}°` : '—';
const truncate = (value, max = 160) => {
  const t = text(value);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Only absolute http(s) links reach the card (shared contract rule). */
export function safeHttpUrl(value) {
  return sanitizeHref(value);
}

/** Convert a Julian date to epoch milliseconds. */
export function julianDateToMs(jd) {
  if (!Number.isFinite(jd)) return null;
  return Math.round((jd - 2440587.5) * 86400000);
}

function fmtUtc(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Human age of an instant relative to now ("3.2 h ago", "in 12 min"). */
export function describeAge(ms, nowMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return '';
  const delta = nowMs - ms;
  const abs = Math.abs(delta);
  const unit =
    abs < 90_000
      ? `${Math.round(abs / 1000)} s`
      : abs < 5_400_000
        ? `${Math.round(abs / 60_000)} min`
        : abs < 172_800_000
          ? `${(abs / 3_600_000).toFixed(1)} h`
          : `${(abs / 86_400_000).toFixed(1)} d`;
  return delta >= 0 ? `${unit} ago` : `in ${unit}`;
}

/**
 * Keplerian summary from a satellite.js SGP4 record. The record stores mean
 * motion in radians per minute and angles in radians.
 * @param {object} satrec satellite.js record (`no`, `ecco`, `inclo`, `nodeo`,
 *   `argpo`, `mo`, `bstar`, `jdsatepoch`).
 * @returns {object|null}
 */
export function orbitalElementsFromSatrec(satrec) {
  if (!satrec || !Number.isFinite(satrec.no) || satrec.no <= 0) return null;
  const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI);
  return orbitalElementsFrom({
    meanMotionRevPerDay,
    eccentricity: finite(satrec.ecco),
    inclinationDeg: Number.isFinite(satrec.inclo) ? satrec.inclo * RAD : null,
    raanDeg: Number.isFinite(satrec.nodeo) ? satrec.nodeo * RAD : null,
    argPerigeeDeg: Number.isFinite(satrec.argpo) ? satrec.argpo * RAD : null,
    meanAnomalyDeg: Number.isFinite(satrec.mo) ? satrec.mo * RAD : null,
    bstar: finite(satrec.bstar),
    epochMs: julianDateToMs(satrec.jdsatepoch),
    source: 'loaded TLE (layer)',
  });
}

/**
 * Keplerian summary from a normalized CelesTrak GP (OMM) record as the
 * `/api/satcat` proxy returns it (mean motion in revolutions per day).
 * @param {object} gp Normalized GP record.
 * @returns {object|null}
 */
export function orbitalElementsFromGp(gp) {
  if (!gp || !Number.isFinite(gp.meanMotion) || gp.meanMotion <= 0) return null;
  const epochMs = gp.epoch ? Date.parse(`${gp.epoch}Z`) : NaN;
  return orbitalElementsFrom({
    meanMotionRevPerDay: gp.meanMotion,
    eccentricity: finite(gp.eccentricity),
    inclinationDeg: finite(gp.inclinationDeg),
    raanDeg: finite(gp.raanDeg),
    argPerigeeDeg: finite(gp.argPerigeeDeg),
    meanAnomalyDeg: finite(gp.meanAnomalyDeg),
    bstar: finite(gp.bstar),
    epochMs: Number.isFinite(epochMs) ? epochMs : null,
    source: 'CelesTrak GP',
  });
}

function orbitalElementsFrom(base) {
  const n = base.meanMotionRevPerDay;
  const periodMin = 1440 / n;
  const nRadS = (n * 2 * Math.PI) / 86400;
  const semiMajorAxisKm = Math.cbrt(MU_KM3_S2 / (nRadS * nRadS));
  const e = Number.isFinite(base.eccentricity) ? base.eccentricity : 0;
  return {
    ...base,
    periodMin,
    semiMajorAxisKm,
    apogeeKm: semiMajorAxisKm * (1 + e) - EARTH_RADIUS_KM,
    perigeeKm: semiMajorAxisKm * (1 - e) - EARTH_RADIUS_KM,
  };
}

/**
 * Orbit regime from the mean elements. Heuristic thresholds; the label is a
 * description of the orbit, never a statement about the mission.
 * @param {object|null} elements Output of orbitalElementsFrom*.
 * @returns {{regime: string, label: string, notes: string[]}}
 */
export function classifyOrbitRegime(elements) {
  if (!elements || !Number.isFinite(elements.periodMin))
    return { regime: 'UNKNOWN', label: 'Unknown orbit', notes: [] };
  const { periodMin, apogeeKm, perigeeKm } = elements;
  const e = Number.isFinite(elements.eccentricity) ? elements.eccentricity : 0;
  const inc = Number.isFinite(elements.inclinationDeg)
    ? elements.inclinationDeg
    : null;
  const notes = [];
  if (apogeeKm > 400_000)
    return { regime: 'DEEP', label: 'Deep space / escape', notes };
  if (Math.abs(periodMin - SIDEREAL_DAY_MIN) < 25 && e < 0.02) {
    if (inc !== null && inc < 7)
      return { regime: 'GEO', label: 'Geostationary (GEO)', notes };
    return {
      regime: 'GSO',
      label: 'Geosynchronous, inclined (GSO)',
      notes: ['Period matches one sidereal day; inclined ground track'],
    };
  }
  if (e > 0.5 && inc !== null && Math.abs(inc - 63.4) < 5)
    return {
      regime: 'MOLNIYA',
      label: 'Molniya-type highly elliptical',
      notes: [
        'Critical inclination ≈63.4° holds the apogee over one hemisphere',
      ],
    };
  if (e > 0.25)
    return { regime: 'HEO', label: 'Highly elliptical (HEO)', notes };
  if (apogeeKm < 2000) {
    if (inc !== null && inc >= 96 && inc <= 100.5)
      notes.push(
        'Retrograde ~97–99° inclination is typical of sun-synchronous orbits',
      );
    return {
      regime: 'LEO',
      label:
        notes.length > 0
          ? 'Low Earth orbit (LEO) · sun-synchronous (probable)'
          : 'Low Earth orbit (LEO)',
      notes,
    };
  }
  if (perigeeKm > 2000 && apogeeKm < 35_000)
    return { regime: 'MEO', label: 'Medium Earth orbit (MEO)', notes };
  return { regime: 'OTHER', label: 'Non-standard orbit', notes };
}

/**
 * Instantaneous orbital speed by vis-viva for a given geocentric radius.
 * @param {{radiusKm: number, semiMajorAxisKm: number}} options
 * @returns {number|null} km/s
 */
export function orbitalSpeedKmS({ radiusKm, semiMajorAxisKm }) {
  if (
    !Number.isFinite(radiusKm) ||
    !Number.isFinite(semiMajorAxisKm) ||
    radiusKm <= 0 ||
    semiMajorAxisKm <= 0
  )
    return null;
  const v2 = MU_KM3_S2 * (2 / radiusKm - 1 / semiMajorAxisKm);
  return v2 > 0 ? Math.sqrt(v2) : null;
}

/** Radar cross-section size class per the 18 SDS convention. */
export function rcsSizeClass(rcsM2) {
  if (!Number.isFinite(rcsM2)) return null;
  if (rcsM2 < 0.1) return 'small';
  if (rcsM2 < 1) return 'medium';
  return 'large';
}

/** External references for one catalog object. */
export function satelliteIntelLinks(norad, name) {
  const id = Number(norad);
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  const links = [
    {
      label: 'CelesTrak SATCAT',
      href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${id}`,
    },
    { label: 'N2YO tracking', href: `https://www.n2yo.com/satellite/?s=${id}` },
    {
      label: 'Heavens-Above',
      href: `https://www.heavens-above.com/orbit.aspx?satid=${id}`,
    },
  ];
  const q = text(name);
  if (q)
    links.push({
      label: 'Wikipedia search',
      href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    });
  return links;
}

/**
 * Fetch the proxy payload for one catalog number.
 * @param {{norad: number|string, fetchImpl?: Function, signal?: AbortSignal}} options
 * @returns {Promise<object>} `/api/satcat` JSON.
 */
export async function fetchSatelliteIntel({
  norad,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
} = {}) {
  const id = Number(norad);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error('A NORAD catalog number is required');
  signal?.throwIfAborted();
  const response = await fetchImpl(`/api/satcat/${id}`, { signal });
  if (!response.ok) throw new Error(`SATCAT HTTP ${response.status}`);
  const payload = await readResponseJsonCapped(
    response,
    MAX_INTEL_BYTES,
    signal,
  );
  if (!payload || typeof payload !== 'object')
    throw new Error('Malformed SATCAT response');
  return payload;
}

function statusTone(code) {
  if (code === '+') return 'ok';
  if (code === 'D' || code === '-') return 'alert';
  if (!code || code === '?') return 'neutral';
  return 'warn';
}

/** Accept a context-store record, a flat descriptor, or nothing. */
function normalizeLive(live) {
  if (!live || typeof live !== 'object') return {};
  const props =
    live.properties && typeof live.properties === 'object'
      ? live.properties
      : {};
  const altitudeM = finite(live.altitudeM);
  const altitudeText = text(props.altitude || live.altitude);
  const altitudeKm =
    altitudeM !== null
      ? altitudeM / 1000
      : Number.parseFloat(altitudeText.replace(/,/g, '')) || null;
  return {
    name: text(props.name || live.name || live.label),
    noradId: Number(props.noradId ?? live.noradId ?? live.id) || null,
    classLabel: text(props.class || live.classLabel),
    group: text(live.group),
    isIss: live.isIss === true,
    latitude: finite(live.latitude),
    longitude: finite(live.longitude),
    altitudeKm: Number.isFinite(altitudeKm) ? altitudeKm : null,
  };
}

/**
 * Build the satellite intel model.
 * @param {object} options
 * @param {object|null} [options.payload] `/api/satcat` JSON (satcat + gp).
 * @param {object|null} [options.live] Context record or `getTrackedInfo()` output.
 * @param {object|null} [options.satrec] satellite.js record from `getTrackedSatellite()`.
 * @param {number} [options.nowMs]
 * @param {{latDeg: number, lonDeg: number, label?: string}|null} [options.observer]
 * @param {object|null} [options.nextPass] `getNextSatellitePass()` result.
 * @returns {object} IntelModel.
 */
export function buildSatelliteIntelModel({
  payload = null,
  live = null,
  satrec = null,
  nowMs = Date.now(),
  observer = null,
  nextPass = null,
} = {}) {
  const sat = payload?.satcat || null;
  const gp = payload?.gp || null;
  const current = normalizeLive(live);
  const norad =
    sat?.norad ||
    gp?.norad ||
    current.noradId ||
    Number(payload?.norad) ||
    null;
  const name = text(sat?.name || gp?.name || current.name) || `NORAD ${norad}`;
  const elements =
    orbitalElementsFromSatrec(satrec) || orbitalElementsFromGp(gp) || null;
  const regime = classifyOrbitRegime(
    elements ||
      (sat && Number.isFinite(sat.periodMin)
        ? {
            periodMin: sat.periodMin,
            apogeeKm: sat.apogeeKm,
            perigeeKm: sat.perigeeKm,
            inclinationDeg: sat.inclinationDeg,
            eccentricity:
              Number.isFinite(sat.apogeeKm) && Number.isFinite(sat.perigeeKm)
                ? (sat.apogeeKm - sat.perigeeKm) /
                  (sat.apogeeKm + sat.perigeeKm + 2 * EARTH_RADIUS_KM)
                : 0,
          }
        : null),
  );
  const classLabel =
    current.classLabel ||
    (current.group
      ? satelliteClassLabel(current.group, { isIss: current.isIss })
      : '');
  const accent = current.group ? satelliteClassColor(current.group) : '#c89bff';
  const notes = [];
  const sections = [];

  const identity = [
    { label: 'Name', value: name },
    { label: 'NORAD ID', value: norad ? String(norad) : '—', mono: true },
  ];
  const intl = text(sat?.intlDesignator || gp?.intlDesignator);
  if (intl) identity.push({ label: 'COSPAR ID', value: intl, mono: true });
  if (sat) {
    identity.push({ label: 'Object type', value: sat.objectTypeLabel || '—' });
    identity.push({
      label: 'Owner / source',
      value: sat.ownerLabel
        ? sat.owner && sat.owner !== sat.ownerLabel
          ? `${sat.ownerLabel} (${sat.owner})`
          : sat.ownerLabel
        : '—',
    });
    identity.push({ label: 'Launched', value: sat.launchDate || '—' });
    identity.push({
      label: 'Launch site',
      value: sat.launchSiteLabel
        ? sat.launchSite && sat.launchSite !== sat.launchSiteLabel
          ? `${sat.launchSiteLabel} (${sat.launchSite})`
          : sat.launchSiteLabel
        : '—',
    });
    identity.push({ label: 'Status', value: sat.statusLabel || 'Unknown' });
    if (sat.decayDate)
      identity.push({ label: 'Decayed', value: sat.decayDate });
    if (Number.isFinite(sat.rcsM2))
      identity.push({
        label: 'Radar cross-section',
        value: `${fmt(sat.rcsM2, sat.rcsM2 < 1 ? 3 : 1)} m² (${rcsSizeClass(sat.rcsM2)})`,
      });
    if (sat.orbitCenterLabel && sat.orbitCenter !== 'EA')
      identity.push({ label: 'Orbit center', value: sat.orbitCenterLabel });
    if (sat.orbitTypeLabel && sat.orbitType !== 'ORB')
      identity.push({ label: 'Orbit type', value: sat.orbitTypeLabel });
    if (sat.dataStatusLabel)
      identity.push({ label: 'Element data', value: sat.dataStatusLabel });
  } else if (payload && payload.found === false) {
    notes.push('No SATCAT record for this catalog number.');
  }
  sections.push({ heading: 'IDENTITY', rows: identity });

  const orbitRows = [{ label: 'Regime', value: regime.label }];
  if (elements) {
    orbitRows.push(
      { label: 'Period', value: `${fmt(elements.periodMin, 1)} min` },
      { label: 'Inclination', value: fmtDeg(elements.inclinationDeg) },
      {
        label: 'Apogee / perigee',
        value: `${fmtKm(elements.apogeeKm)} / ${fmtKm(elements.perigeeKm)}`,
      },
      {
        label: 'Eccentricity',
        value: fmt(elements.eccentricity, 5),
        mono: true,
      },
      { label: 'RAAN', value: fmtDeg(elements.raanDeg) },
      { label: 'Arg. of perigee', value: fmtDeg(elements.argPerigeeDeg) },
      { label: 'Mean anomaly', value: fmtDeg(elements.meanAnomalyDeg) },
      {
        label: 'Mean motion',
        value: `${fmt(elements.meanMotionRevPerDay, 4)} rev/day`,
      },
      { label: 'Semi-major axis', value: fmtKm(elements.semiMajorAxisKm, 1) },
    );
    if (Number.isFinite(elements.epochMs))
      orbitRows.push({
        label: 'Elements epoch',
        value: `${fmtUtc(elements.epochMs)} (${describeAge(elements.epochMs, nowMs)})`,
      });
    if (Number.isFinite(elements.bstar))
      orbitRows.push({
        label: 'B* drag term',
        value: elements.bstar.toExponential(4),
        mono: true,
      });
    orbitRows.push({ label: 'Elements source', value: elements.source });
    if (
      Number.isFinite(elements.epochMs) &&
      nowMs - elements.epochMs > 7 * 86_400_000
    )
      notes.push(
        'Element set is over a week old; propagated positions drift with age.',
      );
  } else if (sat && Number.isFinite(sat.periodMin)) {
    orbitRows.push(
      { label: 'Period', value: `${fmt(sat.periodMin, 1)} min` },
      { label: 'Inclination', value: fmtDeg(sat.inclinationDeg) },
      {
        label: 'Apogee / perigee',
        value: `${fmtKm(sat.apogeeKm)} / ${fmtKm(sat.perigeeKm)}`,
      },
      { label: 'Elements source', value: 'SATCAT mean orbit' },
    );
  } else {
    orbitRows.push({ label: 'Elements', value: 'Not available' });
  }
  for (const note of regime.notes) notes.push(note);
  sections.push({ heading: 'ORBIT', rows: orbitRows });

  if (
    current.latitude !== null ||
    current.longitude !== null ||
    current.altitudeKm !== null
  ) {
    const liveRows = [];
    if (current.latitude !== null && current.longitude !== null)
      liveRows.push({
        label: 'Sub-satellite point',
        value: `${fmt(current.latitude, 3)}°, ${fmt(current.longitude, 3)}°`,
        mono: true,
      });
    if (current.altitudeKm !== null)
      liveRows.push({ label: 'Altitude', value: fmtKm(current.altitudeKm) });
    const speed =
      current.altitudeKm !== null && elements
        ? orbitalSpeedKmS({
            radiusKm: EARTH_RADIUS_KM + current.altitudeKm,
            semiMajorAxisKm: elements.semiMajorAxisKm,
          })
        : null;
    if (speed !== null)
      liveRows.push({
        label: 'Orbital speed',
        value: `${fmt(speed, 2)} km/s (${fmt(speed * 3600, 0)} km/h)`,
      });
    liveRows.push({ label: 'As of', value: fmtUtc(nowMs) });
    sections.push({ heading: 'LIVE (SGP4)', rows: liveRows });
  }

  const pass =
    nextPass?.status === 'ok'
      ? nextPass.pass
      : nextPass?.riseMs
        ? nextPass
        : null;
  if (observer && pass && Number.isFinite(pass.riseMs)) {
    sections.push({
      heading: `NEXT PASS · ${text(observer.label) || `${fmt(observer.latDeg, 2)}°, ${fmt(observer.lonDeg, 2)}°`}`,
      rows: [
        {
          label: 'Rise',
          value: `${fmtUtc(pass.riseMs)} (${describeAge(pass.riseMs, nowMs)})`,
        },
        {
          label: 'Peak',
          value: `${fmtDeg(pass.maxElevDeg, 0)} at ${fmtUtc(pass.maxElevMs)}`,
        },
        { label: 'Set', value: fmtUtc(pass.setMs) },
        {
          label: 'Duration',
          value: `${fmt((pass.setMs - pass.riseMs) / 60000, 1)} min`,
        },
        { label: 'Rise azimuth', value: fmtDeg(pass.riseAzDeg, 0) },
        {
          label: 'Naked-eye visible',
          value: pass.visible ? 'Yes' : 'No',
        },
      ],
    });
  } else if (observer && nextPass?.status === 'none') {
    sections.push({
      heading: 'NEXT PASS',
      rows: [{ label: 'Within 24 h', value: 'No pass above 10° elevation' }],
    });
  }

  const classRows = [];
  if (classLabel) classRows.push({ label: 'Catalog group', value: classLabel });
  if (sat?.objectTypeLabel)
    classRows.push({ label: 'Object type', value: sat.objectTypeLabel });
  if (gp?.classification)
    classRows.push({
      label: 'Element classification',
      value:
        gp.classification === 'U'
          ? 'U — unclassified elements'
          : gp.classification,
    });
  if (classRows.length) {
    classRows.push({
      label: 'Note',
      value:
        'Group reflects the CelesTrak catalog list the object was loaded from, not a confirmed mission or operator.',
    });
    sections.push({ heading: 'CLASSIFICATION', rows: classRows });
  }

  if (gp) {
    const setRows = [];
    if (Number.isFinite(gp.elementSetNo))
      setRows.push({
        label: 'Element set no.',
        value: String(gp.elementSetNo),
        mono: true,
      });
    if (Number.isFinite(gp.revAtEpoch))
      setRows.push({
        label: 'Revolutions at epoch',
        value: fmt(gp.revAtEpoch),
      });
    if (Number.isFinite(gp.meanMotionDot))
      setRows.push({
        label: 'Mean motion dot',
        value: `${gp.meanMotionDot.toExponential(3)} rev/day²`,
        mono: true,
      });
    if (Number.isFinite(gp.ephemerisType))
      setRows.push({
        label: 'Ephemeris type',
        value: String(gp.ephemerisType),
      });
    if (setRows.length)
      sections.push({ heading: 'ELEMENT SET', rows: setRows });
  }

  const badges = [];
  if (sat?.objectTypeLabel)
    badges.push({ label: sat.objectTypeLabel.toUpperCase(), tone: 'neutral' });
  if (sat?.status)
    badges.push({
      label: sat.statusLabel.toUpperCase(),
      tone: statusTone(sat.status),
    });
  if (regime.regime !== 'UNKNOWN')
    badges.push({ label: regime.regime, tone: 'neutral' });
  if (classLabel) badges.push({ label: classLabel, tone: 'neutral' });

  notes.push(
    'Catalog: CelesTrak SATCAT (public). Elements: CelesTrak GP / 18 SDS. Positions are SGP4 propagations.',
  );

  const subtitleParts = [
    sat?.objectTypeLabel,
    sat?.ownerLabel,
    regime.regime !== 'UNKNOWN' ? regime.label : null,
  ].filter(Boolean);

  return createIntelModel({
    kind: 'satellite',
    id: norad ? `satellite:${norad}` : 'satellite:unknown',
    title: truncate(name, 80),
    subtitle: subtitleParts.join(' · '),
    accent,
    badges,
    photo: null,
    sections,
    links: satelliteIntelLinks(norad, name),
    raw: { payload, elements, regime },
    fetchedAt: Number.isFinite(payload?.fetchedAt) ? payload.fetchedAt : null,
    notes,
  });
}
