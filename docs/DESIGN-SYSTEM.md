# PANOPTES design system

PANOPTES is an analyst workstation, not a science-fiction cockpit. The
interface should read like a well-made instrument: quiet surfaces, one warm
accent, dense but legible data, and nothing that glows for decoration.

The tokens below live in `src/ui/styles/foundation.css`. Every component
stylesheet reads them; none redefines them. The product name and tagline live
in `src/brand.js`.

## Tokens

| Token                  | Dark                        | Light                       | Role                                         |
| ---------------------- | --------------------------- | --------------------------- | -------------------------------------------- |
| `--bg-dark`            | `#0b0d10`                   | `#f4f5f7`                   | Page background behind the globe             |
| `--surface`            | `#12151a`                   | `#ffffff`                   | Opaque panel surface                         |
| `--surface-2`          | `#171b21`                   | `#eef0f3`                   | Raised rows, inputs                          |
| `--glass-bg`           | `rgba(18, 21, 26, 0.92)`    | `rgba(255, 255, 255, 0.94)` | Floating panel fill                          |
| `--glass-border`       | `rgba(255, 255, 255, 0.09)` | `rgba(27, 31, 36, 0.12)`    | Panel and control borders                    |
| `--glass-border-hover` | `rgba(255, 255, 255, 0.2)`  | `rgba(27, 31, 36, 0.3)`     | Hover and focus border                       |
| `--accent`             | `#f5a524`                   | `#b45309`                   | Brand and interactive accent                 |
| `--accent-rgb`         | `245, 165, 36`              | `180, 83, 9`                | Alpha variants: `rgba(var(--accent-rgb), a)` |
| `--accent-2`           | `#2dd4bf`                   | `#0f766e`                   | Live, nominal, ok                            |
| `--alert`              | `#ff4d4f`                   | `#dc2626`                   | Alerts, errors, destructive actions          |
| `--accent-dim`         | accent at 0.14              | accent at 0.12              | Selected fills, subtle highlights            |
| `--accent-glow`        | accent at 0.35              | accent at 0.25              | The only permitted glow strength             |
| `--text-primary`       | `#e9ecef`                   | `#1b1f24`                   | Body text                                    |
| `--text-secondary`     | primary at 0.58             | primary at 0.66             | Supporting text                              |
| `--text-dim`           | primary at 0.36             | primary at 0.45             | Labels, hints                                |
| `--panel-radius`       | `8px`                       |                             | Panels and cards                             |
| `--btn-radius`         | `4px`                       |                             | Buttons, chips, inputs                       |
| `--label-tracking`     | `1.4px`                     |                             | Uppercase mono labels                        |

## Typography

- `--font-sans`: IBM Plex Sans 300 to 600. Prose, descriptions, long labels.
- `--font-mono`: IBM Plex Mono 300 to 700. Every number, identifier, readout,
  panel title and chip. Use `font-variant-numeric: tabular-nums` on columns of
  numbers.
- Labels are uppercase mono at 9 to 11 px with `--label-tracking`. Body copy
  is sans at 12 to 13 px. Panel headings never exceed 11 px.
- JetBrains Mono stays loaded because canvas-drawn overlays name it directly;
  new code should reference `var(--font-mono)`.

## Color roles

- One accent. Amber marks the brand, selection, active controls and primary
  actions. It is never used for status.
- Teal (`--accent-2`) means live, nominal or connected. Red (`--alert`) means
  alert, error or destructive. Amber never carries either meaning.
- Data layers keep their own colors (aircraft classes, depth ramps, weather
  fields). Those are set in JavaScript next to the layer and are not theme
  tokens.
- Surfaces are neutral graphite. Tinted panel backgrounds are not allowed.

## Components

- Panels: `--glass-bg` fill, 1 px `--glass-border`, `--panel-radius`, a
  soft drop shadow only (`0 8px 32px rgba(0, 0, 0, 0.5)`). No inner glow, no
  scanlines, no gradient borders.
- Buttons and chips: `--btn-radius`, transparent fill, `--glass-border`.
  Hover brightens the border to `--glass-border-hover`. Active or selected
  states use `--accent-dim` fill with an accent border.
