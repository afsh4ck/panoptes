/**
 * Nuclear sites: power plants, research reactors, enrichment plants, missile
 * launch facilities and test sites.
 *
 * Sources: Wikidata (CC0), OpenStreetMap (ODbL), WRI GPPD (CC BY 4.0)
 * Output: src/data/local_data/nuclear_sites/nuclear_sites.geojsonl
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
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';
import { loadWriPlants } from './power-plants.mjs';

export const WIKIDATA_CLASSES = [
  ['Q134447', 'power_plant'],
  ['Q1438105', 'research_reactor'],
  ['Q54360657', 'enrichment'],
  ['Q853409', 'missile_silo'],
  ['Q53732481', 'test_site'],
];

export const CLASS_LABEL = {
  power_plant: 'Nuclear power plant',
  research_reactor: 'Research reactor',
  enrichment: 'Uranium enrichment plant',
  missile_silo: 'Missile launch facility',
  test_site: 'Nuclear test site',
  reprocessing: 'Reprocessing plant',
  other: 'Nuclear site',
};

export const OSM_QUERY =
  '[out:json][timeout:300];(nwr["plant:source"="nuclear"];nwr["generator:source"="nuclear"];nwr["military"="nuclear_explosion_site"];);out center tags;';

const wikidataQuery = (
  classId,
) => `SELECT ?item ?itemLabel ?coord ?countryLabel ?operatorLabel ?statusLabel ?capacity ?inception WHERE {
  ?item wdt:P31/wdt:P279* wd:${classId}; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P137 ?operator }
  OPTIONAL { ?item wdt:P5817 ?status }
  OPTIONAL { ?item wdt:P2109 ?capacity }
  OPTIONAL { ?item wdt:P571 ?inception }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,[AUTO_LANGUAGE]". }
} ORDER BY ?item`;

function countryIndex() {
  const byName = new Map();
  for (const country of loadCountries())
    byName.set(country.name.toLowerCase(), country);
  return byName;
}

function formatMw(value) {
  const mw = Number(value);
  return Number.isFinite(mw) && mw > 0
    ? `${Math.round(mw).toLocaleString('en-US')} MW`
    : '';
}

export function wikidataFeatures(rows, klass) {
  const byItem = new Map();
  for (const row of rows) {
    const id = qid(row.item);
    const entry = byItem.get(id) || {
      id,
      label: '',
      coord: null,
      country: '',
      operator: '',
      status: '',
      capacity: '',
      inception: '',
    };
    entry.label ||= clean(row.itemLabel);
    entry.coord ||= parseWktPoint(row.coord);
    entry.country ||= clean(row.countryLabel);
    entry.operator ||= clean(row.operatorLabel);
    entry.status ||= clean(row.statusLabel);
    entry.inception ||= clean(row.inception);
    const capacity = Number(row.capacity);
    if (Number.isFinite(capacity) && capacity > Number(entry.capacity || 0))
      entry.capacity = capacity;
    byItem.set(id, entry);
  }
  const countries = countryIndex();
  const features = [];
  for (const entry of byItem.values()) {
    if (!entry.coord) continue;
    if (/^Q\d+$/.test(entry.label)) entry.label = '';
    const country =
      countries.get(entry.country.toLowerCase()) ||
      countryAt(entry.coord.lon, entry.coord.lat);
    const countryName = entry.country || country?.name || '';
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
        subtitle: [CLASS_LABEL[klass], formatMw(entry.capacity), entry.status]
          .filter(Boolean)
          .join(' · '),
        detail: [countryName, entry.operator, 'Wikidata']
          .filter(Boolean)
          .join(' · '),
        country: country?.iso2 || countryName,
        source: 'Wikidata',
        tags: {
          wikidata: entry.id,
          operator: entry.operator,
          status: entry.status,
          capacity_mw: Number(entry.capacity) || undefined,
          inception: entry.inception.slice(0, 10),
        },
      },
    });
  }
  return features;
}

export function osmFeatures(elements) {
  const plants = [];
  const generators = [];
  for (const element of elements || []) {
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = element.tags || {};
    const klass =
      tags.military === 'nuclear_explosion_site' ? 'test_site' : 'power_plant';
    const country = countryAt(lon, lat);
    const countryName = country?.name || '';
    const operator = clean(tags.operator);
    const output =
      clean(tags['plant:output:electricity']) ||
      clean(tags['generator:output:electricity']);
    const mw = /^([\d.]+)\s*MW/i.exec(output)?.[1];
    const name =
      clean(tags.name) ||
      clean(tags['name:en']) ||
      clean(tags.official_name) ||
      `${CLASS_LABEL[klass]}${countryName ? ` (${countryName})` : ''}`;
    const feature = {
      id: `osm:${element.type}:${element.id}`,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        name,
        class: klass,
        subtitle: [
          CLASS_LABEL[klass],
          mw ? `${Math.round(Number(mw)).toLocaleString('en-US')} MW` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        detail: [countryName, operator, 'OSM'].filter(Boolean).join(' · '),
        country: country?.iso2 || '',
        source: 'OSM',
        tags: {
          osm_id: `${element.type}/${element.id}`,
          operator,
          capacity_mw: mw ? Number(mw) : undefined,
          wikidata: clean(tags.wikidata),
          osm_kind: tags['plant:source']
            ? 'plant'
            : tags['generator:source']
              ? 'generator'
              : 'site',
        },
      },
    };
    (tags['generator:source'] && !tags['plant:source']
      ? generators
      : plants
    ).push(feature);
  }
  // Generators inside a mapped plant collapse into it.
  // Test sites are mapped per shot (Nevada alone has hundreds): keep one
  // representative per ~10 km, preferring named ones, with a shot count.
  const isTest = (feature) => feature.properties.class === 'test_site';
  const tests = absorbNearby([], plants.filter(isTest), {
    anchorKm: 0,
    selfKm: 10,
    countKey: 'mapped_shots',
    isNamed: (feature) =>
      !/^Nuclear test site( \(|$)/.test(feature.properties.name),
  });
  for (const feature of tests) {
    const shots = feature.properties.tags.mapped_shots;
    if (shots > 1) {
      const p = feature.properties;
      const country = countryAt(...feature.geometry.coordinates);
      p.tags.example_shot = p.name;
      p.name = `Nuclear test area${country ? ` (${country.name})` : ''}`;
      p.subtitle = `Nuclear test area · ${shots} mapped shots`;
    }
  }
  const sites = [...plants.filter((feature) => !isTest(feature)), ...tests];
  return mergeByProximity(sites, generators, { radiusKm: 3, onMerge() {} })
    .features;
}

export function wriNuclearFeatures(rows) {
  return rows
    .filter((row) => clean(row.primary_fuel).toLowerCase() === 'nuclear')
    .map((row) => {
      const lon = Number(row.longitude);
      const lat = Number(row.latitude);
      const mw = Number(row.capacity_mw);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const country = countryAt(lon, lat);
      return {
        id: `gppd:${clean(row.gppd_idnr)}`,
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name:
            clean(row.name) ||
            `Nuclear power plant (${clean(row.country_long)})`,
          class: 'power_plant',
          subtitle: ['Nuclear power plant', formatMw(mw)]
            .filter(Boolean)
            .join(' · '),
          detail: [clean(row.country_long), clean(row.owner), 'WRI']
            .filter(Boolean)
            .join(' · '),
          country: country?.iso2 || clean(row.country),
          source: 'WRI',
          tags: {
            gppd_idnr: clean(row.gppd_idnr),
            capacity_mw: Number.isFinite(mw) ? mw : undefined,
            owner: clean(row.owner),
            year: Number.parseInt(row.commissioning_year, 10) || undefined,
          },
        },
      };
    })
    .filter(Boolean);
}

function fold(base, incoming, radiusKm) {
  return mergeByProximity(base, incoming, {
    radiusKm,
    onMerge(target, feature) {
      const tp = target.properties;
      const fp = feature.properties;
      tp.tags = { ...fp.tags, ...tp.tags };
      if (!tp.tags.capacity_mw && fp.tags.capacity_mw) {
        tp.tags.capacity_mw = fp.tags.capacity_mw;
        if (!/MW/.test(tp.subtitle))
          tp.subtitle = [
            CLASS_LABEL[tp.class],
            formatMw(fp.tags.capacity_mw),
            tp.tags.status,
          ]
            .filter(Boolean)
            .join(' · ');
      }
      if (!tp.country && fp.country) tp.country = fp.country;
      const sources = new Set([
        ...tp.source.split('+'),
        ...fp.source.split('+'),
      ]);
      tp.source = [...sources].join('+');
      tp.detail =
        tp.detail.replace(/ · (OSM|Wikidata|WRI)(\+(OSM|Wikidata|WRI))*$/, '') +
        ` · ${tp.source}`;
    },
  });
}

export async function buildNuclearSites({ dryRun, limit, refresh } = {}) {
  let features = [];
  for (const [classId, klass] of WIKIDATA_CLASSES) {
    console.log(`  Wikidata ${klass} (${classId})…`);
    try {
      const rows = await cachedJson(
        `wikidata-nuclear-${klass}`,
        () =>
          sparqlPaged(wikidataQuery(classId), { pageSize: 4000, maxPages: 6 }),
        { refresh },
      );
      const converted = wikidataFeatures(rows, klass);
      console.log(`    ${rows.length} rows → ${converted.length} items`);
      features = fold(features, converted, 1.0).features;
    } catch (error) {
      console.warn(`    skipped: ${error.message}`);
    }
    await sleep(2000);
  }
  console.log('  OSM nuclear plants / generators / test sites…');
  try {
    const payload = await cachedJson('osm-nuclear', () => overpass(OSM_QUERY), {
      refresh,
    });
    const osm = osmFeatures(payload.elements);
    const merged = fold(features, osm, 3.0);
    console.log(
      `    ${payload.elements?.length || 0} elements → ${osm.length} sites, ${merged.merged} merged into Wikidata items`,
    );
    features = merged.features;
  } catch (error) {
    console.warn(`    skipped: ${error.message}`);
  }
  console.log('  WRI nuclear plants…');
  try {
    const wri = wriNuclearFeatures(await loadWriPlants());
    const merged = fold(features, wri, 5.0);
    console.log(`    ${wri.length} plants, ${merged.merged} merged`);
    features = merged.features;
  } catch (error) {
    console.warn(`    skipped: ${error.message}`);
  }
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('nuclear_sites');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'nuclear_sites.geojsonl'),
    features,
  );
  await writeManifest(
    dir,
    {
      dataset: 'nuclear_sites',
      file: 'nuclear_sites.geojsonl',
      sources: [
        { name: 'Wikidata', license: 'CC0 1.0', classes: WIKIDATA_CLASSES },
        {
          name: 'OpenStreetMap via Overpass',
          license: 'ODbL 1.0',
          query: OSM_QUERY,
        },
        {
          name: 'WRI Global Power Plant Database v1.3 (nuclear rows)',
          license: 'CC BY 4.0',
        },
      ],
      merge:
        'OSM → Wikidata within 3 km, WRI → within 5 km (similar or missing names)',
      count: out.count,
      invalid: out.invalid,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Nuclear sites

Bundled for the PANOPTES "Nuclear Sites" strategic layer: nuclear power
plants (operating, under construction and decommissioned), research reactors,
uranium enrichment plants, missile launch facilities and nuclear test sites.
Mapped ≠ operational: check \`tags.status\` where present.

- Sources: Wikidata (CC0 1.0) instances of nuclear power plant, research
  reactor, uranium enrichment plant, missile launch facility, nuclear test
  site; OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors)
  \`plant:source=nuclear\`, \`generator:source=nuclear\`,
  \`military=nuclear_explosion_site\`; WRI Global Power Plant Database v1.3
  nuclear rows (CC BY 4.0)
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`nuclear_sites.geojsonl\`
- Regenerate: \`node scripts/etl/nuclear-sites.mjs\` (\`--refresh\` re-downloads)

\`class\` values: ${Object.keys(out.classes).sort().join(', ')}.
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    classes: out.classes,
  };
}

if (process.argv[1]?.endsWith('nuclear-sites.mjs')) {
  runDataset('nuclear_sites', (args) =>
    buildNuclearSites({
      dryRun: args.dryRun,
      limit: args.limit,
      refresh: Boolean(args.refresh),
    }),
  );
}
