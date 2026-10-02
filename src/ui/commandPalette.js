import {
  buildCommandIndex,
  createRecentStore,
  nextGroupIndex,
  searchCommands,
  FLY_RANGE_M,
} from './commandPaletteModel.js';

/** Delay before an unanswered query is sent to the optional place search. */
const PLACE_SEARCH_DEBOUNCE_MS = 300;

const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};

/**
 * Centered command palette (Ctrl/Cmd+K): layers, places, sites, actions and
 * coordinates behind one input. The caller supplies providers and owns the
 * side effects; this module owns the overlay, keyboard model and rendering.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.root The `#command-palette` overlay element.
 * @param {object} options.providers
 * @param {() => object[]} options.providers.layers `{id, name, icon, enabled, group}` rows.
 * @param {(id: string, enabled: boolean) => (void|Promise<void>)} options.providers.toggleLayer
 * @param {() => (object[]|Promise<object[]>)} [options.providers.locations] `{id, name, lat, lon, kind, subtitle}` rows; may resolve later.
 * @param {(target: {lat: number, lon: number, rangeM: number, heading?: number, pitch?: number, label?: string}) => void} options.providers.flyTo
 * @param {() => object[]} [options.providers.actions] `{id, label, hint, run}` rows.
 * @param {(query: string, options: {signal: AbortSignal}) => Promise<object[]>} [options.providers.searchPlaces] Optional geocoder for misses.
 * @param {{list: Function, push: Function}} [options.providers.recent] Recents ledger; defaults to localStorage.
 * @param {Storage} [options.storage] Storage for the default recents ledger.
 * @returns {{open: Function, close: Function, toggle: Function, isOpen: Function, destroy: Function}|null}
 */
