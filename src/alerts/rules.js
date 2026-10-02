/**
 * Alert rules: pure functions over a plain evaluation context.
 *
 * The engine builds the context (analyst records per layer, drained window
 * events, active watch zones) and owns cooldowns and persistence; a rule only
 * says what, right now, deserves the operator's attention. Rules never throw
 * on a missing layer — a layer that is off or absent simply contributes
 * nothing — so one broken feed cannot silence the others.
 *
 * Context shape (every field optional):
 *   {
 *     now: epoch ms,
 *     zones: [{ id, name, lat, lon, radiusKm, enabled }],   // active zones only
 *     events: { airEmergencies: [{ hex, callsign, squawk, emergency, lat, lon, altFt, type, registration }] },
 *     records: {
 *       earthquakes: [{ id, magnitude, depthKm, lat, lon, timeMs, place }],
 *       'disaster-alerts': [{ id, level, title, type, country, lat, lon, timeMs }],
 *       'conflict-events': [{ id, title, lat, lon, timeMs }],
 *       'ais-live-vessels': [{ mmsi, name, lat, lon, shipType }],
 *       military: [{ icao24, callsign, lat, lon, altitudeM, aircraftClass, operator }],
 *     },
 *     options: { ...ALERT_RULE_DEFAULTS overrides },
 *   }
 */
import { isInsideZone, haversineKm } from './zones.js';
import { escalateSeverity } from './store.js';

const MINUTE = 60_000;
const HOUR = 3600_000;

export const ALERT_RULE_DEFAULTS = Object.freeze({
  quakeCriticalMag: 6.0,
  quakeWarnMag: 5.0,
  /** Ignore quakes older than this so enabling the layer does not replay the day. */
  quakeMaxAgeMs: 3 * HOUR,
  conflictClusterMin: 8,
  conflictClusterKm: 50,
  /** Conflict events inside one zone that count as zone activity. */
  zoneConflictMin: 3,
  recordCap: 2000,
});

export const SQUAWK_LABELS = Object.freeze({
  7500: 'HIJACK 7500',
  7600: 'RADIO FAILURE 7600',
  7700: 'EMERGENCY 7700',
});

const text = (value, limit = 120) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const latOk = (lat) => lat !== null && lat >= -90 && lat <= 90;
const lonOk = (lon) => lon !== null && lon >= -180 && lon <= 180;

function options(ctx) {
  return { ...ALERT_RULE_DEFAULTS, ...(ctx?.options || {}) };
}

function records(ctx, layerId) {
  const rows = ctx?.records?.[layerId];
  if (!Array.isArray(rows)) return [];
  const cap = options(ctx).recordCap;
  return rows.length > cap ? rows.slice(0, cap) : rows;
}

function zones(ctx) {
  return (Array.isArray(ctx?.zones) ? ctx.zones : []).filter(
    (zone) => zone && zone.enabled !== false,
  );
}

function zonesContaining(ctx, lat, lon) {
  return zones(ctx).filter((zone) => isInsideZone(zone, lat, lon));
}

/** Prefix a base alert with a zone and lift its severity one step. */
function escalateForZone(alert, zone, prefix) {
  return {
    ...alert,
    key: `${prefix}:${zone.id}:${alert.key}`,
    severity: escalateSeverity(alert.severity),
    title: `${zone.name}: ${alert.title}`,
    detail: alert.detail,
    zoneId: zone.id,
  };
}

/* ── Collectors: base observations shared by plain and zone rules ─────── */

export function collectAirEmergencies(ctx) {
  const rows = ctx?.events?.airEmergencies;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const hex = text(row?.hex, 16).toLowerCase();
    const squawk = text(row?.squawk, 4);
    if (!hex && !squawk) continue;
    const lat = num(row?.lat);
    const lon = num(row?.lon);
    const ident =
      text(row?.callsign, 12) || text(row?.registration, 12) || hex || '?';
    const label = SQUAWK_LABELS[squawk] || `SQUAWK ${squawk || '?'}`;
    const details = [
      text(row?.type, 40),
      Number.isFinite(num(row?.altFt))
        ? `${Math.round(num(row.altFt)).toLocaleString('en-US')} ft`
        : '',
      text(row?.emergency, 40),
    ].filter(Boolean);
    out.push({
      key: `air-emergency:${hex || ident}:${squawk || 'x'}`,
      severity: 'critical',
      title: `${label} · ${ident}`,
      detail: details.join(' · '),
      layerId: 'air-emergencies',
      lat: latOk(lat) ? lat : null,
      lon: lonOk(lon) ? lon : null,
      rangeM: 60_000,
    });
  }
  return out;
}

