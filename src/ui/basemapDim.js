import * as Cesium from 'cesium';

/**
 * @module basemapDim
 * @description Darkens the basemap (photoreal 3D tiles and flat imagery)
 * without touching data symbology, so dense point layers stay legible —
 * e.g. city traffic dots over bright rooftops.
 *
 * The 3D tiles get one CustomShader that multiplies the material colour by a
 * uniform; changing the amount only updates the uniform (re-assigning a
 * shader to ready content does not rebuild it). Flat imagery layers use
 * their own `brightness`.
 */

const SCAN_INTERVAL_MS = 1500;

/** Brightness factor for a dim amount in [0, 0.8]. */
export function dimFactor(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return 1 - Math.min(0.8, value);
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Window} options.windowRef
 */
export function createBasemapDimmer({ viewer, windowRef }) {
  let amount = 0;
  let shader = null;
  const shaded = new WeakSet();
  const imageryBase = new WeakMap();

  function ensureShader() {
    if (shader) return shader;
    shader = new Cesium.CustomShader({
      uniforms: {
        u_basemapDim: { type: Cesium.UniformType.FLOAT, value: 1 },
      },
      fragmentShaderText: `
        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          material.diffuse *= u_basemapDim;
          material.emissive *= u_basemapDim;
        }
      `,
    });
    return shader;
  }

  function apply() {
    if (!viewer || viewer.isDestroyed?.()) return;
    const factor = dimFactor(amount);
    const primitives = viewer.scene.primitives;
    if (factor < 1 || shader) {
      const custom = ensureShader();
      custom.setUniform('u_basemapDim', factor);
      for (let i = 0; i < primitives.length; i++) {
        const p = primitives.get(i);
        if (!(p instanceof Cesium.Cesium3DTileset) || p.isDestroyed?.())
          continue;
        if (shaded.has(p)) continue;
        // Never replace a shader another feature installed.
        if (p.customShader && p.customShader !== custom) continue;
        p.customShader = custom;
        shaded.add(p);
      }
    }
    const layers = viewer.imageryLayers;
    for (let i = 0; i < (layers?.length || 0); i++) {
      const layer = layers.get(i);
      if (!imageryBase.has(layer)) imageryBase.set(layer, layer.brightness);
      layer.brightness = imageryBase.get(layer) * factor;
    }
    viewer.scene.requestRender();
  }

  const timer = windowRef?.setInterval?.(() => {
    if (amount > 0) apply();
  }, SCAN_INTERVAL_MS);

  return {
    /** @param {number} next 0 (off) … 0.8 */
    set(next) {
      const value = Math.max(0, Math.min(0.8, Number(next) || 0));
      if (value === amount) return;
      amount = value;
      apply();
    },
    get: () => amount,
    destroy() {
      windowRef?.clearInterval?.(timer);
      amount = 0;
      apply();
    },
  };
}
