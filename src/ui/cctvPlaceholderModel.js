/**
 * Recognise a publisher's "camera in use" card in a downscaled frame.
 *
 * Some official publishers (Transport for London's JamCams, several US DOTs)
 * replace the picture with a flat grey card and a line of text while an
 * operator is steering the camera ("Camera … in use keeping London moving").
 * The frame loads fine, so nothing upstream reports it; the panel recognises
 * the card instead and says so, rather than showing what looks like a broken
 * image.
 *
 * A card is: most pixels a neutral (unsaturated) mid grey, and those grey
 * pixels almost perfectly flat. Real road scenes — even overcast asphalt —
 * have texture, so their grey pixels vary far more.
 */

/** Sample size the caller should draw the frame at. */
export const PLACEHOLDER_SAMPLE = Object.freeze({ width: 48, height: 27 });

/**
 * @param {Uint8ClampedArray|number[]} rgba Pixel data (RGBA, row-major).
 * @returns {boolean}
 */
export function looksLikePublisherPlaceholder(rgba) {
  const total = Math.floor((rgba?.length || 0) / 4);
  if (total < 64) return false;
  let grey = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < total; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (max - min <= 12 && luma >= 90 && luma <= 190) {
      grey += 1;
      sum += luma;
      sumSq += luma * luma;
    }
  }
  if (grey / total < 0.6) return false;
  const mean = sum / grey;
  const variance = Math.max(0, sumSq / grey - mean * mean);
  return Math.sqrt(variance) < 6;
}