export function createCommandPalette({ document, root, providers = {} } = {}) {
  if (!document?.createElement || !root) return null;
  const dialog = root.querySelector('[role="dialog"]');
  const input = root.querySelector('input');
  const results = root.querySelector('[role="listbox"]');
  const empty = root.querySelector('[data-command-palette-empty]');
  const status = root.querySelector('[data-command-palette-status]');
  const enterHint = root.querySelector('[data-command-palette-enter-hint]');
  if (!dialog || !input || !results) return null;

  const storage = (() => {
    try {
      return document.defaultView?.localStorage || null;
    } catch {
      return null;
    }
  })();
  const recent = providers.recent || createRecentStore({ storage });

  let open = false;
  let destroyed = false;
  let activeIndex = 0;
  let current = { groups: [], flat: [], total: 0 };
  let locations = [];
  let locationsPromise = null;
  let remotePlaces = [];
  let remoteQuery = '';
  let remoteTimer = null;
  let remoteController = null;
  let remoteSequence = 0;
  let restoreFocus = null;
  const removers = [];

  const bind = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  };

  function resolveLocations() {
    if (locationsPromise || typeof providers.locations !== 'function') return;
    let value;
    try {
      value = providers.locations();
    } catch {
      value = [];
    }
    if (Array.isArray(value)) {
      locations = value;
      locationsPromise = Promise.resolve(value);
      return;
    }
    locationsPromise = Promise.resolve(value)
      .then((rows) => {
        locations = Array.isArray(rows) ? rows : [];
        if (open && !destroyed) render();
      })
      .catch(() => {
        locations = [];
      });
  }

  function snapshot() {
    const read = (fn) => {
      try {
        const value = typeof fn === 'function' ? fn() : [];
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    };
    return {
      layers: read(providers.layers),
      locations: [
        ...locations,
        ...remotePlaces.map((place, index) => ({
          id: `remote-${index}-${place.name}`,
          name: place.name,
          lat: place.lat,
          lon: place.lon ?? place.lng,
          kind: 'place',
          subtitle: place.subtitle || 'Place search',
          rangeM: FLY_RANGE_M.place,
        })),
      ],
      actions: read(providers.actions),
    };
  }

  function search() {
    const index = buildCommandIndex(snapshot());
    current = searchCommands(input.value, index, { recent: recent.list() });
    if (activeIndex >= current.total) activeIndex = 0;
    if (activeIndex < 0) activeIndex = 0;
  }

  function cancelRemote() {
    if (remoteTimer) {
      clearTimeout(remoteTimer);
      remoteTimer = null;
    }
    remoteController?.abort();
    remoteController = null;
  }

  function scheduleRemote() {
    const query = input.value.trim();
    if (
      typeof providers.searchPlaces !== 'function' ||
      query.length < 3 ||
      current.total > 0
    ) {
      if (query !== remoteQuery) {
        remotePlaces = [];
        remoteQuery = '';
      }
      cancelRemote();
      if (status) set(status, 'textContent', '');
      return;
    }
    if (query === remoteQuery) return;
    cancelRemote();
    remoteTimer = setTimeout(async () => {
      remoteTimer = null;
      const sequence = ++remoteSequence;
      const controller = new AbortController();
      remoteController = controller;
      if (status) set(status, 'textContent', 'Searching places…');
      try {
        const rows = await providers.searchPlaces(query, {
          signal: controller.signal,
        });
        if (
          destroyed ||
          sequence !== remoteSequence ||
          controller.signal.aborted
        )
          return;
        remotePlaces = (Array.isArray(rows) ? rows : []).filter(
          (row) =>
            Number.isFinite(Number(row?.lat)) &&
            Number.isFinite(Number(row?.lon ?? row?.lng)),
        );
        remoteQuery = query;
        if (status)
          set(
            status,
            'textContent',
            remotePlaces.length ? '' : 'No places found.',
          );
        if (open) render({ keepRemote: true });
      } catch {
        if (status && sequence === remoteSequence)
          set(status, 'textContent', 'Place search unavailable.');
      } finally {
        if (remoteController === controller) remoteController = null;
      }
    }, PLACE_SEARCH_DEBOUNCE_MS);
  }

  function itemHint(item) {
    return item?.hint || 'Enter to select';
  }

  function renderRows() {
    results.textContent = '';
    let index = 0;
    for (const group of current.groups) {
      const heading = document.createElement('div');
      heading.className = 'command-palette-group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = group.label;
      results.appendChild(heading);
      for (const item of group.items) {
        const row = document.createElement('div');
        row.className = `command-palette-row command-palette-row-${item.group}`;
        row.setAttribute('role', 'option');
        row.id = `command-palette-option-${index}`;
        row.dataset.index = String(index);
        row.setAttribute('aria-selected', String(index === activeIndex));
        if (index === activeIndex) row.classList.add('is-active');

        const icon = document.createElement('span');
        icon.className = 'command-palette-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = item.icon || '•';
        const text = document.createElement('span');
        text.className = 'command-palette-text';
        const title = document.createElement('span');
        title.className = 'command-palette-title';
        title.textContent = item.title;
        const subtitle = document.createElement('span');
        subtitle.className = 'command-palette-subtitle';
        subtitle.textContent = item.subtitle || '';
        text.appendChild(title);
        if (item.subtitle) text.appendChild(subtitle);
        const badge = document.createElement('span');
        badge.className = 'command-palette-badge';
        badge.textContent =
          item.kind === 'layer' && item.enabled ? 'ON' : item.kind;
        const hint = document.createElement('span');
        hint.className = 'command-palette-hint';
        hint.textContent = itemHint(item);

        row.append(icon, text, badge, hint);
        results.appendChild(row);
        index += 1;
      }
    }
  }

  function syncActive() {
    const rows = results.querySelectorAll('[role="option"]');
    rows.forEach((row) => {
      const active = Number(row.dataset.index) === activeIndex;
      row.classList.toggle('is-active', active);
      row.setAttribute('aria-selected', String(active));
      if (active) {
        input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView?.({ block: 'nearest' });
      }
    });
    if (enterHint)
      set(
        enterHint,
        'textContent',
        itemHint(current.flat[activeIndex]).replace(/^Enter to /, ''),
      );
  }

  function render({ keepRemote = false } = {}) {
    if (destroyed) return;
    search();
    if (!keepRemote) scheduleRemote();
    renderRows();
    if (empty) empty.hidden = current.total > 0;
    results.hidden = current.total === 0;
    syncActive();
  }

  async function run(item) {
    if (!item) return;
    recent.push(item.id);
    if (item.kind === 'layer') {
      try {
        await providers.toggleLayer?.(item.layerId, !item.enabled);
      } catch {
        /* the layer reports its own failure state */
      }
      if (open) render();
      return;
    }
    if (item.kind === 'action') {
      close();
      try {
        await item.run();
      } catch {
        /* actions own their error reporting */
      }
      return;
    }
    if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
      close();
      providers.flyTo?.({
        lat: item.lat,
        lon: item.lon,
        rangeM: item.rangeM || FLY_RANGE_M.place,
        heading: item.heading,
        pitch: item.pitch,
        label: item.title,
        kind: item.kind,
      });
    }
  }

  function move(delta) {
    if (!current.total) return;
    activeIndex = (activeIndex + delta + current.total) % current.total;
    syncActive();
  }

  const onKeyDown = (event) => {
    if (!open) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Home':
        event.preventDefault();
        activeIndex = 0;
        syncActive();
        return;
      case 'End':
        event.preventDefault();
        activeIndex = Math.max(0, current.total - 1);
        syncActive();
        return;
      case 'Tab': {
        // Tab cycles result groups; the dialog keeps focus on the input.
        event.preventDefault();
        const next = nextGroupIndex(
          current.groups,
          activeIndex,
          event.shiftKey ? -1 : 1,
        );
        if (next >= 0) {
          activeIndex = next;
          syncActive();
        }
        return;
      }
      case 'Enter':
        event.preventDefault();
        run(current.flat[activeIndex]);
        return;
      default:
    }
  };

  const onInput = () => {
    activeIndex = 0;
    render();
  };

  const onClick = (event) => {
    const row = event.target?.closest?.('[role="option"]');
    if (!row || !results.contains(row)) return;
    event.preventDefault();
    activeIndex = Number(row.dataset.index) || 0;
    run(current.flat[activeIndex]);
  };

  const onPointerMove = (event) => {
    const row = event.target?.closest?.('[role="option"]');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (Number.isFinite(index) && index !== activeIndex) {
      activeIndex = index;
      syncActive();
    }
  };

  const onBackdrop = (event) => {
    if (event.target?.closest?.('[data-command-palette-close]')) close();
  };

  // Focus never leaves the dialog while it is open.
  const onFocusIn = (event) => {
    if (!open) return;
    if (!dialog.contains(event.target)) input.focus();
  };

  function openPalette() {
    if (destroyed || open) return;
    open = true;
    restoreFocus = document.activeElement;
    root.hidden = false;
    root.classList.add('visible');
    resolveLocations();
    input.value = '';
    activeIndex = 0;
    remotePlaces = [];
    remoteQuery = '';
    render();
    input.focus();
    input.select?.();
  }

  function close() {
    if (!open) return;
    open = false;
    cancelRemote();
    root.classList.remove('visible');
    root.hidden = true;
    if (status) set(status, 'textContent', '');
    const target = restoreFocus;
    restoreFocus = null;
    if (target && typeof target.focus === 'function' && target !== input) {
      try {
        target.focus();
      } catch {
        /* the previous element may be gone */
      }
    }
  }

  bind(dialog, 'keydown', onKeyDown);
  bind(input, 'input', onInput);
  bind(results, 'click', onClick);
  bind(results, 'pointermove', onPointerMove);
  bind(root, 'click', onBackdrop);
  bind(document, 'focusin', onFocusIn);

  root.hidden = true;

  return {
    open: openPalette,
    close,
    toggle() {
      if (open) close();
      else openPalette();
    },
    isOpen: () => open,
    /** Re-run the search against fresh providers while open (layer toggles). */
    refresh() {
      if (open) render({ keepRemote: true });
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      for (const remove of removers.splice(0)) remove();
      results.textContent = '';
    },
  };
}

/**
 * Whether a keyboard event is the palette chord (Ctrl+K or Cmd+K).
 * Kept here so the shortcut binding and any dock button agree on the chord.
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isCommandPaletteChord(event) {
  if (!event || event.altKey) return false;
  const key = String(event.key || '').toLowerCase();
  return key === 'k' && (event.ctrlKey || event.metaKey);
}
