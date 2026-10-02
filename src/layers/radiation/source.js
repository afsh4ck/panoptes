import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  RADIATION_DEFAULT_DAYS,
  RADIATION_WINDOWS,
  normalizeRadiationSnapshot,
} from './records.js';

const MAX_BYTES = 16 * 1024 * 1024;

/** Request a normalized Safecast snapshot through the same-origin proxy. */
export function createRadiationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ days = RADIATION_DEFAULT_DAYS, signal } = {}) {
      signal?.throwIfAborted();
      const span = RADIATION_WINDOWS.includes(days)
        ? days
        : RADIATION_DEFAULT_DAYS;
      const response = await fetchImpl(`/api/radiation?days=${span}`, {
        signal,
      });
      if (!response.ok) throw new Error(`Radiation HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
      signal?.throwIfAborted();
      const snapshot = normalizeRadiationSnapshot(payload);
      if (!snapshot) throw new Error('Malformed radiation snapshot');
      return snapshot;
    },
  };
}
