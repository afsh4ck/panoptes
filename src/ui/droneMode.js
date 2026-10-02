import * as Cesium from 'cesium';
import {
  clampPitch,
  droneClimbRate,
  droneIntent,
  droneOsd,
  droneSpeed,
  nextSpeedMultiplier,
} from './droneModel.js';

/**
 * @module droneMode
 * @description "UHD drone": a free-flight camera like a filming drone.
 * WASD / arrows move horizontally, the mouse looks around (click the view to
 * capture the pointer), Shift / Space / E climb, Q / C descend, the wheel
 * changes speed and Esc exits. While active it requests UHD 3D tiles when
 * hovering (coarser while flying so the view keeps up), widens the lens and
 * shows a drone OSD. Nothing persists: exiting restores the previous camera
 * controls, lens and tile detail.
 *
 * Note: Ctrl+W is reserved by the browser (closes the tab) and cannot be
 * intercepted; descend with Q while moving forward.
 */

const DRONE_FOV_DEG = 78;
const DRONE_SCREEN_SPACE_ERROR = 4;
const MIN_AGL_M = 3;
const MOUSE_SENSITIVITY = 0.12; // degrees per pixel

function photorealTilesets(scene) {
  const found = [];
  const primitives = scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const p = primitives.get(i);
    if (p instanceof Cesium.Cesium3DTileset) found.push(p);
  }
  return found;
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Document} options.document
 * @param {() => void} [options.releaseTracking] Stops any follow camera.
 * @param {(on: boolean) => void} [options.onChange]
 * @param {{setDrone: Function}|null} [options.tileQuality]
 */
