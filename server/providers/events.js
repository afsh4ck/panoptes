/**
 * Live event proxies: conflict events (GDELT + optional UCDP/ACLED), disaster
 * alerts (GDACS + NASA EONET) and Safecast radiation. Each is a Vite plugin
 * that serves one same-origin `/api/*` route for dev and preview servers.
 */
export { conflictsProxy } from './events/conflicts.js';
export { disastersProxy } from './events/disasters.js';
export { radiationProxy } from './events/radiation.js';