export function collectQuakes(ctx) {
  const opts = options(ctx);
  const now = num(ctx?.now) ?? Date.now();
  const out = [];
  for (const row of records(ctx, 'earthquakes')) {
    const mag = num(row?.magnitude ?? row?.mag);
    if (mag === null || mag < opts.quakeWarnMag) continue;
    const at = num(row?.timeMs ?? row?.time);
    if (at !== null && now - at > opts.quakeMaxAgeMs) continue;
    const lat = num(row?.lat);
    const lon = num(row?.lon);
    const id = text(row?.id, 64) || `${lat}:${lon}:${at}`;
    const depth = num(row?.depthKm ?? row?.depth);
    out.push({
      key: `quake:${id}`,
      severity: mag >= opts.quakeCriticalMag ? 'critical' : 'warn',
      title: `M${mag.toFixed(1)} earthquake`,
      detail: [
        text(row?.place, 80),
        depth !== null ? `${Math.round(depth)} km deep` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      layerId: 'earthquakes',
      lat: latOk(lat) ? lat : null,
      lon: lonOk(lon) ? lon : null,
      rangeM: 400_000,
    });
  }
  return out;
}

function disasterLevel(row) {
  const raw = text(
    row?.level ?? row?.alertLevel ?? row?.severity,
    12,
  ).toLowerCase();
  if (raw === 'red' || raw === 'critical') return 'red';
  if (raw === 'orange' || raw === 'warn' || raw === 'warning') return 'orange';
  return raw || 'green';
}

export function collectDisasters(ctx) {
  const out = [];
  for (const row of records(ctx, 'disaster-alerts')) {
    const level = disasterLevel(row);
    if (level !== 'red' && level !== 'orange') continue;
    const lat = num(row?.lat);
    const lon = num(row?.lon);
    const id = text(row?.id, 64) || `${lat}:${lon}`;
    const type = text(row?.type ?? row?.category, 30);
    out.push({
      key: `disaster:${id}:${level}`,
      severity: level === 'red' ? 'critical' : 'warn',
      title: text(row?.title, 100) || `${level.toUpperCase()} disaster alert`,
      detail: [type, text(row?.country, 40), `${level.toUpperCase()} alert`]
        .filter(Boolean)
        .join(' · '),
      layerId: 'disaster-alerts',
      lat: latOk(lat) ? lat : null,
      lon: lonOk(lon) ? lon : null,
      rangeM: 600_000,
    });
  }
  return out;
}

/** Cell id for a ~clusterKm grid; a cell that gathers enough events is a cluster. */
function cellIdFor(lat, lon, clusterKm) {
  const step = Math.max(0.1, clusterKm / 111);
  const row = Math.floor((lat + 90) / step);
  const col = Math.floor((lon + 180) / step);
  return { id: `${row}:${col}`, step };
}

export function collectConflictClusters(ctx) {
  const opts = options(ctx);
  const cells = new Map();
  for (const row of records(ctx, 'conflict-events')) {
    const lat = num(row?.lat);
    const lon = num(row?.lon);
    if (!latOk(lat) || !lonOk(lon)) continue;
    const { id } = cellIdFor(lat, lon, opts.conflictClusterKm);
    let cell = cells.get(id);
    if (!cell) {
      cell = { id, count: 0, latSum: 0, lonSum: 0, sample: '' };
      cells.set(id, cell);
    }
    cell.count += 1;
    cell.latSum += lat;
    cell.lonSum += lon;
    if (!cell.sample) cell.sample = text(row?.title, 80);
  }
  const out = [];
  for (const cell of cells.values()) {
    if (cell.count < opts.conflictClusterMin) continue;
    const lat = cell.latSum / cell.count;
    const lon = cell.lonSum / cell.count;
    out.push({
      key: `conflict-cluster:${cell.id}`,
      severity: 'warn',
      title: `Conflict activity cluster · ${cell.count} events`,
      detail: [
        cell.sample,
        `within ~${opts.conflictClusterKm} km of ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      layerId: 'conflict-events',
      lat,
      lon,
      rangeM: Math.max(150_000, opts.conflictClusterKm * 4000),
      count: cell.count,
    });
  }
  return out;
}

function vesselIsMilitary(row) {
  const raw = row?.shipType ?? row?.type;
  const asNumber = num(raw);
  if (asNumber !== null) return asNumber === 35;
  return /\b(military|warship|naval|navy)\b/i.test(String(raw || ''));
}

/* ── Rules ─────────────────────────────────────────────────────────────── */

export const ALERT_RULES = Object.freeze([
  Object.freeze({
    id: 'air-emergency',
    label: 'Air emergencies',
    description: 'Squawk 7500 / 7600 / 7700 anywhere in the live feed',
    severity: 'critical',
    cooldownMs: 30 * MINUTE,
    evaluate: (ctx) => collectAirEmergencies(ctx),
  }),
  Object.freeze({
    id: 'quake-major',
    label: 'Major earthquakes',
    description: 'M5+ warns, M6+ is critical (recent events only)',
    severity: 'critical',
    cooldownMs: 24 * HOUR,
    evaluate: (ctx) => collectQuakes(ctx),
  }),
  Object.freeze({
    id: 'disaster-red',
    label: 'Disaster alerts',
    description: 'GDACS red is critical, orange warns',
    severity: 'critical',
    cooldownMs: 24 * HOUR,
    evaluate: (ctx) => collectDisasters(ctx),
  }),
  Object.freeze({
    id: 'conflict-cluster',
    label: 'Conflict clusters',
    description: 'Many conflict events inside ~50 km',
    severity: 'warn',
    cooldownMs: 6 * HOUR,
    evaluate: (ctx) => collectConflictClusters(ctx),
  }),
  Object.freeze({
    id: 'zone-military-air',
    label: 'Zone: military aircraft',
    description: 'A military contact enters a watch zone',
    severity: 'warn',
    cooldownMs: 6 * HOUR,
    evaluate(ctx) {
      const active = zones(ctx);
      if (!active.length) return [];
      const out = [];
      for (const row of records(ctx, 'military')) {
        const lat = num(row?.lat ?? row?.latitude);
        const lon = num(row?.lon ?? row?.longitude);
        if (!latOk(lat) || !lonOk(lon)) continue;
        const hex = text(row?.icao24 ?? row?.hex ?? row?.id, 16).toLowerCase();
        if (!hex) continue;
        for (const zone of active) {
          if (!isInsideZone(zone, lat, lon)) continue;
          const ident = text(row?.callsign, 12) || hex;
          const altitudeM = num(row?.altitudeM);
          const details = [
            text(row?.aircraftClass ?? row?.type, 30),
            text(row?.operator, 40),
            altitudeM !== null
              ? `${Math.round(altitudeM * 3.28084).toLocaleString('en-US')} ft`
              : '',
            `${Math.round(haversineKm(zone.lat, zone.lon, lat, lon))} km from centre`,
          ].filter(Boolean);
          out.push({
            key: `zone-mil:${zone.id}:${hex}`,
            severity: 'warn',
            title: `${zone.name}: military aircraft ${ident}`,
            detail: details.join(' · '),
            layerId: 'military',
            lat,
            lon,
            rangeM: 80_000,
            zoneId: zone.id,
          });
        }
      }
      return out;
    },
  }),
  Object.freeze({
    id: 'zone-vessel-military',
    label: 'Zone: military vessels',
    description: 'An AIS military-ops vessel inside a watch zone',
    severity: 'warn',
    cooldownMs: 6 * HOUR,
    evaluate(ctx) {
      const active = zones(ctx);
      if (!active.length) return [];
      const out = [];
      for (const row of records(ctx, 'ais-live-vessels')) {
        if (!vesselIsMilitary(row)) continue;
        const lat = num(row?.lat);
        const lon = num(row?.lon);
        if (!latOk(lat) || !lonOk(lon)) continue;
        const mmsi = text(row?.mmsi ?? row?.id, 16);
        for (const zone of active) {
          if (!isInsideZone(zone, lat, lon)) continue;
          out.push({
            key: `zone-vessel:${zone.id}:${mmsi || `${lat}:${lon}`}`,
            severity: 'warn',
            title:
              `${zone.name}: military vessel ${text(row?.name, 30) || mmsi || ''}`.trim(),
            detail: [mmsi ? `MMSI ${mmsi}` : '', text(row?.destination, 40)]
              .filter(Boolean)
              .join(' · '),
            layerId: 'ais-live-vessels',
            lat,
            lon,
            rangeM: 60_000,
            zoneId: zone.id,
          });
        }
      }
      return out;
    },
  }),
  Object.freeze({
    id: 'zone-emergency',
    label: 'Zone: air emergency',
    description: 'An emergency squawk inside a watch zone',
    severity: 'critical',
    cooldownMs: 30 * MINUTE,
    evaluate(ctx) {
      const out = [];
      for (const alert of collectAirEmergencies(ctx))
        for (const zone of zonesContaining(ctx, alert.lat, alert.lon))
          out.push(escalateForZone(alert, zone, 'zone-emergency'));
      return out;
    },
  }),
  Object.freeze({
    id: 'zone-quake',
    label: 'Zone: earthquake',
    description: 'A notable quake inside a watch zone',
    severity: 'critical',
    cooldownMs: 24 * HOUR,
    evaluate(ctx) {
      const out = [];
      for (const alert of collectQuakes(ctx))
        for (const zone of zonesContaining(ctx, alert.lat, alert.lon))
          out.push(escalateForZone(alert, zone, 'zone-quake'));
      return out;
    },
  }),
  Object.freeze({
    id: 'zone-disaster',
    label: 'Zone: disaster alert',
    description: 'A GDACS orange/red event inside a watch zone',
    severity: 'critical',
    cooldownMs: 24 * HOUR,
    evaluate(ctx) {
      const out = [];
      for (const alert of collectDisasters(ctx))
        for (const zone of zonesContaining(ctx, alert.lat, alert.lon))
          out.push(escalateForZone(alert, zone, 'zone-disaster'));
      return out;
    },
  }),
  Object.freeze({
    id: 'zone-conflict',
    label: 'Zone: conflict events',
    description: 'Conflict events reported inside a watch zone',
    severity: 'warn',
    cooldownMs: 6 * HOUR,
    evaluate(ctx) {
      const active = zones(ctx);
      if (!active.length) return [];
      const opts = options(ctx);
      const now = num(ctx?.now) ?? Date.now();
      const counts = new Map();
      for (const row of records(ctx, 'conflict-events')) {
        const lat = num(row?.lat);
        const lon = num(row?.lon);
        if (!latOk(lat) || !lonOk(lon)) continue;
        for (const zone of active) {
          if (!isInsideZone(zone, lat, lon)) continue;
          const entry = counts.get(zone.id) || {
            zone,
            count: 0,
            sample: '',
          };
          entry.count += 1;
          if (!entry.sample) entry.sample = text(row?.title, 80);
          counts.set(zone.id, entry);
        }
      }
      const out = [];
      const dayBucket = Math.floor(now / (6 * HOUR));
      for (const { zone, count, sample } of counts.values()) {
        if (count < opts.zoneConflictMin) continue;
        out.push({
          key: `zone-conflict:${zone.id}:${dayBucket}`,
          severity: count >= opts.conflictClusterMin ? 'critical' : 'warn',
          title: `${zone.name}: ${count} conflict events`,
          detail: sample,
          layerId: 'conflict-events',
          lat: zone.lat,
          lon: zone.lon,
          rangeM: zone.radiusKm * 2500,
          zoneId: zone.id,
        });
      }
      return out;
    },
  }),
]);

export const ALERT_RULE_IDS = Object.freeze(ALERT_RULES.map((rule) => rule.id));

/**
 * Run every rule and return the alerts that are new right now.
 *
 * @param {ReadonlyArray<object>} rules Rule table (ALERT_RULES by default).
 * @param {object} ctx Evaluation context.
 * @param {object} [gates]
 * @param {(ruleId: string) => boolean} [gates.isMuted]
 * @param {(key: string, cooldownMs: number, now: number) => boolean} [gates.isCoolingDown]
 * @param {number} [gates.now]
 * @returns {{alerts: object[], errors: string[]}}
 */
export function evaluateRules(
  rules = ALERT_RULES,
  ctx = {},
  { isMuted = () => false, isCoolingDown = () => false, now } = {},
) {
  const at = Number.isFinite(now) ? now : (num(ctx?.now) ?? Date.now());
  const context = { ...ctx, now: at };
  const seen = new Set();
  const alerts = [];
  const errors = [];
  for (const rule of rules) {
    if (!rule?.id || typeof rule.evaluate !== 'function') continue;
    let produced;
    try {
      if (isMuted(rule.id)) continue;
      produced = rule.evaluate(context) || [];
    } catch (error) {
      errors.push(`${rule.id}: ${error?.message || error}`);
      continue;
    }
    if (!Array.isArray(produced)) continue;
    for (const raw of produced) {
      const key = text(raw?.key, 200);
      if (!key || seen.has(key)) continue;
      const cooldownMs = Number.isFinite(rule.cooldownMs)
        ? rule.cooldownMs
        : 30 * MINUTE;
      if (isCoolingDown(key, cooldownMs, at)) continue;
      seen.add(key);
      alerts.push({
        ...raw,
        key,
        ruleId: rule.id,
        severity: raw?.severity || rule.severity || 'info',
        at,
        cooldownMs,
      });
    }
  }
  return { alerts, errors };
}
