import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteIntelModel } from './siteIntel.js';

const rota = {
  id: 'strategic-military-bases:osm:way:39736545',
  layerId: 'strategic-military-bases',
  layerName: 'Military Bases',
  source: 'OSM + Wikidata',
  latitude: 36.64,
  longitude: -6.35,
  properties: {
    name: 'Base Naval de Rota',
    class: 'naval_base',
    subtitle: 'Military base · Navy',
    country: 'ES',
    source: 'OSM+Wikidata',
    tags: {
      wikidata: 'Q729530',
      operator: 'United States Navy',
      osm_id: 'way/39736545',
      branch: 'navy',
      inception: '1953-09-26',
      name_en: 'Naval Station Rota',
    },
  },
};

test('builds a site dossier with identity, location and provenance links', () => {
  const model = buildSiteIntelModel({ subject: { id: rota.id }, live: rota });
  assert.equal(model.kind, 'site');
  assert.equal(model.title, 'Base Naval de Rota');
  const rows = Object.fromEntries(
    model.sections.flatMap((s) => s.rows).map((r) => [r.label, r]),
  );
  assert.equal(rows.Type.value, 'Naval base');
  assert.equal(rows.Operator.value, 'United States Navy');
  assert.equal(rows.Inception.value, '1953-09-26');
  assert.match(rows.MGRS.value, /^29S/);
  assert.equal(rows.Wikidata.href, 'https://www.wikidata.org/wiki/Q729530');
  assert.equal(
    rows.OpenStreetMap.href,
    'https://www.openstreetmap.org/way/39736545',
  );
  assert.ok(model.links.some((l) => l.label === 'Satellite view'));
  assert.ok(model.notes[0].includes('does not confirm'));
});

test('tolerates a bare record without properties or position', () => {
  const model = buildSiteIntelModel({ subject: { id: 'x', label: 'Dam X' } });
  assert.equal(model.title, 'Dam X');
  assert.equal(
    model.sections.some((s) => s.heading === 'LOCATION'),
    false,
  );
});
