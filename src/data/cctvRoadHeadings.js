/**
 * @module cctvRoadHeadings
 *
 * Road-aligned bearings for highway cameras whose feed publishes no facing,
 * used by scripts/precompute-cctv-road-headings.mjs. A camera on a numbered
 * road ("A-6") faces along that road, so its bearing is the bearing of the
 * nearest stretch of the same road in OpenStreetMap. Which way along it comes
 * from the feed: DGT marks each camera `positive` (towards increasing
 * kilometre points) or `negative`, and a neighbouring camera on the same road
 * with a different kilometre point shows which way the kilometres grow there.
 * With both, the bearing is `medium` confidence; with only the road axis it
 * stays `low`, still drawn as an estimate.
 */

const EARTH_M_PER_DEG = 111_320;
/** Road classes a highway camera may stand on when the road number is unknown. */
const MAJOR_ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
]);

/** "A-6" / "a 6" / "A6" → "A6"; OSM `ref` lists split on ";" or ",". */
export function normalizeRoadRef(ref) {
  return String(ref || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function roadRefs(ref) {
  return String(ref || '')
    .split(/[;,]/)
    .map(normalizeRoadRef)
    .filter(Boolean);
}

/** Smallest angle between two bearings, 0–180. */
export function angleDiff(a, b) {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Initial bearing from one {lat, lon} to another, degrees clockwise from north. */
export function bearingDeg(from, to) {
  const toRad = Math.PI / 180;
  const lat1 = from.lat * toRad;
  const lat2 = to.lat * toRad;
  const dLon = (to.lon - from.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Nearest road stretch to a camera: a line carrying the camera's road number
 * within `maxRefDistanceM` wins; otherwise the nearest major road within
 * `maxAnyDistanceM`. Returns the stretch's bearing (one of the two ways along
 * it) or null.
 *
 * @param {{lat: number, lon: number}} point
 * @param {Array<{coordinates: number[][], ref?: string, class?: string}>} lines
 *   Lines in [lon, lat] order.
 * @param {string} road - The camera's road number, if any.
 * @returns {{axisDeg: number, distanceM: number, matchedRef: boolean}|null}
 */
export function nearestRoadAxis(
  point,
  lines,
  road,
  { maxRefDistanceM = 150, maxAnyDistanceM = 60 } = {},
) {
  const want = normalizeRoadRef(road);
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const local = ([lon, lat]) => [
    (lon - point.lon) * cosLat * EARTH_M_PER_DEG,
    (lat - point.lat) * EARTH_M_PER_DEG,
  ];
  let best = null;
  for (const line of lines) {
    const matchedRef = Boolean(want) && roadRefs(line.ref).includes(want);
    const limit = matchedRef ? maxRefDistanceM : maxAnyDistanceM;
    if (!matchedRef && !MAJOR_ROAD_CLASSES.has(line.class)) continue;
    const coords = line.coordinates || [];
    for (let i = 1; i < coords.length; i++) {
      const [ax, ay] = local(coords[i - 1]);
      const [bx, by] = local(coords[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d > limit) continue;
      // A matching road number outranks any distance advantage of another road.
      const better =
        !best ||
        (matchedRef && !best.matchedRef) ||
        (matchedRef === best.matchedRef && d < best.distanceM);
      if (better) {
        best = {
          axisDeg: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
          distanceM: d,
          matchedRef,
        };
      }
    }
  }
  return best;
}

/**
 * Bearing towards increasing kilometre points at a camera, from the nearest
 * camera on the same road 0.3–40 km away whose straight-line distance agrees
 * with the kilometre gap. NaN when no neighbour qualifies.
 *
 * @param {{lat: number, lon: number, kmPoint: number}} camera
 * @param {Array<{lat: number, lon: number, kmPoint: number}>} sameRoad
 */
export function kmUpBearing(camera, sameRoad) {
  if (!Number.isFinite(camera?.kmPoint)) return NaN;
  let best = null;
  for (const other of sameRoad) {
    if (other === camera || !Number.isFinite(other?.kmPoint)) continue;
    const dk = other.kmPoint - camera.kmPoint;
    if (Math.abs(dk) < 0.3 || Math.abs(dk) > 40) continue;
    // Same road name, different stretch: a straight line longer than the road
    // between them, or far shorter, is not this stretch of road.
    const straightKm = distanceM(camera, other) / 1000;
    if (straightKm > Math.abs(dk) * 1.2 + 0.5) continue;
    if (straightKm < Math.abs(dk) * 0.2) continue;
    if (!best || Math.abs(dk) < Math.abs(best.dk)) best = { other, dk };
  }
  if (!best) return NaN;
  const bearing = bearingDeg(camera, best.other);
  return best.dk > 0 ? bearing : (bearing + 180) % 360;
}

/**
 * Final bearing for a road camera. `destinationDeg` is the bearing to the
 * far-away city the feed names as the camera's destination ("→ Madrid"),
 * when known: a facing that points away from it means the feed contradicts
 * itself, so the bearing keeps only `low` confidence.
 *
 * @param {{axisDeg: number, kmUpDeg?: number, travelDirection?: string,
 *   destinationDeg?: number}} input
 * @returns {{headingDeg: number, confidence: 'medium'|'low'}|null}
 */
export function resolveRoadHeading({
  axisDeg,
  kmUpDeg = NaN,
  travelDirection,
  destinationDeg = NaN,
}) {
  if (!Number.isFinite(axisDeg)) return null;
  // The road stretch runs both ways; the kilometre direction picks one.
  let up = null;
  if (Number.isFinite(kmUpDeg)) {
    const diff = angleDiff(axisDeg, kmUpDeg);
    if (diff <= 60) up = axisDeg;
    else if (diff >= 120) up = (axisDeg + 180) % 360;
  }
  if (
    up === null ||
    (travelDirection !== 'positive' && travelDirection !== 'negative')
  ) {
    return { headingDeg: up ?? axisDeg, confidence: 'low' };
  }
  const headingDeg = travelDirection === 'positive' ? up : (up + 180) % 360;
  const contradicted =
    Number.isFinite(destinationDeg) &&
    angleDiff(headingDeg, destinationDeg) >= 135;
  return { headingDeg, confidence: contradicted ? 'low' : 'medium' };
}
