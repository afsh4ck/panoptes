import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEL_STATES,
  coerceSubject,
  createIntelCache,
  exportFileName,
  fallbackModelFromSubject,
  flatProperties,
  formatFetchedAt,
  h,
  kindForLayer,
  normalizeIntelModel,
  panelBadgeText,
  renderEmptyView,
  renderIntelView,
  requestDescriptorFor,
  sanitizeHref,
  subjectFromAwarenessEvent,
  subjectFromEntityRecord,
  subjectKey,
  vnodeToHtml,
} from './intelPanelModel.js';

test('layer ids resolve to dossier kinds; unknown layers are sites', () => {
  assert.equal(kindForLayer('flights'), 'aircraft');
  assert.equal(kindForLayer('military'), 'aircraft');
  assert.equal(kindForLayer('satellites'), 'satellite');
  assert.equal(kindForLayer('ais-live-vessels'), 'vessel');
  assert.equal(kindForLayer('rocket-launches'), 'launch');
  assert.equal(kindForLayer('military-installations'), 'site');
  assert.equal(kindForLayer(undefined), 'site');
});

test('awareness selection becomes a tracking subject keyed by layer and id', () => {
  const subject = subjectFromAwarenessEvent({
    layerId: 'flights',
    id: 'A1B2C3',
    label: ' DLH400 ',
    origin: 'click',
    position: { x: 1, y: 2, z: 3 },
  });
  assert.deepEqual(
    { ...subject },
    {
      kind: 'aircraft',
      id: 'A1B2C3',
      layerId: 'flights',
      label: 'DLH400',
      tracking: true,
      origin: 'click',
      latitude: null,
      longitude: null,
      properties: {},
      record: null,
    },
  );
  assert.equal(subjectKey(subject), 'aircraft:flights:A1B2C3');
  assert.equal(subjectFromAwarenessEvent({ layerId: 'flights' }), null);
  assert.equal(subjectFromAwarenessEvent({ id: 'x' }), null);
  assert.equal(subjectFromAwarenessEvent(null), null);
});

test('entity records flatten one nested level and keep the record reference', () => {
  const record = {
    id: 42,
    layerId: 'strategic-nuclear-sites',
    label: '',
    latitude: 51.4,
    longitude: 3.7,
    properties: {
      name: 'Borssele',
      class: 'nuclear_power_plant',
      tags: { operator: 'EPZ', 'plant:output': '485 MW', nested: { x: 1 } },
      list: ['a', 'b'],
      empty: null,
    },
    entity: { show: true },
  };
  const subject = subjectFromEntityRecord(record);
  assert.equal(subject.kind, 'site');
  assert.equal(subject.id, '42');
  assert.equal(subject.label, 'Borssele');
  assert.equal(subject.latitude, 51.4);
  assert.deepEqual(subject.properties, {
    name: 'Borssele',
    class: 'nuclear_power_plant',
    'tags.operator': 'EPZ',
    'tags.plant:output': '485 MW',
    list: 'a, b',
  });
  assert.equal(subject.record, record);
  assert.deepEqual(flatProperties(null), {});
});

test('coerceSubject accepts normalized subjects and either event shape', () => {
  const normalized = coerceSubject({
    kind: 'vessel',
    id: 244660000,
    layerId: 'ais-live-vessels',
    label: '',
  });
  assert.equal(normalized.id, '244660000');
  assert.equal(normalized.label, '244660000');
  assert.equal(normalized.tracking, true);
  assert.equal(
    coerceSubject({ layerId: 'satellites', id: 25544, label: 'ISS' }).kind,
    'satellite',
  );
  assert.equal(
    coerceSubject({ id: 'n1', layerId: 'local-dams', properties: {} }).kind,
    'site',
  );
  assert.equal(coerceSubject('nope'), null);
});

test('request descriptors read identifiers from the live record first', () => {
  const aircraft = subjectFromAwarenessEvent({
    layerId: 'flights',
    id: '3C6444',
  });
  assert.deepEqual(
    requestDescriptorFor(aircraft, {
      id: '3c6444',
      properties: {
        icao24: '3C6444',
        callsign: 'dlh400 ',
        registration: 'D-AIBD',
      },
    }),
    {
      kind: 'aircraft',
      key: 'aircraft:flights:3C6444',
      hex: '3c6444',
      callsign: 'DLH400',
      registration: 'D-AIBD',
    },
  );
  assert.equal(
    requestDescriptorFor(
      subjectFromAwarenessEvent({ layerId: 'flights', id: '~zz1234' }),
    ).hex,
    null,
  );
  const satellite = subjectFromAwarenessEvent({
    layerId: 'satellites',
    id: 25544,
  });
  assert.deepEqual(requestDescriptorFor(satellite), {
    kind: 'satellite',
    key: 'satellite:satellites:25544',
    norad: 25544,
  });
  assert.equal(
    requestDescriptorFor(
      subjectFromAwarenessEvent({ layerId: 'satellites', id: 'abc' }),
    ).norad,
    null,
  );
  const vessel = subjectFromEntityRecord({
    id: '244660000',
    layerId: 'ais-live-vessels',
    properties: { mmsi: '244660000', imo: '9331036' },
  });
  assert.deepEqual(requestDescriptorFor(vessel), {
    kind: 'vessel',
    key: 'vessel:ais-live-vessels:244660000',
    mmsi: '244660000',
    imo: '9331036',
  });
  const site = subjectFromEntityRecord({
    id: 'w1',
    layerId: 'local-dams',
    properties: {},
  });
  assert.deepEqual(requestDescriptorFor(site), {
    kind: 'site',
    key: 'site:local-dams:w1',
    layerId: 'local-dams',
    id: 'w1',
  });
});

