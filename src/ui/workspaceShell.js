import {
  CHROME_STORAGE_KEY,
  chromeVisible,
  normalizeChromeState,
  toggleChromeRegion,
  toggleFocus,
  DRAWER_ITEMS,
  INSPECTOR_ITEMS,
  exclusiveCollapseTargets,
  feedSummary,
  formatUtcClock,
  formatUtcDate,
  initialCollapseTargets,
  regionOf,
  toggleIntent,
} from './workspaceModel.js';
import { WORKSPACE_ATTRIBUTE, WORKSTATION } from './workspaceMode.js';

/**
 * @module workspaceShell
 * @description PANOPTES workstation chrome around the globe: a top app bar
 * (brand, search, actions, UTC clock), a left icon rail that docks one tool
 * panel at a time as a drawer, a tabbed right inspector (INTEL, ALERTS, CASE,
 * CONTEXT, WEATHER, IMAGERY) and a bottom status bar. It reuses the existing
 * panel elements — ids, disclosure buttons and persistence stay intact — and
 * only decides which one of each region is open. Placement is CSS
 * (src/ui/styles/workspace.css), keyed on `html[data-workspace]`.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** 20×20 stroke icons; kept inline so no icon-font subset is needed. */
const ICONS = Object.freeze({
  layers: 'M10 3 2.5 7 10 11l7.5-4L10 3Zm-7.5 7L10 14l7.5-4M2.5 13 10 17l7.5-4',
  display: 'M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3M6 8h3M6 10.5h6',
  scenes: 'M3 5h14v10H3zM3 8h14M7 5v3M11 5v3M15 5v3',
  camera: 'M3 7h9v7H3zM12 9.5 17 7v7l-5-2.5',
  draw: 'M4 16l1-4 8.5-8.5a2.1 2.1 0 0 1 3 3L8 15l-4 1Zm8-11 3 3M3 18.5h14',
  route:
    'M5 16.5a1.8 1.8 0 1 0 0-.01M15 3.5a1.8 1.8 0 1 0 0-.01M5 14.5V9a3 3 0 0 1 3-3h4.5M15 5.5V11a3 3 0 0 1-3 3H7.5',
  intel: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3v4l2.5 1.5',
  alerts: 'M10 3.5 2.5 16.5h15L10 3.5Zm0 5v3.5m0 2v.5',
  case: 'M4 3.5h9l3 3v10H4zM13 3.5v3h3M7 10h6M7 13h4',
  context: 'M10 10m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M10 10l4-2.5',
  weather:
    'M6.5 14.5h8a3 3 0 0 0-.4-6A4.5 4.5 0 0 0 5.6 9.2 2.7 2.7 0 0 0 6.5 14.5Z',
  imagery: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5',
  search: 'M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm3.6 8.6 4.4 4.4',
  up: 'M5 12.5 10 7.5l5 5',
  down: 'M5 7.5 10 12.5l5-5',
  left: 'M12.5 5 7.5 10l5 5',
  right: 'M7.5 5l5 5-5 5',
  focus: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4',
  hud: 'M3 7V4h3M17 7V4h-3M3 13v3h3M17 13v3h-3M7.5 10h5',
});

function icon(document, name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'ws-icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.layers);
  svg.appendChild(path);
  return svg;
}

function el(document, tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
}

/**
 * Mount the workstation chrome.
 * @param {object} options
 * @param {Document} options.document
 * @param {(id: string, collapsed: boolean) => void} options.setPanelCollapsed
 *   The shell's disclosure writer (persists and syncs share state).
 * @param {() => object[]} [options.getLayers] Layer manager rows for the status bar.
 * @param {() => void} [options.openPalette] Opens the command palette.
 * @param {() => void} [options.scheduleLayout] Ask the shell to re-measure.
 * @returns {{destroy: Function, open: Function, refresh: Function}}
 */
