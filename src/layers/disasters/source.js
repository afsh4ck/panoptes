import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeDisasterSnapshot } from './records.js';

const MAX_BYTES = 16 * 1024 * 1024;

/** Request a normalized disaster snapshot through the same-origin proxy. */
export function createDisasterSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/disasters', { signal });
      if (!response.ok) throw new Error(`Disasters HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
      signal?.throwIfAborted();
      const snapshot = normalizeDisasterSnapshot(payload);
      if (!snapshot) throw new Error('Malformed disaster snapshot');
      return snapshot;
    },
  };
}
