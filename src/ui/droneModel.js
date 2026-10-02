/**
 * Pure rules for the "UHD drone" free-flight camera: key → intent mapping,
 * speed from height above ground, and the OSD text. No Cesium, no DOM.
 */

/** Keys the drone owns while active (lower-case `event.key` or `event.code`). */
export const DRONE_KEYS = Object.freeze({
  forward: ['w', 'arrowup'],
  back: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
  up: ['shift', ' ', 'e'],
  down: ['q', 'c'],
});

/** Which intent a key maps to, or null. */
export function droneIntent(key) {
  const k = String(key || '').toLowerCase();
  for (const [intent, keys] of Object.entries(DRONE_KEYS))
    if (keys.includes(k)) return intent;
  return null;
}

/**
 * Horizontal cruise speed (m/s) for a height above ground: slow and precise
 * near rooftops, fast at altitude. `multiplier` comes from the mouse wheel.
 */
export function droneSpeed(heightAglM, multiplier = 1) {
  const h = Number.isFinite(heightAglM) ? Math.max(0, heightAglM) : 200;
  const base = Math.min(2500, Math.max(12, h * 0.6));
  const m = Math.min(8, Math.max(0.125, Number(multiplier) || 1));
  return base * m;
}

/** Vertical speed (m/s): a fraction of cruise, never below a usable floor. */
export function droneClimbRate(heightAglM, multiplier = 1) {
  return Math.max(6, droneSpeed(heightAglM, multiplier) * 0.6);
}

/** Wheel step: each notch multiplies or divides the speed by 1.25. */
export function nextSpeedMultiplier(current, wheelDeltaY) {
  const value = Number(current) || 1;
  const next = wheelDeltaY < 0 ? value * 1.25 : value / 1.25;
  return Math.min(8, Math.max(0.125, next));
}

/** Clamp the gimbal pitch (degrees) to a camera-safe range. */
export function clampPitch(deg) {
  return Math.min(85, Math.max(-89, deg));
}

/** 16-point compass label for a heading in degrees. */
export function compassPoint(headingDeg) {
  const points = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const h = ((Number(headingDeg) % 360) + 360) % 360;
  return points[Math.round(h / 22.5) % 16];
}

/** OSD lines for the drone overlay. */
export function droneOsd({
  altMslM,
  aglM,
  speedMps,
  climbMps,
  headingDeg,
  pitchDeg,
  lat,
  lon,
  multiplier,
}) {
  const fmt = (v, digits = 0) =>
    Number.isFinite(v) ? v.toFixed(digits) : '--';
  return {
    alt: `ALT ${fmt(altMslM)} m MSL · AGL ${fmt(aglM)} m`,
    speed: `H.SPD ${fmt((speedMps || 0) * 3.6)} km/h · V.SPD ${fmt(climbMps, 1)} m/s`,
    heading: `HDG ${String(Math.round(((headingDeg % 360) + 360) % 360)).padStart(3, '0')}° ${compassPoint(headingDeg)} · GIMBAL ${fmt(pitchDeg)}°`,
    position: `${fmt(lat, 5)}° ${fmt(lon, 5)}° · SPEED ×${fmt(multiplier, 2)}`,
  };
}