- Focus: the global `:focus-visible` ring in foundation.css is 2 px
  `--text-primary`. Never remove it locally.
- Glow: decorative `text-shadow`, `box-shadow` and `drop-shadow` using the
  accent are capped at 0.18 alpha. Prefer no glow.
- Motion: 150 ms for state changes, 300 ms for layout. Respect
  `prefers-reduced-motion`.

## Theming

`src/ui/theme.js` owns the theme. It writes `data-theme="dark|light"` on
`<html>`, persists an explicit choice under `panoptes:theme`, and follows
`prefers-color-scheme` when no choice is stored. The DISPLAY panel exposes the
toggle (`#theme-toggle`). Component rules must read tokens, never literal
colors, so that both themes stay correct without per-component overrides.

## Do and do not

- Do write `rgba(var(--accent-rgb), 0.2)` for accent tints.
- Do keep labels short, uppercase and mono. Put units in the value, not the label.
- Do prefer a border change to a glow for hover.
- Do not introduce new hues for interface chrome.
- Do not use cyan, blue or purple accents anywhere in the shell.
- Do not add scanlines, CRT curvature or animated gradients to chrome. Visual
  presets that emulate sensors (CRT, NVG, FLIR) apply to the globe, not the UI.
- Do not exceed three text sizes inside one panel.

## Brand

- Name: PANOPTES. Wordmark: `PANOP` in `--text-primary`, `TES` in `--accent`,
  IBM Plex Mono 600, 6 px tracking.
- Tagline: EVERY SIGNAL. ONE GLOBE.
- Mark: `public/logo.svg`, a central amber eye inside a ring of smaller
  watching eyes (the hundred eyes of Argus). The iris follows the pointer through `src/logoGaze.js` (`#globe` and
  `#globe_cage` groups). `public/favicon.svg` is the simplified mark on a
  rounded graphite tile.
- The name comes from Argus Panoptes, the hundred-eyed watchman of Greek
  myth. The project is an independent open-source fork and is unaffiliated
  with any company.

## Workstation layout

PANOPTES runs as an analyst workstation, not a floating-panel cockpit. The
layout lives in `src/ui/workspaceShell.js` (chrome + region state),
`src/ui/workspaceModel.js` (pure rules, tested) and
`src/ui/styles/workspace.css`. It is keyed on `html[data-workspace="workstation"]`
and stands down in Cockpit mode.

| Region     | Size                    | Contents                                                                                                                 |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Top bar    | 48 px, full width       | Logo + wordmark · search field (opens the Ctrl+K palette) · POWER UP · globe actions · UTC clock                         |
| Tool rail  | 60 px, left             | Layers · Display · Scenes · Cameras. Opens one drawer at a time                                                          |
| Drawer     | 344 px, beside the rail | The open tool panel, full height, scrolls inside                                                                         |
| Inspector  | 380 px, right           | Tab strip (Intel · Alerts · Case · Context · Weather · Imagery), one tab at a time. A new selection brings Intel forward |
| Status bar | 34 px, full width       | Product line · command dock segments (Location · voice · Visual presets) · feed summary                                  |
| Viewport   | the rest                | The globe; HUD readouts sit inside it as solid cards                                                                     |

Rules:

- **One open panel per region.** Opening a panel collapses the others in its
  region. Panels keep their ids, disclosure buttons and persisted state.
- **Solid surfaces.** No blur, no glow, no scanlines. 1 px borders, 4–6 px
  radii, `--ws-surface` / `--ws-surface-2` fills.
- **Type.** IBM Plex Sans 11–13 px for UI, IBM Plex Mono for data; uppercase
  micro-labels at 0.12–0.16 em tracking.
- **The legacy rail engines stand down** (`src/ui/workspaceMode.js`): they no
  longer measure, auto-collapse or position panels in workstation mode.
- **Scope vignette off by default.** First launch turns off the circular scope
  mask through its DISPLAY toggle; users can turn it back on.
- **HUD.** Neutral banner (`OPEN SOURCE // UNCLASSIFIED`), amber readouts,
  no brackets or edge strips in the workstation.
- **Narrow screens (≤ 900 px).** The rail and inspector tabs become one bottom
  navigation bar; open panels become bottom sheets; the dock sits above the
  navigation as icon-only segments.
