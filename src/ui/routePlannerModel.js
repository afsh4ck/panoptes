/**
 * Pure rules for the ROUTE drawer: travel modes, a flight plan between two
 * points, and a timeline that turns a route (geometry + timed steps) into a
 * position, heading, height and progress at any simulated second.
 * No Cesium, no DOM.
 */

import { greatCircleKm, greatCirclePath } from './flightRouteModel.js';

/** Travel modes. `profile` is the /api/route profile; flights are planned here. */
export const ROUTE_MODES = Object.freeze({
  foot: Object.freeze({
    id: 'foot',
    label: 'Walk',
    profile: 'foot',
    followRangeM: 260,
  }),
  car: Object.freeze({
    id: 'car',
    label: 'Drive',
    profile: 'car',
    followRangeM: 700,
  }),
  fly: Object.freeze({
    id: 'fly',
    label: 'Fly',
    profile: null,
    followRangeM: 45000,
  }),
});
export const DEFAULT_ROUTE_MODE = 'car';

/** Playback speeds offered as chips (simulated seconds per real second). */
export const PLAYBACK_SPEEDS = Object.freeze([1, 10, 60, 300, 1000]);

const EARTH_RADIUS_M = 6_371_000;
const CRUISE_ALT_M = 11_000;
const CRUISE_KMH = 850;
const CLIMB_KMH = 450;
const DESCENT_KMH = 420;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance between two [lon, lat] pairs, metres. */
export function segmentMeters([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from one [lon, lat] to another, degrees clockwise from north. */
export function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Parse "40.4168, -3.7038" (lat, lon) into a point, or null. */
export function parseCoordinates(text) {
  const match = String(text || '')
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

/**
 * A flight from A to B: great-circle track, climb / cruise / descent phases
 * with realistic speeds, and a height for every track vertex.
 * @param {{lat:number, lon:number, name?:string}} a
 * @param {{lat:number, lon:number, name?:string}} b
 */
export function planFlight(a, b) {
  const totalKm = greatCircleKm(a, b);
  if (!(totalKm > 0)) return null;
  const climbKm = Math.min(180, totalKm * 0.3);
  const descentKm = Math.min(200, totalKm * 0.35);
  const cruiseKm = Math.max(0, totalKm - climbKm - descentKm);
  // A short hop flies low and slow (light aircraft / helicopter pace), an
  // airliner trip reaches full speed from ~300 km.
  const pace = Math.max(0.25, Math.min(1, totalKm / 300));
  const hours = (km, kmh) => km / (kmh * pace);
  const climbS = hours(climbKm, CLIMB_KMH) * 3600;
  const cruiseS = hours(cruiseKm, CRUISE_KMH) * 3600;
  const descentS = hours(descentKm, DESCENT_KMH) * 3600;
  const segments = Math.max(16, Math.min(256, Math.round(totalKm / 10)));
  const geometry = greatCirclePath(a, b, segments).map((p) => [p.lon, p.lat]);
  // Cruise altitude scales down for short hops.
  const cruiseAltM = Math.min(
    CRUISE_ALT_M,
    Math.max(300, totalKm * 25 + Math.min(3000, totalKm * 60)),
  );
  const cumulative = cumulativeMeters(geometry);
  const total = cumulative[cumulative.length - 1] || 1;
  const heights = cumulative.map((m) => {
    const km = (m / total) * totalKm;
    if (km < climbKm) return cruiseAltM * (1 - (1 - km / climbKm) ** 2);
    if (km > totalKm - descentKm) {
      const left = (totalKm - km) / descentKm;
      return cruiseAltM * (1 - (1 - left) ** 2);
    }
    return cruiseAltM;
  });
  const from = a.name || 'origin';
  const to = b.name || 'destination';
  const steps = [
    {
      instruction: `Take off from ${from} and climb`,
      distanceM: climbKm * 1000,
      durationS: climbS,
      lon: a.lon,
      lat: a.lat,
    },
    ...(cruiseKm > 0
      ? [
          {
            instruction: `Cruise at FL${Math.round((cruiseAltM * 3.28084) / 100)}`,
            distanceM: cruiseKm * 1000,
            durationS: cruiseS,
            lon: geometry[Math.round(geometry.length * 0.3)][0],
            lat: geometry[Math.round(geometry.length * 0.3)][1],
          },
        ]
      : []),
    {
      instruction: `Descend towards ${to}`,
      distanceM: descentKm * 1000,
      durationS: descentS,
      lon: geometry[Math.round(geometry.length * 0.75)][0],
      lat: geometry[Math.round(geometry.length * 0.75)][1],
    },
    {
      instruction: `Land at ${to}`,
      distanceM: 0,
      durationS: 0,
      lon: b.lon,
      lat: b.lat,
    },
  ].map((step, index) => ({ ...step, index }));
  return {
    mode: 'fly',
    distanceM: totalKm * 1000,
    durationS: climbS + cruiseS + descentS,
    geometry,
    heights,
    steps,
  };
}

/** Cumulative metres at each vertex of a [lon, lat] polyline. */
export function cumulativeMeters(geometry) {
  const out = [0];
  for (let i = 1; i < geometry.length; i++)
    out.push(out[i - 1] + segmentMeters(geometry[i - 1], geometry[i]));
  return out;
}

/**
 * Timeline for a route: where each step starts in distance and in time along
 * the drawn geometry. Step distances are rescaled to the geometry's length so
 * the two always agree; steps without usable timing fall back to the route's
 * average speed.
 */
export function buildTimeline(route) {
  const geometry = route?.geometry || [];
  if (geometry.length < 2) return null;
  const cumulative = cumulativeMeters(geometry);
  const lengthM = cumulative[cumulative.length - 1];
  const durationS = Math.max(1, Number(route.durationS) || 0);
  const steps = (route.steps || []).filter((s) => Number(s.distanceM) > 0);
  const stepDistanceSum = steps.reduce(
    (sum, s) => sum + Number(s.distanceM),
    0,
  );
  const scale = stepDistanceSum > 0 ? lengthM / stepDistanceSum : 1;
  const legs = [];
  let distanceAt = 0;
  let timeAt = 0;
  if (steps.length) {
    for (const step of steps) {
      const distanceM = Number(step.distanceM) * scale;
      const stepDuration =
        Number(step.durationS) > 0
          ? Number(step.durationS)
          : (Number(step.distanceM) / Math.max(1, Number(route.distanceM))) *
            durationS;
      legs.push({
        index: step.index,
        startM: distanceAt,
        endM: distanceAt + distanceM,
        startS: timeAt,
        endS: timeAt + stepDuration,
      });
      distanceAt += distanceM;
      timeAt += stepDuration;
    }
  } else {
    legs.push({
      index: 0,
      startM: 0,
      endM: lengthM,
      startS: 0,
      endS: durationS,
    });
    timeAt = durationS;
  }
  return {
    geometry,
    heights: route.heights || null,
    cumulative,
    lengthM,
    durationS: timeAt,
    legs,
    // Step index → [startS, endS], used for the per-step times in the list.
    stepTimes: new Map(legs.map((leg) => [leg.index, [leg.startS, leg.endS]])),
  };
}

/** Distance along the route reached after `t` simulated seconds. */
export function distanceAtTime(timeline, t) {
  if (!timeline) return 0;
  const time = Math.max(0, Math.min(timeline.durationS, t));
  for (const leg of timeline.legs) {
    if (time <= leg.endS || leg === timeline.legs[timeline.legs.length - 1]) {
      const span = leg.endS - leg.startS;
      const f = span > 0 ? (time - leg.startS) / span : 1;
      return leg.startM + Math.max(0, Math.min(1, f)) * (leg.endM - leg.startM);
    }
  }
  return timeline.lengthM;
}

/**
 * State of the traveller after `t` simulated seconds.
 * @returns {{lon:number, lat:number, heightM:number, headingDeg:number,
 *   traveledM:number, remainingM:number, remainingS:number, legIndex:number,
 *   stepIndex:number, vertexIndex:number, done:boolean}}
 */
export function positionAtTime(timeline, t) {
  const traveledM = distanceAtTime(timeline, t);
  const { cumulative, geometry, heights } = timeline;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < traveledM) i++;
  const a = geometry[i - 1];
  const b = geometry[i];
  const span = cumulative[i] - cumulative[i - 1];
  const f = span > 0 ? (traveledM - cumulative[i - 1]) / span : 0;
  const lon = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const heightM = heights
    ? heights[i - 1] + (heights[i] - heights[i - 1]) * f
    : 0;
  const legIndex = Math.max(
    0,
    timeline.legs.findIndex((leg) => traveledM <= leg.endM + 0.01),
  );
  const time = Math.max(0, Math.min(timeline.durationS, t));
  return {
    lon,
    lat,
    heightM,
    headingDeg: bearingDeg(a, b),
    traveledM,
    remainingM: Math.max(0, timeline.lengthM - traveledM),
    remainingS: Math.max(0, timeline.durationS - time),
    legIndex,
    stepIndex: timeline.legs[legIndex]?.index ?? 0,
    vertexIndex: i - 1,
    done: time >= timeline.durationS,
  };
}

/** A playback speed that plays the whole route in about 90 real seconds. */
export function suggestedSpeed(durationS) {
  const target = Math.max(1, durationS / 90);
  return PLAYBACK_SPEEDS.reduce((best, s) =>
    Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target))
      ? s
      : best,
  );
}

/** "14:32" clock for `now + seconds` (local time). */
export function clockAfter(seconds, now = new Date()) {
  const at = new Date(now.getTime() + Math.max(0, seconds) * 1000);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
