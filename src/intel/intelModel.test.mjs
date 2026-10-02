import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntelModel,
  fmtAltitude,
  fmtDate,
  fmtDistance,
  fmtLength,
  fmtMass,
  fmtNumber,
  fmtSpeed,
  intelRow,
  intelSection,
  isIntelModel,
  sanitizeHref,
  truncate,
} from './intelModel.js';

test('sanitizeHref admits only absolute http(s) URLs without credentials', () => {
  assert.equal(
    sanitizeHref('https://example.com/a?b=1'),
    'https://example.com/a?b=1',
  );
  assert.equal(sanitizeHref('http://example.com'), 'http://example.com/');
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
  assert.equal(sanitizeHref('data:text/html,hi'), null);
  assert.equal(sanitizeHref('/relative/path'), null);
  assert.equal(sanitizeHref('https://user:pw@example.com/'), null);
  assert.equal(sanitizeHref('https://localhost/x'), null);
  assert.equal(sanitizeHref(''), null);
  assert.equal(sanitizeHref(null), null);
  assert.equal(sanitizeHref(`https://example.com/${'a'.repeat(3000)}`), null);
});

test('formatters are locale-stable and empty for non-finite input', () => {
  assert.equal(fmtNumber(1234.5, { digits: 1, unit: 'km' }), '1,234.5 km');
  assert.equal(fmtNumber('abc'), '');
  assert.equal(fmtDistance(850), '850 m');
  assert.equal(fmtDistance(12_300), '12.3 km · 7 nmi');
  assert.equal(fmtDistance(2_500), '2.5 km');
  assert.equal(fmtDistance(-1), '');
  assert.equal(fmtLength(35.8), '35.8 m (117.5 ft)');
  assert.equal(fmtLength(0), '');
  assert.equal(fmtMass(77_000), '77,000 kg (169,756 lb)');
  assert.equal(fmtMass(2_000_000), '2,000 t (4,409,240 lb)');
  assert.equal(fmtSpeed(460), '460 kt · 852 km/h');
  assert.equal(fmtAltitude(35_000), 'FL350 · 35,000 ft (10,668 m)');
  assert.equal(fmtAltitude(2_500), '2,500 ft (762 m)');
  assert.equal(fmtDate('2026-09-30T18:24:07Z'), '2026-09-30 18:24 UTC');
  assert.equal(fmtDate(Date.UTC(2026, 0, 2), { dateOnly: true }), '2026-01-02');
  assert.equal(fmtDate('not a date'), '');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abc', 5), 'abc');
});

test('intelRow and intelSection drop blanks and unsafe hrefs', () => {
  assert.equal(intelRow('Label', ''), null);
  assert.equal(intelRow('Label', null), null);
  assert.equal(intelRow('', 'value'), null);
  assert.deepEqual(intelRow('Label', ' value  here '), {
    label: 'Label',
    value: 'value here',
  });
  assert.deepEqual(
    intelRow('Hex', 'abc', { mono: true, href: 'javascript:x' }),
    {
      label: 'Hex',
      value: 'abc',
      mono: true,
    },
  );
  assert.deepEqual(intelRow('Site', 'x', { href: 'https://example.com/' }), {
    label: 'Site',
    value: 'x',
    href: 'https://example.com/',
  });
  assert.equal(intelSection('EMPTY', [null, intelRow('a', '')]), null);
  assert.deepEqual(
    intelSection('IDENTITY', [
      intelRow('A', '1'),
      null,
      { label: 'B', value: 2 },
    ]),
    {
      heading: 'IDENTITY',
      rows: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
      ],
    },
  );
});

test('createIntelModel normalizes every field and rejects unknown kinds', () => {
  assert.throws(
    () => createIntelModel({ kind: 'planet' }),
    /Unknown intel kind/,
  );
  const model = createIntelModel({
    kind: 'aircraft',
    id: ' 3c6444 ',
    title: '',
    subtitle: null,
    badges: [
      'MILITARY',
      { label: 'STALE', tone: 'warn' },
      { label: '', tone: 'ok' },
      { label: 'X', tone: 'bogus' },
    ],
    photo: {
      src: 'https://img.example.com/a.jpg',
      link: 'javascript:bad',
      credit: ' Steffen ',
    },
    sections: [
      { heading: 'A', rows: [{ label: 'k', value: 'v' }] },
      { heading: 'B', rows: [{ label: 'k', value: '' }] },
      null,
    ],
    links: [
      { label: 'One', href: 'https://one.example.com/' },
      { label: 'Dup', href: 'https://one.example.com/' },
      { label: 'Bad', href: 'ftp://x.example.com/' },
      { label: '', href: 'https://two.example.com/' },
    ],
    raw: [1, 2],
    fetchedAt: 'nope',
    notes: ['', ' keep me '],
  });
  assert.equal(model.id, '3c6444');
  assert.equal(model.title, 'UNKNOWN');
  assert.equal(model.subtitle, '');
  assert.equal(model.accent, '#f5a524');
  assert.deepEqual(model.badges, [
    { label: 'MILITARY', tone: 'neutral' },
    { label: 'STALE', tone: 'warn' },
    { label: 'X', tone: 'neutral' },
  ]);
  assert.deepEqual(model.photo, {
    src: 'https://img.example.com/a.jpg',
    link: null,
    credit: 'Steffen',
  });
  assert.deepEqual(model.sections, [
    { heading: 'A', rows: [{ label: 'k', value: 'v' }] },
  ]);
  assert.deepEqual(model.links, [
    { label: 'One', href: 'https://one.example.com/' },
  ]);
  assert.deepEqual(model.raw, {});
  assert.equal(model.fetchedAt, null);
  assert.deepEqual(model.notes, ['keep me']);
  assert.equal(isIntelModel(model), true);
  assert.equal(isIntelModel({ kind: 'aircraft' }), false);
});
