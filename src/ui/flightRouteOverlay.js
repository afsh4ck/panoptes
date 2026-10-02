import * as Cesium from 'cesium';
import {
  formatDuration,
  formatUtcTime,
  greatCirclePath,
  routePoint,
  routeSummary,
} from './flightRouteModel.js';
import { overlayHost } from '../app/layers/overlayHost.js';
import { createInfrastructureOverlayEntry } from '../data/infrastructureOverlayEntry.js';

/** World-overlay source for the airport cards (text never uses Cesium labels). */
const CARD_SOURCE = 'flight-route';
const CARD_OPTIONS = Object.freeze({
  cohortLimit: 2,
  collisionCapacity: 2,
  moving: false,
});

/**
 * @module flightRouteOverlay
 * @description While an aircraft is tracked, draw its published route on the
 * globe: origin and destination airports, the great circle split into the
 * flown leg (dim) and the remaining leg (bright), and an ETA card at the
 * destination from the current ground speed. Route data comes from the
 * flight layer's enrichment (adsbdb), falling back to the INTEL payload.
 * Routes are published schedules for the callsign, not a filed flight plan,
 * so the card says "est."; nothing is drawn when no route is known.
 */

/** Flown leg (behind the aircraft) and remaining leg (to landing). */
const FLOWN_COLOR = Cesium.Color.fromCssColorString('#38bdf8');
const REMAINING_COLOR = Cesium.Color.fromCssColorString('#f5a524');
const ROUTE_HEIGHT_M = 1500;

/**
 * Height profile of the route: from the origin runway the line climbs to the
 * aircraft's current altitude (fast at first, then level), and from the
 * aircraft it stays high before descending onto the destination runway.
 */
export function routeHeights(count, cruiseM, leg) {
  const top = Math.max(ROUTE_HEIGHT_M, Number(cruiseM) || 0);
  return Array.from({ length: count }, (_, i) => {
    const f = count > 1 ? i / (count - 1) : 1;
    const ease = leg === 'flown' ? 1 - (1 - f) ** 3 : 1 - f ** 3;
    return 60 + (top - 60) * ease;
  });
}

function toProfile(points, cruiseM, leg) {
  const heights = routeHeights(points.length, cruiseM, leg);
  return points.map((p, i) =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heights[i]),
  );
}
const TRACKING_LAYERS = Object.freeze({
  flights: 'flightsLayer',
  military: 'militaryFlightsLayer',
});

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.services Shell services (flightsLayer, militaryFlightsLayer).
 * @param {() => object|null} [options.intelModel] Current INTEL model (route fallback).
 * @param {(summary: object|null) => void} [options.onSummary] Route summary listener.
 * @returns {{destroy: Function}}
 */
