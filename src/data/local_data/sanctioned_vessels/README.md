# Sanctioned vessels

Vessel entities from the OpenSanctions consolidated sanctions list, bundled so
PALANTIR can flag AIS contacts by IMO / MMSI without a network call.

- Source: [OpenSanctions — Consolidated Sanctions](https://www.opensanctions.org/datasets/sanctions/), `targets.simple.csv`
- License: **CC BY-NC 4.0 — NonCommercial.** Commercial deployments must license
  the data from OpenSanctions or remove this file.
- Vessel count: 1,998
- Runtime file: `sanctioned_vessels.json` — `byImo` and `byMmsi` map identifiers
  to indexes in `vessels`
- Regenerate: `node scripts/etl/sanctioned-vessels.mjs` (streams ~75 MB; nothing is cached)

Only Vessel-schema rows are kept; names, aliases, flag countries, sanction
programs and source datasets are retained. No personal data is bundled.
Retrieved 2026-09-30.
