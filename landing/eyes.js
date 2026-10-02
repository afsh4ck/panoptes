/*
 * PANOPTES eyes: Argus' central eye with eight watchers orbiting it. Every
 * pupil follows the pointer anywhere over the hero; sight lines converge on it
 * and a reticle reads its position. Ported from the app's loading screen.
 */
(function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var STAGE = 400;
  var CENTER = STAGE / 2;
  var ORBIT_RADIUS = 150;
  var WATCHERS = 8;
  var ORBIT_PERIOD_S = 36;
  var MAIN_EYE = { halfWidth: 72, iris: 26 };
  var WATCHER_EYE = { halfWidth: 22, iris: 8 };

  function el(tag, attrs) {
    var node = document.createElementNS(SVG, tag);
    for (var key in attrs) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  function almond(hw) {
    var h = hw * 0.62;
    return (
      'M' + -hw + ' 0 Q0 ' + -h + ' ' + hw + ' 0 Q0 ' + h + ' ' + -hw + ' 0 Z'
    );
  }
  function watcherPosition(index, seconds, still) {
    var phase = still ? 0 : (seconds / ORBIT_PERIOD_S) * Math.PI * 2;
    var angle = (index / WATCHERS) * Math.PI * 2 - Math.PI / 2 + phase;
    return {
      x: CENTER + Math.cos(angle) * ORBIT_RADIUS,
      y: CENTER + Math.sin(angle) * ORBIT_RADIUS,
    };
  }
  function pupilOffset(eye, target, size) {
    var dx = target.x - eye.x;
    var dy = target.y - eye.y;
    var d = Math.hypot(dx, dy);
    if (!d) return { x: 0, y: 0 };
    var maxX = Math.max(0, size.halfWidth - size.iris - size.halfWidth * 0.12);
    var maxY = maxX * 0.38;
    var reach = Math.min(1, d / (size.halfWidth * 6));
    return { x: (dx / d) * maxX * reach, y: (dy / d) * maxY * reach * 1.6 };
  }
  function isBlinking(index, seconds) {
    var period = 5 + ((index * 7) % 5);
    return (seconds + index * 1.3) % period < 0.14;
  }
  var uid = 0;
  function buildEye(size, main) {
    var group = el('g', { class: main ? 'le-eye le-main' : 'le-eye' });
    var lid = el('g', { class: 'le-lid' });
    var clipId = 'le-clip-' + uid++;
    var clip = el('clipPath', { id: clipId });
    clip.appendChild(el('path', { d: almond(size.halfWidth) }));
    var outline = el('path', {
      d: almond(size.halfWidth),
      class: 'le-outline',
    });
    var irisGroup = el('g', { 'clip-path': 'url(#' + clipId + ')' });
    var iris = el('g', { class: 'le-iris' });
    iris.appendChild(el('circle', { r: size.iris, class: 'le-iris-disc' }));
    iris.appendChild(el('circle', { r: size.iris * 0.42, class: 'le-pupil' }));
    iris.appendChild(
      el('circle', {
        r: size.iris * 0.16,
        cx: -size.iris * 0.32,
        cy: -size.iris * 0.34,
        class: 'le-glint',
      }),
    );
    if (main)
      iris.appendChild(
        el('circle', { r: size.iris * 0.72, class: 'le-iris-ring' }),
      );
    irisGroup.appendChild(iris);
    lid.appendChild(clip);
    lid.appendChild(irisGroup);
    lid.appendChild(outline);
    group.appendChild(lid);
    return { group: group, lid: lid, iris: iris };
  }

  function start() {
    var host = document.querySelector('[data-eyes]');
    var hero = document.getElementById('hero');
    var sight = document.querySelector('.hero-sight');
    var readout = document.querySelector('.eyes-readout');
    if (!host || !hero) return;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var stage = el('svg', {
      viewBox: '0 0 ' + STAGE + ' ' + STAGE,
      class: 'le-stage',
    });
    stage.appendChild(
      el('circle', {
        cx: CENTER,
        cy: CENTER,
        r: ORBIT_RADIUS,
        class: 'le-orbit',
      }),
    );
    var main = buildEye(MAIN_EYE, true);
    main.group.setAttribute(
      'transform',
      'translate(' + CENTER + ' ' + CENTER + ')',
    );
    var watchers = [];
    for (var i = 0; i < WATCHERS; i++) {
      watchers.push(buildEye(WATCHER_EYE, false));
      stage.appendChild(watchers[i].group);
    }
    stage.appendChild(main.group);
    host.appendChild(stage);

    var lines = [];
    for (var j = 0; j <= WATCHERS; j++) {
      var line = el('line', {});
      sight.appendChild(line);
      lines.push(line);
    }
    var reticle = el('g', {});
    reticle.appendChild(el('circle', { r: 16, class: 'ring' }));
    reticle.appendChild(
      el('path', { d: 'M-26 0h8M18 0h8M0 -26v8M0 18v8', class: 'ticks' }),
    );
    reticle.appendChild(el('circle', { r: 2, class: 'dot' }));
    sight.appendChild(reticle);
    var readTitle = readout.querySelector('strong');
    var readLine = readout.querySelector('span');
    var readBar = readout.querySelector('i');

    var pointer = null;
    var lastMove = 0;
    var lock = 0;
    hero.addEventListener(
      'pointermove',
      function (e) {
        var r = hero.getBoundingClientRect();
        pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
        lastMove = performance.now();
      },
      { passive: true },
    );
    hero.addEventListener('pointerleave', function () {
      pointer = null;
    });

    var t0 = performance.now();
    var visible = true;
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }).observe(hero);

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      var seconds = (now - t0) / 1000;
      var heroRect = hero.getBoundingClientRect();
      var rect = stage.getBoundingClientRect();
      var ox = rect.left - heroRect.left;
      var oy = rect.top - heroRect.top;
      var scale = rect.width / STAGE || 1;
      // Without a pointer the eyes sweep the hero slowly.
      var idle = {
        x: heroRect.width / 2 + Math.cos(seconds * 0.7) * heroRect.width * 0.32,
        y:
          heroRect.height / 2 +
          Math.sin(seconds * 0.9) * heroRect.height * 0.22,
      };
      var target = pointer || idle;
      var tStage = { x: (target.x - ox) / scale, y: (target.y - oy) / scale };
      var m = pupilOffset({ x: CENTER, y: CENTER }, tStage, MAIN_EYE);
      main.iris.setAttribute(
        'transform',
        'translate(' + m.x.toFixed(2) + ' ' + m.y.toFixed(2) + ')',
      );
      var centers = [{ x: CENTER, y: CENTER }];
      for (var k = 0; k < WATCHERS; k++) {
        var p = watcherPosition(k, seconds, still);
        centers.push(p);
        watchers[k].group.setAttribute(
          'transform',
          'translate(' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ')',
        );
        var o = pupilOffset(p, tStage, WATCHER_EYE);
        watchers[k].iris.setAttribute(
          'transform',
          'translate(' + o.x.toFixed(2) + ' ' + o.y.toFixed(2) + ')',
        );
        watchers[k].lid.classList.toggle('blink', isBlinking(k, seconds));
      }
      var tracking = Boolean(pointer);
      var settled = now - lastMove > 450;
      lock = tracking
        ? Math.min(1, lock + (settled ? 0.02 : 0.004))
        : Math.max(0, lock - 0.05);
      sight.classList.toggle('on', tracking);
      readout.classList.toggle('on', tracking);
      readout.classList.toggle('locked', lock >= 1);
      if (!tracking) return;
      centers.forEach(function (c, n) {
        lines[n].setAttribute('x1', (ox + c.x * scale).toFixed(1));
        lines[n].setAttribute('y1', (oy + c.y * scale).toFixed(1));
        lines[n].setAttribute('x2', target.x.toFixed(1));
        lines[n].setAttribute('y2', target.y.toFixed(1));
      });
      reticle.setAttribute(
        'transform',
        'translate(' +
          target.x.toFixed(1) +
          ' ' +
          target.y.toFixed(1) +
          ') rotate(' +
          ((seconds * 40) % 360).toFixed(1) +
          ')',
      );
      var pct = Math.round(lock * 100);
      var es = document.documentElement.lang !== 'en';
      readTitle.textContent =
        pct >= 100
          ? es
            ? 'OBJETIVO FIJADO'
            : 'TARGET LOCKED'
          : es
            ? 'ADQUIRIENDO OBJETIVO'
            : 'ACQUIRING TARGET';
      var lat = (90 - (target.y / heroRect.height) * 180).toFixed(4);
      var lon = ((target.x / heroRect.width) * 360 - 180).toFixed(4);
      readLine.textContent =
        'X ' +
        Math.round(target.x) +
        ' · Y ' +
        Math.round(target.y) +
        ' · ' +
        lat +
        '° ' +
        lon +
        '°';
      readBar.style.setProperty('--lock', pct + '%');
      var flipX = target.x > heroRect.width - 270;
      var flipY = target.y > heroRect.height - 90;
      readout.style.transform =
        'translate(' +
        (target.x + (flipX ? -255 : 30)).toFixed(0) +
        'px,' +
        (target.y + (flipY ? -72 : 22)).toFixed(0) +
        'px)';
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();
})();
