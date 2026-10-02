import { createDisastersLayer } from '../../layers/disasters/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire disaster alerts to the application overlay host. */
export function createApplicationDisasters(options) {
  return createDisastersLayer({ overlayHost, ...options });
}
