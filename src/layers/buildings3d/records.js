import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { tileToBBox, tilesForBounds } from '../../data/tomtomTiles.js';
import { clipTileRing } from '../../sources/militaryTileGeometry.js';

/**
 * Pure building records for the keyless 3D buildings layer: OpenMapTiles
 * `building` polygons (OpenFreeMap vector tiles) decoded into footprints with
 * a base and roof height, plus the tile-range and cache helpers the layer
 * uses. No Cesium, no DOM.
 */

/** Vector tile zoom the buildings come from (OpenMapTiles has full detail at 14). */
export const BUILDING_ZOOM = 14;
/** Fallback roof height when a building has no `render_height`. */
export const DEFAULT_BUILDING_HEIGHT_M = 9;
/** Upper bound on buildings kept from one tile. */
export const MAX_BUILDINGS_PER_TILE = 6000;
/** Upper bound on vertices per footprint ring (very large outlines are simplified away). */
const MAX_RING_POINTS = 400;

function finiteHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 1000
    ? number
    : null;
}

/**
 * Normalize one building's properties into base/roof heights in metres.
 * @param {object} properties OpenMapTiles building properties.
 * @returns {{minHeight: number, height: number}|null} null when hidden.
 */
export function buildingHeights(properties = {}) {
  if (properties.hide_3d === true || properties.hide_3d === 'true') return null;
  const height =
    finiteHeight(properties.render_height) ?? DEFAULT_BUILDING_HEIGHT_M;
  const minHeight = Math.min(
    finiteHeight(properties.render_min_height) ?? 0,
    Math.max(0, height - 1),
  );
  return { minHeight, height: Math.max(height, minHeight + 1) };
}

/** Drop the closing duplicate and reject degenerate rings. */
function openRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const points = ring.slice(0, -1);
  if (points.length < 3 || points.length > MAX_RING_POINTS) return null;
  return points;
}

/**
 * Decode the `building` layer of one vector tile.
 * @param {Uint8Array|ArrayBuffer} bytes Tile body.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {{tile: string, buildings: Array<{id: string, ring: number[][], minHeight: number, height: number, centroid: number[]}>}}
 */
export function decodeBuildingTile(bytes, z, x, y) {
  const tile = new VectorTile(new PbfReader(bytes));
  const layer = tile.layers.building;
  const key = `${z}/${x}/${y}`;
  const buildings = [];
  if (!layer) return { tile: key, buildings };
  const box = tileToBBox(z, x, y);
  for (
    let i = 0;
    i < layer.length && buildings.length < MAX_BUILDINGS_PER_TILE;
    i++
  ) {
    const feature = layer.feature(i);
    const heights = buildingHeights(feature.properties);
    if (!heights) continue;
    const geometry = feature.toGeoJSON(x, y, z).geometry;
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
    for (let p = 0; p < polygons.length; p++) {
      // Outer ring only: courtyards render as solid blocks, which keeps the
      // geometry cheap and reads correctly from above.
      const clipped = clipTileRing(polygons[p][0], box);
      const ring = openRing(clipped);
      if (!ring) continue;
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of ring) {
        sx += lon;
        sy += lat;
      }
      buildings.push({
        id: `${key}:${feature.id ?? i}:${p}`,
        ring,
        minHeight: heights.minHeight,
        height: heights.height,
        centroid: [sx / ring.length, sy / ring.length],
      });
    }
  }
  return { tile: key, buildings };
}

/**
 * Tiles covering a view rectangle at the building zoom, nearest-first around
 * `focus` (the camera's ground point), capped at `maxTiles`.
 * @param {{south: number, west: number, north: number, east: number}} bounds
 * @param {{lat: number, lon: number}|null} focus
 * @param {number} maxTiles
 */
export function buildingTilesForView(bounds, focus, maxTiles = 12) {
  if (!bounds) return [];
  const all = tilesForBounds(bounds, BUILDING_ZOOM, { maxTiles: 400 });
  if (!all.length) return [];
  const center = focus
    ? lonLatTileFloat(focus.lon, focus.lat, BUILDING_ZOOM)
    : {
        x: all.reduce((n, t) => n + t.x + 0.5, 0) / all.length,
        y: all.reduce((n, t) => n + t.y + 0.5, 0) / all.length,
      };
  return all
    .map((tile) => ({
      tile,
      d: Math.hypot(tile.x + 0.5 - center.x, tile.y + 0.5 - center.y),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(1, maxTiles))
    .map((entry) => entry.tile);
}

/** Fractional XYZ tile coordinates for a lon/lat. */
export function lonLatTileFloat(lon, lat, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * Small LRU keyed by tile id. Evicted values are handed to `onEvict` so the
 * caller can destroy GPU resources.
 */
export function createLruCache(limit, onEvict = () => {}) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > limit) {
        const [oldestKey, oldest] = map.entries().next().value;
        map.delete(oldestKey);
        onEvict(oldest, oldestKey);
      }
    },
    has: (key) => map.has(key),
    keys: () => [...map.keys()],
    values: () => [...map.values()],
    get size() {
      return map.size;
    },
    clear() {
      for (const [key, value] of map) onEvict(value, key);
      map.clear();
    },
  };
}

/**
 * Whether the keyless 3D buildings layer should switch itself on at startup.
 * Only for a fresh session without photoreal 3D, never over a share link that
 * chose its own layers, and only once (the user's later choice wins).
 */
export function shouldAutoEnableBuildings({
  photorealAvailable,
  shareLinkHasLayers,
  alreadyAutoEnabled,
  alreadyEnabled,
}) {
  return (
    !photorealAvailable &&
    !shareLinkHasLayers &&
    !alreadyAutoEnabled &&
    !alreadyEnabled
  );
}

/**
 * Roof colour for a height: graphite that lightens with height, warming
 * toward the PANOPTES amber for towers. Returns [r, g, b] in 0–1.
 */
export function buildingColor(height) {
  const t = Math.max(0, Math.min(1, height / 80));
  const base = [0.2, 0.22, 0.25];
  const tall = [0.46, 0.48, 0.52];
  const color = base.map((v, i) => v + (tall[i] - v) * t);
  if (height >= 60) {
    const w = Math.min(1, (height - 60) / 120);
    const amber = [0.96, 0.65, 0.14];
    return color.map((v, i) => v + (amber[i] - v) * w * 0.55);
  }
  return color;
}
