/**
 * Product identity, in one place. Every user-facing surface that names the
 * application reads from here so a rename is a one-line change.
 *
 * The name references Argus Panoptes, the hundred-eyed watchman of Greek
 * myth who never slept. This project is an independent open-source fork and
 * is unaffiliated with any company.
 */
export const BRAND = Object.freeze({
  name: 'PANOPTES',
  shortName: 'PANOPTES',
  tagline: 'EVERY SIGNAL. ONE GLOBE.',
  description:
    'An open-source geospatial intelligence console: live aircraft, ships, satellites, conflicts, disasters and strategic sites on one 3D globe.',
  /** Prefix for browser storage keys owned by the product shell. */
  storagePrefix: 'panoptes:',
  /** Upstream project this fork descends from; keep the attribution visible. */
  upstream: Object.freeze({
    name: "God's Eye View",
    author: 'Bilawal Sidhu',
    url: 'https://github.com/bilawalsidhu/gods-eye-view',
    license: 'MIT',
  }),
});
