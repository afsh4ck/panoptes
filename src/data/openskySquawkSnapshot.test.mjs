import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openSkySquawkSnapshot,
  setOpenSkySnapshotForTest,
} from '../../server/providers/aircraft/opensky.js';

test('the held OpenSky snapshot yields squawking aircraft in adsb.lol shape', (t) => {
  t.after(() => setOpenSkySnapshotForTest(null));
  const time = 1_700_000_000;
  const state = (hex, callsign, lon, lat, altM, ground, mps, squawk, timePosition = time) =>
    [hex, callsign, 'Spain', timePosition, time, lon, lat, altM, ground, mps, 90, 0, null, null, squawk, false, 0, 0];
  setOpenSkySnapshotForTest(
    JSON.stringify({
      time,
      states: [
        state('a1b2c3', 'IBE123  ', -3.7, 40.4, 3048, false, 100, '7700', time - 2),
        state('d4e5f6', 'RYR1', -3.5, 40.5, 9000, false, 200, '2000'),
        state('abcdef', 'GRND', -3.6, 40.45, null, true, 0, '7600'),
      ],
    }),
    time * 1000,
  );
  const snapshot = openSkySquawkSnapshot(['7500', '7600', '7700'], {
    now: time * 1000 + 5000,
  });
  assert.equal(snapshot.at, time * 1000);
  assert.deepEqual(
    snapshot.ac.map((a) => [a.hex, a.squawk, a.flight]),
    [
      ['a1b2c3', '7700', 'IBE123'],
      ['abcdef', '7600', 'GRND'],
    ],
  );
  assert.equal(Math.round(snapshot.ac[0].alt_baro), 10000);
  assert.equal(Math.round(snapshot.ac[0].gs), 194);
  assert.equal(snapshot.ac[0].seen_pos, 2);
  assert.equal(snapshot.ac[1].alt_baro, 'ground');
  assert.equal(
    openSkySquawkSnapshot(['7700'], { now: time * 1000 + 10 * 60_000 }),
    null,
    'a snapshot older than the stale limit is not used',
  );
  setOpenSkySnapshotForTest(null);
  assert.equal(openSkySquawkSnapshot(['7700']), null);
});
