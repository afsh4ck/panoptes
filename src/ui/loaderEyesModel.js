/**
 * Pure geometry for the PANOPTES loading screen: a central eye with eight
 * smaller eyes orbiting it, every pupil turning toward the pointer. No DOM.
 */

/** Stage size in SVG units (square viewBox). */
export const STAGE = 400;
export const CENTER = STAGE / 2;
/** Orbit radius of the watcher eyes. */
export const ORBIT_RADIUS = 150;
/** Number of orbiting eyes. */
export const WATCHERS = 8;
/** Seconds for one full orbit. */
export const ORBIT_PERIOD_S = 36;

/** Eye sizes: half-width of the almond and the iris radius. */
export const MAIN_EYE = Object.freeze({ halfWidth: 72, iris: 26 });
export const WATCHER_EYE = Object.freeze({ halfWidth: 22, iris: 8 });

/**
 * Orbit position of watcher `index` at time `seconds` (stage units).
 * @returns {{x: number, y: number}}
 */
export function watcherPosition(
  index,
  seconds,
  { reducedMotion = false } = {},
) {
  const phase = reducedMotion ? 0 : (seconds / ORBIT_PERIOD_S) * Math.PI * 2;
  const angle = (index / WATCHERS) * Math.PI * 2 - Math.PI / 2 + phase;
  return {
    x: CENTER + Math.cos(angle) * ORBIT_RADIUS,
    y: CENTER + Math.sin(angle) * ORBIT_RADIUS,
  };
}

/**
 * Pupil offset (stage units) for an eye looking at a target. The pupil moves
 * along the gaze direction, more as the target gets farther, and stays inside
 * the almond (wider horizontally than vertically).
 * @param {{x: number, y: number}} eye Eye center.
 * @param {{x: number, y: number}} target Gaze target in the same units.
 * @param {{halfWidth: number, iris: number}} size Eye geometry.
 */
export function pupilOffset(eye, target, size) {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: 0, y: 0 };
  const maxX = Math.max(0, size.halfWidth - size.iris - size.halfWidth * 0.12);
  const maxY = maxX * 0.38;
  const reach = Math.min(1, distance / (size.halfWidth * 6));
  return {
    x: (dx / distance) * maxX * reach,
    y: (dy / distance) * maxY * reach * 1.6,
  };
}

/** Convert a client-space point into stage units for a stage rectangle. */
export function clientToStage(point, rect) {
  const scale = STAGE / (rect.width || STAGE);
  return {
    x: (point.x - rect.left) * scale,
    y: (point.y - rect.top) * scale,
  };
}

/** Readout text for the tracked pointer: viewport position and a lock bar. */
export function trackingReadout(point, viewport, lock) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  const nx = viewport.width ? point.x / viewport.width : 0;
  const ny = viewport.height ? point.y / viewport.height : 0;
  // A mock geographic read of the screen position, framed as a target fix.
  const lat = (90 - ny * 180).toFixed(4);
  const lon = (nx * 360 - 180).toFixed(4);
  const pct = Math.round(Math.max(0, Math.min(1, lock)) * 100);
  return {
    title: pct >= 100 ? 'TARGET LOCKED' : 'ACQUIRING TARGET',
    line: `X ${x} · Y ${y} · ${lat}° ${lon}°`,
    lock: pct,
  };
}

/** Whether a watcher blinks at time `seconds` (staggered, ~every 5–9 s). */
export function isBlinking(index, seconds) {
  const period = 5 + ((index * 7) % 5);
  const phase = (seconds + index * 1.3) % period;
  return phase < 0.14;
}
