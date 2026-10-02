import { BRAND } from '../brand.js';

/** Storage key for the operator's explicit theme choice. */
export const THEME_STORAGE_KEY = `${BRAND.storagePrefix}theme`;
/** Themes the stylesheet defines (foundation.css). */
export const THEMES = Object.freeze(['dark', 'light']);
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const normalize = (value) => (THEMES.includes(value) ? value : null);

/**
 * Own the interface theme: read the stored choice, fall back to the system
 * preference, and write `data-theme` on the root element for the stylesheet.
 *
 * Storage is optional and every access is guarded: private windows and blocked
 * site data must never break the shell, only lose persistence.
 *
 * @param {object} [options]
 * @param {Document} [options.document] Document whose root carries the theme.
 * @param {Storage|null} [options.storage] Persistence; defaults to localStorage.
 * @param {Window|null} [options.windowRef] Source of `matchMedia`.
 * @returns {{
 *   get: () => 'dark'|'light',
 *   set: (theme: string, options?: {persist?: boolean}) => 'dark'|'light',
 *   toggle: () => 'dark'|'light',
 *   isExplicit: () => boolean,
 *   subscribe: (listener: (theme: 'dark'|'light') => void) => () => void,
 *   destroy: () => void,
 * }}
 */
export function createThemeController({
  document: documentRef = globalThis.document,
  storage = safeStorage(),
  windowRef = globalThis.window,
} = {}) {
  const listeners = new Set();
  let explicit = readStored(storage);
  let media = null;
  let onMediaChange = null;

  const systemTheme = () => {
    try {
      return windowRef?.matchMedia?.(LIGHT_QUERY)?.matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  };
  const current = () => explicit || systemTheme();
  const apply = () => {
    const theme = current();
    const root = documentRef?.documentElement;
    if (root && root.getAttribute('data-theme') !== theme)
      root.setAttribute('data-theme', theme);
    for (const listener of listeners) {
      try {
        listener(theme);
      } catch {
        /* one listener must not break the others */
      }
    }
    return theme;
  };

  try {
    media = windowRef?.matchMedia?.(LIGHT_QUERY) || null;
    if (media?.addEventListener) {
      onMediaChange = () => {
        if (!explicit) apply();
      };
      media.addEventListener('change', onMediaChange);
    }
  } catch {
    media = null;
  }
  apply();

  const controller = {
    get: current,
    isExplicit: () => Boolean(explicit),
    set(theme, { persist = true } = {}) {
      const next = normalize(theme);
      if (!next) return current();
      explicit = next;
      if (persist) writeStored(storage, next);
      return apply();
    },
    toggle() {
      return controller.set(current() === 'light' ? 'dark' : 'light');
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      if (media?.removeEventListener && onMediaChange)
        media.removeEventListener('change', onMediaChange);
      media = null;
      onMediaChange = null;
    },
  };
  return controller;
}

/**
 * Wire a DISPLAY-panel button to the controller. The button shows the ACTIVE
 * theme and its accessible name says what a press does.
 * @param {HTMLElement|null} button The `#theme-toggle` control.
 * @param {ReturnType<typeof createThemeController>} controller
 * @returns {() => void} Cleanup.
 */
export function bindThemeToggle(button, controller) {
  if (!button || !controller) return () => {};
  const render = (theme) => {
    const light = theme === 'light';
    button.textContent = light ? 'LIGHT' : 'DARK';
    button.setAttribute('aria-pressed', light ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      light
        ? 'Switch to the dark interface theme'
        : 'Switch to the light interface theme',
    );
    button.classList?.toggle?.('active', light);
  };
  const onClick = () => controller.toggle();
  button.addEventListener('click', onClick);
  const unsubscribe = controller.subscribe(render);
  render(controller.get());
  return () => {
    button.removeEventListener('click', onClick);
    unsubscribe();
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readStored(storage) {
  try {
    return normalize(storage?.getItem?.(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(storage, theme) {
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, theme);
  } catch {
    /* persistence is best-effort */
  }
}
