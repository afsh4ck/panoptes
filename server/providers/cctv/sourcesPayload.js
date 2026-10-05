import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { normalizeFeedType } from './normalize.js';

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = promisify(zlib.gzip);

/**
 * The `/api/cctv/sources` body. Each licence string ships once in `licenses`
 * and rows point at it with `licenseRef` (a few dozen licences repeated over
 * ~18,000 cameras were 12 % of the payload); empty optional fields are left
 * out. The client expands both back (src/layers/cctv/source.js).
 *
 * @param {Array<object>} sources - Catalog sources.
 * @returns {{licenses: string[], sources: Array<object>}}
 */
export function buildSourcesPayload(sources) {
  const licenses = [];
  const licenseRefs = new Map();
  const rows = sources.map((source) => {
    const row = {
      id: source.id,
      name: source.name,
      city: source.city,
      cityId: source.cityId,
      provider: source.provider,
      lat: source.lat,
      lon: source.lon,
      headingDeg: source.headingDeg,
      headingConfidence: source.headingConfidence || '',
      pitchDeg: source.pitchDeg,
      fovDeg: source.fovDeg,
      rangeM: source.rangeM,
      mountHeightM: source.mountHeightM,
      groundElevationM: source.groundElevationM,
      feedType: normalizeFeedType(source.feedType),
      sourceKind: source.sourceKind || (source.url ? 'configured' : 'fallback'),
    };
    if (source.poseSource) row.poseSource = source.poseSource;
    if (source.license) {
      if (!licenseRefs.has(source.license)) {
        licenseRefs.set(source.license, licenses.length);
        licenses.push(source.license);
      }
      row.licenseRef = licenseRefs.get(source.license);
    }
    if (source.credit) row.credit = source.credit;
    if (source.code) row.code = source.code;
    if (source.groundHeights) row.groundHeights = source.groundHeights;
    return row;
  });
  return { licenses, sources: rows };
}

/** Content codings the client accepts, honouring an explicit `q=0`. */
function acceptedEncodings(header) {
  const accepted = new Set();
  for (const part of String(header || '')
    .toLowerCase()
    .split(',')) {
    const [name, ...params] = part.split(';').map((piece) => piece.trim());
    const q = params.find((param) => param.startsWith('q='));
    if (name && !(q && Number(q.slice(2)) === 0)) accepted.add(name);
  }
  return accepted;
}

/**
 * Serialized `/sources` bodies for one catalog snapshot: the JSON is built on
 * first use and each compressed form once, then reused until the catalog
 * array changes (every refresh replaces it).
 */
export function createSourcesBodyCache() {
  let snapshot = null;
  let bodies = null;
  return function bodiesFor(sources) {
    if (sources !== snapshot) {
      snapshot = sources;
      bodies = {
        json: Buffer.from(JSON.stringify(buildSourcesPayload(sources))),
        br: null,
        gzip: null,
      };
    }
    return bodies;
  };
}

/**
 * The body to send for an Accept-Encoding: brotli, then gzip, else JSON.
 *
 * @param {{json: Buffer, br: Promise<Buffer>|null, gzip: Promise<Buffer>|null}} bodies
 * @param {string} [acceptEncoding]
 * @returns {Promise<{encoding: string|null, body: Buffer}>}
 */
export async function encodedSourcesBody(bodies, acceptEncoding) {
  const accepted = acceptedEncodings(acceptEncoding);
  try {
    if (accepted.has('br')) {
      bodies.br ??= brotliCompress(bodies.json, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
      });
      return { encoding: 'br', body: await bodies.br };
    }
    if (accepted.has('gzip')) {
      bodies.gzip ??= gzipCompress(bodies.json, { level: 6 });
      return { encoding: 'gzip', body: await bodies.gzip };
    }
  } catch {
    // Fall through to the identity body; compression is an optimisation.
  }
  return { encoding: null, body: bodies.json };
}
