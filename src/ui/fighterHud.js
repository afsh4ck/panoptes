import {
  fighterHudGeometry,
  fighterLadderRungs,
  flightPathAngleDeg,
  formatVerticalSpeed,
  machFromMps,
} from '../fighterHudModel.js';

/**
 * @module fighterHud
 * @description Fighter-jet head-up display for the cockpit view in the
 * Tactical HUD layout: green collimated symbology (pitch ladder, horizon,
 * waterline, flight-path marker; the cockpit roll arc is the bank scale) plus Mach / vertical speed /
 * heading boxes. CSS shows it only when <html data-hud-layout="tactical">
 * and the cockpit is open; the other layouts keep their own look.
 */

const LADDER_RANGE_DEG = 30;
const LADDER_STEP_DEG = 5;

function markup() {
  const rungs = fighterLadderRungs(LADDER_RANGE_DEG, LADDER_STEP_DEG)
    .map((deg) => {
      const label = Math.abs(deg);
      return `<div class="fhud-rung${deg < 0 ? ' neg' : ''}" style="--deg:${deg}"><b>${label}</b><i></i><i></i><b>${label}</b></div>`;
    })
    .join('');
  return `
    <div class="fhud-glass"><div class="fhud-ladder">
      <div class="fhud-horizon"><i></i><i></i></div>
      ${rungs}
    </div></div>
    <svg class="fhud-waterline" viewBox="0 0 120 24" aria-hidden="true" focusable="false">
      <path d="M0 12H34L44 22L54 4L60 14L66 4L76 22L86 12H120" fill="none"/>
    </svg>
    <svg class="fhud-fpm" viewBox="0 0 80 40" aria-hidden="true" focusable="false">
      <circle cx="40" cy="22" r="9" fill="none"/>
      <path d="M8 22H31 M49 22H72 M40 13V3" fill="none"/>
    </svg>
    <div class="fhud-box fhud-box-left">
      <span class="fhud-mode">NAV</span>
      <span>M <b data-fhud="mach">-.--</b></span>
      <span>G <b>1.0</b></span>
    </div>
    <div class="fhud-box fhud-box-right">
      <span>VS <b data-fhud="vs">---</b> M/S</span>
      <span>HDG <b data-fhud="hdg">---</b></span>
      <span class="fhud-arm">ARM SAFE</span>
    </div>`;
}

function ensure(document) {
  const host = document.getElementById('cockpit-hud');
  if (!host) return null;
  let hud = host.querySelector('#cockpit-fighter-hud');
  if (hud) return hud;
  hud = document.createElement('div');
  hud.id = 'cockpit-fighter-hud';
  hud.className = 'cockpit-fighter-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.setAttribute('data-i18n-skip', '');
  hud.innerHTML = markup();
  host.prepend(hud);
  return hud;
}

/**
 * Refresh the fighter HUD for the current cockpit frame. Cheap no-op while
 * another HUD layout is active.
 * @param {object} cockpit Cockpit controller (`viewer`, `heading`).
 * @param {object} info Tracked aircraft telemetry.
 */
export function updateFighterHud(cockpit, info) {
  const document = globalThis.document;
  if (!document || document.documentElement.dataset.hudLayout !== 'tactical')
    return;
  const hud = ensure(document);
  const camera = cockpit?.viewer?.camera;
  if (!hud || !camera) return;
  const toDeg = (rad) => (Number.isFinite(rad) ? (rad * 180) / Math.PI : 0);
  const canvas = cockpit.viewer.canvas;
  const geometry = fighterHudGeometry({
    cameraPitchDeg: toDeg(camera.pitch),
    cameraRollDeg: toDeg(camera.roll),
    flightPathDeg: flightPathAngleDeg(info?.velocityMps, info?.verticalRateMps),
    fovyDeg: toDeg(camera.frustum?.fovy) || 60,
    viewportHeight: canvas?.clientHeight || 720,
  });
  hud.style.setProperty('--fhud-ppd', `${geometry.ppd.toFixed(3)}px`);
  hud.style.setProperty(
    '--fhud-shift',
    `${geometry.ladderShiftPx.toFixed(1)}px`,
  );
  hud.style.setProperty('--fhud-roll', `${geometry.rollDeg.toFixed(2)}deg`);
  hud.style.setProperty('--fhud-fpm', `${geometry.fpmOffsetPx.toFixed(1)}px`);
  const set = (key, value) => {
    const el = hud.querySelector(`[data-fhud="${key}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };
  const mach = machFromMps(info?.velocityMps);
  set('mach', mach === null ? '-.--' : mach.toFixed(2));
  set('vs', formatVerticalSpeed(info?.verticalRateMps));
  const heading = Number.isFinite(cockpit.heading)
    ? cockpit.heading
    : info?.track;
  set(
    'hdg',
    Number.isFinite(heading)
      ? String(Math.round(((heading % 360) + 360) % 360)).padStart(3, '0')
      : '---',
  );
}
