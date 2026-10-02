import * as Cesium from 'cesium';

/**
 * @module dayNight
 * @description Day and night on the globe while the Celestial view is on.
 * A post-process pass reads each pixel's world position from the depth
 * buffer and shades it by the real sun direction at the viewer's clock time:
 * the night side darkens to a cold blue, the terminator gets a warm dusk
 * band, and the day side is untouched. It works on photorealistic 3D tiles
 * too, which carry their own baked lighting and ignore the globe's.
 */

export const DAY_NIGHT_SHADER = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  if (depth >= 1.0) {
    out_FragColor = color; // sky and space stay as they are
    return;
  }
  vec4 positionEC = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  vec3 positionWC = (czm_inverseView * positionEC).xyz;
  float sunDot = dot(normalize(positionWC), czm_sunDirectionWC);
  // 0 in daylight, 1 deep in the night, with a soft terminator.
  float night = 1.0 - smoothstep(-0.14, 0.08, sunDot);
  float dusk = smoothstep(-0.14, 0.0, sunDot) * (1.0 - smoothstep(0.0, 0.14, sunDot));
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 nightColor = vec3(luma) * vec3(0.16, 0.21, 0.38) + vec3(0.0, 0.004, 0.018);
  vec3 lit = mix(color.rgb, color.rgb * vec3(1.06, 0.76, 0.56), dusk * 0.55);
  out_FragColor = vec4(mix(lit, nightColor, night * 0.9), color.a);
}
`;

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @returns {{setEnabled(on: boolean): void, enabled: boolean, destroy(): void}}
 */
export function createDayNight({ viewer }) {
  let stage = null;
  let enabled = false;
  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      const scene = viewer?.scene;
      if (!scene || scene.isDestroyed?.()) return;
      enabled = Boolean(on);
      if (enabled && !stage) {
        stage = new Cesium.PostProcessStage({
          name: 'panoptes-day-night',
          fragmentShader: DAY_NIGHT_SHADER,
        });
        scene.postProcessStages.add(stage);
      }
      if (stage) stage.enabled = enabled;
      // Terrain and imagery basemaps shade from the sun as well.
      if (scene.globe) scene.globe.enableLighting = enabled;
      scene.requestRender?.();
    },
    destroy() {
      const scene = viewer?.scene;
      if (stage && scene && !scene.isDestroyed?.()) {
        scene.postProcessStages.remove(stage);
        if (scene.globe) scene.globe.enableLighting = false;
      }
      stage = null;
      enabled = false;
    },
  };
}
