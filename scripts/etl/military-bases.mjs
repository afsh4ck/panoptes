/**
 * Global military installations: OpenStreetMap (Overpass) merged with
 * Wikidata military-base items.
 *
 * Sources: OSM (ODbL 1.0), Wikidata (CC0)
 * Output: src/data/local_data/military_bases/military_bases.geojsonl
 */
import path from 'node:path';
import {
  absorbNearby,
  cachedJson,
  clean,
  countryAt,
  datasetDir,
  loadCountries,
  mergeByProximity,
  overpass,
  parseWktPoint,
  qid,
  runDataset,
  sleep,
  sparqlPaged,
  titleCase,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const OSM_QUERY_BASES =
  '[out:json][timeout:600];(nwr["military"="naval_base"];nwr["military"="airfield"];nwr["military"="base"];);out center tags;';
export const OSM_QUERY_BARRACKS =
  '[out:json][timeout:600];nwr["military"="barracks"];out center tags;';
export const OSM_QUERY_LAND =
  '[out:json][timeout:900][maxsize:1073741824];nwr["landuse"="military"]["name"];out center tags;';

export const WIKIDATA_QUERY = `SELECT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?classLabel ?inception WHERE {
  ?item wdt:P31/wdt:P279* wd:Q245016; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P137 ?operator }
  OPTIONAL { ?item wdt:P31 ?class }
  OPTIONAL { ?item wdt:P571 ?inception }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,[AUTO_LANGUAGE]". }
} ORDER BY ?item`;

const CLASS_PRIORITY = [
  'naval_base',
  'air_base',
  'missile_base',
  'radar_station',
  'training_area',
  'barracks',
  'army_base',
  'base',
  'military_land',
  'other',
];

export const CLASS_LABEL = {
  naval_base: 'Naval base',
  air_base: 'Air base',
  missile_base: 'Missile base',
  radar_station: 'Radar / SIGINT station',
  training_area: 'Training area',
  barracks: 'Barracks',
  army_base: 'Army base',
  base: 'Military base',
  military_land: 'Military area',
  other: 'Military site',
};

/** Class for an OSM element from its tags. */
export function osmClass(tags = {}) {
  switch (tags.military) {
    case 'naval_base':
      return 'naval_base';
    case 'airfield':
      return 'air_base';
    case 'base':
      return 'base';
    case 'barracks':
      return 'barracks';
    case 'training_area':
    case 'range':
      return 'training_area';
    default:
      return tags.landuse === 'military' ? 'military_land' : 'other';
  }
}

/** Class for a Wikidata instance-of label. */
export function wikidataClass(label = '') {
  const l = String(label).toLowerCase();
  if (/naval|navy|marine base|submarine base/.test(l)) return 'naval_base';
  if (
    /air ?base|airbase|air force|air station|raf station|fliegerhorst|aerodrome|airport|heliport|\bwing\b|airfield|air national guard/.test(
      l,
    )
  )
    return 'air_base';
  if (/missile|silo|icbm|rocket base/.test(l)) return 'missile_base';
  if (/radar|listening|signals|sigint|early warning|ground station/.test(l))
    return 'radar_station';
  if (/training|proving ground|\brange\b|exercise|firing/.test(l))
    return 'training_area';
  if (/barracks|garrison|cantonment|kaserne|caserne|quartel|cuartel/.test(l))
    return 'barracks';
  if (
    /\bfort\b|outpost|forward operating|\bcamp\b|army|\bpost\b|installation|depot|arsenal/.test(
      l,
    )
  )
    return 'army_base';
  if (/base/.test(l)) return 'base';
  return 'other';
}

const FORMER = /former|ruins|destroyed|historic|abandoned|closed|disused/i;

function countryIndex() {
  const byName = new Map();
  for (const country of loadCountries()) {
    byName.set(country.name.toLowerCase(), country);
  }
  return byName;
}

function bestClass(classes) {
  for (const candidate of CLASS_PRIORITY)
    if (classes.has(candidate)) return candidate;
  return 'other';
}

/** Convert Overpass elements to features. */
export function osmFeatures(elements, { klassOverride } = {}) {
  const features = [];
  for (const element of elements || []) {
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = element.tags || {};
    const klass = klassOverride || osmClass(tags);
    const country = countryAt(lon, lat);
    const iso2 = country?.iso2 || '';
    const countryName = country?.name || '';
    const operator = clean(tags.operator) || clean(tags['operator:short']);
    const branch =
      clean(tags.military_service) || clean(tags['military:service']);
    const name =
      clean(tags.name) ||
      clean(tags['name:en']) ||
      clean(tags.official_name) ||
      `${CLASS_LABEL[klass]}${countryName ? ` (${countryName})` : ''}`;
    features.push({
      id: `osm:${element.type}:${element.id}`,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        name,
        class: klass,
        subtitle: [CLASS_LABEL[klass], operator || titleCase(branch)]
          .filter(Boolean)
          .join(' · '),
        detail: [countryName, 'OSM'].filter(Boolean).join(' · '),
        country: iso2,
        source: 'OSM',
        tags: {
          osm_id: `${element.type}/${element.id}`,
          military: clean(tags.military),
          landuse: clean(tags.landuse),
          operator,
          branch,
          wikidata: clean(tags.wikidata),
          name_en: clean(tags['name:en']),
          status:
            clean(tags.disused) === 'yes' || clean(tags.abandoned) === 'yes'
              ? 'former'
              : undefined,
        },
      },
    });
  }
  return features;
}

