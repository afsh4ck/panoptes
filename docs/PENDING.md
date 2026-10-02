# PANOPTES — pending work

Running list of requested changes that are not finished yet. Tick an item only
when it is implemented, tested and checked in the browser.

## Interface

- [x] Collapsible menus: top bar, tool rail, inspector tabs, status bar, HUD, focus mode (`\`)
- [x] Docked panels (drawer and inspector) have a ✕ and close with their region
- [x] Top bar clock overlaps the focus button at narrow desktop widths
- [x] The globe viewport resizes to the space left by open menus and stays centered in it
- [x] HUD top-left box shows useful data: place name, precise lat/lon, camera altitude, heading/pitch, ground elevation, UTC/local time (instead of the mock classification banner)
- [x] Orange is the default accent everywhere (JS-drawn tracking lines, aircraft, overlays, detection boxes)
- [x] Loading screen: central eye + 8 orbiting eyes tracking the pointer
- [x] Stars in space view look pixelated (sky box resolution / point rendering)
- [x] Visual presets: NVG uses a corner vignette (no circle); anime, noir and snow removed (old links fall back to Normal)
- [~] Dron UHD camera (key 5): WASD/arrows move, mouse look (click to capture), Shift/E up, Ctrl/Q down, wheel speed, Esc exits. Ctrl+W is reserved by the browser
- [x] DISPLAY drawer redesigned: titled sections, one card per feature, on/off switches, sub-settings only while on
- [x] CAMERAS drawer simplified: power switch, feed, camera picker, Nearest/Focus; overlays, calibration and summary in closed sections
- [x] Orange scrollbars that appear only while a panel scrolls
- [~] Bilingual interface (Spanish default, English) with ES/EN switch in the top bar; runtime dictionary over the whole DOM. Some dynamic sentences built from fragments stay in English until added to the dictionary

## Interface (round 2)

- [x] Top bar and status bar never overlap: actions measured live, brand flush left, centred floating dock with chips
- [x] Location tray centred above the dock, landmarks and cities in slim rows, wheel scrolls sideways
- [x] Custom tooltips replace the browser ones everywhere (titles adopted into data-pnp-title, translated)
- [x] Status chips stack vertically; long Spanish labels truncate instead of overflowing
- [x] DRAW drawer (5th rail item): solid outlines, translucent fill draped over buildings, list of zones with fly-to and delete
- [x] Layers drawer scrolls again (inner list no longer swallows the wheel); drawer headers keep a background

## Tracking

- [x] Untrack control: a clear "release camera" action (button + Esc) for tracked aircraft and satellites
- [x] Selected aircraft: draw origin and destination airports on the map, the great-circle route, flown/remaining split, distance remaining and ETA

- [x] Callsign search in Ctrl+K tracks that flight; tracking hides every other aircraft (focus mode)
- [x] Route drawn in two colours (flown cyan, remaining dashed orange) with a 3D climb/descent profile
- [x] Camera modes for a tracked aircraft: Follow, Cockpit, Top-down, Orbit
- [x] Altitude follows the last vertical rate when the feed stops reporting it (no more floating on approach)
- [x] Far-range aircraft icons and detection brackets shrink so continental views stay readable

## Map and data

- [x] Google 3D in the EEA: falls back to Google 3D through Cesium ion, then OSM 3D buildings
- [x] Photoreal 3D wins over restored flat maps (verified over San Francisco with map=esri-imagery); flat maps stay only when chosen explicitly. Was: verify the one-time upgrade to photorealistic 3D when a Cesium ion token is added (sessions restored on `map=esri-imagery` showed untextured gray buildings)
- [x] 3D buildings fallback layer: tests and package boundaries pass; it turns off under photoreal
- [~] Cameras: Austin pack shows synthetic placeholders ("Upstream unavailable") — Austin frames are blocked by the publisher (CloudFront 403 from outside the US) — the panel now says so; Ontario 511 needs CCTV_ONTARIO_API_KEY; catalog timeouts raised so Austin/TfL/DriveBC load
- [~] More public cameras with live video (official sources only), LIVE badge and "live video only" filter — catalog now ~16,000 cameras from 20+ official packs with a liveOnly filter; LIVE playback still to be verified in a real browser

- [x] Cameras: unreachable providers hidden per server location (Austin, Alaska 511 from Spain), stock no-feed cards recognised, first camera is the nearest to the view; live/total counts, live-video filter, street search
- [x] Radiation points open a Safecast dossier; vessels show a Wikidata/Commons photo when one exists
- [x] Strategic layers: type filter chips; points no longer clipped by relief (globe occlusion test instead of depth test)
- [~] Air emergencies / GPS interference: empty results are explained; adsb.lol rate limits (HTTP 429) still make them stale at times
- [ ] Traffic is simulated without a TomTom key (vehicles do not match camera footage)

## Performance

- [x] More parallel 3D tile requests, 1.5 GB tile cache on both Google routes, star sky painted at idle
- [x] Detalle 3D (Estándar / Alto / Ultra HD) with progressive loading: coarse tiles while the camera moves, full detail when it settles, centre of the view first
- [ ] Measure frame rate and load time on a real GPU (headless software rendering cannot show these gains)

## Release checks

- [x] Full `npm test`, `format:check`, import directions, package boundaries, token check, production build
- [x] README and DATA_SOURCES: new layers, camera sources, keys (Cesium ion, UCDP, ACLED, Launch Library)

## Notes

- Legend: [x] done and checked headless · [~] implemented, needs your check in a real browser · [ ] open.
- Route/ETA comes from published callsign schedules (adsbdb); it is an estimate, not a filed flight plan.
- The loading-screen coordinates are a playful screen-to-globe mapping, not your real location.
