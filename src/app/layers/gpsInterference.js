import { createGpsInterferenceLayer } from '../../layers/gpsInterference/index.js';
/** Construct the GPS-interference cell layer with a supplied source. */
export function createApplicationGpsInterference(options) {
  return createGpsInterferenceLayer(options);
}
