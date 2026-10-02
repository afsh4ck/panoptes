import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPhotorealisticTileset,
  photorealFailureReason,
  probeGoogleTilesReason,
} from './google3d.js';

const EEA_BODY = JSON.stringify({
  error: {
    code: 403,
    message:
      'Your request cannot be served because satellite tiles and 3D tiles are not available for your account and region. Learn more here: https://developers.google.com/maps/comms/eea/map-tiles.',
    status: 'PERMISSION_DENIED',
  },
});

test('recognizes the Google EEA refusal and redacts keys', () => {
  const reason = photorealFailureReason({
    statusCode: 403,
    response: EEA_BODY,
  });
  assert.equal(reason.status, 403);
  assert.equal(reason.regionBlocked, true);
  assert.match(reason.message, /not available for your account and region/);
  const other = photorealFailureReason(
    new Error('fetch failed for https://x/?key=SECRET123&a=1'),
  );
  assert.equal(other.regionBlocked, false);
  assert.doesNotMatch(other.message, /SECRET123/);
});

test('probe reads the refusal body and tolerates network failure', async () => {
  const reason = await probeGoogleTilesReason('k', async () => ({
    ok: false,
    status: 403,
    text: async () => EEA_BODY,
  }));
  assert.equal(reason.regionBlocked, true);
  assert.equal(
    await probeGoogleTilesReason('k', async () => {
      throw new Error('offline');
    }),
    null,
  );
});

test('a failed direct load reports regionBlocked without a tileset', async () => {
  const Cesium = {
    createGooglePhotorealistic3DTileset: async () => {
      throw Object.assign(new Error('Request has failed. Status Code: 403'), {
        statusCode: 403,
        response: EEA_BODY,
      });
    },
  };
  const result = await loadPhotorealisticTileset(Cesium, { googleApiKey: 'k' });
  assert.equal(result.tileset, null);
  assert.equal(result.regionBlocked, true);
  assert.equal(result.errors[0].photorealReason.regionBlocked, true);
});