export function createWorkspaceShell({
  document,
  setPanelCollapsed,
  getLayers = () => [],
  openPalette = () => {},
  scheduleLayout = () => {},
}) {
  const view = document.defaultView || globalThis.window;
  const root = document.documentElement;
  root.dataset[WORKSPACE_ATTRIBUTE] = WORKSTATION;
  const removers = [];
  const listen = (target, type, handler, options) => {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  };
  const panel = (id) => document.getElementById(id);
  const isOpen = (id) => {
    const node = panel(id);
    return Boolean(
      node && !node.hidden && !node.classList.contains('collapsed'),
    );
  };
  const collapse = (id, collapsed) => {
    try {
      setPanelCollapsed(id, collapsed);
    } catch {
      panel(id)?.classList.toggle('collapsed', collapsed);
    }
  };

  // ── Top app bar ────────────────────────────────────────────────
  const topbar = el(document, 'header', 'ws-topbar', { id: 'ws-topbar' });
  const brandSlot = el(document, 'div', 'ws-topbar-brand', {
    'aria-hidden': 'true',
  });
  const search = el(document, 'button', 'ws-search', {
    type: 'button',
    id: 'ws-search',
    'aria-label': 'Search sites, layers, places and actions (Ctrl+K)',
  });
  search.appendChild(icon(document, 'search'));
  const searchText = el(document, 'span', 'ws-search-text');
  searchText.textContent = 'Search sites, layers, places, coordinates…';
  const searchKey = el(document, 'kbd', 'ws-search-kbd');
  searchKey.textContent = 'Ctrl K';
  search.append(searchText, searchKey);
  const actionsSlot = el(document, 'div', 'ws-topbar-actions', {
    'aria-hidden': 'true',
  });
  const clock = el(document, 'time', 'ws-clock', { id: 'ws-clock' });
  // Interface language (Spanish by default). The language module owns the
  // choice; the switch only requests it and mirrors the result.
  const langSwitch = el(document, 'div', 'ws-lang', {
    role: 'group',
    'aria-label': 'Language / Idioma',
    'data-i18n-skip': '',
  });
  const langButtons = ['es', 'en'].map((code) => {
    const button = el(document, 'button', 'ws-lang-btn', {
      type: 'button',
      'data-lang': code,
      title: code === 'es' ? 'Español' : 'English',
      'aria-pressed': 'false',
    });
    button.textContent = code.toUpperCase();
    listen(button, 'click', () =>
      view.dispatchEvent(
        new view.CustomEvent('panoptes:set-language', { detail: code }),
      ),
    );
    langSwitch.appendChild(button);
    return button;
  });
  const syncLanguage = () => {
    const current = view.__panoptesLanguage?.get?.() || 'es';
    for (const button of langButtons) {
      const on = button.dataset.lang === current;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  };
  syncLanguage();
  listen(view, 'panoptes:language-changed', syncLanguage);
  topbar.append(brandSlot, search, actionsSlot, langSwitch, clock);
  listen(search, 'click', () => openPalette());

  // ── Navigation: left rail (drawer) + inspector tabs ─────────────
  const nav = el(document, 'nav', 'ws-nav', {
    id: 'ws-nav',
    'aria-label': 'Workspace',
  });
  const rail = el(document, 'div', 'ws-rail', {
    id: 'ws-rail',
    role: 'toolbar',
    'aria-label': 'Tools',
    'aria-orientation': 'vertical',
  });
  const tabs = el(document, 'div', 'ws-tabs', {
    id: 'ws-inspector-tabs',
    role: 'tablist',
    'aria-label': 'Inspector',
  });
  nav.append(rail, tabs);
  const buttons = new Map();
  const badges = new Map();

  function addButton(item, container, region) {
    const button = el(document, 'button', `ws-nav-btn ws-nav-${region}`, {
      type: 'button',
      title: item.label,
      'aria-label': item.label,
      [`data-workspace-${region === 'drawer' ? 'rail' : 'tab'}`]: item.id,
    });
    if (region === 'inspector') {
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', item.id);
    }
    button.appendChild(icon(document, item.icon));
    const label = el(document, 'span', 'ws-nav-label');
    label.textContent = item.label;
    button.appendChild(label);
    if (item.badge) {
      const badge = el(document, 'span', 'ws-nav-badge', { hidden: '' });
      button.appendChild(badge);
      badges.set(item.id, badge);
    }
    listen(button, 'click', () => {
      const intent = toggleIntent(item.id, isOpen);
      const node = panel(item.id);
      if (node?.hidden && !intent.collapsed) return;
      collapse(item.id, intent.collapsed);
      sync();
    });
    container.appendChild(button);
    buttons.set(item.id, button);
  }
  for (const item of DRAWER_ITEMS) addButton(item, rail, 'drawer');
  for (const item of INSPECTOR_ITEMS) addButton(item, tabs, 'inspector');

  // ── Collapsible chrome ───────────────────────────────────────────
  // Every region (top bar, tool rail, inspector tabs, status bar, HUD) can be
  // hidden; a small handle stays on screen to bring it back. Focus mode (\)
  // hides them all at once without forgetting the per-region choice.
  let chrome = normalizeChromeState(null);
  try {
    chrome = normalizeChromeState(
      JSON.parse(view.localStorage?.getItem(CHROME_STORAGE_KEY) || 'null'),
    );
  } catch {
    /* storage unavailable or corrupt: start with everything visible */
  }
  const chromeButton = (name, label, onClick, className = '') => {
    const button = el(document, 'button', `ws-chrome-btn ${className}`.trim(), {
      type: 'button',
      title: label,
      'aria-label': label,
    });
    button.appendChild(icon(document, name));
    listen(button, 'click', onClick);
    return button;
  };
  function applyChrome() {
    for (const region of ['topbar', 'rail', 'tabs', 'statusbar', 'hud'])
      root.dataset[`ws${region[0].toUpperCase()}${region.slice(1)}`] =
        chromeVisible(chrome, region) ? 'shown' : 'hidden';
    root.dataset.wsFocus = chrome.focus ? 'on' : 'off';
    focusButton.setAttribute('aria-pressed', String(chrome.focus));
    hudButton.setAttribute('aria-pressed', String(!chrome.hidden.hud));
    try {
      view.localStorage?.setItem(CHROME_STORAGE_KEY, JSON.stringify(chrome));
    } catch {
      /* best effort */
    }
    scheduleLayout();
  }
  const toggleRegion = (region) => {
    chrome = toggleChromeRegion(chrome, region);
    // Hiding the rail or the tabs also closes the panel they own, so no
    // docked menu is left on screen without its control.
    const closing =
      region === 'rail' && !chromeVisible(chrome, 'rail')
        ? DRAWER_ITEMS
        : region === 'tabs' && !chromeVisible(chrome, 'tabs')
          ? INSPECTOR_ITEMS
          : [];
    for (const item of closing) if (isOpen(item.id)) collapse(item.id, true);
    applyChrome();
    sync();
  };
  const toggleFocusMode = () => {
    chrome = toggleFocus(chrome);
    applyChrome();
  };
  const focusButton = chromeButton(
    'focus',
    'Focus mode: hide all menus (\\)',
    toggleFocusMode,
    'ws-focus-btn',
  );
  topbar.insertBefore(focusButton, clock);

  // The globe actions and the key chip are positioned over the bar (they are
  // shared with the classic layout). Measure the right-hand cluster and the
  // actions so they sit to its left without overlap, and so the search field
  // gives up the space they need.
  const measureTopbar = () => {
    const bar = topbar.getBoundingClientRect();
    if (!bar.width) return;
    const rightCluster = Math.ceil(
      bar.right - langSwitch.getBoundingClientRect().left,
    );
    const actions = document.getElementById('top-center-actions');
    const chip = document.getElementById('key-setup-chip');
    const actionsWidth =
      actions && actions.getClientRects().length
        ? Math.ceil(actions.getBoundingClientRect().width)
        : 0;
    const chipWidth =
      chip && chip.getClientRects().length && chip.parentNode !== actions
        ? Math.ceil(chip.getBoundingClientRect().width)
        : 0;
    root.style.setProperty('--ws-topbar-right', `${rightCluster + 12}px`);
    root.style.setProperty('--ws-actions-w', `${actionsWidth}px`);
    root.style.setProperty(
      '--ws-actions-reserve',
      `${actionsWidth + (chipWidth ? chipWidth + 10 : 0) + 12}px`,
    );
  };
  let measureFrame = 0;
  const scheduleMeasure = () => {
    view.cancelAnimationFrame?.(measureFrame);
    measureFrame = view.requestAnimationFrame?.(measureTopbar) ?? 0;
  };
  if (view.ResizeObserver) {
    const topbarObserver = new view.ResizeObserver(scheduleMeasure);
    topbarObserver.observe(topbar);
    for (const id of ['top-center-actions', 'key-setup-chip']) {
      const node = document.getElementById(id);
      if (node) topbarObserver.observe(node);
    }
    removers.push(() => topbarObserver.disconnect());
  }
  listen(view, 'resize', scheduleMeasure);
  listen(view, 'panoptes:language-changed', scheduleMeasure);
  scheduleMeasure();
  topbar.appendChild(
    chromeButton('up', 'Hide top bar', () => toggleRegion('topbar')),
  );
  rail.appendChild(
    chromeButton(
      'left',
      'Hide tool rail',
      () => toggleRegion('rail'),
      'ws-rail-hide',
    ),
  );
  tabs.appendChild(
    chromeButton(
      'right',
      'Hide inspector tabs',
      () => toggleRegion('tabs'),
      'ws-tabs-hide',
    ),
  );
  const hudButton = chromeButton(
    'hud',
    'Show or hide the HUD readouts',
    () => toggleRegion('hud'),
    'ws-hud-btn',
  );
  // Restore handles, shown only while their region is hidden.
  const handles = el(document, 'div', 'ws-handles', { id: 'ws-handles' });
  const handle = (region, name, label) => {
    const button = chromeButton(
      name,
      label,
      () => toggleRegion(region),
      `ws-handle ws-handle-${region}`,
    );
    handles.appendChild(button);
  };
  handle('topbar', 'down', 'Show top bar');
  handle('rail', 'right', 'Show tool rail');
  handle('tabs', 'left', 'Show inspector tabs');
  handle('statusbar', 'up', 'Show status bar');
  handles.appendChild(
    (() => {
      const exit = chromeButton(
        'focus',
        'Exit focus mode (\\)',
        toggleFocusMode,
        'ws-handle ws-handle-focus',
      );
      const text = el(document, 'span', 'ws-handle-text');
      text.textContent = 'SHOW MENUS';
      exit.appendChild(text);
      return exit;
    })(),
  );
  listen(document, 'keydown', (event) => {
    if (event.key !== '\\' || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (
      event.target?.matches?.(
        'input, textarea, select, [contenteditable="true"]',
      )
    )
      return;
    event.preventDefault();
    toggleFocusMode();
  });

  // ── Bottom status bar ──────────────────────────────────────────
  const statusbar = el(document, 'footer', 'ws-statusbar', {
    id: 'ws-statusbar',
  });
  const feeds = el(document, 'span', 'ws-status-feeds', {
    role: 'status',
    'aria-live': 'polite',
  });
  const brandLine = el(document, 'span', 'ws-status-brand');
  brandLine.textContent = 'PANOPTES · OPEN-SOURCE INTELLIGENCE CONSOLE';
  statusbar.append(
    brandLine,
    feeds,
    hudButton,
    chromeButton('down', 'Hide status bar', () => toggleRegion('statusbar')),
  );

  document.body.append(topbar, nav, statusbar, handles);
  applyChrome();

  // ── State sync ────────────────────────────────────────────────
  function sync() {
    for (const [id, button] of buttons) {
      const node = panel(id);
      const open = isOpen(id);
      button.hidden = !node || node.hidden;
      button.classList.toggle('active', open);
      if (button.getAttribute('role') === 'tab')
        button.setAttribute('aria-selected', String(open));
      else button.setAttribute('aria-pressed', String(open));
    }
    for (const [id, badge] of badges) {
      const source = document.getElementById(
        INSPECTOR_ITEMS.find((item) => item.id === id)?.badge,
      );
      const text = String(source?.textContent || '').trim();
      badge.textContent = text;
      badge.hidden = !text || text === '0';
    }
    root.dataset.wsDrawer = DRAWER_ITEMS.some((item) => isOpen(item.id))
      ? 'open'
      : 'closed';
    root.dataset.wsInspector = INSPECTOR_ITEMS.some((item) => isOpen(item.id))
      ? 'open'
      : 'closed';
  }

  for (const id of initialCollapseTargets(isOpen)) collapse(id, true);

  const observer = new view.MutationObserver((records) => {
    const opened = new Set();
    for (const record of records) {
      const target = record.target;
      if (!regionOf(target.id)) continue;
      const wasOpen =
        record.attributeName === 'class'
          ? !String(record.oldValue || '')
              .split(/\s+/)
              .includes('collapsed')
          : record.oldValue === null;
      if (isOpen(target.id) && !wasOpen) opened.add(target.id);
    }
    for (const id of opened)
      for (const other of exclusiveCollapseTargets(id, isOpen))
        collapse(other, true);
    sync();
    if (opened.size) scheduleLayout();
  });
  for (const item of [...DRAWER_ITEMS, ...INSPECTOR_ITEMS]) {
    const node = panel(item.id);
    if (node)
      observer.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'hidden'],
        attributeOldValue: true,
      });
    const badgeSource = item.badge && document.getElementById(item.badge);
    if (badgeSource)
      observer.observe(badgeSource, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  }

  // First workstation launch: the inherited circular scope vignette is off
  // by default. Uses the real DISPLAY toggle, so the choice persists and a
  // shared link that carries its own scope state still wins.
  try {
    const storage = view.localStorage;
    const key = 'panoptes:workspace-defaults:v1';
    const sharedScope = /[#&]sc=/.test(String(view.location?.hash || ''));
    if (storage && !storage.getItem(key) && !sharedScope) {
      const scope = document.getElementById('scope-toggle');
      if (scope?.getAttribute('aria-pressed') === 'true') scope.click();
      storage.setItem(key, '1');
    }
  } catch {
    /* storage unavailable: keep the inherited default */
  }

  // A fresh selection brings the INTEL tab forward.
  const showIntel = () =>
    view.setTimeout(() => {
      if (panel('intel-panel') && !panel('intel-panel').hidden)
        collapse('intel-panel', false);
      sync();
    }, 80);
  listen(view, 'gev:awareness-subject-selected', showIntel);
  listen(view, 'gev:entity-selected', showIntel);

  // Clock + feed summary.
  const tick = () => {
    const now = new Date();
    clock.textContent = formatUtcClock(now);
    clock.dateTime = now.toISOString();
    clock.title = `${formatUtcDate(now)} UTC`;
    let rows = [];
    try {
      rows = getLayers() || [];
    } catch {
      rows = [];
    }
    const summary = feedSummary(rows);
    feeds.textContent = summary.text;
    feeds.dataset.tone = summary.tone;
  };
  tick();
  const timer = view.setInterval(tick, 1000);
  sync();

  return {
    toggleFocus: toggleFocusMode,
    toggleRegion,
    open(id) {
      collapse(id, false);
      sync();
    },
    refresh: sync,
    destroy() {
      view.clearInterval(timer);
      observer.disconnect();
      for (const remove of removers.splice(0)) remove();
      topbar.remove();
      nav.remove();
      statusbar.remove();
      handles.remove();
      for (const key of [
        'wsTopbar',
        'wsRail',
        'wsTabs',
        'wsStatusbar',
        'wsHud',
        'wsFocus',
      ])
        delete root.dataset[key];
      delete root.dataset[WORKSPACE_ATTRIBUTE];
      delete root.dataset.wsDrawer;
      delete root.dataset.wsInspector;
    },
  };
}
