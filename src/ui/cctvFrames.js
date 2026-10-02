import {
  PLACEHOLDER_SAMPLE,
  looksLikePublisherPlaceholder,
} from './cctvPlaceholderModel.js';

/** True when a loaded frame is the publisher's "camera in use" card. */
function isPublisherHoldFrame(image) {
  try {
    const canvas =
      image.ownerDocument?.createElement?.('canvas') ||
      globalThis.document?.createElement('canvas');
    if (!canvas) return false;
    canvas.width = PLACEHOLDER_SAMPLE.width;
    canvas.height = PLACEHOLDER_SAMPLE.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return looksLikePublisherPlaceholder(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    );
  } catch {
    // Cross-origin (tainted) frames cannot be inspected; assume a picture.
    return false;
  }
}

export function _clearCctvFrame() {
  this._cctvFrameRequestToken += 1;
  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  this._cctvFramePreloader = null;
  if (this._cctvFrame) {
    this._cctvFrame.classList.remove('active');
    this._cctvFrame.removeAttribute('src');
    this._cctvFrame.dataset.cameraId = '';
    this._cctvFrame.dataset.currentSrc = '';
    this._cctvFrame.dataset.loading = '';
    this._cctvFrame.dataset.error = '';
    this._cctvFrame.dataset.publisherHold = '';
  }
  this._cctvFrameWrap?.classList.remove('loading', 'has-frame');
}

export function _queueCctvFrame(src, cameraId, cameraChanged) {
  if (this.destroyed || !this._cctvFrame || !src) return;

  if (cameraChanged) {
    // A different camera gets an honest acquisition state. Never retain
    // the prior camera's pixels under the newly selected metadata.
    this._cctvFrame.classList.remove('active');
    this._cctvFrame.removeAttribute('src');
    this._cctvFrameWrap?.classList.remove('has-frame');
  }

  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  const token = ++this._cctvFrameRequestToken;
  this._cctvFrame.dataset.cameraId = cameraId;
  this._cctvFrame.dataset.currentSrc = src;
  this._cctvFrame.dataset.loading = 'true';
  this._cctvFrame.dataset.error = '';
  this._cctvFrameWrap?.classList.toggle(
    'loading',
    !this._cctvFrameWrap?.classList.contains('has-frame'),
  );

  const preloader = new Image();
  this._cctvFramePreloader = preloader;
  preloader.onload = () => {
    if (token === this._cctvFrameRequestToken && this._cctvFrame)
      this._cctvFrame.dataset.publisherHold = isPublisherHoldFrame(preloader)
        ? 'true'
        : '';
    this._settleCctvFrame(token, src, true);
  };
  preloader.onerror = () => this._settleCctvFrame(token, src, false);
  preloader.src = src;
}

export function _settleCctvFrame(token, src, ok) {
  if (
    this.destroyed ||
    !this._cctvFrame ||
    token !== this._cctvFrameRequestToken
  )
    return;
  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  this._cctvFramePreloader = null;
  this._cctvFrame.dataset.loading = '';
  this._cctvFrameWrap?.classList.remove('loading');

  const syncBadge = () =>
    this._syncCctvSourceBadge(
      this._cctvState?.activeCamera,
      !!this._cctvState?.enabled && !!this.actions.isEnabled(),
    );

  if (!ok) {
    // Leave the element untouched — a settled frame stays on screen.
    this._cctvFrame.dataset.error = 'true';
    syncBadge();
    return;
  }

  this._cctvFrame.dataset.error = '';
  this._cctvFrame.src = src;
  this._cctvFrame.classList.add('active');
  this._cctvFrameWrap?.classList.add('has-frame');
  syncBadge();
}

export function _syncCctvSourceBadge(activeCamera, enabled) {
  if (!this._cctvSourceBadge) return;
  if (!enabled || !activeCamera) {
    this._cctvSourceBadge.textContent = 'SOURCE · UNKNOWN';
    this._cctvSourceBadge.dataset.frameState = 'idle';
    return;
  }
  const hasDisplayedFrame =
    this._cctvFrameWrap?.classList.contains('has-frame');
  if (this._cctvFrame?.dataset.loading === 'true' && !hasDisplayedFrame) {
    this._cctvSourceBadge.textContent = 'FRAME · LOADING';
    this._cctvSourceBadge.dataset.frameState = 'loading';
    return;
  }
  if (this._cctvFrame?.dataset.error === 'true' && !hasDisplayedFrame) {
    this._cctvSourceBadge.textContent = 'FRAME · UNAVAILABLE';
    this._cctvSourceBadge.dataset.frameState = 'error';
    return;
  }
  if (this._cctvFrame?.dataset.publisherHold === 'true') {
    // The publisher swapped the picture for its "camera in use" card while
    // an operator steers the camera; it returns on its own.
    this._cctvSourceBadge.textContent =
      'IN USE BY OPERATOR · TRY ANOTHER CAMERA';
    this._cctvSourceBadge.dataset.live = 'false';
    this._cctvSourceBadge.dataset.frameState = 'held';
    return;
  }
  const kind = String(
    activeCamera.sourceKind || activeCamera.feedType || 'unknown',
  ).toUpperCase();
  const status = String(activeCamera.sourceStatus || 'unknown').toUpperCase();
  // Cameras that publish a real-time stream read LIVE, not as a frame source.
  const live = ['hls', 'mp4', 'webm'].includes(
    String(activeCamera.feedType || '').toLowerCase(),
  );
  this._cctvSourceBadge.textContent = live
    ? `● LIVE VIDEO · ${status}`
    : `${kind} · ${status}`;
  this._cctvSourceBadge.dataset.live = live ? 'true' : 'false';
  this._cctvSourceBadge.dataset.frameState = 'ready';
}
