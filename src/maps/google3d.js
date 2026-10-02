const clean = (value) => String(value || '').trim();

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({
  googleApiKey = '',
  cesiumToken = '',
} = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/** Google's answer for EEA accounts, which cannot use 3D or satellite tiles. */
const REGION_BLOCKED = /not available for your account and region|comms\/eea/i;

/**
 * Describe why a photoreal load failed without ever exposing the key: HTTP
 * status, whether Google refused the account's region (EEA), and Google's
 * own message.
 * @param {unknown} error Cesium RequestErrorEvent, Error or string.
 * @returns {{status: number|null, regionBlocked: boolean, message: string}}
 */
export function photorealFailureReason(error) {
  const status = Number(error?.statusCode ?? error?.status);
  let body = '';
  const response = error?.response;
  if (typeof response === 'string') body = response;
  else if (response instanceof ArrayBuffer)
    body = new TextDecoder().decode(response);
  else if (response && typeof response === 'object')
    body = JSON.stringify(response);
  let message = '';
  try {
    message = JSON.parse(body)?.error?.message || '';
  } catch {
    message = '';
  }
  message ||= String(error?.message || '');
  // Strip anything that looks like a key query parameter.
  message = message.replace(/key=[^&\s]+/gi, 'key=<redacted>').slice(0, 280);
  return {
    status: Number.isFinite(status) ? status : null,
    // Google's EEA refusal text is specific enough to trust on its own; some
    // Cesium error shapes drop the status code.
    regionBlocked: REGION_BLOCKED.test(body) || REGION_BLOCKED.test(message),
    message,
  };
}

/**
 * Ask the 3D Tiles root once for Google's refusal text when the SDK error
 * carried none (Cesium may wrap the HTTP failure). Never logs the key.
 * @returns {Promise<ReturnType<typeof photorealFailureReason>|null>}
 */
export async function probeGoogleTilesReason(
  key,
  fetchImpl = (...args) => globalThis.fetch(...args),
) {
  try {
    const response = await fetchImpl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (response.ok) return null;
    const body = await response.text();
    return photorealFailureReason({
      statusCode: response.status,
      response: body,
    });
  } catch {
    return null;
  }
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '' } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    try {
      const tileset = attempt.googleKey
        ? await createGoogleDirectTileset(Cesium, attempt.googleKey)
        : await createGoogleIonTileset(Cesium, ionToken);
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      let reason = photorealFailureReason(error);
      if (attempt.googleKey && !reason.regionBlocked)
        reason = (await probeGoogleTilesReason(attempt.googleKey)) || reason;
      const wrapped =
        error instanceof Error
          ? error
          : new Error(
              reason.message || `Google 3D Tiles HTTP ${reason.status ?? '?'}`,
            );
      wrapped.photorealReason = { ...reason, route: attempt.route };
      errors.push(wrapped);
    }
  }

  return {
    tileset: null,
    route: 'osm',
    errors,
    regionBlocked: errors.some((e) => e.photorealReason?.regionBlocked),
  };
}

/** Pass credentials to the source instead of changing SDK-wide defaults. */
export function createGoogleDirectTileset(Cesium, key) {
  key = clean(key);
  if (!key) throw new Error('Google 3D requires an explicit browser key');
  // Tiles keep drawing their own texture while draped weather loads.
  return Cesium.createGooglePhotorealistic3DTileset(
    { key, onlyUsingWithGoogleGeocoder: true },
    {
      asynchronouslyLoadImagery: true,
      // Same generous cache as the ion route: revisited areas stay resident.
      cacheBytes: 1536 * 1024 * 1024,
      maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    },
  );
}

export async function createGoogleIonTileset(
  Cesium,
  accessToken,
  { signal } = {},
) {
  accessToken = clean(accessToken);
  if (!accessToken)
    throw new Error('Google 3D through ion requires an explicit token');
  signal?.throwIfAborted();
  const resource = await Cesium.IonResource.fromAssetId(2275207, {
    accessToken,
  });
  signal?.throwIfAborted();
  // Match the installed SDK's Google helper rendering/cache defaults.
  return Cesium.Cesium3DTileset.fromUrl(resource, {
    cacheBytes: 1536 * 1024 * 1024,
    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    enableCollision: true,
    // Tiles keep drawing their own texture while draped weather loads.
    asynchronouslyLoadImagery: true,
  });
}
