/**
 * Presentation model for emergency squawks. Pure — no Cesium types — so cards,
 * accents, the new-contact diff and analyst records are unit-testable.
 */
import { EMERGENCY_SQUAWK_MEANING } from './records.js';

export const EMERGENCY_OVERLAY_SOURCE_ID = 'air-emergencies';
export const EMERGENCY_OVERLAY_COHORT_LIMIT = 48;
export const EMERGENCY_OVERLAY_COLLISION_CAPACITY = 24;
/**
 * How long a hex stays "known" after it last squawked, so a re-enable or a
 * feed flap cannot re-alert the same contact.
 */
export const EMERGENCY_MEMORY_MS = 60 * 60 * 1000;

export const EMERGENCY_ACCENTS = Object.freeze({
  7500: '#ff2bd6',
  7600: '#ffb000',
  7700: '#ff3b30',
});

/** CSS accent for a squawk code (7700 red when unknown). */
export function emergencyAccent(squawk) {
  return EMERGENCY_ACCENTS[String(squawk)] || EMERGENCY_ACCENTS[7700];
}

/** Display identity chain: callsign → registration → hex. */
export function emergencyLabel(row) {
  return (
    String(row?.callsign || '').trim() ||
    String(row?.registration || '').trim() ||
    String(row?.hex || '')
      .replace(/^~/, '')
      .toUpperCase() ||
    'UNKNOWN'
  );
}

function kinematicsLine(row) {
  const parts = [];
  if (row?.onGround) parts.push('on ground');
  else if (Number.isFinite(row?.altFt)) {
    const altFt = Math.round(row.altFt);
    parts.push(altFt >= 18000 ? `FL${Math.round(altFt / 100)}` : `${altFt} ft`);
  }
  if (Number.isFinite(row?.gsKt)) parts.push(`${Math.round(row.gsKt)} kt`);
  if (Number.isFinite(row?.track)) parts.push(`${Math.round(row.track)}°`);
  return parts.join(' · ');
}

/**
 * Card content for one emergency contact. The caller adds the world position.
 * @param {object} row Normalized emergency row.
 * @returns {object} Overlay entry without `position`.
 */
export function buildEmergencyCard(row) {
  const meaning = EMERGENCY_SQUAWK_MEANING[row.squawk] || 'Emergency';
  const details = [
    row.emergency && row.emergency !== 'general'
      ? `${meaning} · ${row.emergency}`
      : meaning,
  ];
  const ident = [row.type, row.registration].filter(Boolean).join(' · ');
  if (ident) details.push(ident);
  const kinematics = kinematicsLine(row);
  if (kinematics) details.push(kinematics);
  return {
    id: `air-emergency:${row.hex}`,
    variant: 'card',
    interactive: false,
    title: `${row.squawk} · ${emergencyLabel(row)}`,
    details,
    accent: emergencyAccent(row.squawk),
    // Hijack outranks emergency outranks radio failure; the fresher fix wins ties.
    priority:
      (row.squawk === '7500' ? 3 : row.squawk === '7700' ? 2 : 1) * 1_000_000 -
      Math.min(999_999, Math.round(row.seen || 0)),
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/**
 * Rows whose hex has not been seen within the memory window. Mutates `memory`
 * (hex → last seen ms) so the caller keeps one map across snapshots.
 * @param {Map<string, number>} memory Known hexes.
 * @param {object[]} rows Current snapshot rows.
 * @param {number} nowMs Snapshot time.
 * @returns {object[]} Newly appeared rows.
 */
export function diffNewEmergencies(memory, rows, nowMs) {
  for (const [hex, at] of memory) {
    if (nowMs - at > EMERGENCY_MEMORY_MS) memory.delete(hex);
  }
  const fresh = [];
  for (const row of rows) {
    if (!memory.has(row.hex)) fresh.push(row);
    memory.set(row.hex, nowMs);
  }
  return fresh;
}

/** JSON-safe analyst record for one contact (query engine seam). */
export function mapAnalystRecord(row) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: row.hex,
    name: emergencyLabel(row),
    callsign: row.callsign || null,
    registration: row.registration || null,
    type: row.type || null,
    squawk: row.squawk,
    meaning: EMERGENCY_SQUAWK_MEANING[row.squawk] || null,
    emergency: row.emergency || null,
    lat: num(row.lat),
    lon: num(row.lon),
    altitudeFt: num(row.altFt),
    speedKt: num(row.gsKt),
    track: num(row.track),
    observedAtMs: num(row.observedAtMs),
  };
}

/** Row count phrasing for the layer chip. */
export function emergencyCountLabel(count) {
  if (!count) return '';
  return count === 1 ? '1 emergency' : `${count} emergencies`;
}
