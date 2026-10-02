import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  normalizeInterferenceSnapshot,
  validInterferenceBox,
} from './cells.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Request validated interference cells for a box through the same-origin proxy. */
export function createGpsInterferenceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: 'adsb.lol',
    async getCells(box, { signal } = {}) {
      signal?.throwIfAborted();
      if (!validInterferenceBox(box))
        throw new Error('Invalid interference box');
      const params = new URLSearchParams({
        south: box.south.toFixed(2),
        west: box.west.toFixed(2),
        north: box.north.toFixed(2),
        east: box.east.toFixed(2),
      });
      const response = await fetchImpl(`/api/gps-interference?${params}`, {
        signal,
      });
      if (!response.ok)
        throw new Error(`GPS interference HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        MAX_BODY_BYTES,
        signal,
      );
      signal?.throwIfAborted();
      const snapshot = normalizeInterferenceSnapshot(payload);
      if (!snapshot) throw new Error('Malformed interference snapshot');
      return snapshot;
    },
  };
}
