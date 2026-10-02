import * as Cesium from 'cesium';

/**
 * @module starfield
 * @description Crisp procedural star sky. Cesium's default sky box is a
 * ~1k-per-face texture that reads as blocky pixels when the camera pulls back
 * to orbital views (and the sharpen pass amplifies it). This builds six
 * high-resolution canvases instead: anti-aliased point stars with a power-law
 * brightness distribution, subtle colour temperatures and a faint galactic
 * band, generated once from a fixed seed so the sky is stable between visits.
 */

const FACES = Object.freeze([
  'positiveX',
  'negativeX',
  'positiveY',
  'negativeY',
  'positiveZ',
  'negativeZ',
]);

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Star colour by a 0..1 temperature draw: mostly white, some blue and amber. */
export function starColor(t) {
  if (t < 0.12) return [170, 196, 255];
  if (t < 0.3) return [212, 226, 255];
  if (t < 0.82) return [255, 250, 244];
  if (t < 0.95) return [255, 226, 186];
  return [255, 196, 140];
}

/**
 * Star list for one face: positions in pixels, radius and alpha. Faint stars
 * dominate (power law), a handful are bright enough to carry a soft halo.
 */
export function faceStars(random, size, count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const brightness = Math.pow(random(), 7);
    stars.push({
      x: random() * size,
      y: random() * size,
      radius: 0.28 + brightness * 1.25,
      alpha: 0.18 + Math.min(0.82, brightness * 1.6 + random() * 0.25),
      color: starColor(random()),
      halo: brightness > 0.9,
    });
  }
  return stars;
}

function paintFace(document, random, size, count, band) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#020306';
  ctx.fillRect(0, 0, size, size);
  if (band) {
    // A faint diffuse band (not an astronomical map) gives depth to the sky.
    const gradient = ctx.createLinearGradient(
      0,
      size * 0.25,
      size,
      size * 0.75,
    );
    gradient.addColorStop(0, 'rgba(120, 130, 160, 0)');
    gradient.addColorStop(0.5, 'rgba(120, 130, 160, 0.06)');
    gradient.addColorStop(1, 'rgba(120, 130, 160, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  for (const star of faceStars(random, size, count)) {
    const [r, g, b] = star.color;
    if (star.halo) {
      const halo = ctx.createRadialGradient(
        star.x,
        star.y,
        0,
        star.x,
        star.y,
        star.radius * 5,
      );
      halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${star.alpha * 0.35})`);
      halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

/**
 * Build the procedural sky box. Returns null outside a browser.
 * @param {{document?: Document, size?: number, starsPerFace?: number, seed?: number}} [options]
 * @returns {Cesium.SkyBox|null}
 */
export function createStarfieldSkyBox({
  document = globalThis.document,
  size = 2048,
  starsPerFace = 11000,
  seed = 0x9a7e5,
} = {}) {
  if (!document?.createElement) return null;
  const random = seededRandom(seed);
  const sources = {};
  FACES.forEach((face, index) => {
    // Two opposite faces carry the faint band so it reads as one loop.
    sources[face] = paintFace(document, random, size, starsPerFace, false);
  });
  return new Cesium.SkyBox({ sources });
}
