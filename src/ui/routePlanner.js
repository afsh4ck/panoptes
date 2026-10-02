import * as Cesium from 'cesium';
import { claimPointer, releasePointer } from '../data/inputOwnership.js';
import {
  formatRouteDistance,
  formatRouteDuration,
} from '../data/routeSteps.js';
import {
  directionsRequestUrl,
  normalizeRoutePayload,
} from '../layers/directions/index.js';
import {
  DEFAULT_ROUTE_MODE,
  PLAYBACK_SPEEDS,
  ROUTE_MODES,
  buildTimeline,
  clockAfter,
  parseCoordinates,
  planFlight,
  positionAtTime,
  suggestedSpeed,
} from './routePlannerModel.js';

/**
 * @module routePlanner
 * @description The ROUTE drawer: pick A and B (search, coordinates or a
 * click on the map), choose walking, driving or flying, then play the trip
 * live on the globe — a moving marker the camera follows, the travelled part
 * of the route in cyan and the rest in orange, the current and next step,
 * elapsed and remaining time and distance, and per-step times.
 * Street routes come from the keyless /api/route proxy (OSRM, © OpenStreetMap
 * contributors); flights are planned along the great circle.
 */

const POINTER_OWNER = 'route-planner';
const TRAVELLED = Cesium.Color.fromCssColorString('#38bdf8');
const REMAINING = Cesium.Color.fromCssColorString('#f5a524');
const A_COLOR = Cesium.Color.fromCssColorString('#4ade80');
const B_COLOR = Cesium.Color.fromCssColorString('#ef4444');
const LIFT_M = 4;

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Document} options.document
 * @param {HTMLElement} options.root Container inside the drawer.
 * @param {(query: string, opts: {signal: AbortSignal}) => Promise<object|null>} [options.geocode]
 * @param {(text: string) => void} [options.toast]
 */
