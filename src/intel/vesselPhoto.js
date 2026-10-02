/**
 * Vessel photo from open sources (Wikidata / Wikimedia Commons).
 *
 * 1. Wikidata: the item whose IMO number (P458) or MMSI (P587) matches the
 *    selected vessel, and its image (P18). Exact identity.
 * 2. Wikimedia Commons file search by name, accepted only when the file
 *    name contains every word of the vessel name, so "MSC CORNELIA" never
 *    shows a different MSC ship.
 *
 * Returns `{src, link, credit}` for the INTEL panel photo slot, or null.
 */

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH = 640;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** Words of a vessel name that must appear in a Commons file name. */
export function nameTokens(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

/** True when a Commons file title plausibly shows the named vessel. */
export function titleMatchesVessel(title, name) {
  const tokens = nameTokens(name);
  if (!tokens.length) return false;
  const haystack = ` ${String(title || '')
    .toUpperCase()
    .replace(/^FILE:/, '')
    .replace(/[^A-Z0-9]+/g, ' ')} `;
  return tokens.every((token) => haystack.includes(` ${token} `));
}

/** SPARQL for an item with this IMO or MMSI and an image. */
export function wikidataQuery({ imo, mmsi }) {
  const clauses = [];
  if (digits(imo).length === 7)
    clauses.push(`{ ?s wdt:P458 "${digits(imo)}" }`);
  if (digits(mmsi).length === 9)
    clauses.push(`{ ?s wdt:P587 "${digits(mmsi)}" }`);
  if (!clauses.length) return null;
  return `SELECT ?s ?image WHERE { ${clauses.join(' UNION ')} ?s wdt:P18 ?image } LIMIT 1`;
}

/** Commons "Special:FilePath" image URL → sized thumbnail URL. */
export function commonsThumb(imageUrl, width = THUMB_WIDTH) {
  const url = String(imageUrl || '');
  if (
    !/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(url)
  )
    return null;
  return `${url.replace(/^http:/, 'https:')}?width=${width}`;
}

/** Pick the first acceptable Commons search hit. */
export function pickCommonsHit(payload, name) {
  const pages = Object.values(payload?.query?.pages || {}).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info?.thumburl || !titleMatchesVessel(page.title, name)) continue;
    const artist = String(info.extmetadata?.Artist?.value || '')
      .replace(/<[^>]+>/g, '')
      .trim();
    return {
      src: info.thumburl,
      link: info.descriptionurl || null,
      credit: artist ? `${artist} · Wikimedia Commons` : 'Wikimedia Commons',
    };
  }
  return null;
}

async function readJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: 'application/sparql-results+json, application/json' },
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * @param {{imo?: string, mmsi?: string, name?: string}} vessel
 * @param {{fetchImpl?: Function, signal?: AbortSignal}} [options]
 */
export async function fetchVesselPhoto(
  { imo, mmsi, name } = {},
  { fetchImpl = (...args) => globalThis.fetch(...args), signal } = {},
) {
  try {
    const query = wikidataQuery({ imo, mmsi });
    if (query) {
      const data = await readJson(
        fetchImpl,
        `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`,
        signal,
      );
      const row = data?.results?.bindings?.[0];
      const src = commonsThumb(row?.image?.value);
      if (src)
        return {
          src,
          link: row?.s?.value || null,
          credit: 'Wikidata · Wikimedia Commons',
        };
    }
    if (nameTokens(name).length) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        generator: 'search',
        gsrnamespace: '6',
        gsrlimit: '8',
        gsrsearch: `"${String(name).trim()}" ship`,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: String(THUMB_WIDTH),
      });
      const data = await readJson(
        fetchImpl,
        `${COMMONS_API}?${params}`,
        signal,
      );
      return pickCommonsHit(data, name);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return null;
}
