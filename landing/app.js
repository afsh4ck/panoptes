(function () {
  'use strict';
  var REPO = 'afsh4ck/panoptes';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = {
    get: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        /* private mode */
      }
    },
  };

  /* ── i18n: Spanish lives in the markup, English here ─────────── */
  var EN = {
    'nav.features': 'Features',
    'nav.showcase': 'In action',
    'nav.layers': 'Layers',
    'nav.gallery': 'Gallery',
    'nav.install': 'Install',
    'hero.pill': 'Open source · MIT · runs on your machine',
    'hero.title1': 'The eyes that',
    'hero.title2': 'see everything.',
    'hero.sub':
      'PANOPTES is an open-source intelligence console: flights, ships, satellites, public cameras, military bases, nuclear sites and critical infrastructure on one photorealistic 3D globe. No accounts, no third-party servers, no black boxes.',
    'hero.cta1': 'View on GitHub',
    'hero.cta2': 'Install in 2 minutes',
    'hero.eyes': '100 eyes, none asleep',
    'film.label': 'The film · 0:57 · 4K with sound',
    'stat.cams': 'public cameras',
    'stat.bases': 'military bases',
    'stat.flights': 'live flights',
    'stat.tests': 'automated tests',
    'term.eyebrow': 'boot',
    'term.title': 'Three commands and you are watching the planet.',
    'term.text':
      'It starts without keys: satellite imagery, terrain, flights, satellites, earthquakes and public cameras work from minute one. Keys are upgrades, not prerequisites, and you add them inside the app.',
    'term.c1': 'Local server on localhost: your keys never leave your machine',
    'term.c2': 'Node.js 24 or 26 · Windows, macOS and Linux',
    'term.c3': 'Bilingual Spanish / English interface',
    'feat.eyebrow': "what's inside",
    'feat.title': 'A complete analyst workstation.',
    'feat.text':
      'Every layer is an independent module with its source, its license and an honest freshness chip. Nothing made up: if a feed is down or stale, you will see it.',
    'f1.t': 'Live flights',
    'f1.p':
      'Thousands of aircraft on real telemetry. Search a callsign (AFR36KN) and follow it with its full route, ETA and a dedicated camera.',
    'f2.t': 'Fighter-jet cockpit HUD',
    'f2.p':
      'Ride inside the aircraft with a pitch ladder, horizon, flight-path marker, Mach and heading. In km/h and metres.',
    'f3.t': 'Satellites',
    'f3.p':
      '800+ objects with orbital elements, orbit ring and a full dossier: NORAD, COSPAR, apogee, perigee.',
    'f4.t': 'AIS vessels',
    'f4.p':
      '12,000 live ships with flag, destination, hazardous cargo, photo and a check against sanctions lists.',
    'f5.t': 'Strategic layers',
    'f5.p':
      'Military bases, nuclear sites, power plants, ports, airports, volcanoes and chokepoints, filterable by type.',
    'f6.t': '25,000 public cameras',
    'f6.p':
      'Official traffic and city cameras only, projected into the 3D city, with a live-video filter.',
    'f7.t': 'Route A → B',
    'f7.p':
      'Walk, drive or fly. Press Play and follow the trip live with steps, times and distances.',
    'f8.t': 'Draw zones',
    'f8.p':
      'Lines, areas and pins over the buildings, anchored to the real ground and saved in your browser.',
    'f9.t': 'Sensor optics',
    'f9.p':
      'NVG, thermal FLIR, CRT and a free UHD drone. The whole live planet re-rendered through another sensor.',
    'f10.t': 'Live events',
    'f10.p':
      'Conflicts, disasters, aviation emergencies, GPS interference, FIRMS fires and Safecast radiation.',
    'f11.t': 'Talk to the world',
    'f11.p':
      'With an OpenAI key, say "take me to Madrid airport and follow the nearest aircraft" and the agent does it.',
    'f12.t': 'Bilingual and accessible',
    'f12.p':
      'Spanish by default, English one click away. Custom tooltips, drop-downs and scrollbars, keyboard shortcuts everywhere.',
    'show.eyebrow': 'in action',
    'show.title': 'How every part works.',
    'show.text':
      'Real recordings of the app, no mock-ups. Hover to tilt the viewer.',
    's1.t': 'A photoreal globe that is yours',
    's1.p':
      'Google photorealistic tiles through Cesium, world terrain and three 3D detail levels with progressive loading: light tiles while you move, full detail once you stop, the centre always first.',
    's1.b1': 'Madrid as the start city, changeable from the bottom bar',
    's1.b2': 'Standard · High · Ultra HD at native pixel density',
    's1.b3': 'Works keyless with Esri satellite imagery and OSM',
    's2.t': 'Follow any flight by its callsign',
    's2.p':
      'Type the callsign in Ctrl+K and PANOPTES focuses that aircraft, hides the rest and draws the published route in two colours: flown in cyan, remaining in orange, with origin, destination and ETA.',
    's2.b1':
      'Dossier with registration, operator, type and a planespotters photo',
    's2.b2': 'Honest altitude on descent even when the feed goes quiet',
    's2.b3': 'Four cameras: follow, cockpit, top-down and orbit',
    's3.t': 'Climb into a fighter cockpit',
    's3.p':
      'With the Tactical layout the cockpit turns into a combat-jet HUD: green collimated symbology, a pitch ladder that rolls with the view, flight-path marker, Mach, vertical speed and heading.',
    's3.b1': 'Speed in km/h and altitude in metres',
    's3.b2': '250 km contact roster: jump from plane to plane',
    's3.b3': 'Buildings stream continuously even though the camera never stops',
    's4.t': 'Plan a route and follow it live',
    's4.p':
      'Mark a point A and a point B, choose walking, driving or flying and press Play. You get distance, duration, arrival time, every step with its time and the traveller moving over the map.',
    's4.b1': 'Road routes with OSRM; flights along a great circle',
    's4.b2':
      'Playback from ×1 to ×1000 and a camera that adapts to the distance',
    's4.b3': 'Turn-by-turn instructions in Spanish or English',
    's5.t': 'Strategic layers worldwide',
    's5.p':
      '20,000+ military bases, 1,200 nuclear facilities, power plants, ports, airports, volcanoes and maritime chokepoints, extracted from OpenStreetMap, Wikidata, WRI and NGA. Click any of them for its dossier.',
    's5.b1': 'Type filters: naval, air, army, missile, radar…',
    's5.b2': 'Mapped context, never claims about capability',
    's5.b3': 'Links to satellite view, Wikidata and news',
    's6.t': 'Draw zones that stay put',
    's6.p':
      'Orange lines, areas and pins, draped over the buildings and anchored to the real ground height. Your zones are saved in the browser; fly to them or delete them one by one.',
    's6.b1': 'Translucent fill over buildings',
    's6.b2': 'Several zones at once with their own list',
    's6.b3': 'Persistent across sessions',
    's7.t': 'Switch sensors in one click',
    's7.p':
      'Normal, night vision with vignette, thermal FLIR with the Ironbow palette, CRT with scanlines or a free UHD drone with WASD and the mouse. The whole live planet re-rendered with GLSL shaders.',
    's7.b1': 'Keys 1–7 switch optics',
    's7.b2': 'Detection overlay with identifiers',
    's7.b3': 'Optional Cyber theme, orange by default',
    's9.t': 'See the street through public cameras',
    's9.p':
      'More than 25,000 official traffic and city cameras, published by their operators. Pick one and PANOPTES projects its picture into the 3D city, with its field of view, while live traffic flows through the streets.',
    's9.b1': 'Live-video filter and search by city or street',
    's9.b2': 'Nearest camera to any point on the map',
    's9.b3': 'Only intentionally published cameras, never private ones',
    's8.t': 'Truly in your language',
    's8.p':
      'The whole interface, every tooltip and every dynamic readout switches between Spanish and English from the top bar, route instructions and cockpit texts included.',
    's8.b1': '2,600+ translated strings',
    's8.b2': 'Patterns for readouts with numbers and names',
    's8.b3': 'Spanish by default',
    'lay.eyebrow': 'layers',
    'lay.title': "What's on the globe.",
    'lay.text':
      'Every layer shows its source, its license and when it last updated.',
    lg1: 'Movement',
    lg2: 'Signals & events',
    lg3: 'Strategic',
    lg4: 'Cameras & weather',
    'gal.eyebrow': 'gallery',
    'gal.title': 'Real captures.',
    'gal.text': 'Click any image to see it full screen.',
    g1: 'Two-colour flight route',
    g2: 'Orbital dossier',
    g3: 'Ship in the port of Barcelona',
    g4: 'Military flight with photo',
    g5: 'Fighter HUD in the cockpit',
    g6: 'Camera projected in 3D',
    g7: '20,600 military bases',
    g8: 'Nuclear power plants',
    g9: 'City traffic in Madrid',
    g10: 'Aircraft dossier',
    g11: 'Ship off Bilbao',
    g12: 'Walking route through Madrid',
    g13: 'Loading screen',
    g14: 'Zones drawn over the Retiro park',
    'ins.eyebrow': 'install',
    'ins.title': 'Up and running in two minutes.',
    'ins.text':
      "You need Node.js 24.14+ or 26.x. Everything runs on your machine; keys are added later from the app's POWER UP panel.",
    st1: 'Clone the repository',
    st2: 'Install and check',
    st3: 'Start and open localhost:4173',
    't1.tag': 'No keys',
    't1.t': 'Satellite globe',
    't1.p':
      'Esri imagery, terrain, flights, satellites, earthquakes, cameras and radio. OSM if Esri does not answer.',
    't2.tag': 'Free Cesium ion token',
    't2.t': 'Photoreal 3D cities',
    't2.p':
      'Google photorealistic tiles and world terrain for personal, non-commercial use.',
    't3.tag': 'Google Maps key',
    't3.t': 'Direct 3D and search',
    't3.p':
      'The same 3D straight from Google, plus place search. A billed route: set limits.',
    'eth.t': 'The line is clear.',
    'eth.p':
      'PANOPTES models events, assets, infrastructure and systems: aircraft, ships, satellites, fires, cameras, sites and cities. It does not search for people, does no face recognition and does not track individuals. It only uses cameras intentionally published by their operators, never private or unsecured ones.',
    'faq.title': 'Frequently asked questions.',
    q1: 'Is it free?',
    a1: 'Yes. The code is MIT and it starts without any key. Some optional providers (Google Maps, OpenAI, TomTom) have their own plans and quotas.',
    q2: 'Where are my keys stored?',
    a2: 'In the local .env file of your clone, readable only by your user. The server listens on localhost and uses them to talk to the providers; they never leave your machine.',
    q3: 'Is the data real time?',
    a3: 'Most of it is (flights, ships, satellites, events). Strategic layers are precomputed datasets with an extraction date. Every layer shows its freshness and warns when a feed is down or stale.',
    q4: 'Do I need a powerful GPU?',
    a4: 'No. The Standard 3D detail level runs on modest laptops; Ultra HD makes use of strong GPUs and fast connections.',
    q5: 'Can I use it for navigation or emergencies?',
    a5: 'No. It is an exploratory visualization of public data: it can be delayed, incomplete or estimated. Always verify with authoritative sources.',
    q6: 'How do I contribute?',
    a6: 'Open an issue or a pull request on GitHub. Every layer is an independent module: adding a new source follows the same pattern.',
    'fin.t': 'Open the hundred eyes.',
    'fin.p':
      'Clone it, start it and see the planet like never before. If you like it, a star helps more people find it.',
    'fin.cta': 'Give it a star',
    'fin.cta2': 'Install',
    'foot.p': 'The eyes that see everything. · MIT License',
    'foot.by': 'Developed by',
  };
  var nodes = Array.prototype.slice.call(
    document.querySelectorAll('[data-i18n]'),
  );
  nodes.forEach(function (n) {
    n.dataset.es = n.textContent;
  });
  var TERM = {};
  /* Text without a data-i18n key (layer lists, viewer bars) and the
     alt / aria-label attributes translate by their Spanish text. */
  var TEXT_EN = {
    'Vuelos en directo': 'Live flights',
    'Vuelos militares': 'Military flights',
    Buques: 'Vessels',
    Satélites: 'Satellites',
    'Tráfico urbano': 'City traffic',
    'Transporte público': 'Public transit',
    Bicicletas: 'Bike share',
    'ADS-B local': 'Local ADS-B',
    'Emergencias aéreas': 'Aviation emergencies',
    'Interferencia GPS': 'GPS interference',
    Radiación: 'Radiation',
    Conflictos: 'Conflicts',
    Desastres: 'Disasters',
    Terremotos: 'Earthquakes',
    Incendios: 'Wildfires',
    Ciclones: 'Cyclones',
    'Bases militares': 'Military bases',
    'Instalaciones nucleares': 'Nuclear facilities',
    'Centrales eléctricas': 'Power plants',
    Puertos: 'Ports',
    Aeropuertos: 'Airports',
    Volcanes: 'Volcanoes',
    'Estrechos marítimos': 'Maritime chokepoints',
    'Datacenters · presas · cables': 'Datacenters · dams · cables',
    'Cámaras públicas': 'Public cameras',
    '25.000': '25,000',
    'Cámaras ALPR': 'ALPR cameras',
    'Imágenes recientes': 'Recent imagery',
    Viento: 'Wind',
    'Radar y nubes': 'Radar and clouds',
    Rayos: 'Lightning',
    'Lanzamientos espaciales': 'Space launches',
    'RUTA · SOL → RETIRO': 'ROUTE · SOL → RETIRO',
    'EUROPA · CAPAS': 'EUROPE · LAYERS',
    'DIBUJAR · ZONAS': 'DRAW · ZONES',
    'CÁMARAS · TALLIN': 'CAMERAS · TALLINN',
    Secciones: 'Sections',
    Idioma: 'Language',
    'Estrellas en GitHub': 'GitHub stars',
    Menú: 'Menu',
    Bajar: 'Scroll down',
    'Fuentes de datos': 'Data sources',
    'Órbita sobre Madrid en 3D fotorrealista':
      'Orbit over Madrid in photoreal 3D',
    'Seguimiento de un vuelo en directo con su ruta':
      'Following a live flight and its route',
    'HUD de caza en la vista de cabina': 'Fighter HUD in the cockpit view',
    'Planificador de rutas reproduciendo un trayecto a pie':
      'Route planner playing a walking trip',
    'Capas estratégicas sobre Europa': 'Strategic layers over Europe',
    'Zonas dibujadas sobre Madrid': 'Zones drawn over Madrid',
    'Cambio de estilos visuales': 'Switching visual styles',
    'Cambio de idioma español / inglés':
      'Switching between Spanish and English',
    'Cámaras públicas proyectadas en la ciudad 3D':
      'Public cameras projected into the 3D city',
    'Ruta de vuelo París – Málaga': 'Paris – Málaga flight route',
    'Satélite GLONASS': 'GLONASS satellite',
    'Buque MSC Gemma': 'MSC Gemma vessel',
    'Vuelo militar': 'Military flight',
    'HUD de caza': 'Fighter HUD',
    'Cámara pública en Tallin': 'Public camera in Tallinn',
    'Bases militares en Europa': 'Military bases in Europe',
    'Centrales nucleares': 'Nuclear power plants',
    'Tráfico en Madrid': 'Traffic in Madrid',
    'Dossier de aeronave': 'Aircraft dossier',
    'Buque frente a Bilbao': 'Ship off Bilbao',
    'Planificador de rutas': 'Route planner',
    'Zonas dibujadas sobre el Retiro': 'Zones drawn over the Retiro park',
    'Pantalla de carga': 'Loading screen',
    Copiar: 'Copy',
    Licencia: 'License',
    Cerrar: 'Close',
    'Ver la película de PANOPTES con sonido': 'Watch the PANOPTES film with sound',
    'Película de PANOPTES': 'PANOPTES film',
  };
  var textNodes = [];
  (function collect() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      if (n.parentElement.closest('[data-i18n]')) continue;
      var key = n.textContent.trim();
      if (TEXT_EN[key])
        textNodes.push({ node: n, es: n.textContent, key: key });
    }
  })();
  var attrNodes = [];
  document.querySelectorAll('[alt], [aria-label]').forEach(function (el) {
    ['alt', 'aria-label'].forEach(function (name) {
      var value = el.getAttribute(name);
      if (value && TEXT_EN[value])
        attrNodes.push({ el: el, name: name, es: value });
    });
  });

  function setLang(lang) {
    document.documentElement.lang = lang;
    nodes.forEach(function (n) {
      var key = n.getAttribute('data-i18n');
      n.textContent = lang === 'en' && EN[key] ? EN[key] : n.dataset.es;
    });
    textNodes.forEach(function (t) {
      t.node.textContent =
        lang === 'en' ? t.es.replace(t.key, TEXT_EN[t.key]) : t.es;
    });
    attrNodes.forEach(function (a) {
      a.el.setAttribute(a.name, lang === 'en' ? TEXT_EN[a.es] : a.es);
    });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lang === lang);
    });
    store.set('panoptes-landing-lang', lang);
    if (TERM.restart) TERM.restart();
  }
  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      setLang(b.dataset.lang);
    });
  });
  var savedLang = store.get('panoptes-landing-lang');
  if (savedLang === 'en') setLang('en');

  /* ── Live GitHub stars ───────────────────────────────────────── */
  function paintStars(n) {
    var text =
      n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
    document.querySelectorAll('[data-stars]').forEach(function (s) {
      var from = 0;
      var t0 = performance.now();
      (function tick(now) {
        var k = Math.min(1, (now - t0) / 900);
        var v = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
        s.textContent = k < 1 ? String(v) : text;
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }
  function loadStars() {
    var cached = null;
    try {
      cached = JSON.parse(sessionStorage.getItem('panoptes-stars') || 'null');
    } catch (e) {
      /* ignore */
    }
    if (cached && Date.now() - cached.at < 5 * 60 * 1000)
      return paintStars(cached.n);
    fetch('https://api.github.com/repos/' + REPO, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (d) {
        var n = Number(d.stargazers_count) || 0;
        try {
          sessionStorage.setItem(
            'panoptes-stars',
            JSON.stringify({ n: n, at: Date.now() }),
          );
        } catch (e) {
          /* ignore */
        }
        paintStars(n);
      })
      .catch(function () {
        if (cached) paintStars(cached.n);
      });
  }
  loadStars();
  // Live: refresh every five minutes while the page is open.
  setInterval(
    function () {
      try {
        sessionStorage.removeItem('panoptes-stars');
      } catch (e) {
        /* ignore */
      }
      if (!document.hidden) loadStars();
    },
    5 * 60 * 1000,
  );

  /* ── Reveal, progress bar and spotlight ──────────────────────── */
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );
  document.querySelectorAll('.rv').forEach(function (n) {
    var siblings = n.parentElement
      ? Array.prototype.indexOf.call(n.parentElement.children, n)
      : 0;
    if (n.closest('.cards, .gallery, .layer-groups, .steps, .tiers, .faq'))
      n.style.setProperty('--d', Math.min(siblings, 8) * 0.06 + 's');
    io.observe(n);
  });
  var bar = document.querySelector('.progress');
  function onScroll() {
    var max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  var spot = document.querySelector('.spot');
  if (!reduced) {
    addEventListener(
      'pointermove',
      function (e) {
        spot.style.opacity = 1;
        spot.style.transform =
          'translate(' + (e.clientX - 380) + 'px,' + (e.clientY - 380) + 'px)';
      },
      { passive: true },
    );
  }

  /* ── Counters ────────────────────────────────────────────────── */
  var fmt = new Intl.NumberFormat('es-ES');
  var counterIo = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        counterIo.unobserve(e.target);
        var el = e.target;
        var target = Number(el.dataset.count);
        var suffix = el.dataset.suffix || '';
        var t0 = performance.now();
        var dur = reduced ? 1 : 1600;
        (function tick(now) {
          var k = Math.min(1, (now - t0) / dur);
          el.textContent =
            fmt.format(Math.round(target * (1 - Math.pow(1 - k, 4)))) +
            (k >= 1 ? suffix : '');
          if (k < 1) requestAnimationFrame(tick);
        })(t0);
      });
    },
    { threshold: 0.5 },
  );
  document.querySelectorAll('[data-count]').forEach(function (n) {
    counterIo.observe(n);
  });

  /* ── Terminal typing ─────────────────────────────────────────── */
  var out = document.querySelector('[data-term-out]');
  var script = function () {
    var es = document.documentElement.lang !== 'en';
    return [
      ['cmd', 'git clone https://github.com/afsh4ck/panoptes.git'],
      ['dim', "Cloning into 'panoptes'... done."],
      ['cmd', 'cd panoptes && npm ci'],
      ['dim', 'added 412 packages in 18s'],
      ['cmd', 'npm run doctor'],
      ['ok', '✔ Node.js 24.14.0'],
      [
        'ok',
        es
          ? '✔ Arranque sin claves: Esri + terreno + OSM'
          : '✔ Keyless start: Esri + terrain + OSM',
      ],
      [
        'dim',
        es
          ? '· Opcional: Cesium ion, Google Maps, OpenAI'
          : '· Optional: Cesium ion, Google Maps, OpenAI',
      ],
      ['cmd', 'npm run dev'],
      ['cy', '  VITE ready in 1.9 s'],
      ['cy', '  ➜  Local:   http://localhost:4173/'],
      [
        'ok',
        es
          ? '◉ PANOPTES · todas las señales, un solo globo'
          : '◉ PANOPTES · every signal, one globe',
      ],
    ];
  };
  var termTimer = null;
  function runTerminal() {
    clearTimeout(termTimer);
    out.innerHTML = '';
    var lines = script();
    var li = 0;
    var ci = 0;
    var current = null;
    (function step() {
      if (li >= lines.length) {
        termTimer = setTimeout(runTerminal, 6000);
        return;
      }
      var kind = lines[li][0];
      var text = lines[li][1];
      if (!current) {
        current = document.createElement('span');
        if (kind === 'cmd') {
          var prompt = document.createElement('span');
          prompt.className = 'p';
          prompt.textContent = '❯ ';
          out.appendChild(prompt);
        } else current.className = kind;
        out.appendChild(current);
      }
      if (kind === 'cmd' && !reduced && ci < text.length) {
        current.textContent += text[ci++];
        termTimer = setTimeout(step, 28 + Math.random() * 40);
        return;
      }
      if (kind !== 'cmd') current.textContent = text;
      out.appendChild(document.createTextNode('\n'));
      li++;
      ci = 0;
      current = null;
      termTimer = setTimeout(step, kind === 'cmd' ? 380 : 140);
    })();
  }
  var termEl = document.querySelector('[data-terminal]');
  var termIo = new IntersectionObserver(
    function (entries) {
      if (entries[0].isIntersecting) {
        termIo.disconnect();
        runTerminal();
      }
    },
    { threshold: 0.3 },
  );
  termIo.observe(termEl);
  TERM.restart = function () {
    if (out.textContent) runTerminal();
  };

  /* ── Tilt viewers, glow cards ────────────────────────────────── */
  if (!reduced && matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('[data-tilt]').forEach(function (v) {
      v.addEventListener('pointermove', function (e) {
        var r = v.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        v.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg');
        v.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg');
      });
      v.addEventListener('pointerleave', function () {
        v.style.setProperty('--ry', '0deg');
        v.style.setProperty('--rx', '0deg');
      });
    });
    document.querySelectorAll('.card').forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', e.clientX - r.left + 'px');
        c.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
  }

  /* ── GIF fallback to a still capture ─────────────────────────── */
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    img.addEventListener('error', function () {
      if (img.dataset.failed) return;
      img.dataset.failed = '1';
      img.src = img.dataset.fallback;
    });
  });

  /* ── Lightbox ────────────────────────────────────────────────── */
  var box = document.querySelector('.lightbox');
  var boxImg = box.querySelector('img');
  function closeBox() {
    box.hidden = true;
    boxImg.src = '';
  }
  document.querySelectorAll('.shot').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      boxImg.src = a.getAttribute('href');
      boxImg.alt = a.querySelector('img').alt;
      box.hidden = false;
    });
  });
  box.addEventListener('click', function (e) {
    if (e.target !== boxImg) closeBox();
  });
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeBox();
  });

  /* ── Film: poster below the hero, plays with sound in a popup ── */
  var film = document.querySelector('.film-modal');
  var filmTrigger = document.querySelector('[data-film]');
  if (film && filmTrigger) {
    var filmVideo = film.querySelector('video');
    var filmClose = film.querySelector('.film-close');
    /* Phones held upright get the 9:16 cut of the film. */
    var portraitQuery = window.matchMedia(
      '(max-width: 768px) and (orientation: portrait)',
    );
    var openFilm = function () {
      var cut = portraitQuery.matches ? 'portrait' : 'landscape';
      if (filmVideo.dataset.cut !== cut) {
        filmVideo.dataset.cut = cut;
        filmVideo.poster = filmVideo.dataset[cut + 'Poster'];
        filmVideo.src = filmVideo.dataset[cut];
      }
      film.classList.toggle('portrait', cut === 'portrait');
      film.hidden = false;
      document.documentElement.classList.add('film-open');
      filmVideo.muted = false;
      filmVideo.currentTime = 0;
      var playing = filmVideo.play();
      if (playing && playing.catch) playing.catch(function () {});
      filmClose.focus();
    };
    var closeFilm = function () {
      if (film.hidden) return;
      filmVideo.pause();
      film.hidden = true;
      document.documentElement.classList.remove('film-open');
      filmTrigger.focus();
    };
    filmTrigger.addEventListener('click', openFilm);
    filmClose.addEventListener('click', closeFilm);
    film.addEventListener('click', function (e) {
      if (e.target === film) closeFilm();
    });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeFilm();
    });
  }

  /* ── Copy buttons ────────────────────────────────────────────── */
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.parentElement.querySelector('code').textContent;
      var done = function () {
        b.classList.add('done');
        b.innerHTML = '<i class="ph ph-check"></i>';
        setTimeout(function () {
          b.classList.remove('done');
          b.innerHTML = '<i class="ph ph-copy"></i>';
        }, 1600);
      };
      if (navigator.clipboard)
        navigator.clipboard.writeText(text).then(done, done);
      else done();
    });
  });

  /* ── Mobile menu ─────────────────────────────────────────────── */
  var burger = document.querySelector('.burger');
  var panel = document.querySelector('.mobile-panel');
  burger.addEventListener('click', function () {
    var open = panel.hidden;
    panel.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
  });
  panel.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      panel.hidden = true;
      burger.setAttribute('aria-expanded', 'false');
    });
  });
})();
