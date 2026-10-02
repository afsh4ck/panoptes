import { createBuildings3dLayer } from '../../layers/buildings3d/index.js';

/**
 * Wire the 3D buildings layer to the configured Cesium ion token (OSM
 * Buildings) or the keyless OpenFreeMap extrusion path.
 */
export function createApplicationBuildings3d(options) {
  const layer = createBuildings3dLayer({
    ionToken: import.meta.env?.CESIUM_ION_TOKEN || '',
    ...options,
  });
  // QA seam in development builds only.
  if (import.meta.env?.DEV && globalThis.window)
    globalThis.window.__panoptesBuildings3d = () => layer.getDiagnostics();
  return layer;
}