test('hrefs keep only absolute http(s) URLs', () => {
  assert.equal(
    sanitizeHref('https://example.com/a?b=1'),
    'https://example.com/a?b=1',
  );
  assert.equal(sanitizeHref('http://example.com'), 'http://example.com/');
  assert.equal(sanitizeHref('javascript:alert(1)'), '');
  assert.equal(sanitizeHref('data:text/html,hi'), '');
  assert.equal(sanitizeHref('/relative/path'), '');
  assert.equal(sanitizeHref(''), '');
  assert.equal(sanitizeHref(null), '');
});

test('the cache is bounded and least-recently-used', () => {
  const cache = createIntelCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // touch a → b is now the oldest
  cache.set('c', 3);
  assert.deepEqual(cache.keys(), ['a', 'c']);
  assert.equal(cache.has('b'), false);
  cache.set('a', 9);
  assert.equal(cache.get('a'), 9);
  assert.equal(cache.size, 2);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(createIntelCache(0).set('k', 1), 1);
});

test('models normalize to the panel contract and drop unsafe or empty fields', () => {
  const subject = subjectFromAwarenessEvent({
    layerId: 'flights',
    id: '3c6444',
    label: 'DLH400',
  });
  const model = normalizeIntelModel(
    {
      kind: 'bogus',
      title: '  ',
      subtitle: 'Airbus A319-112',
      accent: 'url(evil)',
      badges: [
        'LIVE',
        { label: 'SANCTIONED', tone: 'alert' },
        { label: '', tone: 'ok' },
        { label: 'x', tone: 'weird' },
      ],
      photo: { src: 'javascript:1', link: 'https://p.example/1' },
      sections: [
        {
          heading: 'AIRFRAME',
          rows: [
            { label: 'Registration', value: 'D-AIBD', mono: true },
            { label: 'Empty', value: '' },
            ['Operator', 'Lufthansa'],
            { label: 'Link', value: 'adsbdb', href: 'javascript:void(0)' },
            { label: 'Site', value: 'adsbdb', href: 'https://adsbdb.com' },
          ],
        },
        { heading: 'EMPTY', rows: [{ label: 'x', value: null }] },
      ],
      links: [
        { label: 'FR24', href: 'https://fr24.example' },
        { href: 'ftp://nope' },
      ],
      notes: ['a', '', 'b'],
      raw: { ok: true },
      fetchedAt: 'soon',
    },
    subject,
  );
  assert.equal(model.kind, 'aircraft');
  assert.equal(model.title, 'DLH400');
  assert.equal(model.accent, '');
  assert.deepEqual(model.badges, [
    { label: 'LIVE', tone: 'neutral' },
    { label: 'SANCTIONED', tone: 'alert' },
    { label: 'x', tone: 'neutral' },
  ]);
  assert.equal(model.photo, null);
  assert.equal(model.sections.length, 1);
  assert.deepEqual(model.sections[0].rows, [
    { label: 'Registration', value: 'D-AIBD', mono: true },
    { label: 'Operator', value: 'Lufthansa', mono: false },
    { label: 'Link', value: 'adsbdb', mono: false },
    {
      label: 'Site',
      value: 'adsbdb',
      mono: false,
      href: 'https://adsbdb.com/',
    },
  ]);
  assert.deepEqual(model.links, [
    { label: 'FR24', href: 'https://fr24.example/' },
  ]);
  assert.deepEqual(model.notes, ['a', 'b']);
  assert.deepEqual(model.raw, { ok: true });
  assert.equal(model.fetchedAt, null);
  assert.equal(
    normalizeIntelModel({ accent: '#f5a524' }, subject).accent,
    '#f5a524',
  );
  assert.equal(
    normalizeIntelModel({ accent: 'var(--accent)' }, subject).accent,
    'var(--accent)',
  );
  const photo = normalizeIntelModel(
    {
      photo: {
        src: 'https://img.example/a.jpg',
        link: 'https://img.example',
        credit: 'Jane',
      },
    },
    subject,
  ).photo;
  assert.deepEqual(photo, {
    src: 'https://img.example/a.jpg',
    link: 'https://img.example/',
    credit: 'Jane',
    alt: '',
  });
});

