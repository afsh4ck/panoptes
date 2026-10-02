import { createConflictsLayer } from '../../layers/conflicts/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire conflict events to the application overlay host. */
export function createApplicationConflicts(options) {
  return createConflictsLayer({ overlayHost, ...options });
}
