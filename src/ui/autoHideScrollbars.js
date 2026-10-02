/**
 * @module autoHideScrollbars
 * @description Scrollbars stay invisible until an element actually scrolls.
 * A capture-phase listener (scroll does not bubble) marks the scrolling
 * element with `.is-scrolling` and clears it shortly after it stops; the
 * stylesheet paints the orange thumb only while the class is present.
 */

export const SCROLLING_CLASS = 'is-scrolling';
export const HIDE_DELAY_MS = 900;

/** @param {Document} document */
export function installAutoHideScrollbars(document) {
  const view = document.defaultView || globalThis.window;
  const timers = new WeakMap();
  const onScroll = (event) => {
    const element =
      event.target === document ? document.documentElement : event.target;
    if (!element?.classList) return;
    if (!element.classList.contains(SCROLLING_CLASS))
      element.classList.add(SCROLLING_CLASS);
    view.clearTimeout(timers.get(element));
    timers.set(
      element,
      view.setTimeout(
        () => element.classList.remove(SCROLLING_CLASS),
        HIDE_DELAY_MS,
      ),
    );
  };
  document.addEventListener('scroll', onScroll, {
    capture: true,
    passive: true,
  });
  return () =>
    document.removeEventListener('scroll', onScroll, { capture: true });
}

/** Horizontal strips that opt in to wheel-to-sideways scrolling. */
export const HORIZONTAL_WHEEL_SELECTOR =
  '#location-pills, .poi-row-container, [data-wheel-x]';

/**
 * A plain mouse wheel scrolls the opted-in horizontal strips (city pills,
 * landmark chips) sideways, so they never need a visible scrollbar. Only
 * those strips are touched: every other panel keeps its normal vertical
 * wheel scrolling.
 * @param {Document} document
 */
export function installHorizontalWheel(document) {
  const onWheel = (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return;
    const strip = event.target?.closest?.(HORIZONTAL_WHEEL_SELECTOR);
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
    // At either end, let the wheel fall through to the page as usual.
    const max = strip.scrollWidth - strip.clientWidth;
    const canMove =
      event.deltaY > 0 ? strip.scrollLeft < max - 1 : strip.scrollLeft > 0;
    if (!canMove) return;
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  };
  document.addEventListener('wheel', onWheel, { passive: false });
  return () => document.removeEventListener('wheel', onWheel);
}
