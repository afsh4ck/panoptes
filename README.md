<div align="center">

<img src="public/logo.svg" alt="PANOPTES" width="96" />

# PANOPTES

### The eyes that see everything.

**An open-source geospatial intelligence console.** Live aircraft, ships and
satellites, conflict and disaster events, military bases, nuclear sites and
critical infrastructure, on one photorealistic 3D globe that runs on your own
machine.

</div>

![PANOPTES following a live flight from Paris to Málaga](docs/screenshots/17-flight-route-v2.jpg)

> The name comes from Argus Panoptes, the hundred-eyed watchman of Greek
> myth. This project is independent and unaffiliated with any company.

---

<div align="center">

**[Quick Start](#-quick-start) · [What it does](#%EF%B8%8F-what-it-does) · [What's Live](#%EF%B8%8F-whats-on-the-globe) · [Keys & Costs](#-api-keys) · [Design System](docs/DESIGN-SYSTEM.md) · [Contributing](CONTRIBUTING.md)**

</div>

---

## 🧭 What's inside

PANOPTES is a photoreal Cesium globe, a catalog of live and bundled layers, a
voice agent and a scene director, built as an analyst workstation:

- **A new identity and interface.** Graphite surfaces, an amber accent, IBM
  Plex type, a light theme and no cockpit theatrics. The tokens and rules are
  in [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).
- **Strategic layers, worldwide.** Bundled, precomputed datasets for military
  bases and naval stations, nuclear power and fuel-cycle sites, large power
  plants, ports, airports, volcanoes and maritime chokepoints, built by the
  scripts in `scripts/etl` from OpenStreetMap, Wikidata, WRI, NGA and other
  public sources.
- **Live event layers.** Conflict events, disaster alerts, aviation
  emergencies and GPS interference, each with an honest source and freshness
  chip.
- **Intel cards.** Click an aircraft, satellite or vessel for registry,
  technical and orbital data drawn from public APIs.
- **Analyst tools.** An alert center with watch zones, a Ctrl+K command
  palette, GeoJSON and CSV export, report generation and case notes.
- **Bilingual interface.** Spanish by default, English one click away (ES/EN
  in the top bar). Every surface, tooltip and dynamic readout follows the
  switch through a runtime dictionary (`src/i18n`).
- **A workstation layout.** Top bar, tool rail (Layers, Display, Scenes,
  Cameras, Draw, Route), inspector tabs and a status bar, every one of them
  collapsible; the globe re-centres in the space the open menus leave. Orange
  auto-hiding scrollbars, styled tooltips and custom drop-down lists (orange
  hover, full keyboard support) replace the browser defaults, and every
  drawer keeps a solid header while it scrolls.
- **Flights you can follow.** Search a callsign (e.g. `AFR36KN`) in Ctrl+K to
  track it; the map hides every other aircraft, draws the published route in
  two colours (flown in cyan, remaining in dashed orange) with an ETA, keeps
  a descending aircraft's altitude honest when the feed goes silent, and
  offers four camera modes: follow, cockpit, top-down and orbit. Speeds and
  altitudes read in km/h and metres.
- **A fighter-jet cockpit.** With the HUD layout on Tactical, the cockpit
  turns into a combat-jet head-up display: green collimated symbology, a
  pitch ladder that rolls with the view, horizon, waterline, flight-path
  marker, Mach, vertical speed and heading. The cockpit streams 3D buildings
  with its own steady profile (whole view, no cancelled requests), so a
  moving aircraft no longer waits for tiles that never arrive.
- **Photoreal detail you control.** "3D detail" (Standard, High, Ultra HD)
  with progressive loading: coarse tiles while the camera moves, full detail
  once it settles, the centre of the view first.
- **UHD drone.** Fly a free camera with WASD and the mouse (Shift/E up,
  Ctrl/Q down, wheel for speed).
- **~15,600 public cameras.** Official traffic and city cameras only, with a
  live/total count, a "live video" filter and a street search. Providers that
  cannot deliver a frame from where the server runs are hidden automatically,
  and stock "no feed" cards are recognised and reported.
- **More you can click.** Radiation points open a Safecast dossier, vessels
  show an open-source photo (Wikidata / Wikimedia Commons), and strategic
  layers filter by type (naval, air, army, missile, radar…).
- **Draw.** Lines, areas and pins on the map in orange, draped over
  buildings and anchored to the real ground height (no drift when you zoom
  out), with a list of marked zones you can fly to or delete one by one.
  Zones you keep are saved in the browser and come back on the next visit.
- **Route.** Mark a point A and a point B (type an address or coordinates,
  or pick them on the map), choose walking, driving or flying, and press
  Play: the trip is followed live on the map with distance, duration,
  arrival time, average speed, every step with its time and distance, and
  playback from ×1 to ×1000. Road routes come from OSRM; flights follow a
  great circle with climb, cruise and descent (short hops fly low and slow,
  and the follow camera frames them close).

Every layer stays a separate module, and every source is listed with its
license in [DATA_SOURCES.md](DATA_SOURCES.md).

## 🌍 Why this exists

Flight transponders, ship beacons, orbital elements, seismographs, public
cameras and open registries already say a great deal about the world. PANOPTES
puts them on one globe so you can move between the global picture and a
single aircraft, vessel or site, and then ask what else is nearby. It runs
locally, brokers your own keys server-side, and every line of code is open to
inspection.

Most feeds are live or regularly refreshed. Bundled datasets carry their
extraction date. Traffic is simulated along real roads, and camera poses and
launch trajectories are estimates. Mapped installations are community-mapped
features, never assertions about capability or status.

---

## 🎛️ What it does

- **🛩️ Cockpit view:** Ride inside a tracked flight — the camera holds the terrain under you all the way down.
- **📡 Contacts:** A 250 km roster of everything near your target — step through live aircraft and drop into any cockpit.
- **🎯 Click-to-track anything:** Camera locks on, draws a fading trail, surfaces full metadata — and a tracked fire or vessel hands you off to the nearest live camera in one click.
- **🖊️ Voice whiteboard:** Speak annotations onto the world — real boundary polygons, marks, and routes.
- **🛫 3D hangar:** Real per-class aircraft models — 787, ATR-72, Citation, Bell 206, MQ-9 — and a tracked contact swaps from glyph to 3D model as you close in.
- **🎨 Reskin reality:** GLSL sensor looks over the normal globe — CRT, NVG (corner vignette, no fish-eye), FLIR/thermal — plus a free-flying UHD drone camera.
- **🟩 Detection overlay:** Screen-space bounding boxes and IDs on everything in view.
- **🎖️ Military HUD:** Tactical heads-up display with intelligence-style telemetry.
- **🌐 Global Context:** Stage the full situational picture with one switch — and get your exact view back when you leave.
- **🎥 Scene director:** Capture cinematic camera tours for clips and demos.
- **🔗 Share Links:** Camera, style, layers, and even one tracked target serialize into a URL — a live target is a handoff, not a bookmark.
- **🏠 Reset Globe:** One control — or one sentence — back to the full Earth.
- **🌦️ Weather:** Animate GFS or ECMWF forecast wind, replay observed radar, satellite clouds and lightning on one timeline, and follow NHC/CPHC cyclone tracks. No key needed.
- **📷 Mapped ALPR cameras:** License-plate-reader camera locations tagged in OpenStreetMap, one city at a time. Locations and tags only; no key needed.
- **🔭 Satellite passes:** Ask by voice when any loaded satellite next rises over you: rise, peak and set times, and whether you can see it.
- **🔎 Analyst answers:** Count, filter and rank satellites, datacenters and dams by voice, alongside flights, ships, fires and quakes; answers say when a feed is stale or on a fallback.
- **🧭 Tilt and North Up:** Switch between straight-down and a 35° oblique, or put north at the top, while a tracked target stays centered.
- **🔍 Keyless search:** Type coordinates or a bundled city or landmark to fly there with no network request; other names use Google when configured, then Photon and Nominatim.
- **📦 Shareable scenes:** Import, preview and share Director scenes as files or bundles, with camera anchors, authored moves and data packs.
- **🌊 Nepal flood scene:** Replay the Bhote Koshi flood: flood path, witness sources and before-and-after imagery (bundled data is non-commercial; see [DATA_SOURCES.md](DATA_SOURCES.md)).

---

## 📸 Feature tour

Real captures of this build (Spanish interface by default).

| | |
|---|---|
| ![Loading screen](docs/screenshots/01-loader-v2.jpg) **Loading** — Argus' eye and eight watchers follow the pointer while the globe boots. | ![Satellites](docs/screenshots/05-satellite-intel-v2.jpg) **Satellites** — 800+ tracked objects, orbit ring and a full orbital dossier (GLONASS shown). |
| ![Aircraft dossier](docs/screenshots/04-aircraft-intel-route-v2.jpg) **Aircraft dossier** — registry, operator, type and a planespotters photo for the tracked flight. | ![Military flights](docs/screenshots/25-military-flight.jpg) **Military flights** — adsb.lol military lane with type, altitude, speed and photo. |
| ![Flight route](docs/screenshots/17-flight-route-v2.jpg) **Route on the map** — flown leg in cyan, remaining leg dashed orange, origin and destination cards with ETA. | ![Fighter HUD](docs/screenshots/23-fighter-hud-v2.jpg) **Fighter HUD** — the Tactical cockpit as a combat-jet head-up display, in km/h and metres. |
| ![Focus mode](docs/screenshots/18-focus-mode.jpg) **Focus mode** — tracking an aircraft hides every other one; Follow, Cockpit, Top-down and Orbit cameras. | ![Cockpit camera mode](docs/screenshots/19-cockpit-camera-mode.jpg) **Cockpit** — first-person view from the tracked aircraft with nearby contacts. |
| ![Vessel dossier](docs/screenshots/06-vessel-intel-v2.jpg) **Vessels** — AIS dossier, hazmat class, voyage and an open-source photo of the ship. | ![Vessel near port](docs/screenshots/27-vessel-port.jpg) **Port watch** — live AIS traffic over the port layer, sanctions check included. |
| ![Military bases](docs/screenshots/20-military-base-filter-v2.jpg) **Military bases** — 20,000+ sites worldwide from OSM and Wikidata, filterable by type. | ![Nuclear sites](docs/screenshots/26-nuclear-sites.jpg) **Nuclear sites** — plants and fuel-cycle facilities with capacity, operator and status. |
| ![Strategic layers](docs/screenshots/03-strategic-sites-conflicts.jpg) **Strategic layers** — bases, nuclear sites and conflict events on one globe. | ![Radiation dossier](docs/screenshots/21-radiation-intel.jpg) **Radiation** — click any Safecast point for CPM, level, tube and last reading. |
| ![Cameras](docs/screenshots/07-cameras-v2.jpg) **Cameras** — 15,600 public cameras, live-video filter, frames projected into the 3D city. | ![City traffic](docs/screenshots/14-traffic-dimmed-v2.jpg) **City traffic** — TomTom + OSM flow over Madrid; the basemap dims so vehicles stay readable. |
| ![Route planner](docs/screenshots/22-route-planner-v2.jpg) **Route** — A to B on foot, by car or by air, followed live with every step, time and distance. | ![Draw zones](docs/screenshots/28-draw-zones.jpg) **Draw** — zones draped over the buildings, anchored to the ground and saved in the browser. |
| ![Display panel](docs/screenshots/08-display-panel.jpg) **Display** — sections, one card per feature, on/off switches. | ![Visual presets and 3D detail](docs/screenshots/13-visual-presets-3d-detail.jpg) **Visual presets** — styles, map source and 3D detail (Standard / High / Ultra HD). |
| ![Night vision](docs/screenshots/09-night-vision.jpg) **NVG** — phosphor green with a soft corner vignette. | ![Thermal](docs/screenshots/10-thermal-flir-v2.jpg) **FLIR** — thermal contrast. |
| ![CRT](docs/screenshots/11-crt.jpg) **CRT** — scanlines and curvature. | ![Command palette](docs/screenshots/15-command-palette.jpg) **Ctrl+K** — layers, places, actions and callsign search in one box. |
| ![Photoreal Madrid](docs/screenshots/02-madrid-photoreal.jpg) **Photoreal 3D** — Google tiles through Cesium ion, Madrid as the start city. | ![English interface](docs/screenshots/16-english-interface.jpg) **ES / EN** — the whole interface switches language from the top bar. |
| ![Custom drop-downs](docs/screenshots/24-custom-dropdown.jpg) **Drop-downs** — PANOPTES lists instead of the browser's, orange on hover. | |

---

## ⚡ Quick Start

**Start without an account or API keys.** The app opens with
Esri satellite imagery and keyless terrain. OSM is the fallback if Esri is
unreachable. Flights, military traffic, satellites, earthquakes, public
cameras, radio, and launches are available without keys.

For photorealistic 3D, add a **Cesium ion token** for eligible personal,
non-commercial use, or a **Google Maps key** for the direct, metered route and
Google place search. Provider terms and quotas apply. Add keys through the
app's **POWER UP** panel; [Keys & Costs](#-api-keys) explains the options.

> **Already installed?** Update to the latest version. Older versions query
> public OpenStreetMap Overpass servers, which now refuse them, so Traffic,
> Mapped Installations and ALPR stay empty until you update.

### Install

Use **Node.js 24.x (24.14.0 or later) or 26.x**. The setup doctor warns about
Node 25, which is end-of-life.

```bash
git clone https://github.com/afsh4ck/panoptes.git
cd panoptes
npm ci
npm run doctor
npm run dev
```

Open **`http://localhost:4173`**. Choose **Live Contacts**, **Space Missions**,
**Environmental**, or **Explore Manually** from the first-run panel.

<details>
<summary>Startup performance</summary>

A point-in-time M5/Chrome capture measured a median 1.86-second cold start.
This is a comparison baseline, not a guarantee for your machine or connection.
See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

</details>

**macOS shortcut:** `./scripts/dev-fresh.sh` clears the Vite cache and pulls any
configured keys straight from the Keychain. It starts keyless too.

### Then power it up — in the app, not in a file

Keys are upgrades, not prerequisites. When you want one, click the **POWER UP**
chip in the bottom-right corner: Provider Settings lists every supported key,
what it switches on, and where to get it. Paste, hit **SAVE KEYS**, and the app
restarts itself with the new capability on. Once everything is configured the
chip reads **POWERED UP** — and if a compact layout hides it, `?setup=1`
reopens the same panel.

- **Where keys land:** the repo-root `.env`. The file is made owner-only
  _before_ a secret is written into it. These are local plaintext files,
  excluded from Git; the app uses your keys to contact the providers.
- **Keys you already have stay yours:** values from your shell or the macOS
  Keychain show as _configured externally_ and are read-only to the panel.
- **What to get first:** the free [Cesium ion](https://cesium.com/ion) token
  (eligible personal, non-commercial use; current terms and quotas apply) for
  photorealistic 3D and world terrain; a Google Maps key only for the
  billing-enabled, metered route + Google place search; OpenAI when you want to
  talk to the world. Full map, costs included, in [Keys & Costs](#-api-keys).

The server binds to **localhost**, and Provider Settings answers
requests only from your machine. Browser-side keys (Google Maps, Cesium ion)
must be restricted at their providers — [SECURITY.md](SECURITY.md) shows how,
and it carries the LAN-sharing rules alongside [Keys & Costs](#-api-keys).

---

## 🕐 The First Five Minutes

Choose a first-run mission, or try these in order. Your starting basemap depends on the keys you've added.


1. **Light up the sky.** Take the **Live Contacts** mission (or turn on **Flights** yourself) — thousands of live aircraft, gliding on real telemetry, detection mesh already reading the scene. Click one: the camera locks on, a trail draws behind it, and its live telemetry card comes up.
2. **Take the controls.** Hit **COCKPIT** on your tracked plane and ride it down, switching sensors mid-flight: NVG into Ironbow FLIR.


3. **Drop into a busy airport.** Search one and descend to the taxiways with **3D** aircraft on — grounded contacts, taxi trails, the whole apron working in real time.


4. **Look through a public camera.** Turn on **Cameras** over Austin, London, California, Finland, or Delaware (live video). The feeds aren't webcam embeds — they project _into_ the 3D city. Cycle coverage to **VIEWSHED** and every camera draws its estimated coverage volume — where it reaches, and where it goes blind.


5. **Track something in orbit.** Turn on **Satellites** and click the ISS — you ride along at orbital distance, orbit ring and all.


6. **Switch the optics.** Tap `1`–`7` — CRT, NVG, FLIR — and the whole live planet re-renders through a different sensor.


7. **Talk to it** _(needs an OpenAI key)_: _"Take me to LAX and select the nearest airborne aircraft."_
8. **Come home.** Hit **Reset Globe** — or just say _"zoom out to a globe view."_

**Keyboard:** `1`–`7` visual styles · `H` HUD · `D` detection · `C` cockpit · `` ` `` frame rate · `Esc` out. Trackpad pinch zooms the globe.

---

## 🛩️ The Cockpit

> Every plane should let you do this.

Real-time cockpit mode, built from live flight data: the camera rides your contact with real terrain holding underneath, all the way down — sensor styles come along for the ride, and **Contacts** keeps the 250 km roster one click away: jump plane to plane and fall straight into the next cockpit.


Pick **Tactical** as the HUD layout (Display → HUD → Layout) and the cockpit becomes a fighter-jet head-up display: a green pitch ladder that rolls with the view, horizon, waterline, flight-path marker, Mach, vertical speed and heading, with ground speed in km/h and altitude in metres. **Cyber** gives the red skin instead; any image style (Normal, CRT, NVG, FLIR) hands the interface back to the orange theme.

The cockpit even carries its own briefing strip: nearby live signals, regional headlines, and real local weather — with an opt-in **WX** mode that renders volumetric clouds from actual observations around your aircraft.


---

## 🎙️ Talk to It

> Voice needs an **OpenAI key**. Without one the entire app still runs — the mic button just reports voice is unavailable. The same key drives the **AI HUD summary**: a terse, five-word intelligence-style readout of the current view that regenerates as you move.

Click **PANOPTES MIC**, grant the microphone, and just talk. This is more than a voice-controlled remote:

- **🧠 It knows what it's looking at.** The agent pulls live scene context before answering — including coordinates, street names, active layers, and view scale. Ask _"what city is this?"_ mid-flight and it knows.
- **🎯 Entity Q&A.** Click any plane, ship, or datacenter and ask _"what's this?"_ It answers using the object's live telemetry.
- **👁️ Visual grounding.** At street level, it reads a viewport screenshot to identify legible signage and building names, and is instructed never to hallucinate labels.
- **🎬 Cinematic framing.** _"Show me the planes overhead"_ pulls the camera back, angles it, and frames the live traffic like a director.
- **🔒 Honest and secure.** The agent only confirms actions that succeeded. Your `OPENAI_API_KEY` never touches the browser; the client only gets a short-lived session token.

Twenty-nine tools, four jobs — the commands below come straight from the product's voice test suite and tool playbook:

**🎥 Direct it** — drone-operator camera verbs:

> 🗣️ _"Take me to Tokyo."_ · _"Orbit around this area slowly."_ · _"Draw the walking route from the Capitol to Zilker Park."_ → _"Fly the route we just drew."_ · _"Zoom out to a globe view."_

**🖊️ Annotate it** — a whiteboard over the real world:

> 🗣️ _"Outline the state of Texas."_ · _"Annotate the Texas State Capitol and its grounds"_ — it draws the **actual enclosing boundary**, not a circle. · _"How far is the Eiffel Tower from the Louvre?"_ — a connector arrow appears and it speaks the distance. Everything persists until you say _"clear the map."_

**✍️ Or draw it yourself** — DISPLAY ▸ **Draw**: pick Area, Line or Pin, click the vertices on the real world, double-click to finish, label it. Same whiteboard, same persistence, no microphone needed.



**🔎 Interrogate it** — analyst queries against the live layers:

> 🗣️ _"How many flights are over Texas right now?"_ · _"Which ships are headed to Oakland?"_ · _"What is the biggest fire near Los Angeles?"_ · _"Is anything flying above forty thousand feet?"_ · _"When does the ISS pass over next?"_ · _"How many datacenters are in view?"_

**🎛️ Operate it** — the whole console, hands-free:

> 🗣️ _"Switch to night vision and turn on the flights layer."_ · _"Turn on the camera viewsheds."_ · _"Play a news radio station near Austin."_ · _"Track that plane."_ → _"Enter Cockpit."_

**And the rapid-fire tier** — one sentence each:

> 🗣️ _"Show me global infrastructure."_ (stages the layers and pulls back to the globe) · _"Play Orbital Watch."_ (a full cinematic scene) · _"Set detection density to fifty percent."_ · _"Next contact — helicopters only."_ (mid-cockpit) · _"Show me space missions."_ · _"Switch to OSM."_ · _"Sharpen the image a touch."_ · _"Switch to the tactical layout."_ · _"What's turned on right now?"_


---

## 🛰️ What's on the Globe

Nineteen layers and map sources. **Seventeen have a keyless path.** Some offer additional capabilities with a provider key. (🟢 no key · 🟡 free key · 🔴 metered.)

| Layer                       | What you get                                                                                                                                                                                                                                                                                                                                                                                                       | Source                                  | Auth                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 🗺️ **Map Stack**            | Esri satellite imagery, Google Photorealistic 3D, OSM, plus additional ion-hosted stacks                                                                                                                                                                                                                                                                                                                           | Esri / Google / Ion / OSM               | 🟢 Esri satellite + OSM · 🟡 ion-hosted Google 3D + world terrain · 🔴 direct Google + place search |
| ✈️ **Live Flights**         | 11,000+ live aircraft + route history                                                                                                                                                                                                                                                                                                                                                                              | OpenSky + adsb.lol                      | 🟢 (🟡 optional for more polling credits)                                                           |
| 🎖️ **Military Flights**     | ADS-B military traffic in amber                                                                                                                                                                                                                                                                                                                                                                                    | adsb.lol                                | 🟢                                                                                                  |
| 🚢 **Live Vessels**         | Thousands of ships worldwide                                                                                                                                                                                                                                                                                                                                                                                       | AISStream                               | 🟡                                                                                                  |
| 🛰️ **Satellites**           | 838-object catalog, color-coded by class with a live legend — the **DENSE** chip drops in the whole Starlink shell                                                                                                                                                                                                                                                                                                 | CelesTrak                               | 🟢                                                                                                  |
| 🌍 **Earthquakes**          | Global seismic activity, last 24h                                                                                                                                                                                                                                                                                                                                                                                  | USGS                                    | 🟢                                                                                                  |
| 🚗 **Traffic**              | Simulated vehicles on OSM roads. With TomTom, live flow speeds drive the simulation and congestion colors below ~8 km; individual vehicle positions are not live observations                                                                                                                                                                                                                                      | TomTom + OSM                            | 🟢 simulation · 🟡 live flow speeds                                                                 |
| 📹 **CCTV Mesh**            | ~3,600 public cameras projected _into_ the 3D space — Austin · Texas (TxDOT) · California (Caltrans) · London (TfL) · Ontario (511) · Finland (Fintraffic) · British Columbia (DriveBC) · Estonia (Tallinn, Tarktee) · Delaware (DelDOT live video) · New South Wales (Live Traffic NSW) · Calgary. Positions are published; poses are estimated priors **you calibrate by dragging a gizmo on the camera itself** | City APIs                               | 🟢                                                                                                  |
| 📷 **Mapped ALPR Cameras**  | License-plate-reader camera locations tagged by OpenStreetMap contributors, loaded one city-sized view at a time, with **SHOW NEAREST**. Locations and tags only: no plate data, no video                                                                                                                                                                                                                          | OpenStreetMap (incl. DeFlock mapping)   | 🟢                                                                                                  |
| 📻 **Radio**                | Geolocated world radio with an **analog tuner** — drag the needle across up to 750 stations and the globe flies to each broadcaster                                                                                                                                                                                                                                                                                | Radio Browser / broadcasters            | 🟢                                                                                                  |
| 🚌 **Transit**              | Live buses, trams, metros, trains and ferries with delayed playback between reports, selected-vehicle trails, and mode-coloured DETECT labels — Boston, Austin, Minneapolis, Helsinki, the Netherlands, Norway, South East Queensland                                                                                                                                                                              | Operator GTFS-Realtime feeds            | 🟢                                                                                                  |
| 🚲 **Bikeshare**            | Live station availability                                                                                                                                                                                                                                                                                                                                                                                          | GBFS                                    | 🟢                                                                                                  |
| 🧭 **Directions**           | Click A and B on the globe for a street-following drive, walk or cycle route draped on the terrain with turn-by-turn steps — then FLY the camera along it. No key, no geocoder, no mic                                                                                                                                                                                                                             | OSRM on FOSSGIS servers (OpenStreetMap) | 🟢                                                                                                  |
| 🔥 **Active Fires**         | Live NASA FIRMS detections, trailing 24h                                                                                                                                                                                                                                                                                                                                                                           | NASA FIRMS                              | 🟡                                                                                                  |
| 🚀 **Space Missions**       | Rolling 30-day launches with payload, stage, and recovery detail                                                                                                                                                                                                                                                                                                                                                   | Launch Library 2                        | 🟢 (🟡 optional token raises the allowance)                                                         |
| 🎖️ **Mapped Installations** | Viewport-bounded military-site context from community mapping — incomplete by nature, and labeled that way                                                                                                                                                                                                                                                                                                         | OpenStreetMap                           | 🟢                                                                                                  |
| 🌬️ **Wind**                 | Animated 10 m forecast wind with an optional speed, temperature or pressure color field and a reading at map center                                                                                                                                                                                                                                                                                                | NOAA GFS / ECMWF IFS                    | 🟢                                                                                                  |
| 🌦️ **Observed Weather**     | Rain radar (contiguous US), Satellite clouds (GOES regional or global infrared, Clouds only or Full image) and Lightning density (Americas and Pacific) on one history timeline                                                                                                                                                                                                                                    | NOAA nowCOAST                           | 🟢                                                                                                  |
| 🌀 **Cyclones**             | Advisory positions, forecast tracks and uncertainty cones for the Atlantic and eastern/central North Pacific                                                                                                                                                                                                                                                                                                       | NOAA NHC / CPHC                         | 🟢                                                                                                  |

**Weather, keyless.** **Wind** animates 10 m forecast flow from NOAA GFS or ECMWF IFS, with an optional color field and a reading at map center. **Rain radar**, **Satellite clouds** and **Lightning density** are observations on one history timeline in the **WEATHER** panel (step back, **Play**, **Latest**); **Cyclone advisories** draw NHC and CPHC positions, forecast tracks and cones. On Google 3D Tiles the observed layers float above the city as translucent shells, sharpened around your view.

In the app, **Data Layers** groups them as Movement, Cameras, Infrastructure, Events, Weather and Utilities.

**The basemap ladder — what each tier buys you:**

| You have                   | The globe you get                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 Nothing                 | Esri World Imagery satellite basemap + keyless terrain, in 2D. OSM takes over automatically if Esri is unreachable; if terrain is unavailable the globe continues without it |
| 🟡 A free Cesium ion token | **Google Photorealistic 3D cities** and world terrain — eligible personal, non-commercial use; current ion terms and quotas apply                                            |
| 🔴 A Google Maps key       | The same 3D direct from Google, plus Google place search — the billing-enabled, metered route                                                                                |


**Also on the globe:** neighborhood overlays · an optional cockpit WX cloud effect. **Bundled static infrastructure:** Datacenters (4,351), Dams (704), and Submarine Cables (712).


**Missing a layer you want?** Open an issue — or add it and send the PR.

---

## 🎖️ Field Missions

Once the basics click, run these:

| Mission                             | How                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🚁 Ask the planet**               | _"Why are all these military helicopters flying in circles?"_ Select a military track — it silently backfills ~24 h of real trace history — and see what it's been doing, resolved as stacked 3D loops.   |
| **✈️ Final approach**               | Click-track an airliner lining up for a runway, hop into the **cockpit**, and ride it down.                                                                                                               |
| **🌃 Night watch**                  | Fly to your own city, switch to **NVG**, and let the detection mesh and HUD read the scene.                                                                                                               |
| **🚢 Port call**                    | Vessels on over the Port of Long Beach. Click a tanker for its tactical card and wake trail — then hit **NEAREST** in the CCTV panel and look at the same water through a public camera.                  |
| **📻 Tokyo FM**                     | Orbit Shibuya with the **Radio** layer on — then drag the analog tuner needle: every position snaps to a real station and the globe flies to whoever's broadcasting.                                      |
| **🔥 Fire line**                    | FIRMS over California. Click a detection — the camera dives to it — read the intensity, then hit **NEAREST** in the CCTV panel for a ground view.                                                         |
| **🚶 Ask for a walking route** _🎙️_ | Tell the world where you want to go and watch a real street-following route trace itself through the 3D city — then _"fly it"_: banked turns, eased ends, a camera that leads the path like a drone shot. |
| **📏 Measure LAX to DFW** _🎙️_      | _"How far is LAX from DFW?"_ — an arrow spans the country, the distance lands in the caption, and the endpoints stay pinned to the real world as you orbit.                                               |
| **🚀 Launch replay**                | Open **Space Missions**, pick a launch from the last 30 days, and ride the T-minus countdown through ascent to orbit — scrub it at 0.25×–4×. Labeled `RECONSTRUCTED ESTIMATE`, because it is one.         |
| **🪦 Walk the boneyard**            | Fly from regional context down into dense, fully resolved rows of retired aircraft.                                                                                                                       |
| **🏗️ Orbit Three Gorges**           | Sweep the dam and its terrain at a glance — then flip on the **Dams** layer and find 703 more.                                                                                                            |

_🎙️ = voice missions — they need an OpenAI key._




---

## 🔧 Under the Hood

How the globe handles live data:

- **World-stable icons.** Aircraft and ships point along their _true real-world heading_ at every camera angle — tracked or not, looking straight down or across the horizon — via per-frame screen-space course projection. No spinning, no viewport-locking.
- **Smooth motion from choppy data.** Live feeds arrive every 15–30s; the globe renders one interval behind real time and interpolates between known fixes. Dead reckoning fills the gaps.
- **Honest satellites.** SGP4 propagation with orbit rings that stay locked to their satellites via GMST realignment — no drift, no per-second flicker.
- **Sits on the real ground.** Entity heights are aligned to work with Google 3D tiles, so aircraft park on aprons and cameras stand on street corners instead of floating.
- **Caching and request budgets.** An OpenSky credit governor, a TomTom daily tile budget, and disk-cached TLEs reduce repeated requests. These controls do not replace provider quotas or billing controls.
- **Server-side credentials.** Every API that touches a private key (OpenAI, AISStream, OpenSky OAuth, camera frames) is brokered through a hardened server-side proxy with SSRF protection, response caps, and sanitized errors. The only keys the browser sees are Google Maps and Cesium ion (restrict both at the provider).
- **No framework.** Vanilla JavaScript, **CesiumJS**, and **Vite** — plus **Google Photorealistic 3D Tiles** for the planet and the **OpenAI Realtime API** for voice. Fast to read, fast to hack on.

```
src/
├── main.js                 # Bootstrap: Google 3D tiles, layer registration
├── ui.js                   # Runtime UI — panels, HUD, styles, control facade
├── hud.js                  # Intelligence HUD + AI scene summary
├── keySetup.js             # POWER UP panel — in-app provider keys (dev server only)
├── mapStackController.js   # Basemap switching — Google 3D / Esri / OSM / ion stacks
├── voice/                  # OpenAI Realtime session + 29 voice tools
├── layers/                 # Layer components — weather, wind, cyclones, transit, ALPR, …
├── data/                   # One module per layer + orchestration + context store
│   ├── iconOrientation.js  # Screen-projected headings + horizon cull
│   └── local_data/         # Bundled datasets (per-folder provenance)
└── scenes/                 # Cinematic scene director
```

See [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) for the authoritative runtime reference.

---

## 🔑 API Keys

🟢 **No key** · 🟡 **Free key** · 🔴 **Metered**

Use **POWER UP → Provider Settings** to add keys. The tables below explain what
each provider enables; none is required to start. See the
[setup instructions](#then-power-it-up--in-the-app-not-in-a-file) for storage
and configuration details.

> **3D buildings in the EEA (Spain, France, Germany…).** Google does not serve
> Photorealistic 3D Tiles or satellite tiles to accounts in the European
> Economic Area: the key is refused with _"satellite tiles and 3D tiles are not
> available for your account and region"_. PANOPTES detects that refusal, says
> so once, and switches on **3D Buildings (OSM)** instead: OpenStreetMap
> footprints extruded to their mapped heights, keyless. With a free
> **Cesium ion** token the same layer uses Cesium OSM Buildings, and ion's
> hosted Google 3D may also be available to you.

No key needed for Wind, Rain radar, Satellite clouds, Lightning density,
Cyclone advisories, Mapped ALPR Cameras, Transit, Directions, Delaware live
video, and coordinate or bundled-place search. A layer row waiting on a key
names it.

### Choose the capabilities you want

Six keys. Four have a free tier, and the two 🔴 ones are metered:

|     | Key             | Why                                                                                                                                                                                  | Get it                                                                                                                                                               |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡  | **Cesium ion**  | 🗺️ Google Photorealistic 3D, world terrain, and additional ion-hosted imagery stacks. The free Community plan is for eligible individual, personal/non-commercial use and has quotas | [cesium.com/ion](https://cesium.com/ion) — use a public `assets:read` token and check current [pricing/eligibility](https://cesium.com/platform/cesium-ion/pricing/) |
| 🔴  | **Google Maps** | Direct Google Photorealistic 3D + Google place search ([Map Tiles API](https://developers.google.com/maps/documentation/tile))                                                       | [Google Cloud Console](https://console.cloud.google.com/) — URL-restrict it                                                                                          |
| 🔴  | **OpenAI**      | 🎙️ The voice experience + AI HUD summary. The mini model works; the standard model is noticeably smarter. Want Gemini or another provider behind the mic? PRs welcome                | [platform.openai.com](https://platform.openai.com) — metered, see costs below                                                                                        |
| 🟡  | **AISStream**   | 🚢 Live global ships                                                                                                                                                                 | [aisstream.io](https://aisstream.io) — free signup                                                                                                                   |
| 🟡  | **NASA FIRMS**  | 🔥 Live active fires                                                                                                                                                                 | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) — free                                                                             |
| 🟡  | **TomTom**      | 🚦 Live flow speeds and congestion colors for the simulated traffic layer                                                                                                            | [developer.tomtom.com](https://developer.tomtom.com) — free tier available                                                                                           |


### Cherry on top

|     | Key                  | Why                                                           | Get it                                             |
| --- | -------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| 🟡  | **OpenSky**          | ✈️ More flight-polling credits (🟢 anonymous works without)   | [opensky-network.org](https://opensky-network.org) |
| 🟡  | **Launch Library 2** | 🚀 Higher space-missions request allowance (🟢 works without) | [thespacedevs.com](https://thespacedevs.com)       |

Add these if you need higher polling allowances.

`npm run doctor` reports Node/npm readiness, the primary provider routes, and
where each configured provider was found without printing credential values.
On macOS its Keychain-aware result previews `./scripts/dev-fresh.sh`; plain
`npm run dev` reads only explicit environment and Vite dotenv values. The
OpenSky summary reports keyless anonymous access for explicit `anon` or an
OAuth mode without a client pair, retains presence-only wording for a complete
OAuth pair, and identifies selected Basic or auto mode without guessing which
credentials runtime will accept. Basic and credentials-file modes remain
advanced `dev-fresh.sh` configuration.

<details>
<summary>Advanced setup: environment variables and macOS Keychain</summary>

For headless machines, coding agents, or scripted setups:

```bash
# Put keys in .env (see .env.example), or pass them as env vars:
OPENAI_API_KEY="…" AISSTREAM_API_KEY="…" npm run dev -- --host localhost --port 4173

# On macOS, store any of them in the Keychain and dev-fresh.sh pulls them in:
security add-generic-password -U -s "google-maps-api" -a "api-key" -w
security add-generic-password -U -s "openai-api"      -a "api-key" -w
security add-generic-password -U -s "aisstream-api"   -a "api-key" -w
security add-generic-password -U -s "firms-map"       -a "map-key" -w
security add-generic-password -U -s "cesium-ion"      -a "token"   -w
```

OpenSky can run fully anonymous (`OPENSKY_AUTH_MODE=anon`), or import OAuth credentials with `./scripts/opensky-import-client.sh /path/to/credentials.json`.

</details>

<details>
<summary>Live video cameras (HLS)</summary>

CCTV sources with `"feedType": "hls"` and a registered HTTP(S) `.m3u8`
URL play through a lazily loaded hls.js decoder shared by the monitor plane
and panel. DelDOT uses its official HTTPS HLS catalog links. Disable that
pack with `CCTV_DELDOT_ENABLED=0`.

The server allows two concurrent sessions. Each retains at most 12 segments
and 24 MiB in memory; individual downloads are capped at 4 MiB with a ten
second deadline. There are no segment files or ffmpeg processes. Redirects,
off-origin references, encrypted playlists and non-MPEG-TS segments are refused.
Each decoder has its own client lease (at most eight per session), including
native HLS. Closing it releases only that lease; abandoned leases expire after
15 seconds without access. The last release stops upstream work. Failed live video
uses the existing still/Street View/synthetic fallback, which is not live video.
RTMP-only sources are not supported by this integration.

</details>

### 🗝️ How to get the optional PANOPTES keys

Every key goes in **POWER UP** inside the app (or the repo-root `.env`). None
is required; each one unlocks a richer source.

| Key                                 | Unlocks                                                                                | How to get it                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CESIUM_ION_TOKEN`                  | Photorealistic Google 3D buildings through Cesium ion, world terrain, OSM 3D buildings | Free account at [ion.cesium.com](https://ion.cesium.com) → _Access Tokens_. **Use this in the EU/EEA:** Google no longer serves 3D or satellite tiles to Maps keys from EEA accounts, but the same 3D city loads through ion.                                                                      |
| `LL2_API_TOKEN`                     | Launch Library 2 without the 15 requests/hour limit                                    | Keys come from supporting [The Space Devs](https://thespacedevs.com/llapi) on Patreon or with a one-time donation. The keyless tier still works for normal use.                                                                                                                                    |
| `ACLED_USERNAME` + `ACLED_PASSWORD` | Curated conflict and protest events                                                    | Register once at [acleddata.com/user/register](https://acleddata.com/user/register) (an institutional email gets better access), then use those myACLED credentials; PANOPTES exchanges them for an OAuth token. See [ACLED's API guide](https://acleddata.com/api-documentation/getting-started). |
| `UCDP_ACCESS_TOKEN`                 | Researcher-coded conflict events with fatalities                                       | Request a token as described in the [UCDP API docs](https://ucdp.uu.se/apidocs/).                                                                                                                                                                                                                  |
| `CCTV_ONTARIO_API_KEY`              | Ontario 511 highway cameras                                                            | 511on.ca now rejects keyless requests; request a developer key on [511on.ca](https://511on.ca/developers/help/).                                                                                                                                                                                   |

Without UCDP or ACLED, Conflict Events runs on keyless GDELT, which is
machine-coded from news and not a verified incident record.

### 💸 What it actually costs

Honest numbers, roughly, as of mid-2026 — always check the provider pricing pages:

|                          | Cost reality                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🟢 Most layers**       | **$0, no signup.** OpenSky anon, USGS, CelesTrak, adsb.lol, city CCTV, Radio Browser, GBFS, Launch Library 2, transit feeds, OSRM routing, NOAA and ECMWF weather, OpenStreetMap ALPR mapping, bundled datasets.                                                                                                                                                            |
| **🟡 The free-key tier** | **$0 with a signup.** AISStream, FIRMS, TomTom, OpenSky, plus Cesium ion for eligible personal/non-commercial use. Provider quotas and eligibility still apply.                                                                                                                                                                                                             |
| **🗺️ Google 3D tiles**   | **Free through an eligible Cesium ion Community account within its quota; metered through a direct Google key.** Use the direct route for Google place search or commercial deployment, verify current provider terms, and set budget alerts where billing is enabled.                                                                                                      |
| **🔴 OpenAI voice**      | **The one that costs real money — so the app meters it for you.** Realtime audio runs a few cents per active minute; an evening of heavy use is single-digit dollars. A live session-spend readout sits next to the mic, with an STD/MINI model toggle, a $2 warning, and a **$5 hard cap that ends the session**. The voice context window is kept deliberately short too. |

Google's direct 3D route is surprisingly generous: the first 1,000 Photorealistic
3D Tiles sessions each month are currently free, and one root request supports
roughly three hours of rendering. A solo user exploring sparingly can
realistically stay inside the free usage cap. Billing must still be enabled, so
restrict the key and set a quota or budget alert. Check Google's
[current pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
before relying on these figures.

### 🧗 The floor is low on purpose

Everything above is the deliberately cheap baseline — enough to get a real taste of geospatial intelligence, GEOINT, and OSINT without ever talking to a sales team. You'll also notice the ceiling: terrestrial AIS goes quiet mid-ocean and satellite AIS costs real money; premium imagery, SAR, and the deeper commercial feeds live behind enterprise contracts. That's not a limit of the architecture — every layer here is a pattern you can point at your own data sources. This repo hands you the foundation; what you fuse into it is up to you.

### 🔒 Sharing an instance

By default nobody else can reach your server — it binds to localhost. To share on your LAN, opt in explicitly (`npm run dev -- --host 0.0.0.0 --port 4173`, or `HOST=0.0.0.0 ./scripts/dev-fresh.sh` on macOS/Linux) — but know that ⚠️ **a LAN-visible server brokers your configured API keys to anyone who can reach it.** Set the per-IP throttles (`GEV_RATELIMIT_OPENAI_PER_MIN`, `GEV_RATELIMIT_GOOGLE_PER_MIN` — see `.env.example`) and, before anything else, **configure provider quotas, usage limits, and billing alerts**: app-level throttles are not billing caps, and a budget alert alone does not stop spending. Full threat model in [SECURITY.md](SECURITY.md).

Provider Settings is disabled when the server is shared, so remote users cannot
access the key-entry panel.

**LAN and Cloudflare sharing stay disabled by default.** Use
a separately reviewed authentication proxy if remote access is required.
[SECURITY.md](SECURITY.md) explains the restrictions and threat model.

---

## 📋 Responsible and open

PANOPTES runs on **public data, clear sources and local-first execution.** No
secrets, no private datasets, no mystery scraping: anything that needs a
private key is brokered server-side on your own machine.

**The line.** This project models **events, assets, infrastructure and
systems**: aircraft, vessels, satellites, fires, cameras, sites, cities. It does
not build features for named-person search, face recognition or tracking
individuals, and pull requests that cross that line will not be merged. People
are not a query type here.

**Status.** An evolving open-source client for exploration and learning: a
fast, hackable foundation, not a hardened production service. Released under
the **[MIT License](LICENSE)**. Bundled and live datasets carry their own
terms, listed in **[DATA_SOURCES.md](DATA_SOURCES.md)**. Security model:
**[SECURITY.md](SECURITY.md)**. Contributions: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## 🪶 The name

The name comes from Argus Panoptes, the hundred-eyed giant of Greek myth who
kept watch without sleeping. This project is unaffiliated with any company or
product of a similar name.

> [!IMPORTANT]
> PANOPTES is an exploratory visualization of public and third-party data.
> Data may be delayed, incomplete, modeled, inferred or wrong. Do not use it
> for flight or maritime navigation, emergency response, medical or health
> decisions, investment decisions, or other safety-critical or operational
> purposes. Verify important information with authoritative sources.

---

<div align="center">

**PANOPTES. The eyes that see everything.**

</div>
