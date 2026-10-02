/**
 * Run every strategic-dataset ETL script sequentially, continuing on failure.
 *
 *   node scripts/etl/run-all.mjs            # all datasets
 *   node scripts/etl/run-all.mjs ports airports
 *   node scripts/etl/run-all.mjs --refresh  # bypass the .gev-cache/etl cache
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SCRIPTS = [
  ['chokepoints', 'chokepoints.mjs'],
  ['ports', 'ports.mjs'],
  ['airports', 'airports.mjs'],
  ['power_plants', 'power-plants.mjs'],
  ['aircraft_types', 'aircraft-types.mjs'],
  ['sanctioned_vessels', 'sanctioned-vessels.mjs'],
  ['volcanoes', 'volcanoes.mjs'],
  ['military_bases', 'military-bases.mjs'],
  ['nuclear_sites', 'nuclear-sites.mjs'],
];

const argv = process.argv.slice(2);
const only = new Set(argv.filter((arg) => !arg.startsWith('--')));
const flags = argv.filter((arg) => arg.startsWith('--'));
const results = [];
for (const [name, file] of SCRIPTS) {
  if (only.size && !only.has(name)) continue;
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(here, file), ...flags], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  process.stdout.write(run.stdout || '');
  const summary = /✔ \S+: (\{.*\})/.exec(run.stdout || '')?.[1];
  let count = '';
  try {
    count = summary ? JSON.parse(summary).count : '';
  } catch {
    /* unparsable summary */
  }
  results.push({
    dataset: name,
    status: run.status === 0 ? 'ok' : 'FAILED',
    count,
    seconds: ((Date.now() - started) / 1000).toFixed(1),
  });
}
console.log('\nETL summary');
console.table(results);
if (results.some((result) => result.status !== 'ok')) process.exitCode = 1;
