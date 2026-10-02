import * as Cesium from 'cesium';
import { createStarfieldSkyBox } from './starfield.js';
import { applyModelAtmosphereWorkaround } from './atmosphereCompat.js';

const PINCH_ZOOM_MULTIPLIER = 8;
const MAX_PINCH_PIXEL_DELTA = 120;

function boundedPinchDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return delta;
  return (
    Math.sign(delta) *
    Math.min(Math.abs(delta) * PINCH_ZOOM_MULTIPLIER, MAX_PINCH_PIXEL_DELTA)
  );
}

/**
 * Add browser trackpad pinch to Cesium's zoom inputs and return its disposer.
 * Browsers expose this gesture as a small pixel-mode Ctrl+wheel event.
 */
export function installTrackpadPinchZoom(
  viewer,
  { createWheelEvent = (type, init) => new WheelEvent(type, init) } = {},
) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  const container = viewer?.container;
  const canvas = viewer?.canvas;
  if (!controller || !container || !canvas)
    throw new TypeError('A complete Cesium viewer is required');

  const originalZoomEventTypes = controller.zoomEventTypes;
  const zoomEventTypes = Array.isArray(originalZoomEventTypes)
    ? originalZoomEventTypes
    : originalZoomEventTypes === undefined
      ? []
      : [originalZoomEventTypes];
  const alreadyHandlesControlWheel = zoomEventTypes.some(
    (binding) =>
      binding?.eventType === Cesium.CameraEventType.WHEEL &&
      binding?.modifier === Cesium.KeyboardEventModifier.CTRL,
  );
  const configuredZoomEventTypes = alreadyHandlesControlWheel
    ? originalZoomEventTypes
    : [
        ...zoomEventTypes,
        {
          eventType: Cesium.CameraEventType.WHEEL,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
      ];
  if (!alreadyHandlesControlWheel)
    controller.zoomEventTypes = configuredZoomEventTypes;

  const relayedEvents = new WeakSet();
  const relayPinch = (event) => {
    if (
      !event.ctrlKey ||
      relayedEvents.has(event) ||
      event.deltaMode !== 0 ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0
    )
      return;
    let relayed;
    try {
      relayed = createWheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: boundedPinchDelta(event.deltaY),
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        view: globalThis.window,
      });
    } catch {
      // The registered Ctrl+wheel binding can still consume the original.
      return;
    }
    relayedEvents.add(relayed);
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(relayed);
  };
  container.addEventListener('wheel', relayPinch, {
    capture: true,
    passive: false,
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener('wheel', relayPinch, true);
    if (
      !alreadyHandlesControlWheel &&
      controller.zoomEventTypes === configuredZoomEventTypes
    )
      controller.zoomEventTypes = originalZoomEventTypes;
  };
}

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    msaaSamples: 4,
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
  });
  try {
    viewer.targetFrameRate = 60;
    // Before any tile builds a draw command: Cesium's per-vertex model
    // atmosphere fails to LINK on Apple's Metal backend and kills the
    // render loop. See app/atmosphereCompat.js.
    applyModelAtmosphereWorkaround(viewer.scene);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    // Photoreal 3D tiles stream from one host over HTTP/2; Cesium's default
    // of 18 concurrent requests per server leaves bandwidth idle while a city
    // loads. More parallel requests fill the view faster at the same quality.
    // The global cap (50 by default) would otherwise throttle these per-host
    // limits as soon as imagery and terrain requests share the scheduler.
    Cesium.RequestScheduler.maximumRequests = Math.max(
      Cesium.RequestScheduler.maximumRequests || 0,
      160,
    );
    for (const host of ['tile.googleapis.com:443', 'assets.ion.cesium.com:443'])
      Cesium.RequestScheduler.requestsByServer[host] = Math.max(
        Cesium.RequestScheduler.requestsByServer[host] || 0,
        64,
      );
    // Crisp procedural stars instead of the low-resolution default sky box,
    // painted when the main thread is idle so startup is not delayed.
    const installStars = () => {
      try {
        if (viewer.isDestroyed?.()) return;
        const skyBox = createStarfieldSkyBox();
        if (skyBox) {
          viewer.scene.skyBox?.destroy?.();
          viewer.scene.skyBox = skyBox;
          viewer.scene.requestRender?.();
        }
      } catch {
        /* keep Cesium's default sky */
      }
    };
    if (typeof globalThis.requestIdleCallback === 'function')
      globalThis.requestIdleCallback(installStars, { timeout: 4000 });
    else setTimeout(installStars, 1500);
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
