/**
 * Holocene volcanoes from the Smithsonian Global Volcanism Program, with a
 * Wikidata fallback when the GVP WFS is unreachable.
 *
 * Output: src/data/local_data/volcanoes/volcanoes.geojsonl
 */
import path from 'node:path';
import {
  cachedJson,
  clean,
  countryAt,
  datasetDir,
  fetchJson,
  loadCountries,
  parseWktPoint,
  qid,
  runDataset,
  sparqlPaged,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const GVP_URL =
  'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=json';

export const WIKIDATA_QUERY = `SELECT ?item ?itemLabel ?coord ?countryLabel ?elevation ?classLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q8072; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P2044 ?elevation }
  OPTIONAL { ?item wdt:P31 ?class }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,[AUTO_LANGUAGE]". }
} ORDER BY ?item`;

/**
 * Collapse a free-text volcano type into a small, stylable class set:
 * volcano_stratovolcano, volcano_shield, volcano_caldera, volcano_cone,
 * volcano_dome, volcano_submarine, volcano_field, volcano_mud, volcano.
 */
export function volcanoClass(type) {
  const t = clean(type).toLowerCase();
  if (/strato|somma|composite/.test(t)) return 'volcano_stratovolcano';
  if (/shield/.test(t)) return 'volcano_shield';
  if (/caldera|supervolcano/.test(t)) return 'volcano_caldera';
  if (/submarine|seamount/.test(t)) return 'volcano_submarine';
  if (/dome/.test(t)) return 'volcano_dome';
  if (/cone|parasitic|lateral|maar|tuff ring|scoria/.test(t))
    return 'volcano_cone';
  if (/field|fissure|vent|lava field/.test(t)) return 'volcano_field';
  if (/mud|sand/.test(t)) return 'volcano_mud';
  return 'volcano';
}

/** Activity status hinted by a type label (Wikidata instance-of). */
export function volcanoStatus(labels) {
  const text = [...labels].join(' ').toLowerCase();
  if (/extinct/.test(text)) return 'extinct';
  if (/dormant/.test(text)) return 'dormant';
  if (/active/.test(text)) return 'active';
  return '';
}

function prop(properties, pattern) {
  const key = Object.keys(properties || {}).find((name) => pattern.test(name));
  return key ? properties[key] : undefined;
}

export function gvpFeatures(collection) {
  const features = [];
  for (const feature of collection?.features || []) {
    const p = feature.properties || {};
    const coords = feature.geometry?.coordinates;
    const lon = Number(coords?.[0] ?? prop(p, /^longitude$/i));
    const lat = Number(coords?.[1] ?? prop(p, /^latitude$/i));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const name = clean(prop(p, /^volcano_?name$/i));
    const number = clean(prop(p, /^volcano_?number$/i));
    const type = clean(
      prop(p, /^primary_?volcano_?type$/i) ?? prop(p, /type/i),
    );
    const lastEruption = clean(
      prop(p, /^last_?eruption_?year$/i) ?? prop(p, /last_?eruption/i),
    );
    const countryName = clean(prop(p, /^country$/i));
    const region = clean(prop(p, /^region$/i));
    const subregion = clean(prop(p, /^subregion$/i));
    const elevation = Number(prop(p, /^elevation/i));
    const tectonic = clean(prop(p, /tectonic/i));
    const country = countryAt(lon, lat);
    features.push({
      id: `gvp:${number || name}`,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        name: name || `Volcano (${countryName || region})`,
        class: volcanoClass(type),
        subtitle: [
          type || 'Volcano',
          Number.isFinite(elevation)
            ? `${Math.round(elevation).toLocaleString('en-US')} m`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        detail:
          [
            countryName || region,
            lastEruption
              ? `last eruption ${lastEruption}`
              : 'no dated eruption',
          ]
            .filter(Boolean)
            .join(' · ') + ' · GVP',
        country: country?.iso2 || countryName,
        source: 'GVP',
        tags: {
          gvp_number: number,
          type,
          elevation_m: Number.isFinite(elevation)
            ? Math.round(elevation)
            : undefined,
          last_eruption: lastEruption,
          region: [region, subregion].filter(Boolean).join(' / '),
          tectonic_setting: tectonic,
        },
      },
    });
  }
  return features;
}

export function wikidataFeatures(rows) {
  const byItem = new Map();
  for (const row of rows) {
    const id = qid(row.item);
    const entry = byItem.get(id) || {
      id,
      label: '',
      coord: null,
      country: '',
      elevation: '',
      classes: new Set(),
    };
    entry.label ||= clean(row.itemLabel);
    entry.coord ||= parseWktPoint(row.coord);
    entry.country ||= clean(row.countryLabel);
    entry.elevation ||= clean(row.elevation);
    if (clean(row.classLabel)) entry.classes.add(clean(row.classLabel));
    byItem.set(id, entry);
  }
  const byName = new Map(
    loadCountries().map((country) => [country.name.toLowerCase(), country]),
  );
  const features = [];
  for (const entry of byItem.values()) {
    if (!entry.coord || /^Q\d+$/.test(entry.label)) continue;
    const type =
      [...entry.classes].find((label) => volcanoClass(label) !== 'volcano') ||
      'Volcano';
    const status = volcanoStatus(entry.classes);
    const elevation = Number(entry.elevation);
    const country =
      byName.get(entry.country.toLowerCase()) ||
      countryAt(entry.coord.lon, entry.coord.lat);
    features.push({
      id: `wd:${entry.id}`,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [entry.coord.lon, entry.coord.lat],
      },
      properties: {
        name: entry.label,
        class: volcanoClass(type),
        subtitle: [
          type,
          Number.isFinite(elevation)
            ? `${Math.round(elevation).toLocaleString('en-US')} m`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        detail: [entry.country || country?.name, status, 'Wikidata']
          .filter(Boolean)
          .join(' · '),
        country: country?.iso2 || entry.country,
        source: 'Wikidata',
        tags: {
          wikidata: entry.id,
          type,
          status,
          elevation_m: Number.isFinite(elevation)
            ? Math.round(elevation)
            : undefined,
        },
      },
    });
  }
  return features;
}

export async function buildVolcanoes({ dryRun, limit, refresh } = {}) {
  let features = [];
  let source = '';
  let error = '';
  try {
    console.log('  Smithsonian GVP WFS (can take minutes)…');
    const collection = await cachedJson(
      'gvp-holocene',
      () =>
        fetchJson(GVP_URL, {
          timeoutMs: 240_000,
          retries: 1,
          backoffMs: 5_000,
        }),
      { refresh },
    );
    features = gvpFeatures(collection);
    source = 'GVP';
    console.log(`  ${features.length} GVP volcanoes`);
  } catch (gvpError) {
    error = gvpError.message;
    console.warn(`  GVP unavailable (${error}); falling back to Wikidata`);
    const rows = await cachedJson(
      'wikidata-volcanoes',
      () => sparqlPaged(WIKIDATA_QUERY, { pageSize: 4000, maxPages: 8 }),
      { refresh },
    );
    features = wikidataFeatures(rows);
    source = 'Wikidata';
    console.log(
      `  ${rows.length} Wikidata rows → ${features.length} volcanoes`,
    );
  }
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('volcanoes');
  if (dryRun) return { count: features.length, source, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'volcanoes.geojsonl'),
    features,
  );
  const gvp = source === 'GVP';
  await writeManifest(
    dir,
    {
      dataset: 'volcanoes',
      file: 'volcanoes.geojsonl',
      source: gvp
        ? 'Smithsonian Global Volcanism Program (Holocene volcano list, WFS)'
        : 'Wikidata (fallback; GVP WFS unavailable)',
      url: gvp ? GVP_URL : 'https://query.wikidata.org/sparql',
      license: gvp
        ? 'Smithsonian GVP data — free for non-commercial use with citation (check https://volcano.si.edu/gvp_about.cfm)'
        : 'CC0 1.0',
      fallbackReason: gvp ? undefined : error,
      count: out.count,
      invalid: out.invalid,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Volcanoes

Bundled for the PANOPTES "Volcanoes" layer.

- Source: ${gvp ? '[Smithsonian Global Volcanism Program](https://volcano.si.edu) Holocene volcano list via its WFS service' : `Wikidata instances of *volcano* (fallback because the GVP WFS was unreachable: ${error})`}
- License: ${gvp ? 'Smithsonian GVP terms — cite "Global Volcanism Program, Smithsonian Institution"; verify commercial-use terms before redistribution' : 'CC0 1.0'}
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`volcanoes.geojsonl\`
- Regenerate: \`node scripts/etl/volcanoes.mjs\` (\`--refresh\` re-downloads)

\`class\` is \`volcano_<type>\` (${Object.keys(out.classes).sort().slice(0, 12).join(', ')}${Object.keys(out.classes).length > 12 ? ', …' : ''}).
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    source,
    classes: out.classes,
  };
}

if (process.argv[1]?.endsWith('volcanoes.mjs')) {
  runDataset('volcanoes', (args) =>
    buildVolcanoes({
      dryRun: args.dryRun,
      limit: args.limit,
      refresh: Boolean(args.refresh),
    }),
  );
}
