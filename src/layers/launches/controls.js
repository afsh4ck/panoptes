export function createControls({ state: layerState, services, parts, source }) {
  const methods = {
    id: 'rocket-launches',

    name: 'Space Missions (30d)',

    icon: '🚀',

    source: 'Launch Library 2',

    updateInterval: 300000,

    /** Release only Space Mission camera ownership, preserving layer and selection state. */
    releaseCameraOwnership() {
      parts.panel.clearMissionRosterHover();
      parts.replay.stopMissionReplay();
      parts.selection.stopMissionZoomAnchor();
    },

    getStats() {
      return {
        count: layerState._count,
        orbitMatches: layerState._orbitMatches,
        lastUpdate: layerState._lastUpdate,
        error: layerState._lastError,
      };
    },

    attachDataManager(dataManager) {
      layerState._dataManager = dataManager;
    },

    /**
     * The launch currently selected in the Space Missions panel, as the
     * layer's normalized record (see model.js normalizeRocketLaunches), for
     * detail surfaces such as the intel card. Null while nothing is selected.
     * @returns {object|null}
     */
    getSelectedLaunch() {
      const id = layerState._selectedLaunchId;
      if (!id) return null;
      return layerState._launches.find((launch) => launch.id === id) || null;
    },
  };

  return { methods };
}