/** Group Wikidata rows by item and convert to features. */
export function wikidataFeatures(rows) {
  const byItem = new Map();
  for (const row of rows) {
    const id = qid(row.item);
    if (!byItem.has(id)) {
      byItem.set(id, {
        id,
        label: clean(row.itemLabel),
        coord: parseWktPoint(row.coord),
        country: clean(row.countryLabel),
        operator: clean(row.operatorLabel),
        classes: new Set(),
        classLabels: new Set(),
        inception: clean(row.inception),
      });
    }
    const entry = byItem.get(id);
    if (!entry.coord) entry.coord = parseWktPoint(row.coord);
    if (!entry.country) entry.country = clean(row.countryLabel);
    if (!entry.operator) entry.operator = clean(row.operatorLabel);
    const classLabel = clean(row.classLabel);
    if (classLabel) {
      entry.classLabels.add(classLabel);
      entry.classes.add(wikidataClass(classLabel));
    }
  }
  const countries = countryIndex();
  const features = [];
  for (const entry of byItem.values()) {
    if (!entry.coord) continue;
    if (/^Q\d+$/.test(entry.label)) entry.label = '';
    const klass = bestClass(entry.classes);
    const country =
      countries.get(entry.country.toLowerCase()) ||
      countryAt(entry.coord.lon, entry.coord.lat);
    const iso2 = country?.iso2 || '';
    const countryName = entry.country || country?.name || '';
    const labels = [...entry.classLabels];
    const former = labels.some((label) => FORMER.test(label));
    const name =
      entry.label ||
      `${CLASS_LABEL[klass]}${countryName ? ` (${countryName})` : ''}`;
    features.push({
      id: `wd:${entry.id}`,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [entry.coord.lon, entry.coord.lat],
      },
      properties: {
        name,
        class: klass,
        subtitle: [CLASS_LABEL[klass], entry.operator]
          .filter(Boolean)
          .join(' · '),
        detail: [countryName, 'Wikidata'].filter(Boolean).join(' · '),
        country: iso2 || countryName,
        source: 'Wikidata',
        tags: {
          wikidata: entry.id,
          operator: entry.operator,
          instance_of: labels.slice(0, 4).join('; '),
          inception: entry.inception.slice(0, 10),
          status: former ? 'former' : undefined,
        },
      },
    });
  }
  return features;
}

function mergeInto(base, incoming, radiusKm) {
  return mergeByProximity(base, incoming, {
    radiusKm,
    onMerge(target, feature) {
      const tp = target.properties;
      const fp = feature.properties;
      tp.tags = { ...fp.tags, ...tp.tags };
      if (!tp.tags.wikidata && fp.tags.wikidata)
        tp.tags.wikidata = fp.tags.wikidata;
      if (!tp.tags.operator && fp.tags.operator)
        tp.tags.operator = fp.tags.operator;
      if (!tp.country && fp.country) tp.country = fp.country;
      if (
        /^(Naval base|Air base|Missile base|Radar|Training area|Barracks|Army base|Military base|Military area|Military site)\b/.test(
          tp.name,
        ) &&
        fp.name &&
        !/^(Naval base|Air base|Military)/.test(fp.name)
      )
        tp.name = fp.name;
      if (
        tp.class === 'other' ||
        tp.class === 'military_land' ||
        tp.class === 'base'
      ) {
        if (fp.class !== 'other' && fp.class !== 'military_land')
          tp.class = fp.class;
      }
      if (!tp.subtitle.includes('·') && fp.subtitle.includes('·'))
        tp.subtitle = fp.subtitle;
      const sources = new Set([
        ...tp.source.split('+'),
        ...fp.source.split('+'),
      ]);
      tp.source = [...sources].join('+');
      tp.detail =
        tp.detail.replace(/ · (OSM|Wikidata|OSM\+Wikidata)$/, '') +
        ` · ${tp.source}`;
    },
  });
}

