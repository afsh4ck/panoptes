/**
 * @module tooltips
 * @description PANOPTES tooltips instead of the browser's native ones.
 *
 * Every `title` attribute is adopted into `data-pnp-title` as soon as it
 * appears, so the browser never shows its native tooltip; hovering shows the
 * text in a styled bubble instead.
 */

const SHOW_DELAY_MS = 380;
/** Controls that open on hover already: their title is lifted (no native
 *  tooltip) but no bubble is shown either. */
export const SILENT_TOOLTIP_SELECTOR =
  '#command-dock .dock-tray-toggle, [data-no-tooltip]';
const GAP_PX = 10;
const EDGE_PX = 8;

/** Position for a bubble of `size` next to `anchor`, inside `viewport`. */
export function placeTooltip(anchor, size, viewport) {
  const centerX = anchor.left + anchor.width / 2;
  let left = Math.round(centerX - size.width / 2);
  left = Math.max(
    EDGE_PX,
    Math.min(left, viewport.width - size.width - EDGE_PX),
  );
  const above = anchor.top - GAP_PX - size.height;
  const below = anchor.bottom + GAP_PX;
  const side =
    above >= EDGE_PX || below + size.height > viewport.height - EDGE_PX
      ? 'top'
      : 'bottom';
  const top = side === 'top' ? Math.max(EDGE_PX, above) : below;
  // Arrow x relative to the bubble, kept off its rounded corners.
  const arrow = Math.max(12, Math.min(size.width - 12, centerX - left));
  return { left, top: Math.round(top), side, arrow: Math.round(arrow) };
}

/** Attribute that holds a tooltip once its native `title` is adopted. */
export const TOOLTIP_ATTRIBUTE = 'data-pnp-title';

/**
 * @param {Document} document
 * Install BEFORE the language module: titles are adopted in their authored
 * (English) form and the translator then localises `data-pnp-title`.
 */
export function installTooltips(document) {
  const view = document.defaultView || globalThis.window;
  const bubble = document.createElement('div');
  bubble.className = 'pnp-tooltip';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;

  // Every `title` — in the markup or written later by any module — moves to
  // TOOLTIP_ATTRIBUTE at once, so the browser never has a native tooltip to
  // show (hover-time lifting raced with modules rewriting titles).
  function adopt(element) {
    if (
      element?.nodeType !== 1 ||
      element.namespaceURI !==
        element.ownerDocument?.documentElement?.namespaceURI
    )
      return;
    const text = element.getAttribute('title');
    if (text === null) return;
    element.removeAttribute('title');
    if (text.trim()) element.setAttribute(TOOLTIP_ATTRIBUTE, text);
    else element.removeAttribute(TOOLTIP_ATTRIBUTE);
  }
  function adoptTree(root) {
    if (root?.nodeType !== 1) return;
    adopt(root);
    for (const element of root.querySelectorAll('[title]')) adopt(element);
  }
  adoptTree(document.documentElement);
  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') adopt(record.target);
      else for (const node of record.addedNodes) adoptTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });

  let owner = null;
  let timer = 0;

  function hide() {
    view.clearTimeout(timer);
    owner = null;
    bubble.hidden = true;
    bubble.classList.remove('visible');
  }

  function show() {
    const text = owner?.isConnected
      ? owner.getAttribute(TOOLTIP_ATTRIBUTE)
      : '';
    if (!text) return;
    if (!bubble.isConnected) document.body.appendChild(bubble);
    bubble.textContent = text;
    bubble.hidden = false;
    const rect = owner.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const place = placeTooltip(rect, size, {
      width: view.innerWidth,
      height: view.innerHeight,
    });
    bubble.style.left = `${place.left}px`;
    bubble.style.top = `${place.top}px`;
    bubble.style.setProperty('--pnp-tip-arrow', `${place.arrow}px`);
    bubble.dataset.side = place.side;
    bubble.classList.add('visible');
  }

  const onOver = (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const target = event.target?.closest?.(`[${TOOLTIP_ATTRIBUTE}]`);
    if (target === owner) return;
    hide();
    if (!target || target.matches?.(SILENT_TOOLTIP_SELECTOR)) return;
    owner = target;
    timer = view.setTimeout(show, SHOW_DELAY_MS);
  };
  const onOut = (event) => {
    if (!owner) return;
    const next = event.relatedTarget;
    if (next && owner.contains(next)) return;
    hide();
  };

  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  view.addEventListener('blur', hide);
  view.addEventListener('scroll', hide, true);

  return () => {
    hide();
    observer.disconnect();
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('keydown', hide, true);
    view.removeEventListener('blur', hide);
    view.removeEventListener('scroll', hide, true);
    bubble.remove();
  };
}
