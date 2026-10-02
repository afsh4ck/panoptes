import { createVectorTileSource } from '../../sources/vectorTiles.js';
import { BUILDING_ZOOM, decodeBuildingTile } from './records.js';

/**
 * Keyless building footprints from OpenFreeMap's OpenMapTiles vector tiles.
 * A dedicated tile source (separate cache from roads/installations) that only
 * decodes the `building` layer.
 */
export function createOpenFreeMapBuildingsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const tiles = createVectorTileSource({
    tileJsonUrl: 'https://tiles.openfreemap.org/planet',
    allowedOrigin: 'https://tiles.openfreemap.org',
    decode: decodeBuildingTile,
    fetchImpl,
    maxTiles: 16,
    concurrency: 4,
    maxEntries: 48,
    maxCacheBytes: 48 * 1024 * 1024,
  });
  return {
    zoom: BUILDING_ZOOM,
    /**
     * Fetch the given z14 tiles; `onTile` receives each decoded tile as it lands.
     * @param {Array<{z: number, x: number, y: number}>} selected
     */
    async getTiles(selected, { signal, onTile } = {}) {
      if (!selected?.length) return { tiles: [], partial: false };
      const xs = selected.map((t) => t.x);
      const ys = selected.map((t) => t.y);
      const n = 2 ** BUILDING_ZOOM;
      const lon = (x) => (x / n) * 360 - 180;
      const lat = (y) =>
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
      const box = {
        west: lon(Math.min(...xs)),
        east: lon(Math.max(...xs) + 1),
        north: lat(Math.min(...ys)),
        south: lat(Math.max(...ys) + 1),
      };
      return tiles.fetchBounds(box, {
        zoom: BUILDING_ZOOM,
        tiles: selected,
        signal,
        onTile,
      });
    },
    clear: () => tiles.clear(),
    getStats: () => tiles.getStats(),
  };
}
