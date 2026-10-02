import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commonsThumb,
  fetchVesselPhoto,
  pickCommonsHit,
  titleMatchesVessel,
  wikidataQuery,
} from './vesselPhoto.js';

test('file names must contain every word of the vessel name', () => {
  assert.equal(
    titleMatchesVessel(
      'File:MSC Cornelia (ship, 2008) 001.jpg',
      'MSC CORNELIA',
    ),
    true,
  );
  assert.equal(
    titleMatchesVessel('File:MSC Oscar leaving Hamburg.jpg', 'MSC CORNELIA'),
    false,
  );
  assert.equal(titleMatchesVessel('File:Ever_Given.jpg', 'EVER GIVEN'), true);
  assert.equal(titleMatchesVessel('File:x.jpg', ''), false);
});

test('Wikidata query uses IMO and MMSI only when well formed', () => {
  assert.match(wikidataQuery({ imo: 'IMO 9461867' }), /P458 "9461867"/);
  assert.match(wikidataQuery({ mmsi: '636017514' }), /P587 "636017514"/);
  assert.equal(wikidataQuery({ imo: '12', mmsi: 'x' }), null);
});

test('Commons FilePath images become sized thumbnails', () => {
  assert.equal(
    commonsThumb('http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg'),
    'https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=640',
  );
  assert.equal(commonsThumb('https://evil.test/a.jpg'), null);
});

test('Commons hits are ordered and filtered by name', () => {
  const payload = {
    query: {
      pages: {
        1: {
          index: 2,
          title: 'File:MSC Cornelia at sea.jpg',
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/a.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:a',
              extmetadata: { Artist: { value: '<a>Jane</a>' } },
            },
          ],
        },
        2: {
          index: 1,
          title: 'File:Another ship.jpg',
          imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.jpg' }],
        },
      },
    },
  };
  const hit = pickCommonsHit(payload, 'MSC CORNELIA');
  assert.equal(hit.src, 'https://upload.wikimedia.org/a.jpg');
  assert.equal(hit.credit, 'Jane · Wikimedia Commons');
});

test('Wikidata identity wins; network failures resolve to null', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.includes('wikidata')
        ? {
            results: {
              bindings: [
                {
                  s: { value: 'http://www.wikidata.org/entity/Q1' },
                  image: {
                    value:
                      'http://commons.wikimedia.org/wiki/Special:FilePath/Ship.jpg',
                  },
                },
              ],
            },
          }
        : {},
  });
  const photo = await fetchVesselPhoto(
    { mmsi: '636017514', name: 'MSC CORNELIA' },
    { fetchImpl },
  );
  assert.match(photo.src, /Special:FilePath\/Ship\.jpg\?width=640$/);
  const failed = await fetchVesselPhoto(
    { mmsi: '636017514', name: 'MSC CORNELIA' },
    {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    },
  );
  assert.equal(failed, null);
});
