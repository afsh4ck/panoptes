/**
 * @module siteWikidata
 * @description Wikidata facts for a mapped site that carries a Wikidata id
 * (most military bases and nuclear sites, every volcano): what it is, where,
 * who runs it, since when, capacity or elevation, a Commons photo and the
 * Wikipedia article. Two keyless calls straight from the browser, like the
 * vessel photo lookup: the entity, then the labels of the items it points at.
 */
import { cleanText, fmtDate, fmtNumber } from './intelModel.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const ENTITY_URL = 'http://www.wikidata.org/entity/';
const QID = /^Q[1-9]\d{0,11}$/;

/** Item-valued properties shown by label, in display order. */
const ITEM_PROPS = Object.freeze({
  P31: 'Instance of',
  P17: 'Country',
  P131: 'Located in',
  P137: 'Operator',
  P127: 'Owned by',
  P5817: 'State of use',
  P4552: 'Mountain range',
  P1435: 'Heritage designation',
});
const NAMEPLATE_CAPACITY = 'P2109';
const ELEVATION = 'P2044';
const INCEPTION = 'P571';
const DISSOLVED = 'P576';
const IMAGE = 'P18';
const WEBSITE = 'P856';
const METRE = 'Q11573';
const FOOT = 'Q3710';
const MEGAWATT = 'Q6982035';

/** A Wikidata id from a site record (`tags.wikidata`, `wd:Q…` ids), or ''. */
export function siteWikidataId(record) {
  const props = record?.properties || {};
  const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
  for (const candidate of [
    tags.wikidata,
    tags.wikidata_id,
    props.wikidata,
    String(record?.id || '').replace(/^wd:/, ''),
  ]) {
    const id = cleanText(candidate).toUpperCase();
    if (QID.test(id)) return id;
  }
  return '';
}

const values = (entity, property) =>
  (entity?.claims?.[property] || [])
    .filter((claim) => claim?.rank !== 'deprecated')
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter((value) => value !== undefined && value !== null);

const itemIds = (entity, property) =>
  values(entity, property)
    .map((value) => value?.id)
    .filter((id) => QID.test(String(id)));

const unitId = (quantity) =>
  String(quantity?.unit || '').startsWith(ENTITY_URL)
    ? quantity.unit.slice(ENTITY_URL.length)
    : '';

function pickLabel(labels, languages) {
  for (const language of languages) {
    const value = cleanText(labels?.[language]?.value);
    if (value) return value;
  }
  return '';
}

/** "+1912-01-01T00:00:00Z" at its stated precision: year, month or day. */
export function wikidataTime(value) {
  const match = /^([+-]\d{1,16})-(\d{2})-(\d{2})/.exec(
    String(value?.time || ''),
  );
  if (!match) return '';
  const year = Number(match[1]);
  if (value.precision <= 9 || match[2] === '00') return String(year);
  if (value.precision === 10 || match[3] === '00') return `${year}-${match[2]}`;
  return fmtDate(`${match[1].replace('+', '')}-${match[2]}-${match[3]}`, {
    dateOnly: true,
  });
}

/** Commons thumbnail and file page for a P18 file name. */
export function commonsImage(fileName, width = 640) {
  const name = cleanText(fileName).replaceAll(' ', '_');
  if (!name || /[\\/]/.test(name)) return null;
  const encoded = encodeURIComponent(name);
  return {
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`,
    link: `https://commons.wikimedia.org/wiki/File:${encoded}`,
    credit: 'Wikimedia Commons',
  };
}

/**
 * Reduce a Wikidata entity (and the labels of what it references) to the
 * facts a site dossier shows.
 * @param {object} entity - `wbgetentities` entity.
 * @param {Record<string, object>} referenced - Referenced entities by id (labels).
 * @param {string[]} languages - Label preference, e.g. ['es', 'en'].
 */
