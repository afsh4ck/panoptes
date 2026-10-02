/**
 * Workstation layout mode (src/ui/workspaceShell.js). While it is active the
 * PANOPTES chrome owns panel placement: one drawer panel and one inspector
 * panel at a time, sized by CSS. The legacy floating-rail engines must then
 * stop measuring, auto-collapsing and positioning panels.
 */
export const WORKSPACE_ATTRIBUTE = 'workspace';
export const WORKSTATION = 'workstation';

/** Whether the document is in workstation layout mode. */
export function isWorkstationLayout(node) {
  const root =
    node?.ownerDocument?.documentElement ||
    node?.documentElement ||
    (typeof document !== 'undefined' ? document.documentElement : null);
  return root?.dataset?.[WORKSPACE_ATTRIBUTE] === WORKSTATION;
}

/**
 * Hand a legacy rail back to the workstation: undo any automatic collapse
 * and the focus/exclusive presentation the rail engines apply.
 * @param {Element} stack Rail element.
 * @param {(panel: Element) => void} [onCollapse] Disclosure sync callback.
 */
export function releaseRailToWorkstation(stack, onCollapse) {
  stack.classList?.remove('layout-focus', 'layout-exclusive', 'layout-tail');
  for (const panel of stack.querySelectorAll?.('[data-panel-id]') || []) {
    if (panel.classList.contains('layout-auto-collapsed')) {
      panel.classList.remove('layout-auto-collapsed');
      onCollapse?.(panel);
    }
    panel.removeAttribute?.('aria-hidden');
  }
}
