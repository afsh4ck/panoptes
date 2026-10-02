import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  CONFLICT_DEFAULT_HOURS,
  CONFLICT_WINDOWS,
  normalizeConflictSnapshot,
} from './records.js';

const MAX_BYTES = 24 * 1024 * 1024;

/** Request a normalized conflict snapshot through the same-origin proxy. */
export function createConflictSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ hours = CONFLICT_DEFAULT_HOURS, signal } = {}) {
      signal?.throwIfAborted();
      const span = CONFLICT_WINDOWS.includes(hours)
        ? hours
        : CONFLICT_DEFAULT_HOURS;
      const response = await fetchImpl(`/api/conflicts?hours=${span}`, {
        signal,
      });
      if (!response.ok) throw new Error(`Conflicts HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
      signal?.throwIfAborted();
      const snapshot = normalizeConflictSnapshot(payload);
      if (!snapshot) throw new Error('Malformed conflict snapshot');
      return snapshot;
    },
  };
}
