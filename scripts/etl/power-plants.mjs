/**
 * Power plants ≥ 100 MW from the WRI Global Power Plant Database v1.3.
 *
 * Source: https://datasets.wri.org/dataset/globalpowerplantdatabase (CC BY 4.0)
 * Output: src/data/local_data/power_plants/power_plants.geojsonl
 */
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  CACHE_ROOT,
  clean,
  csvObjects,
  datasetDir,
  fetchBuffer,
  formatBytes,
  iso3ToIso2,
  readZipEntries,
  runDataset,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const WRI_URL =
  'https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip';
const ZIP_CACHE = path.join(
  CACHE_ROOT,
  'global_power_plant_database_v_1_3.zip',
);

/** Download (or reuse) the WRI zip and return its CSV rows as objects. */
export async function loadWriPlants() {
  let buffer;
  try {
    buffer = await readFile(ZIP_CACHE);
    console.log(`  using cached WRI zip (${formatBytes(buffer.length)})`);
  } catch {
    console.log('  downloading WRI Global Power Plant Database…');
    buffer = await fetchBuffer(WRI_URL, { timeoutMs: 300_000, retries: 2 });
    await mkdir(path.dirname(ZIP_CACHE), { recursive: true });
    await writeFile(ZIP_CACHE, buffer);
  }
  const entries = readZipEntries(buffer, {
    filter: (name) => name.toLowerCase().endsWith('.csv'),
  });
  const [name, csv] = [...entries.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0];
  console.log(`  csv entry ${name} (${formatBytes(csv.length)})`);
  return csvObjects(csv.toString('utf8'));
}

const FUEL_CLASS = {
  coal: 'coal',
  gas: 'gas',
  oil: 'oil',
  petcoke: 'oil',
  nuclear: 'nuclear',
  hydro: 'hydro',
  wind: 'wind',
  solar: 'solar',
  biomass: 'biomass',
  waste: 'waste',
  geothermal: 'geothermal',
  storage: 'storage',
};

/** Map one WRI row to the shared feature contract (null when unusable). */
export function plantFeature(row) {
  const lon = Number(row.longitude);
  const lat = Number(row.latitude);
  const mw = Number(row.capacity_mw);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(mw))
    return null;
  const fuel = clean(row.primary_fuel) || 'Unknown';
  const klass = FUEL_CLASS[fuel.toLowerCase()] || 'other';
  const iso2 = iso3ToIso2(row.country) || clean(row.country);
  const countryName = clean(row.country_long) || clean(row.country);
  const year = Number.parseInt(row.commissioning_year, 10);
  return {
    id: `gppd:${clean(row.gppd_idnr) || `${lon},${lat}`}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: clean(row.name) || `${fuel} plant (${countryName})`,
      class: klass,
      subtitle: `${fuel} · ${Math.round(mw).toLocaleString('en-US')} MW`,
      detail: `${countryName} · WRI GPPD`,
      country: iso2,
      source: 'WRI',
      tags: {
        capacity_mw: Math.round(mw * 10) / 10,
        primary_fuel: fuel,
        owner: clean(row.owner),
        year: Number.isFinite(year) ? year : undefined,
        gppd_idnr: clean(row.gppd_idnr),
        data_source: clean(row.source),
      },
    },
  };
}

export async function buildPowerPlants({ minMw = 100, limit, dryRun } = {}) {
  const rows = await loadWriPlants();
  console.log(`  ${rows.length} plants in the database`);
  let features = rows
    .map(plantFeature)
    .filter(
      (feature) => feature && feature.properties.tags.capacity_mw >= minMw,
    );
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('power_plants');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'power_plants.geojsonl'),
    features,
  );
  await writeManifest(
    dir,
    {
      dataset: 'power_plants',
      file: 'power_plants.geojsonl',
      source: 'WRI Global Power Plant Database v1.3',
      url: WRI_URL,
      license: 'CC BY 4.0',
      filter: `capacity_mw >= ${minMw}`,
      count: out.count,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Power plants (≥ ${minMw} MW)

Bundled for the PANOPTES "Power Plants" infrastructure layer.

- Source: [WRI Global Power Plant Database v1.3](https://datasets.wri.org/dataset/globalpowerplantdatabase)
- License: CC BY 4.0 — attribution "Global Power Plant Database, World Resources Institute"
- Filter: primary capacity ≥ ${minMw} MW (all fuels)
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`power_plants.geojsonl\`
- Regenerate: \`node scripts/etl/power-plants.mjs\` (\`--min-mw 50\` to widen)

Properties: \`name\`, \`class\` (primary fuel), \`subtitle\` (fuel · MW),
\`country\` (ISO2), \`tags\` (capacity_mw, primary_fuel, owner, year, gppd_idnr).
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    classes: out.classes,
  };
}

if (process.argv[1]?.endsWith('power-plants.mjs')) {
  runDataset('power_plants', (args) =>
    buildPowerPlants({
      minMw: Number(args['min-mw']) || 100,
      limit: args.limit,
      dryRun: args.dryRun,
    }),
  );
}
