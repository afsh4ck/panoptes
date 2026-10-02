import {
  CENTER,
  MAIN_EYE,
  STAGE,
  WATCHERS,
  WATCHER_EYE,
  clientToStage,
  isBlinking,
  pupilOffset,
  trackingReadout,
  watcherPosition,
} from './loaderEyesModel.js';

/**
 * @module loaderEyes
 * @description The PANOPTES loading screen: Argus' central eye with eight
 * watchers orbiting it. Every pupil follows the pointer, thin sight lines
 * converge on it and a reticle reads its position while the globe boots.
 * Stops itself (listeners and frame loop) once the loading screen hides.
 */

const SVG = 'http://www.w3.org/2000/svg';

function svgEl(document, tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

/** Almond outline centered on 0,0. */
function almond(halfWidth) {
  const h = halfWidth * 0.62;
  return `M${-halfWidth} 0 Q0 ${-h} ${halfWidth} 0 Q0 ${h} ${-halfWidth} 0 Z`;
}

function buildEye(document, size, { main = false } = {}) {
  const group = svgEl(document, 'g', {
    class: main ? 'le-eye le-main' : 'le-eye',
  });
  const lid = svgEl(document, 'g', { class: 'le-lid' });
  const clipId = `le-clip-${Math.random().toString(36).slice(2, 9)}`;
  const clip = svgEl(document, 'clipPath', { id: clipId });
  clip.appendChild(svgEl(document, 'path', { d: almond(size.halfWidth) }));
  const outline = svgEl(document, 'path', {
    d: almond(size.halfWidth),
    class: 'le-outline',
  });
  const irisGroup = svgEl(document, 'g', { 'clip-path': `url(#${clipId})` });
  const iris = svgEl(document, 'g', { class: 'le-iris' });
  iris.append(
    svgEl(document, 'circle', { r: size.iris, class: 'le-iris-disc' }),
    svgEl(document, 'circle', { r: size.iris * 0.42, class: 'le-pupil' }),
    svgEl(document, 'circle', {
      r: size.iris * 0.16,
      cx: -size.iris * 0.32,
      cy: -size.iris * 0.34,
      class: 'le-glint',
    }),
  );
  if (main)
    iris.appendChild(
      svgEl(document, 'circle', { r: size.iris * 0.72, class: 'le-iris-ring' }),
    );
  irisGroup.appendChild(iris);
  lid.append(clip, irisGroup, outline);
  group.appendChild(lid);
  return { group, lid, iris };
}

/**
 * Start the animation inside `#loading-screen`.
 * @param {HTMLElement|null} screen The loading screen element.
 * @returns {{stop: Function}}
 */
export function startLoaderEyes(screen) {
  const document = screen?.ownerDocument;
  const view = document?.defaultView;
  const host = screen?.querySelector?.('[data-loader-eyes]');
  if (!host || !view?.requestAnimationFrame) return { stop() {} };
  const reducedMotion = Boolean(
    view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  );

  // Stage: the eyes. Overlay: sight lines + reticle in client pixels.
  const stage = svgEl(document, 'svg', {
    viewBox: `0 0 ${STAGE} ${STAGE}`,
    class: 'le-stage',
    'aria-hidden': 'true',
  });
  stage.appendChild(
    svgEl(document, 'circle', {
      cx: CENTER,
      cy: CENTER,
      r: 150,
      class: 'le-orbit',
    }),
  );
  const main = buildEye(document, MAIN_EYE, { main: true });
  main.group.setAttribute('transform', `translate(${CENTER} ${CENTER})`);
  const watchers = Array.from({ length: WATCHERS }, () =>
    buildEye(document, WATCHER_EYE),
  );
  for (const watcher of watchers) stage.appendChild(watcher.group);
  stage.appendChild(main.group);
  host.appendChild(stage);

  const overlay = svgEl(document, 'svg', {
    class: 'le-overlay',
    'aria-hidden': 'true',
  });
  const lines = Array.from({ length: WATCHERS + 1 }, () => {
    const line = svgEl(document, 'line', { class: 'le-sight' });
    overlay.appendChild(line);
    return line;
  });
  const reticle = svgEl(document, 'g', { class: 'le-reticle' });
  reticle.append(
    svgEl(document, 'circle', { r: 16, class: 'le-reticle-ring' }),
    svgEl(document, 'path', {
      d: 'M-26 0h8M18 0h8M0 -26v8M0 18v8',
      class: 'le-reticle-ticks',
    }),
    svgEl(document, 'circle', { r: 2, class: 'le-reticle-dot' }),
  );
  overlay.appendChild(reticle);
  screen.appendChild(overlay);

  const readout = document.createElement('div');
  readout.className = 'le-readout';
  readout.setAttribute('aria-hidden', 'true');
  const readTitle = document.createElement('strong');
  const readLine = document.createElement('span');
  const readBar = document.createElement('i');
  readout.append(readTitle, readLine, readBar);
  screen.appendChild(readout);

  let pointer = null;
  let lock = 0;
  let lastMove = 0;
  const onMove = (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    lastMove = view.performance.now();
  };
  const onLeave = () => {
    pointer = null;
  };
  view.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);

  const start = view.performance.now();
  let frame = 0;
  let stopped = false;
  let hiddenSince = 0;

  function render(now) {
    if (stopped) return;
    frame = view.requestAnimationFrame(render);
    const seconds = (now - start) / 1000;
    if (!screen.isConnected || screen.classList.contains('hidden')) {
      hiddenSince ||= now;
      if (now - hiddenSince > 1500) stop();
      return;
    }
    const rect = stage.getBoundingClientRect();
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    // Without a pointer the eyes scan slowly, like a sweep.
    const idle = {
      x: viewport.width / 2 + Math.cos(seconds * 0.7) * viewport.width * 0.32,
      y: viewport.height / 2 + Math.sin(seconds * 0.9) * viewport.height * 0.22,
    };
    const target = pointer || idle;
    const targetStage = clientToStage(target, rect);
    const scale = rect.width / STAGE;

    const mainOffset = pupilOffset(
      { x: CENTER, y: CENTER },
      targetStage,
      MAIN_EYE,
    );
    main.iris.setAttribute(
      'transform',
      `translate(${mainOffset.x.toFixed(2)} ${mainOffset.y.toFixed(2)})`,
    );
    const centers = [{ x: CENTER, y: CENTER }];
    watchers.forEach((watcher, index) => {
      const position = watcherPosition(index, seconds, { reducedMotion });
      centers.push(position);
      watcher.group.setAttribute(
        'transform',
        `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)})`,
      );
      const offset = pupilOffset(position, targetStage, WATCHER_EYE);
      watcher.iris.setAttribute(
        'transform',
        `translate(${offset.x.toFixed(2)} ${offset.y.toFixed(2)})`,
      );
      watcher.lid.classList.toggle('blink', isBlinking(index, seconds));
    });

    // Sight lines and reticle only while a real pointer is tracked.
    const tracking = Boolean(pointer);
    const settled = now - lastMove > 450;
    lock = tracking
      ? Math.min(1, lock + (settled ? 0.02 : 0.004))
      : Math.max(0, lock - 0.05);
    overlay.classList.toggle('tracking', tracking);
    readout.classList.toggle('tracking', tracking);
    readout.classList.toggle('locked', lock >= 1);
    if (tracking) {
      centers.forEach((center, index) => {
        const line = lines[index];
        line.setAttribute('x1', (rect.left + center.x * scale).toFixed(1));
        line.setAttribute('y1', (rect.top + center.y * scale).toFixed(1));
        line.setAttribute('x2', target.x.toFixed(1));
        line.setAttribute('y2', target.y.toFixed(1));
      });
      reticle.setAttribute(
        'transform',
        `translate(${target.x.toFixed(1)} ${target.y.toFixed(1)}) rotate(${((seconds * 40) % 360).toFixed(1)})`,
      );
      const text = trackingReadout(target, viewport, lock);
      readTitle.textContent = text.title;
      readLine.textContent = text.line;
      readBar.style.setProperty('--lock', `${text.lock}%`);
      const flipX = target.x > viewport.width - 260;
      const flipY = target.y > viewport.height - 90;
      readout.style.transform = `translate(${(target.x + (flipX ? -250 : 30)).toFixed(0)}px, ${(target.y + (flipY ? -70 : 22)).toFixed(0)}px)`;
    }
  }
  frame = view.requestAnimationFrame(render);

  function stop() {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
    view.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    overlay.remove();
    readout.remove();
  }
  return { stop };
}
