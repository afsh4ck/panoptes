/**
 * Altitude while the feed is silent.
 *
 * OpenSky often stops reporting barometric / geometric altitude for an
 * aircraft on final approach (and in other low-coverage moments) while it
 * keeps sending positions and the vertical rate. Holding the last height
 * left a landing aircraft floating at its last report; instead the height
 * keeps following the last known vertical rate, never below the ground,
 * and is marked as an estimate.
 */

/** Longest silence the extrapolation covers in one step (seconds). */
export const MAX_EXTRAPOLATION_SEC = 90;
/** Below this |vertical rate| the aircraft is treated as level. */
const LEVEL_RATE_MPS = 0.5;

/**
 * @param {object} input
 * @param {number} input.previousM Last known (or estimated) height, metres.
 * @param {number|null} input.verticalRateMps Last known vertical rate.
 * @param {number} input.elapsedSec Seconds since that height.
 * @param {number} [input.floorM] Ground height under the aircraft.
 * @returns {{value: number, estimated: boolean}}
 */
export function extrapolateAltitude({
  previousM,
  verticalRateMps,
  elapsedSec,
  floorM = 0,
}) {
  if (!Number.isFinite(previousM))
    return { value: previousM, estimated: false };
  const rate = Number(verticalRateMps);
  const dt = Math.max(
    0,
    Math.min(MAX_EXTRAPOLATION_SEC, Number(elapsedSec) || 0),
  );
  if (!Number.isFinite(rate) || Math.abs(rate) < LEVEL_RATE_MPS || dt === 0)
    return { value: previousM, estimated: true };
  const floor = Number.isFinite(floorM) ? floorM : 0;
  return { value: Math.max(floor, previousM + rate * dt), estimated: true };
}
