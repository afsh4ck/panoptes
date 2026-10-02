import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeEmergencySnapshot } from './records.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Request a validated emergency snapshot through the same-origin adsb.lol proxy. */
export function createEmergencySquawkSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: 'adsb.lol',
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/adsblol/emergency', { signal });
      if (!response.ok) throw new Error(`adsb.lol HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        MAX_BODY_BYTES,
        signal,
      );
      signal?.throwIfAborted();
      const snapshot = normalizeEmergencySnapshot(payload);
      if (!snapshot) throw new Error('Malformed emergency snapshot');
      return snapshot;
    },
  };
}
