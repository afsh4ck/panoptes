import { createAirEmergenciesLayer } from '../../layers/airEmergencies/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire emergency-squawk contacts to the application overlay host. */
export function createApplicationAirEmergencies(options) {
  return createAirEmergenciesLayer({ overlayHost, ...options });
}