test('the fallback dossier describes the selection and its flat properties', () => {
  const subject = subjectFromEntityRecord({
    id: 'n7',
    layerId: 'strategic-military-bases',
    properties: {
      name: 'Rota',
      class: 'naval_base',
      country: 'ES',
      detail: 'US Navy / Armada',
      osm_id: 7,
    },
  });
  const model = fallbackModelFromSubject(subject, {
    id: 'n7',
    layerName: 'Military Bases',
    source: 'OpenStreetMap',
    properties: { name: 'Rota' },
  });
  assert.equal(model.title, 'Rota');
  assert.equal(model.subtitle, 'naval_base · ES');
  assert.deepEqual(model.sections[0], {
    heading: 'SELECTION',
    rows: [
      { label: 'Layer', value: 'Military Bases', mono: false },
      { label: 'ID', value: 'n7', mono: true },
      { label: 'Source', value: 'OpenStreetMap', mono: false },
      { label: 'Detail', value: 'US Navy / Armada', mono: false },
    ],
  });
  assert.equal(model.sections[1].heading, 'PROPERTIES');
  assert.ok(
    model.sections[1].rows.some((row) => row.label === 'osm id' && row.mono),
  );
  assert.equal(
    model.notes[0],
    'No intel provider is registered for this subject kind.',
  );
  assert.equal(
    fallbackModelFromSubject(subject, null, { reason: 'boom' }).notes[0],
    'boom',
  );
});

test('fetched-at reads as a relative age', () => {
  const now = 1_000_000;
  assert.equal(formatFetchedAt(null, now), '');
  assert.equal(formatFetchedAt(now - 1000, now), 'fetched just now');
  assert.equal(formatFetchedAt(now - 12_000, now), 'fetched 12 s ago');
  assert.equal(formatFetchedAt(now - 180_000, now), 'fetched 3 min ago');
  assert.equal(formatFetchedAt(now - 7_200_000, now), 'fetched 2 h ago');
});

test('render trees serialize with escaped text and the expected structure', () => {
  const subject = subjectFromAwarenessEvent({
    layerId: 'satellites',
    id: 25544,
    label: 'ISS <ZARYA>',
  });
  const model = normalizeIntelModel(
    {
      title: 'ISS <ZARYA>',
      subtitle: 'Station · LEO',
      accent: '#39d0ff',
      badges: [{ label: 'ACTIVE', tone: 'ok' }],
      photo: { src: 'https://img.example/iss.jpg', credit: 'NASA' },
      sections: [
        {
          heading: 'ORBIT',
          rows: [
            { label: 'Period', value: '92.9 min', mono: true },
            {
              label: 'Catalog',
              value: 'SATCAT',
              href: 'https://celestrak.org/satcat',
            },
          ],
        },
      ],
      links: [{ label: 'N2YO', href: 'https://n2yo.example' }],
      notes: ['Elements age 6 h'],
      raw: { a: 1 },
      fetchedAt: 500,
    },
    subject,
  );
  const html = vnodeToHtml(
    renderIntelView({
      subject,
      model,
      state: INTEL_STATES.ready,
      nowMs: 1500,
      canFly: true,
    }),
  );
  assert.match(
    html,
    /^<article class="intel-dossier kind-satellite state-ready" data-intel-kind="satellite" data-intel-id="25544" style="--intel-accent: #39d0ff">/,
  );
  assert.ok(html.includes('<h3 class="intel-title">ISS &lt;ZARYA&gt;</h3>'));
  assert.ok(html.includes('<span class="intel-badge tone-ok">ACTIVE</span>'));
  assert.ok(
    html.includes(
      '<img src="https://img.example/iss.jpg" alt="ISS &lt;ZARYA&gt; photo" loading="lazy" data-intel-photo="true">',
    ),
  );
  assert.ok(html.includes('<figcaption>NASA</figcaption>'));
  assert.ok(html.includes('<dt>Period</dt><dd class="mono">92.9 min</dd>'));
  assert.ok(
    html.includes(
      '<dd><a href="https://celestrak.org/satcat" target="_blank" rel="noopener noreferrer">SATCAT</a></dd>',
    ),
  );
  assert.ok(
    html.includes(
      '<a class="data-toggle-chip" href="https://n2yo.example/" target="_blank" rel="noopener noreferrer">N2YO</a>',
    ),
  );
  assert.ok(html.includes('<li>Elements age 6 h</li>'));
  assert.ok(
    html.includes('<span class="intel-fetched">fetched just now</span>'),
  );
  for (const action of ['fly', 'copy', 'export', 'close'])
    assert.ok(html.includes(`data-intel-action="${action}"`), action);
  assert.ok(!html.includes('intel-status'));

  const held = vnodeToHtml(
    renderIntelView({
      subject: { ...subject, tracking: false },
      model: { ...model, raw: null },
      state: INTEL_STATES.error,
      error: 'HTTP 503',
      nowMs: 1500,
      canFly: false,
    }),
  );
  assert.ok(
    held.includes('<span class="intel-badge tone-warn">NOT TRACKING</span>'),
  );
  assert.ok(
    held.includes(
      '<div class="intel-status is-error" role="status">HTTP 503</div>',
    ),
  );
  assert.ok(!held.includes('data-intel-action="fly"'));
  assert.ok(!held.includes('data-intel-action="copy"'));
  assert.ok(held.includes('data-intel-action="close"'));

  const loading = vnodeToHtml(
    renderIntelView({
      subject,
      model: null,
      state: INTEL_STATES.loading,
      nowMs: 0,
    }),
  );
  assert.ok(loading.includes('FETCHING INTEL…'));
  assert.ok(loading.includes('<h3 class="intel-title">ISS &lt;ZARYA&gt;</h3>'));

  assert.equal(
    vnodeToHtml(renderEmptyView()),
    '<div class="intel-empty"><strong>NO SUBJECT</strong><span>Select an aircraft, satellite, vessel, launch or mapped site to build its dossier.</span></div>',
  );
  assert.equal(
    vnodeToHtml(renderIntelView({ subject: null })),
    vnodeToHtml(renderEmptyView()),
  );
  assert.equal(
    vnodeToHtml(h('p', { hidden: true, skip: null }, 'a', null, ['b', false])),
    '<p hidden>ab</p>',
  );
});