export function createFlightRouteOverlay({
  viewer,
  services,
  intelModel = () => null,
  onSummary = () => {},
}) {
  const view = globalThis.window;
  const source = new Cesium.CustomDataSource('panoptes-flight-route');
  viewer.dataSources.add(source);
  let tracked = null;
  let timer = null;
  let routeKey = '';
  // Live leg positions, read every frame through CallbackProperty: the legs
  // move with the aircraft, and replacing a constant positions array every
  // poll forced an asynchronous geometry rebuild that never got to draw.
  let flownPositions = [];
  let remainingPositions = [];

  function publishCards(summary) {
    const card = (point, role, details) =>
      createInfrastructureOverlayEntry({
        id: `route-${role}`,
        source: CARD_SOURCE,
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0),
        title: `${role === 'destination' ? 'DEST' : 'ORIG'} · ${point.code || '---'}`,
        details,
        accent: '#f5a524',
        priority: role === 'destination' ? 2 : 1,
      });
    overlayHost.setEntries(
      CARD_SOURCE,
      [
        card(summary.origin, 'origin', [summary.origin.name].filter(Boolean)),
        card(
          summary.destination,
          'destination',
          [
            summary.destination.name,
            `${Math.round(summary.remainingKm).toLocaleString('en-US')} km · ETA ${formatUtcTime(summary.etaMs)} (${formatDuration(summary.remainingMinutes)}) est.`,
          ].filter(Boolean),
        ),
      ],
      CARD_OPTIONS,
    );
    overlayHost.setVisible(CARD_SOURCE, true);
  }

  function clear() {
    overlayHost.clearSource(CARD_SOURCE);
    source.entities.removeAll();
    routeKey = '';
    onSummary(null);
  }

  function readTracked() {
    const key = TRACKING_LAYERS[tracked?.layerId];
    if (!key) return null;
    try {
      return services[key]?.getTrackedInfo?.() || null;
    } catch {
      return null;
    }
  }

  function intelRoute() {
    const raw = intelModel()?.raw;
    const route = raw?.route || raw?.payload?.route || null;
    return route?.origin && route?.destination ? route : null;
  }

  function airportEntity(point, role) {
    return {
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0),
      point: {
        pixelSize: role === 'destination' ? 11 : 9,
        color: role === 'destination' ? REMAINING_COLOR : FLOWN_COLOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
  }

  function render() {
    if (!tracked) return;
    const info = readTracked();
    const route = info?.route || intelRoute();
    if (!info || !route) {
      if (routeKey) clear();
      return;
    }
    const summary = routeSummary({
      origin: route.origin,
      destination: route.destination,
      position: { lat: info.latitude, lon: info.longitude },
      speedMps: info.velocityMps,
    });
    if (!summary) {
      if (routeKey) clear();
      return;
    }
    const here = routePoint({ lat: info.latitude, lon: info.longitude });
    const key = `${tracked.id}|${summary.origin.code}|${summary.destination.code}`;
    if (key !== routeKey) {
      source.entities.removeAll();
      routeKey = key;
      source.entities.add({
        id: 'route-origin',
        ...airportEntity(summary.origin, 'origin'),
      });
      source.entities.add({
        id: 'route-destination',
        ...airportEntity(summary.destination, 'destination'),
      });
      source.entities.add({
        id: 'route-flown',
        polyline: {
          positions: new Cesium.CallbackProperty(() => flownPositions, false),
          width: 3.5,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: FLOWN_COLOR,
            glowPower: 0.16,
          }),
          // Still readable where terrain or 3D buildings hide the line.
          depthFailMaterial: new Cesium.ColorMaterialProperty(
            FLOWN_COLOR.withAlpha(0.45),
          ),
        },
      });
      source.entities.add({
        id: 'route-remaining',
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => remainingPositions,
            false,
          ),
          width: 3,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: REMAINING_COLOR,
            gapColor: REMAINING_COLOR.withAlpha(0.18),
            dashLength: 18,
          }),
          depthFailMaterial: new Cesium.ColorMaterialProperty(
            REMAINING_COLOR.withAlpha(0.4),
          ),
        },
      });
    }
    const cruiseM = Number.isFinite(info.renderAltitudeM)
      ? info.renderAltitudeM
      : info.altitudeM;
    flownPositions = toProfile(
      greatCirclePath(summary.origin, here, 48),
      cruiseM,
      'flown',
    );
    remainingPositions = toProfile(
      greatCirclePath(here, summary.destination, 64),
      cruiseM,
      'remaining',
    );
    publishCards(summary);
    onSummary({ ...summary, label: tracked.label || tracked.id });
    viewer.scene.requestRender?.();
  }

  const onSelected = (event) => {
    const detail = event?.detail || {};
    if (!TRACKING_LAYERS[detail.layerId]) {
      if (tracked) {
        tracked = null;
        clear();
      }
      return;
    }
    tracked = detail;
    clear();
    // Route enrichment lands asynchronously; keep polling while tracked.
    render();
  };
  const onCleared = (event) => {
    const detail = event?.detail || {};
    if (!tracked || (detail.layerId && detail.layerId !== tracked.layerId))
      return;
    tracked = null;
    clear();
  };
  view?.addEventListener?.('gev:awareness-subject-selected', onSelected);
  view?.addEventListener?.('gev:awareness-subject-cleared', onCleared);
  timer = setInterval(render, 2000);

  return {
    destroy() {
      clearInterval(timer);
      view?.removeEventListener?.('gev:awareness-subject-selected', onSelected);
      view?.removeEventListener?.('gev:awareness-subject-cleared', onCleared);
      try {
        viewer.dataSources.remove(source, true);
      } catch {
        /* viewer already destroyed */
      }
    },
  };
}