export function createDroneMode({
  viewer,
  document,
  releaseTracking = () => {},
  onChange = () => {},
  tileQuality = null,
}) {
  const view = document.defaultView || globalThis.window;
  const scene = viewer.scene;
  const camera = viewer.camera;
  const canvas = scene.canvas;
  let active = false;
  let frame = 0;
  let last = 0;
  let multiplier = 1;
  let groundM = null;
  let groundSampleAt = 0;
  let lastClimb = 0;
  let saved = null;
  const held = new Set();

  // ── OSD overlay ─────────────────────────────────────────────────
  const osd = document.createElement('div');
  osd.className = 'pnp-drone-osd';
  osd.hidden = true;
  osd.innerHTML = `
    <div class="pnp-drone-top"><span class="pnp-drone-rec">● REC</span><span>DRONE · 4K UHD · 60 FPS</span><span class="pnp-drone-exit">ESC · EXIT</span></div>
    <div class="pnp-drone-reticle" aria-hidden="true"></div>
    <div class="pnp-drone-data">
      <div data-osd="alt"></div><div data-osd="speed"></div><div data-osd="heading"></div><div data-osd="position"></div>
    </div>
    <div class="pnp-drone-help">WASD move · mouse look (click to capture) · Shift/E up · Q/C down · wheel speed · Esc exit</div>`;
  document.body.appendChild(osd);
  const osdRows = Object.fromEntries(
    [...osd.querySelectorAll('[data-osd]')].map((n) => [n.dataset.osd, n]),
  );

  function heightAboveGround(carto) {
    const now = performance.now();
    if (now - groundSampleAt > 250) {
      groundSampleAt = now;
      let sampled = null;
      try {
        if (scene.sampleHeightSupported) sampled = scene.sampleHeight(carto);
      } catch {
        sampled = null;
      }
      // Reject hits that cannot be the ground under the drone (far tile
      // back faces, the sky, or a surface above the camera).
      const plausible = (h) =>
        Number.isFinite(h) && h > -500 && h < 9000 && h < carto.height;
      if (!plausible(sampled)) {
        const globeHeight = scene.globe?.getHeight?.(carto);
        sampled = plausible(globeHeight) ? globeHeight : 0;
      }
      groundM = sampled;
    }
    return Number.isFinite(groundM) ? carto.height - groundM : null;
  }

  function step(now) {
    if (!active) return;
    frame = view.requestAnimationFrame(step);
    const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    const carto = camera.positionCartographic;
    if (!carto) return;
    const agl = heightAboveGround(carto);
    const speed = droneSpeed(agl ?? carto.height, multiplier);
    const climb = droneClimbRate(agl ?? carto.height, multiplier);

    // Horizontal axes from the camera heading on the local tangent plane.
    const up = scene.globe.ellipsoid.geodeticSurfaceNormal(
      camera.positionWC,
      new Cesium.Cartesian3(),
    );
    const forward = Cesium.Cartesian3.clone(camera.directionWC);
    const vertical = Cesium.Cartesian3.multiplyByScalar(
      up,
      Cesium.Cartesian3.dot(forward, up),
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.subtract(forward, vertical, forward);
    if (Cesium.Cartesian3.magnitudeSquared(forward) < 1e-8)
      Cesium.Cartesian3.clone(camera.upWC, forward);
    Cesium.Cartesian3.normalize(forward, forward);
    const right = Cesium.Cartesian3.cross(forward, up, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(right, right);

    let moved = false;
    const go = (dir, amount) => {
      if (!amount) return;
      camera.move(dir, amount);
      moved = true;
    };
    const f = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
    const r = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const v = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
    const norm = f && r ? Math.SQRT1_2 : 1;
    go(forward, f * speed * dt * norm);
    go(right, r * speed * dt * norm);
    // Never descend into rooftops or terrain.
    let vz = v * climb * dt;
    if (vz < 0 && agl !== null) vz = Math.max(vz, -(agl - MIN_AGL_M));
    go(up, vz);
    lastClimb = dt ? vz / dt : 0;

    const after = camera.positionCartographic;
    const lines = droneOsd({
      altMslM: after.height,
      aglM: agl,
      speedMps: f || r ? speed : 0,
      climbMps: lastClimb,
      headingDeg: Cesium.Math.toDegrees(camera.heading),
      pitchDeg: Cesium.Math.toDegrees(camera.pitch),
      lat: Cesium.Math.toDegrees(after.latitude),
      lon: Cesium.Math.toDegrees(after.longitude),
      multiplier,
    });
    for (const [key, node] of Object.entries(osdRows))
      node.textContent = lines[key];
    if (moved || held.size) scene.requestRender();
  }

  // ── Input ──────────────────────────────────────────────────────
  const onKeyDown = (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      else exit();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.target?.matches?.('input, textarea, select')) return;
    // A held Ctrl/Meta turns flight keys into browser shortcuts (Ctrl+W
    // closes the tab); the drone ignores them so the key never moves it.
    if (event.ctrlKey || event.metaKey) return;
    const intent = droneIntent(event.key);
    if (!intent) return;
    held.add(intent);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onKeyUp = (event) => {
    if (!active) return;
    const intent = droneIntent(event.key);
    if (!intent) return;
    held.delete(intent);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onBlur = () => held.clear();
  const onBeforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = '';
  };
  const onCanvasClick = () => {
    if (active && document.pointerLockElement !== canvas)
      canvas.requestPointerLock?.();
  };
  let dragging = false;
  const onMouseDown = (event) => {
    if (active && event.button === 0) dragging = true;
  };
  const onMouseUp = () => {
    dragging = false;
  };
  const onMouseMove = (event) => {
    if (!active) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && !dragging) return;
    const heading =
      camera.heading +
      Cesium.Math.toRadians(event.movementX * MOUSE_SENSITIVITY);
    const pitch = Cesium.Math.toRadians(
      clampPitch(
        Cesium.Math.toDegrees(camera.pitch) -
          event.movementY * MOUSE_SENSITIVITY,
      ),
    );
    camera.setView({ orientation: { heading, pitch, roll: 0 } });
    scene.requestRender();
  };
  const onWheel = (event) => {
    if (!active) return;
    multiplier = nextSpeedMultiplier(multiplier, event.deltaY);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function enter() {
    if (active) return;
    releaseTracking();
    try {
      viewer.trackedEntity = undefined;
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      camera.cancelFlight();
    } catch {
      /* already free */
    }
    const controller = scene.screenSpaceCameraController;
    // With the 3D detail controller the drone keeps progressive loading
    // (coarse while flying, UHD when hovering); without it, force UHD.
    const tilesets = tileQuality ? [] : photorealTilesets(scene);
    tileQuality?.setDrone?.(true);
    saved = {
      enableInputs: controller.enableInputs,
      fov: camera.frustum.fov,
      tilesets: tilesets.map((t) => [t, t.maximumScreenSpaceError]),
    };
    controller.enableInputs = false;
    if (Number.isFinite(camera.frustum.fov))
      camera.frustum.fov = Cesium.Math.toRadians(DRONE_FOV_DEG);
    for (const tileset of tilesets)
      tileset.maximumScreenSpaceError = Math.min(
        tileset.maximumScreenSpaceError,
        DRONE_SCREEN_SPACE_ERROR,
      );
    // Level the horizon so the drone starts flying, not diving.
    camera.setView({
      orientation: {
        heading: camera.heading,
        pitch: Cesium.Math.toRadians(
          clampPitch(Math.max(-35, Cesium.Math.toDegrees(camera.pitch))),
        ),
        roll: 0,
      },
    });
    active = true;
    // Last line of defence: an accidental Ctrl+W asks before leaving, and in
    // fullscreen the keyboard lock keeps W/Q inside the page.
    view.addEventListener('beforeunload', onBeforeUnload);
    try {
      navigator.keyboard
        ?.lock?.(['KeyW', 'KeyQ', 'KeyA', 'KeyS', 'KeyD'])
        ?.catch?.(() => {});
    } catch {
      /* not in fullscreen or unsupported */
    }
    document.body.classList.add('drone-mode');
    osd.hidden = false;
    held.clear();
    last = 0;
    frame = view.requestAnimationFrame(step);
    onChange(true);
  }

  function exit() {
    if (!active) return;
    active = false;
    view.removeEventListener('beforeunload', onBeforeUnload);
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      /* nothing locked */
    }
    view.cancelAnimationFrame(frame);
    held.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    const controller = scene.screenSpaceCameraController;
    if (saved) {
      controller.enableInputs = saved.enableInputs;
      if (Number.isFinite(saved.fov)) camera.frustum.fov = saved.fov;
      for (const [tileset, sse] of saved.tilesets)
        if (!tileset.isDestroyed?.()) tileset.maximumScreenSpaceError = sse;
    }
    saved = null;
    tileQuality?.setDrone?.(false);
    document.body.classList.remove('drone-mode');
    osd.hidden = true;
    scene.requestRender();
    onChange(false);
  }

  view.addEventListener('keydown', onKeyDown, true);
  view.addEventListener('keyup', onKeyUp, true);
  view.addEventListener('blur', onBlur);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousedown', onMouseDown);
  view.addEventListener('mouseup', onMouseUp);
  view.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false, capture: true });

  return {
    isActive: () => active,
    enter,
    exit,
    toggle() {
      if (active) exit();
      else enter();
    },
    destroy() {
      exit();
      view.removeEventListener('keydown', onKeyDown, true);
      view.removeEventListener('keyup', onKeyUp, true);
      view.removeEventListener('blur', onBlur);
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('mousedown', onMouseDown);
      view.removeEventListener('mouseup', onMouseUp);
      view.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel, { capture: true });
      osd.remove();
    },
  };
}