export function siteFactsFromEntity(
  entity,
  referenced = {},
  languages = ['en'],
) {
  const label = (id) => pickLabel(referenced[id]?.labels, languages) || id;
  const quantity = (property, preferUnit) => {
    const all = values(entity, property).filter((value) =>
      Number.isFinite(Number(value?.amount)),
    );
    const chosen = all.find((value) => unitId(value) === preferUnit) || all[0];
    if (!chosen) return null;
    return { amount: Number(chosen.amount), unit: unitId(chosen) };
  };

  const facts = {
    id: entity.id,
    label: pickLabel(entity.labels, languages),
    description: pickLabel(entity.descriptions, languages),
    items: {},
    inception: wikidataTime(values(entity, INCEPTION)[0]),
    dissolved: wikidataTime(values(entity, DISSOLVED)[0]),
    capacity: '',
    elevation: '',
    image: commonsImage(values(entity, IMAGE)[0]),
    website: cleanText(values(entity, WEBSITE)[0]),
    wikipedia: null,
  };
  for (const property of Object.keys(ITEM_PROPS)) {
    const names = [...new Set(itemIds(entity, property).map(label))];
    if (names.length) facts.items[property] = names.slice(0, 4).join(', ');
  }
  const capacity = quantity(NAMEPLATE_CAPACITY, MEGAWATT);
  if (capacity) {
    facts.capacity =
      capacity.unit === MEGAWATT
        ? fmtNumber(capacity.amount, { unit: 'MW' })
        : `${fmtNumber(capacity.amount)} ${label(capacity.unit)}`;
  }
  const elevation = quantity(ELEVATION, METRE);
  if (elevation) {
    facts.elevation =
      elevation.unit === METRE
        ? fmtNumber(elevation.amount, { unit: 'm' })
        : elevation.unit === FOOT
          ? fmtNumber(elevation.amount * 0.3048, { unit: 'm' })
          : `${fmtNumber(elevation.amount)} ${label(elevation.unit)}`;
  }
  for (const language of languages) {
    const title = cleanText(entity.sitelinks?.[`${language}wiki`]?.title);
    if (title) {
      facts.wikipedia = {
        language,
        title,
        href: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
      };
      break;
    }
  }
  return facts;
}

/** The ids of every item and unit an entity's shown claims point at. */
export function referencedIds(entity) {
  const ids = new Set();
  for (const property of Object.keys(ITEM_PROPS))
    for (const id of itemIds(entity, property)) ids.add(id);
  for (const property of [NAMEPLATE_CAPACITY, ELEVATION])
    for (const value of values(entity, property)) {
      const unit = unitId(value);
      if (QID.test(unit)) ids.add(unit);
    }
  return [...ids].slice(0, 50);
}

async function getEntities(fetchImpl, ids, props, languages, signal) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props,
    languages: languages.join('|'),
    format: 'json',
    origin: '*',
  });
  const response = await fetchImpl(`${WIKIDATA_API}?${params}`, { signal });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const body = await response.json();
  return body?.entities && typeof body.entities === 'object'
    ? body.entities
    : {};
}

/**
 * Fetch the facts for one Wikidata id. Null for a missing or unknown entity.
 * @param {{wikidata: string, signal?: AbortSignal, languages?: string[],
 *   fetchImpl?: typeof fetch}} options
 */
export async function fetchSiteWikidata({
  wikidata,
  signal,
  languages = ['en'],
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const id = cleanText(wikidata).toUpperCase();
  if (!QID.test(id)) return null;
  const entities = await getEntities(
    fetchImpl,
    [id],
    'labels|descriptions|claims|sitelinks',
    languages,
    signal,
  );
  const entity = entities[id];
  if (!entity || entity.missing !== undefined) return null;
  const refs = referencedIds(entity);
  const referenced = refs.length
    ? await getEntities(fetchImpl, refs, 'labels', languages, signal).catch(
        () => ({}),
      )
    : {};
  return {
    ...siteFactsFromEntity(entity, referenced, languages),
    fetchedAt: Date.now(),
  };
}

/** Dossier rows for the facts, in display order. */
export function siteWikidataRows(facts) {
  if (!facts) return [];
  return [
    { label: 'Description', value: facts.description },
    ...Object.entries(ITEM_PROPS).map(([property, name]) => ({
      label: name,
      value: facts.items?.[property],
    })),
    { label: 'Opened', value: facts.inception },
    { label: 'Closed', value: facts.dissolved },
    { label: 'Capacity', value: facts.capacity },
    { label: 'Elevation', value: facts.elevation },
    { label: 'Website', value: facts.website, href: facts.website },
    {
      label: 'Wikipedia',
      value: facts.wikipedia?.title,
      href: facts.wikipedia?.href,
    },
  ];
}