export function createRoutePlanner({
  viewer,
  document,
  root,
  geocode = null,
  toast = () => {},
}) {
  if (!viewer || !root) return null;
  const view = document.defaultView || globalThis.window;
  const scene = viewer.scene;
  const camera = viewer.camera;
  const source = new Cesium.CustomDataSource('panoptes-route-planner');
  viewer.dataSources.add(source);

  const state = {
    a: null,
    b: null,
    mode: DEFAULT_ROUTE_MODE,
    route: null,
    timeline: null,
    heights: null,
    t: 0,
    playing: false,
    speed: 10,
    follow: true,
    picking: null,
    lease: null,
    loading: false,
  };

  // ── DOM ────────────────────────────────────────────────────────────
  root.textContent = '';
  const intro = el(
    document,
    'p',
    'route-help',
    'Set a start and a destination, choose how to travel, then press Play to follow the trip live on the map.',
  );
  const points = el(document, 'div', 'route-points');
  const fields = {};
  for (const key of ['a', 'b']) {
    const row = el(document, 'div', `route-point route-point-${key}`);
    const badge = el(document, 'span', 'route-badge', key.toUpperCase());
    const input = el(document, 'input', 'route-input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder =
      key === 'a'
        ? 'Start: search a place or lat, lon'
        : 'Destination: search a place or lat, lon';
    const pick = el(document, 'button', 'route-pick', '⌖');
    pick.type = 'button';
    pick.title = 'Pick this point on the map';
    row.append(badge, input, pick);
    points.appendChild(row);
    fields[key] = { input, pick, row };
  }
  const swap = el(document, 'button', 'route-swap', '⇅');
  swap.type = 'button';
  swap.title = 'Swap start and destination';
  points.appendChild(swap);

  const modes = el(document, 'div', 'route-modes');
  modes.setAttribute('role', 'radiogroup');
  const modeButtons = Object.values(ROUTE_MODES).map((mode) => {
    const button = el(document, 'button', 'route-mode', mode.label);
    button.type = 'button';
    button.dataset.mode = mode.id;
    button.setAttribute('role', 'radio');
    modes.appendChild(button);
    return button;
  });

  const calculate = el(document, 'button', 'route-calc', 'Calculate route');
  calculate.type = 'button';

  const summary = el(document, 'div', 'route-summary');
  summary.hidden = true;
  const stats = el(document, 'div', 'route-stats');
  const player = el(document, 'div', 'route-player');
  const play = el(document, 'button', 'route-play', '▶ Play');
  play.type = 'button';
  const stop = el(document, 'button', 'route-stop', '■');
  stop.type = 'button';
  stop.title = 'Back to the start';
  const followToggle = el(document, 'button', 'route-follow active', 'Follow');
  followToggle.type = 'button';
  followToggle.title = 'Camera follows the traveller';
  player.append(play, stop, followToggle);
  const speeds = el(document, 'div', 'route-speeds');
  const speedButtons = PLAYBACK_SPEEDS.map((speed) => {
    const button = el(document, 'button', 'route-speed', `×${speed}`);
    button.type = 'button';
    button.dataset.speed = String(speed);
    speeds.appendChild(button);
    return button;
  });
  const progress = el(document, 'div', 'route-progress');
  const bar = el(document, 'div', 'route-progress-bar');
  const fill = el(document, 'div', 'route-progress-fill');
  bar.appendChild(fill);
  const progressText = el(document, 'div', 'route-progress-text');
  const now = el(document, 'div', 'route-now');
  progress.append(bar, progressText, now);
  const stepsTitle = el(document, 'div', 'route-steps-title', 'Route steps');
  const steps = el(document, 'ol', 'route-steps');
  summary.append(stats, player, speeds, progress, stepsTitle, steps);

  const status = el(document, 'div', 'route-status');
  root.append(intro, points, modes, calculate, status, summary);

  // ── Map entities ───────────────────────────────────────────────────
  const marker = (color) =>
    source.entities.add({
      show: false,
      position: Cesium.Cartesian3.fromDegrees(0, 0),
      point: {
        pixelSize: 16,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  const markerA = marker(A_COLOR);
  const markerB = marker(B_COLOR);
  let travelledPositions = [];
  let remainingPositions = [];
  // Readable over any city: a dark casing under the whole route, a bright
  // glowing line for the travelled leg and a wide dashed line for the rest.
  const line = (getPositions, material, width, failAlpha = 0.8) =>
    source.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(getPositions, false),
        width,
        arcType: Cesium.ArcType.NONE,
        material,
        // Buildings never cut the route.
        depthFailMaterial: new Cesium.ColorMaterialProperty(
          (material.color?.getValue?.() ?? Cesium.Color.BLACK).withAlpha(
            failAlpha,
          ),
        ),
      },
    });
  line(
    () => [...travelledPositions, ...remainingPositions.slice(1)],
    new Cesium.ColorMaterialProperty(Cesium.Color.BLACK.withAlpha(0.6)),
    13,
    0.45,
  );
  line(
    () => remainingPositions,
    new Cesium.PolylineDashMaterialProperty({
      color: REMAINING,
      gapColor: REMAINING.withAlpha(0.28),
      dashLength: 22,
    }),
    7,
  );
  line(
    () => travelledPositions,
    new Cesium.PolylineGlowMaterialProperty({
      color: TRAVELLED,
      glowPower: 0.22,
      taperPower: 1,
    }),
    12,
  );
  let travellerPosition = Cesium.Cartesian3.fromDegrees(0, 0);
  const traveller = source.entities.add({
    show: false,
    position: new Cesium.CallbackProperty(() => travellerPosition, false),
    point: {
      pixelSize: 16,
      color: Cesium.Color.WHITE,
      outlineColor: TRAVELLED,
      outlineWidth: 4,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────
  function setStatus(text) {
    status.textContent = text || '';
    status.hidden = !text;
  }
  function placeMarker(entity, point) {
    entity.show = Boolean(point);
    if (point)
      entity.position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat);
    scene.requestRender();
  }
  function setPoint(key, point) {
    state[key] = point;
    fields[key].input.value = point ? point.name || '' : '';
    placeMarker(key === 'a' ? markerA : markerB, point);
    clearRoute();
  }
  function heightAt(index) {
    const ground = state.heights?.[index] ?? 0;
    const profile = state.route?.heights?.[index] ?? 0;
    return state.route?.mode === 'fly'
      ? Math.max(ground, profile) + LIFT_M
      : ground + LIFT_M;
  }
  function vertex(index) {
    const [lon, lat] = state.timeline.geometry[index];
    return Cesium.Cartesian3.fromDegrees(lon, lat, heightAt(index));
  }

  async function resolveQuery(key) {
    const text = fields[key].input.value.trim();
    if (!text) return state[key];
    if (state[key] && text === state[key].name) return state[key];
    const coords = parseCoordinates(text);
    if (coords) return coords;
    if (typeof geocode !== 'function') return null;
    const controller = new AbortController();
    try {
      const result = await geocode(text, { signal: controller.signal });
      const place = result?.place || result;
      const lat = Number(place?.lat);
      const lon = Number(place?.lng ?? place?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, name: place.name || text };
    } catch {
      return null;
    }
  }

  // ── Pick on map ────────────────────────────────────────────────────
  const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  function stopPicking() {
    if (state.lease) releasePointer(state.lease);
    state.lease = null;
    state.picking = null;
    for (const key of ['a', 'b']) fields[key].pick.classList.remove('active');
    document.body.classList.remove('route-picking');
  }
  function startPicking(key) {
    if (state.picking === key) return stopPicking();
    stopPicking();
    const lease = claimPointer(POINTER_OWNER);
    if (!lease) {
      toast('Another map tool is using the pointer — close it first');
      return;
    }
    state.lease = lease;
    state.picking = key;
    fields[key].pick.classList.add('active');
    document.body.classList.add('route-picking');
    setStatus(
      key === 'a'
        ? 'Click the map to set the start'
        : 'Click the map to set the destination',
    );
  }
  clickHandler.setInputAction((click) => {
    if (!state.picking) return;
    let cartesian = null;
    if (scene.pickPositionSupported)
      cartesian = scene.pickPosition(click.position);
    if (!cartesian)
      cartesian = camera.pickEllipsoid(click.position, scene.globe.ellipsoid);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const key = state.picking;
    setPoint(key, { lat, lon, name: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    stopPicking();
    setStatus('');
    if (state.a && state.b) calculateRoute();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ── Route ──────────────────────────────────────────────────────────
  function clearRoute() {
    pause();
    state.route = null;
    state.timeline = null;
    state.heights = null;
    state.t = 0;
    travelledPositions = [];
    remainingPositions = [];
    traveller.show = false;
    summary.hidden = true;
    scene.requestRender();
  }

  /**
   * Ground height under every route vertex. The exact answer
   * (sampleHeightMostDetailed) can take long while tiles stream; after a few
   * seconds the route is published on a quick estimate from the loaded
   * terrain and `onLate` receives the exact heights when they land, so a
   * slow sample never leaves the route (and the follow camera) at sea level.
   */
  async function sampleGround(geometry, maxSamples = 400, onLate = null) {
    const flat = geometry.map(() => 0);
    // Thin long routes: sample at most maxSamples vertices, interpolate the rest.
    const stride = Math.max(1, Math.ceil(geometry.length / maxSamples));
    const picks = [];
    for (let i = 0; i < geometry.length; i += stride) picks.push(i);
    if (picks[picks.length - 1] !== geometry.length - 1)
      picks.push(geometry.length - 1);
    const cartographics = picks.map((i) =>
      Cesium.Cartographic.fromDegrees(geometry[i][0], geometry[i][1]),
    );
    const plausible = (h) => Number.isFinite(h) && h > -500 && h < 9000;
    const spread = (values) => {
      const known = values.filter(plausible);
      const fallback = known.length
        ? known.reduce((sum, h) => sum + h, 0) / known.length
        : 0;
      const heights = flat.slice();
      picks.forEach((i, k) => {
        heights[i] = plausible(values[k]) ? values[k] : fallback;
      });
      for (let k = 0; k < picks.length - 1; k++) {
        const [i0, i1] = [picks[k], picks[k + 1]];
        for (let i = i0 + 1; i < i1; i++)
          heights[i] =
            heights[i0] + ((heights[i1] - heights[i0]) * (i - i0)) / (i1 - i0);
      }
      return heights;
    };
    const estimate = () =>
      spread(
        cartographics.map((c) => {
          try {
            return scene.globe?.getHeight?.(c);
          } catch {
            return undefined;
          }
        }),
      );
    if (typeof scene.sampleHeightMostDetailed !== 'function') return estimate();
    try {
      const exact = scene
        .sampleHeightMostDetailed(cartographics.map((c) => c.clone()))
        .then((result) => spread(result.map((c) => c?.height)));
      const TIMEOUT = Symbol('timeout');
      const first = await Promise.race([
        exact,
        new Promise((resolve) => view.setTimeout(() => resolve(TIMEOUT), 4000)),
      ]);
      if (first !== TIMEOUT) return first;
      exact.then((heights) => onLate?.(heights)).catch(() => {});
      return estimate();
    } catch {
      return estimate();
    }
  }

  async function calculateRoute() {
    // A mode or point change during a calculation recalculates right after it.
    if (state.loading) {
      state.pendingRecalc = true;
      state.abort?.abort(); // drop the stale road request now
      return;
    }
    state.pendingRecalc = false;
    state.loading = true;
    state.abort = new AbortController();
    calculate.disabled = true;
    setStatus('Calculating route…');
    try {
      const [a, b] = await Promise.all([resolveQuery('a'), resolveQuery('b')]);
      if (!a || !b) {
        setStatus(!a ? 'Start not found' : 'Destination not found');
        return;
      }
      if (a !== state.a) setPoint('a', a);
      if (b !== state.b) setPoint('b', b);
      // The mode this route was asked for; the selector may change meanwhile.
      const mode = state.mode;
      let route = null;
      if (mode === 'fly') route = planFlight(a, b);
      else {
        const profile = ROUTE_MODES[mode].profile;
        const response = await fetch(directionsRequestUrl(profile, a, b), {
          signal: AbortSignal.any([
            state.abort.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        route = normalizeRoutePayload(await response.json(), profile);
      }
      if (!route) {
        setStatus('No route found between these points');
        return;
      }
      // Ground first, then publish route, timeline and heights together, so
      // playback never sees a route without its heights. A flight only needs
      // the airfield elevations; the profile carries it above everything else.
      const token = Symbol('route');
      const heights = await sampleGround(
        route.geometry,
        mode === 'fly' ? 2 : 400,
        (late) => {
          if (state.routeToken !== token) return;
          state.heights = late;
          update();
        },
      );
      if (state.pendingRecalc) return; // superseded; finally re-runs
      pause();
      state.route = { ...route, mode };
      state.timeline = buildTimeline(route);
      state.heights = heights;
      state.routeToken = token;
      state.t = 0;
      state.speed = suggestedSpeed(state.timeline.durationS);
      setStatus('');
      renderSummary();
      renderSteps();
      update();
      frameRoute();
    } catch (error) {
      if (!state.pendingRecalc)
        setStatus(`Route unavailable: ${error?.message || error}`);
    } finally {
      state.loading = false;
      calculate.disabled = false;
      if (state.pendingRecalc) calculateRoute();
    }
  }

  function frameRoute() {
    const positions = state.timeline.geometry.map((_, i) => vertex(i));
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    camera.flyToBoundingSphere(sphere, {
      duration: 1.6,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-55),
        sphere.radius * 2.6 + 400,
      ),
    });
  }

  // ── Playback ───────────────────────────────────────────────────────
  let frame = 0;
  let lastFrameAt = 0;
  let smoothedHeading = null;
  function tick(nowMs) {
    if (!state.playing) return;
    frame = view.requestAnimationFrame(tick);
    const dt = lastFrameAt ? Math.min(0.25, (nowMs - lastFrameAt) / 1000) : 0;
    lastFrameAt = nowMs;
    state.t += dt * state.speed;
    update();
    if (state.t >= state.timeline.durationS) {
      pause();
      toast('Route complete');
    }
  }
  function playPause() {
    if (!state.timeline) return;
    if (state.playing) return pause();
    if (state.t >= state.timeline.durationS) state.t = 0;
    state.playing = true;
    lastFrameAt = 0;
    play.textContent = '❚❚ Pause';
    play.classList.add('active');
    frame = view.requestAnimationFrame(tick);
  }
  function pause() {
    state.playing = false;
    view.cancelAnimationFrame(frame);
    play.textContent = '▶ Play';
    play.classList.remove('active');
    releaseCamera();
  }
  function releaseCamera() {
    try {
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch {
      /* free already */
    }
  }

  // Camera distance while following: close for a short trip, wide for a
  // long flight, so a 2 km hop is never watched from 45 km away.
  function followRange() {
    const lengthM = state.timeline?.lengthM || 0;
    if (state.route?.mode === 'fly')
      return Math.max(900, Math.min(45000, 600 + lengthM * 0.08));
    if (state.route?.mode === 'car')
      return Math.max(350, Math.min(1400, 350 + lengthM * 0.02));
    return ROUTE_MODES.foot.followRangeM;
  }

  function update() {
    const timeline = state.timeline;
    if (!timeline) return;
    const at = positionAtTime(timeline, state.t);
    const ground = state.heights?.[at.vertexIndex] ?? 0;
    const height =
      state.route?.mode === 'fly' ? Math.max(ground, at.heightM) : ground;
    travellerPosition = Cesium.Cartesian3.fromDegrees(
      at.lon,
      at.lat,
      height + LIFT_M + 2,
    );
    const cut = at.vertexIndex + 1;
    travelledPositions = [
      ...timeline.geometry.slice(0, cut).map((_, i) => vertex(i)),
      travellerPosition,
    ];
    remainingPositions = [
      travellerPosition,
      ...timeline.geometry.slice(cut).map((_, i) => vertex(cut + i)),
    ];
    traveller.show = true;
    if (state.playing && state.follow) {
      const heading = Cesium.Math.toRadians(at.headingDeg);
      smoothedHeading =
        smoothedHeading === null
          ? heading
          : smoothedHeading +
            Math.atan2(
              Math.sin(heading - smoothedHeading),
              Math.cos(heading - smoothedHeading),
            ) *
              0.08;
      const range = followRange();
      camera.lookAt(
        travellerPosition,
        new Cesium.HeadingPitchRange(
          smoothedHeading,
          Cesium.Math.toRadians(state.route?.mode === 'fly' ? -24 : -32),
          range,
        ),
      );
    }
    renderProgress(at);
    scene.requestRender();
  }

  // ── Panel rendering ────────────────────────────────────────────────
  function stat(label, value) {
    const box = el(document, 'div', 'route-stat');
    box.append(
      el(document, 'span', 'route-stat-label', label),
      el(document, 'strong', 'route-stat-value', value),
    );
    return box;
  }
  function renderSummary() {
    const { timeline, route } = state;
    summary.hidden = false;
    stats.textContent = '';
    const kmh =
      timeline.lengthM / 1000 / Math.max(1 / 3600, timeline.durationS / 3600);
    stats.append(
      stat('Distance', formatRouteDistance(timeline.lengthM)),
      stat('Duration', formatRouteDuration(timeline.durationS)),
      stat('Arrival if leaving now', clockAfter(timeline.durationS)),
      stat('Average speed', `${Math.round(kmh)} km/h`),
    );
    stats.dataset.mode = route.mode;
    renderSpeeds();
  }
  function renderSpeeds() {
    for (const button of speedButtons)
      button.classList.toggle(
        'active',
        Number(button.dataset.speed) === state.speed,
      );
  }
  let lastStep = -1;
  function renderSteps() {
    steps.textContent = '';
    lastStep = -1;
    const route = state.route;
    for (const step of route.steps) {
      const item = el(document, 'li', 'route-step');
      item.dataset.step = String(step.index);
      const times = state.timeline.stepTimes.get(step.index);
      const head = el(document, 'div', 'route-step-head');
      head.append(
        el(document, 'span', 'route-step-text', step.instruction),
        el(
          document,
          'span',
          'route-step-at',
          times ? `+${formatRouteDuration(times[0]) || '0 s'}` : '',
        ),
      );
      const meta = el(
        document,
        'div',
        'route-step-meta',
        [
          formatRouteDistance(step.distanceM),
          times ? formatRouteDuration(times[1] - times[0]) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      item.append(head, meta);
      item.addEventListener('click', () => {
        if (!times) return;
        state.t = times[0];
        update();
        if (!state.playing) {
          releaseCamera();
          camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              step.lon,
              step.lat,
              state.route?.mode === 'fly' ? followRange() * 2.5 : 900,
            ),
            duration: 1.2,
          });
        }
      });
      steps.appendChild(item);
    }
  }
  function renderProgress(at) {
    const timeline = state.timeline;
    const share =
      timeline.durationS > 0 ? Math.min(1, state.t / timeline.durationS) : 0;
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    progressText.textContent = [
      `${formatRouteDuration(Math.min(state.t, timeline.durationS)) || '0 s'} elapsed`,
      `${formatRouteDuration(at.remainingS) || '0 s'} left`,
      `${formatRouteDistance(at.traveledM) || '0 m'} done`,
      `${formatRouteDistance(at.remainingM) || '0 m'} to go`,
    ].join(' · ');
    const current = state.route.steps.find((s) => s.index === at.stepIndex);
    const next = state.route.steps.find((s) => s.index > at.stepIndex);
    const nextTimes = next ? timeline.stepTimes.get(next.index) : null;
    now.textContent = '';
    if (current)
      now.append(el(document, 'div', 'route-now-current', current.instruction));
    if (next && nextTimes && !at.done)
      now.append(
        el(
          document,
          'div',
          'route-now-next',
          `Next · ${next.instruction} · ${formatRouteDuration(Math.max(0, nextTimes[0] - state.t)) || '0 s'}`,
        ),
      );
    if (at.done)
      now.append(el(document, 'div', 'route-now-current', 'Arrived'));
    if (at.stepIndex !== lastStep) {
      lastStep = at.stepIndex;
      for (const item of steps.children) {
        const index = Number(item.dataset.step);
        item.classList.toggle('current', index === at.stepIndex);
        item.classList.toggle('passed', index < at.stepIndex);
      }
      steps
        .querySelector('.route-step.current')
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function renderModes() {
    for (const button of modeButtons) {
      const on = button.dataset.mode === state.mode;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', String(on));
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  on(fields.a.pick, 'click', () => startPicking('a'));
  on(fields.b.pick, 'click', () => startPicking('b'));
  for (const key of ['a', 'b'])
    on(fields[key].input, 'keydown', (event) => {
      if (event.key === 'Enter') calculateRoute();
    });
  on(swap, 'click', () => {
    const { a, b } = state;
    setPoint('a', b);
    setPoint('b', a);
    if (state.a && state.b) calculateRoute();
  });
  on(modes, 'click', (event) => {
    const mode = event.target?.closest?.('[data-mode]')?.dataset?.mode;
    if (!mode || mode === state.mode) return;
    state.mode = mode;
    renderModes();
    if (state.route || (state.a && state.b)) calculateRoute();
  });
  on(calculate, 'click', () => calculateRoute());
  on(play, 'click', () => playPause());
  on(stop, 'click', () => {
    pause();
    state.t = 0;
    update();
  });
  on(followToggle, 'click', () => {
    state.follow = !state.follow;
    followToggle.classList.toggle('active', state.follow);
    if (!state.follow) releaseCamera();
  });
  on(speeds, 'click', (event) => {
    const speed = Number(
      event.target?.closest?.('[data-speed]')?.dataset?.speed,
    );
    if (!speed) return;
    state.speed = speed;
    renderSpeeds();
  });
  renderModes();
  setStatus('');

  return {
    destroy() {
      pause();
      stopPicking();
      clickHandler.destroy();
      for (const remove of listeners) remove();
      viewer.dataSources.remove(source, true);
    },
  };
}
