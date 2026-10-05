import { CCTV_AMBIENT_CARD_MAX } from '../../data/cctvLod.js';
import { ACTIVE_FRAME_REFRESH_MS, IDLE_FRAME_REFRESH_MS } from './policy.js';
import { headingHudToken, isHeadingEstimated } from './headingConfidence.js';
import { frameFreshnessLabel } from './freshness.js';

/** Window for notifyListenersSoon(). */
const SOON_NOTIFY_MS = 250;
/** Notification options for background bursts (see uiState). */
const BACKGROUND = Object.freeze({ reuseCameraList: true });

export function createPresentation({
  state: layerState,
  services,
  parts,
  source,
}) {
  /**
   * Builds a single-line summary string for the active camera, including city,
   * heading, FOV, coverage area, overlap count, projection mode, alignment
   * confidence, source type, and view context.
   * @returns {string} Summary text separated by mid-dots.
   */

  function buildSummaryText() {
    const active = parts.selection.getActiveRecord();
    if (!active) {
      return layerState._records.length
        ? `${layerState._records.length} CAMERAS STANDING BY · NO CAMERA SELECTED · CLICK A CAMERA TO ACTIVATE`
        : 'No cameras available in catalog.';
    }

    const area = parts.model.sectorAreaKm2(
      active.camera.rangeM,
      active.camera.fovDeg,
    );
    const overlapCount = parts.geometry.coverageNeighborCount(active);
    const viewKey = parts.model.currentViewContext();
    const viewBand = viewKey.split(':')[0] || 'global';
    const health = layerState._healthById.get(active.camera.id) || null;
    const calBadge = parts.calibration.deriveCalBadge(active.camera);

    return [
      `${active.camera.city.toUpperCase()} CCTV`,
      `${active.camera.name.toUpperCase()}`,
      // A synthetic bearing (headingConfidence 'low', no human calibration)
      // is tagged so a hashed guess never reads as a surveyed facing (#639).
      headingHudToken(active.camera),
      `FOV ${Math.round(active.camera.fovDeg)}°`,
      `COVERAGE ${area.toFixed(2)}km²`,
      overlapCount > 0 ? `OVERLAP ${overlapCount} cams` : 'ISOLATED VIEW',
      `PROJ ${layerState._showProjection ? 'MONITOR' : 'OFF'}`,
      layerState._coverageMode === 'viewshed' ? 'VIEWSHED' : null,
      `CAL ${calBadge.replace('-', ' ').toUpperCase()}`,
      health?.sourceKind
        ? `SRC ${String(health.sourceKind).toUpperCase()}`
        : `SRC ${String(active.camera.feedType || 'image').toUpperCase()}`,
      frameFreshnessLabel(health?.frameTime, health?.frozen) || null,
      `${viewBand.toUpperCase()} CONTEXT`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Builds a public-facing camera state object for UI consumption.
   * Includes all pose, calibration, CAL badge, projection, and feed metadata.
   * @param {Object} record - Camera record.
   * @param {string|null} [activeId=null] - Active camera ID for the `active` flag.
   * @returns {Object} Public camera state.
   */

  function getPublicCameraState(record, activeId = null) {
    return publicCameraState(
      record,
      activeId || parts.selection.getActiveRecord()?.camera.id || null,
    );
  }

  /**
   * getPublicCameraState with the active id already resolved. uiState() maps
   * the whole catalog (~18,000 cameras) on every notification while list
   * consumers read only identity and feed fields, so the copied and derived
   * fields are getters, built when read.
   */
  function publicCameraState(record, resolvedActiveId) {
    const camera = record.camera;
    const health = layerState._healthById.get(camera.id) || null;
    const isActive = camera.id === resolvedActiveId;
    const refreshMs = isActive
      ? ACTIVE_FRAME_REFRESH_MS
      : IDLE_FRAME_REFRESH_MS;
    return {
      id: camera.id,
      name: camera.name,
      city: camera.city,
      provider: camera.provider,
      lat: camera.lat,
      lon: camera.lon,
      headingDeg: camera.headingDeg,
      // Bearing provenance (#639): the pack's confidence flag plus the derived
      // "is this a synthetic guess" bit (calibration-aware), so UI consumers
      // never have to re-derive it.
      headingConfidence: camera.headingConfidence || null,
      get headingEstimated() {
        return isHeadingEstimated(camera);
      },
      pitchDeg: camera.pitchDeg,
      fovDeg: camera.fovDeg,
      rangeM: camera.rangeM,
      elevationM: camera.absoluteHeightM,
      mountHeightM: camera.mountHeightM,
      active: isActive,
      feedType: camera.feedType,
      isVideo:
        parts.model.isVideoFeedType(camera.feedType) &&
        record.projection?.mode !== 'image',
      sourceKind:
        health?.sourceKind ||
        camera.sourceKind ||
        (camera.feedConfigured ? 'configured' : 'seed'),
      sourceStatus: health?.status || 'unknown',
      sourceMessage: health?.message || '',
      sourceLabel: health?.label || camera.provider || '',
      frameTime: health?.frameTime ?? null,
      frameFrozen: health?.frozen === true,
      get frameFreshness() {
        return frameFreshnessLabel(health?.frameTime, health?.frozen);
      },
      credit: camera.credit || '',
      get calibration() {
        return {
          ...parts.calibration.normalizeCalibration(camera.calibration),
        };
      },
      // Save-gated persistence (design §3e): true while the live pose carries
      // edits that have not been SAVEd (or RESET). Drives the CAL · EDITED chip.
      calDirty: !!record.calDirty,
      // Deterministic QA seam: counts commit-grade anchor resolutions (E/N drag
      // release, numeric E/N edit, or reset), never transient gizmo moves.
      groundResolveCount: record.calibrationGroundResolveCount || 0,
      // Per-record QA seam for proving transient gizmo moves never enter the
      // shared mesh-floor sampler while unrelated catalog cells finish.
      groundMeshSampleRequestCount: record.groundMeshSampleRequestCount || 0,
      // Datum QA seam: expose the immutable Re:Earth ellipsoidal prior
      // separately from the currently applied frustum ground. Google-3D may
      // legitimately refine the latter to the rendered mesh, so callers must
      // not infer the prior by subtracting mount height from live geometry.
      groundPriorM: Number.isFinite(record.groundPrior?.ellipsoid)
        ? record.groundPrior.ellipsoid
        : null,
      get intrinsics() {
        return camera.intrinsics ? { ...camera.intrinsics } : null;
      },
      get extrinsics() {
        return camera.extrinsics ? { ...camera.extrinsics } : null;
      },
      get anchor() {
        return camera.anchor ? { ...camera.anchor } : null;
      },
      // Panel-only trust signal (design §3b, amended by LOCKED §9.2/§9.3): no
      // in-world rendering reads this, no score-based quality math backs it.
      get calBadge() {
        return parts.calibration.deriveCalBadge(camera);
      },
      poseSource: camera.poseSource || null,
      get basePose() {
        return camera.basePose ? { ...camera.basePose } : null;
      },
      // Built on read: every state notification maps the whole catalog
      // (~18,000 cameras) and only the active camera's URLs are ever used.
      get frameUrl() {
        return parts.frames.frameUrlFor(camera, refreshMs);
      },
      get mediaUrl() {
        return parts.frames.mediaUrlFor(camera);
      },
    };
  }

  /**
   * Assembles the full UI state payload containing layer toggles, camera list,
   * active camera details, summary text, and error state.
   * @returns {Object} Complete UI state for subscribers.
   */

  /** The last camera list, reusable by background notifications (geometry
   *  progress, ground batches) while the catalog, the active camera and the
   *  health map are unchanged: those notify many times a second during a
   *  load and none of them changes what a list entry says. */
  let cameraListCache = null;

  function uiState({ reuseCameraList = false } = {}) {
    const active = parts.selection.getActiveRecord();
    const activeId = active?.camera.id || null;
    const reusable =
      reuseCameraList &&
      cameraListCache?.records === layerState._records &&
      cameraListCache.activeId === activeId &&
      cameraListCache.health === layerState._healthById;
    const cameras = reusable
      ? cameraListCache.cameras
      : layerState._records.map((record) =>
          publicCameraState(record, activeId),
        );
    cameraListCache = {
      records: layerState._records,
      activeId,
      health: layerState._healthById,
      cameras,
    };
    const payload = {
      enabled: layerState._enabled,
      // Compat boolean + the full tri-state (viewshed design §3b).
      showCoverage: layerState._coverageMode !== 'off',
      coverageMode: layerState._coverageMode,
      showProjection: layerState._showProjection,
      calibrationMode: layerState._calibrationMode,
      autoHop: layerState._autoHop,
      autoHopSuspended: layerState._autoHopSuspended,
      autoHopSec: layerState._autoHopSec,
      count: layerState._count,
      lastUpdate: layerState._lastUpdate,
      error: layerState._lastError,
      loading: {
        active: layerState._geoLoading,
        loaded: Math.min(layerState._geoLoadDone, layerState._geoLoadTotal),
        total: layerState._geoLoadTotal,
      },
      // Ambient card tier telemetry (QA harnesses assert the fetch pacing —
      // minFrameFetchSpacingMs reads together with fetchMode: cold-fill bursts
      // legitimately reach ~250 ms, steady state stays >=1000 ms).
      ambientCards: {
        count: layerState._cardIds.size,
        limit: CCTV_AMBIENT_CARD_MAX,
        frameFetches: layerState._cardFetchCount,
        minFrameFetchSpacingMs: layerState._cardMinFetchSpacingMs,
        fetchMode: layerState._cardFetchMode,
        fetchesInFlight: layerState._cardFetchInFlightCount,
        // Item B QA seam: the hover-summoned pinned card, if any.
        hoverId: layerState._hoverCardId,
      },
      activeCameraId: activeId,
      activeCamera: active ? publicCameraState(active, activeId) : null,
      cameras,
      summary: buildSummaryText(),
    };
    return payload;
  }

  /** Dispatches the current UI state to all registered subscriber callbacks. */

  function notifyListeners(options) {
    const payload = uiState(options);
    for (const callback of layerState._listeners) {
      try {
        callback(payload);
      } catch (error) {
        console.warn('[Data:CCTV] listener error:', error);
      }
    }
  }

  /**
   * Throttled notifyListeners for transient (mid-drag) calibration patches —
   * the panel re-render is DOM-heavy, so live gizmo drags publish state at
   * ≤10 Hz while the in-world geometry still tracks every processed move.
   */

  /**
   * Coalesced notifyListeners for background bursts (ground batches resolving
   * for thousands of cameras): the first call notifies at once, later calls
   * within the window fold into one trailing notification. Each notification
   * maps the whole catalog, so a burst of hundreds must not become hundreds.
   */
  function notifyListenersSoon() {
    const now = Date.now();
    if (now - layerState._lastSoonNotifyAt >= SOON_NOTIFY_MS) {
      layerState._lastSoonNotifyAt = now;
      notifyListeners(BACKGROUND);
      return;
    }
    if (layerState._soonNotifyTimer) return;
    layerState._soonNotifyTimer = setTimeout(
      () => {
        layerState._soonNotifyTimer = null;
        layerState._lastSoonNotifyAt = Date.now();
        notifyListeners(BACKGROUND);
      },
      SOON_NOTIFY_MS - (now - layerState._lastSoonNotifyAt),
    );
  }

  function notifyListenersThrottled() {
    const now = Date.now();
    if (now - layerState._lastTransientNotifyAt < 100) return;
    layerState._lastTransientNotifyAt = now;
    notifyListeners();
  }
  return {
    buildSummaryText,
    getPublicCameraState,
    uiState,
    notifyListeners,
    notifyListenersThrottled,
    notifyListenersSoon,
  };
}
