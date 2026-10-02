/**
 * Pure geometry for the fighter-style head-up display drawn over the
 * cockpit view in the Tactical HUD layout: a pitch ladder that rolls and
 * slides with the view, a flight-path marker offset by the climb / descent
 * angle, and the classic readouts (Mach, vertical speed).
 */

/** Ladder rungs in degrees, horizon (0) excluded: it is drawn on its own. */
export function fighterLadderRungs(rangeDeg = 30, stepDeg = 5) {
  const rungs = [];
  for (let deg = -rangeDeg; deg <= rangeDeg; deg += stepDeg) {
    if (deg !== 0) rungs.push(deg);
  }
  return rungs;
}

/** Pixels per degree of view for a vertical field of view on a viewport. */
export function pixelsPerDegree(fovyDeg, viewportHeight) {
  if (!(fovyDeg > 0) || !(viewportHeight > 0)) return 12;
  return viewportHeight / fovyDeg;
}

/** Climb (+) / descent (−) angle of the flight path, in degrees. */
export function flightPathAngleDeg(groundSpeedMps, verticalRateMps) {
  if (!Number.isFinite(verticalRateMps)) return 0;
  const speed = Number.isFinite(groundSpeedMps) ? groundSpeedMps : 0;
  if (speed < 1 && Math.abs(verticalRateMps) < 0.1) return 0;
  return (Math.atan2(verticalRateMps, Math.max(1, speed)) * 180) / Math.PI;
}

/**
 * Where the moving symbology sits for the current view.
 * @returns {{ppd:number, ladderShiftPx:number, rollDeg:number, fpmOffsetPx:number}}
 *   ladderShiftPx moves the whole ladder down when the view pitches up;
 *   fpmOffsetPx moves the flight-path marker up when the path climbs above
 *   the view's centre line (both screen pixels, y down).
 */
export function fighterHudGeometry({
  cameraPitchDeg = 0,
  cameraRollDeg = 0,
  flightPathDeg = 0,
  fovyDeg = 60,
  viewportHeight = 720,
}) {
  const ppd = pixelsPerDegree(fovyDeg, viewportHeight);
  const limit = viewportHeight * 0.32;
  const clamp = (v) => Math.max(-limit, Math.min(limit, v));
  return {
    ppd,
    ladderShiftPx: clamp(cameraPitchDeg * ppd),
    rollDeg: -cameraRollDeg,
    fpmOffsetPx: clamp((cameraPitchDeg - flightPathDeg) * ppd),
  };
}

/** Mach number from ground speed (sea-level speed of sound). */
export function machFromMps(speedMps) {
  return Number.isFinite(speedMps) ? speedMps / 340.3 : null;
}

/** "+12.4" / "−3.0" vertical speed in m/s for the HUD. */
export function formatVerticalSpeed(verticalRateMps) {
  if (!Number.isFinite(verticalRateMps)) return '---';
  const value = Math.abs(verticalRateMps).toFixed(1);
  if (Number(value) === 0) return '0.0';
  return `${verticalRateMps > 0 ? '+' : '−'}${value}`;
}