export async function buildMilitaryBases({
  dryRun,
  limit,
  refresh,
  skipLand,
} = {}) {
  console.log('  OSM bases (naval_base, airfield, base)…');
  const bases = await cachedJson(
    'osm-military-bases',
    () => overpass(OSM_QUERY_BASES),
    { refresh },
  );
  console.log(`  ${bases.elements?.length || 0} OSM base elements`);
  await sleep(5000);
  let barracks = { elements: [] };
  try {
    console.log('  OSM barracks…');
    barracks = await cachedJson(
      'osm-military-barracks',
      () => overpass(OSM_QUERY_BARRACKS),
      { refresh },
    );
    console.log(`  ${barracks.elements?.length || 0} OSM barracks elements`);
  } catch (error) {
    console.warn(`  barracks query skipped: ${error.message}`);
  }
  let land = { elements: [] };
  if (!skipLand) {
    try {
      await sleep(5000);
      console.log('  OSM named military land…');
      land = await cachedJson(
        'osm-military-land-named',
        () => overpass(OSM_QUERY_LAND),
        { refresh },
      );
      console.log(
        `  ${land.elements?.length || 0} OSM named military-land elements`,
      );
    } catch (error) {
      console.warn(`  military land query skipped: ${error.message}`);
    }
  }
  console.log('  Wikidata military bases…');
  const rows = await cachedJson(
    'wikidata-military-bases',
    () => sparqlPaged(WIKIDATA_QUERY, { pageSize: 4000, maxPages: 12 }),
    { refresh },
  );
  console.log(`  ${rows.length} Wikidata rows`);

  // OSM maps barracks per building: fold them into a nearby base, or into
  // one representative per ~1 km cluster, recording the building count.
  const bases_ = osmFeatures(bases.elements || []);
  const barracksFeatures = absorbNearby(
    bases_,
    osmFeatures(barracks.elements || []),
    {
      anchorKm: 1.5,
      selfKm: 1.0,
      countKey: 'barracks_buildings',
      isNamed: (feature) => !/^Barracks( \(|$)/.test(feature.properties.name),
    },
  );
  console.log(
    `  ${barracks.elements?.length || 0} barracks elements → ${barracksFeatures.length} clusters`,
  );
  const osm = [...bases_, ...barracksFeatures];
  const wd = wikidataFeatures(rows);
  const step1 = mergeInto(osm, wd, 2.5);
  console.log(`  merged ${step1.merged} Wikidata items into OSM features`);
  const landFeatures = osmFeatures(land.elements || []).filter(
    (feature) => feature.properties.class === 'military_land',
  );
  const step2 = mergeInto(step1.features, landFeatures, 2.0);
  console.log(
    `  merged ${step2.merged} named military-land areas into existing sites`,
  );
  let features = step2.features;
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('military_bases');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'military_bases.geojsonl'),
    features,
  );
  await writeManifest(
    dir,
    {
      dataset: 'military_bases',
      file: 'military_bases.geojsonl',
      sources: [
        {
          name: 'OpenStreetMap via Overpass',
          license: 'ODbL 1.0',
          queries: [
            OSM_QUERY_BASES,
            OSM_QUERY_BARRACKS,
            skipLand ? null : OSM_QUERY_LAND,
          ].filter(Boolean),
        },
        { name: 'Wikidata', license: 'CC0 1.0', query: WIKIDATA_QUERY },
      ],
      merge:
        'Wikidata → OSM within 2.5 km (similar or missing names); named military land → within 2 km',
      count: out.count,
      invalid: out.invalid,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
      osmElements:
        (bases.elements?.length || 0) + (barracks.elements?.length || 0),
      osmLandElements: land.elements?.length || 0,
      wikidataRows: rows.length,
    },
    `# Military installations (global)

Bundled for the PANOPTES "Military Bases" strategic layer. These are MAPPED
features from community and open sources: presence on this list says nothing
about a site's capability, occupancy or operational status, and coverage is
uneven by country.

- Sources: OpenStreetMap (\`military=naval_base|airfield|base|barracks\`${land.elements?.length ? ' and named `landuse=military`' : ''}) via Overpass — ODbL 1.0, © OpenStreetMap
  contributors; Wikidata items that are instances of *military base* or a
  subclass — CC0 1.0
- Merge: Wikidata items within 2.5 km of an OSM feature with a similar (or
  missing) name are folded into it (\`source\` becomes \`OSM+Wikidata\`)
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`military_bases.geojsonl\`
- Regenerate: \`node scripts/etl/military-bases.mjs\` (\`--refresh\` re-downloads; \`--skip-land\` drops the large named-land query)

\`class\` values: ${Object.keys(out.classes).sort().join(', ')}.
\`tags\` keep the OSM id, Wikidata id, operator/branch, instance-of labels and a
\`status: former\` marker when the source says the site is disused.
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    classes: out.classes,
    merged: step1.merged + step2.merged,
  };
}

if (process.argv[1]?.endsWith('military-bases.mjs')) {
  runDataset('military_bases', (args) =>
    buildMilitaryBases({
      dryRun: args.dryRun,
      limit: args.limit,
      refresh: Boolean(args.refresh),
      skipLand: Boolean(args['skip-land']),
    }),
  );
}
