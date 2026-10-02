/**
 * @module customSelect
 * @description PANOPTES dropdown lists instead of the browser's native ones.
 *
 * Every single-choice `<select>` keeps its own look, value, events and
 * keyboard stepping; only the list it opens is replaced. Opening it (click,
 * Space, Enter, Alt+↓ or F4) shows a styled menu anchored to the select,
 * with the hovered / keyboard-active item in orange. Choosing an item sets
 * the select's value and fires `input` + `change` exactly as a native pick
 * would, so no caller has to know the menu exists.
 */

const GAP_PX = 4;
const EDGE_PX = 8;
const MAX_HEIGHT_PX = 320;
const MIN_HEIGHT_PX = 120;

/**
 * Where to put a menu of `contentHeight` for an anchor rect inside the
 * viewport: below when it fits (or when there is more room below), above
 * otherwise; the height is capped to the room on that side.
 */
export function placeSelectMenu(anchor, contentHeight, viewport) {
  const below = viewport.height - anchor.bottom - GAP_PX - EDGE_PX;
  const above = anchor.top - GAP_PX - EDGE_PX;
  const wanted = Math.min(contentHeight, MAX_HEIGHT_PX);
  const side = wanted <= below || below >= above ? 'below' : 'above';
  const room = Math.max(MIN_HEIGHT_PX, side === 'below' ? below : above);
  const maxHeight = Math.round(Math.min(wanted, room));
  const width = Math.round(Math.max(anchor.width, 120));
  const left = Math.round(
    Math.max(EDGE_PX, Math.min(anchor.left, viewport.width - width - EDGE_PX)),
  );
  const top = Math.round(
    side === 'below'
      ? anchor.bottom + GAP_PX
      : Math.max(EDGE_PX, anchor.top - GAP_PX - maxHeight),
  );
  return { left, top, width, maxHeight, side };
}

/** Only single-choice drop-downs get the custom list (not list boxes). */
export function isDropdownSelect(element) {
  return (
    element?.tagName === 'SELECT' &&
    !element.multiple &&
    !(Number(element.size) > 1) &&
    !element.hasAttribute('data-native-select')
  );
}

const OPEN_KEYS = new Set([' ', 'Enter', 'F4']);

/**
 * @param {Document} document
 * @returns {{destroy(): void}}
 */
