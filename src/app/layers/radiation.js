import { createRadiationLayer } from '../../layers/radiation/index.js';
import { overlayHost } from './overlayHost.js';
import {
  registerEntityContext,
  selectEntityContext,
} from '../../data/contextStore.js';
/** Wire Safecast radiation to the application overlay host. */
export function createApplicationRadiation(options) {
  return createRadiationLayer({
    overlayHost,
    registerEntityContext,
    selectEntityContext,
    ...options,
  });
}