test('badge text and export names follow the subject', () => {
  const subject = subjectFromAwarenessEvent({
    layerId: 'flights',
    id: '3c6444',
  });
  assert.equal(panelBadgeText(subject), 'AIRCRAFT');
  assert.equal(
    panelBadgeText({ ...subject, tracking: false }),
    'AIRCRAFT · HELD',
  );
  assert.equal(panelBadgeText(null), '');
  assert.equal(exportFileName(subject), 'intel-aircraft-3c6444.json');
  assert.equal(
    exportFileName({ kind: 'site', id: 'way/12 34' }),
    'intel-site-way-12-34.json',
  );
});

test('event layers open event dossiers and sites carry their Wikidata id', () => {
  for (const layerId of [
    'earthquakes',
    'local-firms',
    'disaster-alerts',
    'conflict-events',
    'weather-cyclones',
    'gps-interference',
  ])
    assert.equal(kindForLayer(layerId), 'event');
  const site = subjectFromEntityRecord({
    id: 'base-1',
    layerId: 'strategic-military-bases',
    properties: { name: 'Malmen', tags: { wikidata: 'Q6744357' } },
  });
  assert.equal(requestDescriptorFor(site).wikidata, 'Q6744357');
  const event = subjectFromEntityRecord({
    id: 'earthquake:us1',
    layerId: 'earthquakes',
    latitude: 1,
    longitude: 2,
    properties: {},
  });
  assert.deepEqual(requestDescriptorFor(event), {
    kind: 'event',
    key: 'event:earthquakes:earthquake:us1',
    layerId: 'earthquakes',
    id: 'earthquake:us1',
  });
});

test('NEARBY rows keep their in-app targets and render as buttons', () => {
  const subject = subjectFromEntityRecord({
    id: 'q',
    layerId: 'earthquakes',
    latitude: 40,
    longitude: -3,
    properties: {},
  });
  const model = normalizeIntelModel(
    {
      kind: 'event',
      title: 'M4',
      sections: [
        {
          heading: 'NEARBY · 50 KM',
          rows: [
            { label: 'Cameras', value: 'Callao · 400 m N', fly: { lat: 40.42, lon: -3.7 }, camera: 'madrid-01314' },
            { label: 'Sites', value: 'Base · 9 km E', fly: { lat: 95, lon: 0 } },
          ],
        },
      ],
    },
    subject,
  );
  const [camera, site] = model.sections[0].rows;
  assert.deepEqual(camera.fly, { lat: 40.42, lon: -3.7 });
  assert.equal(camera.camera, 'madrid-01314');
  assert.equal(site.fly, undefined, 'an impossible position is dropped');
  const html = vnodeToHtml(
    renderIntelView({ subject, model, state: 'ready', nowMs: 0 }),
  );
  assert.match(html, /<button type="button" class="intel-row-target" data-intel-camera="madrid-01314" data-intel-fly-lat="40.42" data-intel-fly-lon="-3.7">Callao · 400 m N<\/button>/);
});