export function installCustomSelects(document) {
  const view = document?.defaultView;
  if (!view || !document.body) return { destroy() {} };

  let open = null; // { select, menu, items, active }

  function close({ refocus = false } = {}) {
    if (!open) return;
    const { select, menu } = open;
    open = null;
    menu.remove();
    select.removeAttribute('aria-expanded');
    select.classList.remove('pnp-select-open');
    if (refocus) select.focus?.({ preventScroll: true });
  }

  function choose(index) {
    if (!open) return;
    const { select, items } = open;
    const item = items[index];
    if (!item || item.option.disabled) return;
    const changed = select.selectedIndex !== item.optionIndex;
    close({ refocus: true });
    if (!changed) return;
    select.selectedIndex = item.optionIndex;
    select.dispatchEvent(new view.Event('input', { bubbles: true }));
    select.dispatchEvent(new view.Event('change', { bubbles: true }));
  }

  function setActive(index, { scroll = true } = {}) {
    if (!open) return;
    const { items } = open;
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, index));
    items[open.active]?.element.classList.remove('active');
    open.active = next;
    const element = items[next].element;
    element.classList.add('active');
    if (scroll) element.scrollIntoView?.({ block: 'nearest' });
  }

  function step(direction) {
    if (!open) return;
    const { items } = open;
    let index = open.active;
    for (let n = 0; n < items.length; n++) {
      index += direction;
      if (index < 0 || index >= items.length) return;
      if (!items[index].option.disabled) return setActive(index);
    }
  }

  function build(select) {
    const menu = document.createElement('div');
    menu.className = 'pnp-select-menu';
    menu.setAttribute('role', 'listbox');
    // Option texts are already in the interface language.
    menu.setAttribute('data-i18n-skip', '');
    const style = view.getComputedStyle(select);
    menu.style.fontFamily = style.fontFamily;
    menu.style.fontSize = style.fontSize;
    menu.style.letterSpacing = style.letterSpacing;

    const items = [];
    const options = [...select.options];
    let group = null;
    options.forEach((option, optionIndex) => {
      if (option.hidden) return;
      const parent = option.parentElement;
      if (parent?.tagName === 'OPTGROUP' && parent !== group) {
        group = parent;
        const label = document.createElement('div');
        label.className = 'pnp-select-group';
        label.textContent = parent.label;
        menu.append(label);
      }
      const element = document.createElement('div');
      element.className = 'pnp-select-option';
      element.setAttribute('role', 'option');
      element.textContent = option.textContent.trim() || ' ';
      if (option.disabled) element.classList.add('disabled');
      if (optionIndex === select.selectedIndex) {
        element.classList.add('selected');
        element.setAttribute('aria-selected', 'true');
      }
      const index = items.length;
      element.addEventListener('pointerenter', () =>
        setActive(index, { scroll: false }),
      );
      element.addEventListener('click', () => choose(index));
      items.push({ element, option, optionIndex });
      menu.append(element);
    });
    return { menu, items };
  }

  function position() {
    if (!open) return;
    const { select, menu } = open;
    const rect = select.getBoundingClientRect();
    const place = placeSelectMenu(rect, menu.scrollHeight, {
      width: view.innerWidth,
      height: view.innerHeight,
    });
    Object.assign(menu.style, {
      left: `${place.left}px`,
      top: `${place.top}px`,
      minWidth: `${place.width}px`,
      maxWidth: `${Math.max(place.width, 360)}px`,
      maxHeight: `${place.maxHeight}px`,
    });
    menu.dataset.side = place.side;
  }

  function show(select) {
    if (open?.select === select) return close({ refocus: true });
    close();
    if (select.disabled) return;
    const { menu, items } = build(select);
    if (!items.length) return;
    document.body.append(menu);
    open = { select, menu, items, active: -1 };
    select.setAttribute('aria-expanded', 'true');
    select.classList.add('pnp-select-open');
    position();
    const selected = items.findIndex(
      (item) => item.optionIndex === select.selectedIndex,
    );
    setActive(selected >= 0 ? selected : 0);
  }

  // ── Event wiring (delegated, so selects added later are covered) ──
  const onPointerDown = (event) => {
    const select = event.target?.closest?.('select');
    if (select && isDropdownSelect(select)) {
      if (event.button !== 0) return;
      event.preventDefault(); // no native list
      select.focus?.({ preventScroll: true });
      show(select);
      return;
    }
    if (!open) return;
    // Keep focus on the select while picking from the menu.
    if (open.menu.contains(event.target)) event.preventDefault();
    else close();
  };
  const onKeyDown = (event) => {
    const select = event.target;
    if (open && select === open.select) {
      if (event.key === 'ArrowDown') step(1);
      else if (event.key === 'ArrowUp') step(-1);
      else if (event.key === 'Home') setActive(0);
      else if (event.key === 'End') setActive(open.items.length - 1);
      else if (event.key === 'Enter' || event.key === ' ') choose(open.active);
      else if (event.key === 'Escape') close({ refocus: true });
      else if (event.key === 'Tab') return close();
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!isDropdownSelect(select)) return;
    const altArrow =
      event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    if (OPEN_KEYS.has(event.key) || altArrow) {
      event.preventDefault();
      show(select);
    }
  };
  const onScroll = (event) => {
    if (open && !open.menu.contains(event.target)) close();
  };
  const onResize = () => close();
  const onFocusOut = (event) => {
    if (open && event.target === open.select && !open.menu.matches(':hover'))
      close();
  };

  // mousedown (not pointerdown) is what opens the native list.
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('focusout', onFocusOut, true);
  view.addEventListener('resize', onResize);
  view.addEventListener('blur', onResize);

  return {
    destroy() {
      close();
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('focusout', onFocusOut, true);
      view.removeEventListener('resize', onResize);
      view.removeEventListener('blur', onResize);
    },
  };
}
