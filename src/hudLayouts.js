import { applyCyberSonarThemePhase } from './cyberSonar.js';
import { syncRadioPanelPlacement } from './ui/radioPanelPlacement.js';
import { HUD_LAYOUTS } from './hudLayoutPolicy.js';
export { HUD_LAYOUTS } from './hudLayoutPolicy.js';

/** Canonical HUD layouts shared by the UI, voice schema and HUD renderer. */

export const DEFAULT_HUD_LAYOUT = 'tactical';

/** Visual treatment applied only when an operator explicitly enters Cyber. */
export const CYBER_VISUAL_DEFAULTS = Object.freeze({
  style: 'thermal',
  ironbow: 0.42,
});

const HUD_LAYOUT_SET = new Set(HUD_LAYOUTS);

/** @param {unknown} value */
export function isHudLayout(value) {
  return HUD_LAYOUT_SET.has(String(value ?? '').toLowerCase());
}

/** @param {unknown} value */
export function normalizeHudLayout(value) {
  const normalized = String(value ?? '').toLowerCase();
  return isHudLayout(normalized) ? normalized : DEFAULT_HUD_LAYOUT;
}

/**
 * Resolve the opt-in visual defaults for an explicit layout transition.
 * Restores and repeated Cyber selections return null so they never overwrite
 * a shared link or a user's subsequent FLIR tuning.
 */
export function cyberVisualDefaultsForHudTransition(
  previousLayout,
  nextLayout,
  { explicit = false } = {},
) {
  if (!explicit) return null;
  if (normalizeHudLayout(previousLayout) === 'cyber') return null;
  if (normalizeHudLayout(nextLayout) !== 'cyber') return null;
  return CYBER_VISUAL_DEFAULTS;
}

/**
 * Leaving the Cyber layout by hand gives back the image style it replaced:
 * Cyber switches the view to FLIR (ironbow), and without this the red
 * thermal look outlived the layout. A style the analyst picked while in
 * Cyber (anything but the Cyber default) is kept.
 * @returns {string|null} the style to restore, or null to leave it.
 */
export function styleAfterLeavingCyber(
  previousLayout,
  nextLayout,
  { explicit = false, currentStyle, styleBeforeCyber } = {},
) {
  if (!explicit) return null;
  if (normalizeHudLayout(previousLayout) !== 'cyber') return null;
  if (normalizeHudLayout(nextLayout) === 'cyber') return null;
  if (currentStyle !== CYBER_VISUAL_DEFAULTS.style) return null;
  const restore =
    styleBeforeCyber && styleBeforeCyber !== CYBER_VISUAL_DEFAULTS.style
      ? styleBeforeCyber
      : 'normal';
  return restore;
}

/**
 * Keep the global shell skin derived from the selected HUD layout. The data
 * attribute lives on <html> so theme tokens are available to every UI surface.
 * @param {HTMLElement|{dataset?: Record<string, string>}|null|undefined} root
 * @param {unknown} layout
 * @returns {'cyber'|null}
 */
export function applyHudUiTheme(root, layout) {
  if (!root?.dataset) return null;
  // The layout itself, for skins that are not global themes (the Tactical
  // cockpit's fighter HUD).
  root.dataset.hudLayout = normalizeHudLayout(layout);
  if (normalizeHudLayout(layout) === 'cyber') {
    root.dataset.uiTheme = 'cyber';
    applyCyberSonarThemePhase(root, true);
    syncRadioPanelPlacement(root.ownerDocument);
    return 'cyber';
  }
  delete root.dataset.uiTheme;
  applyCyberSonarThemePhase(root, false);
  syncRadioPanelPlacement(root.ownerDocument);
  return null;
}
