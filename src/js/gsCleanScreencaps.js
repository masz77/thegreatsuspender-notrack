// 2026-07-05: Neutered for MV3 — this feature relied on BLOCKING chrome.webRequest,
// which MV3 removed. It was already dead in MV2: the webRequest permission was never
// declared in the manifest, so enabling the option threw. Upgrade path:
// declarativeNetRequest session rules scoped to the capturing tab.
// eslint-disable-next-line no-unused-vars
var gsCleanScreencaps = {
  initAsPromised: async () => {
    return;
  },

  addListener: () => {},

  removeListener: () => {},

  loadList: async () => {
    return;
  },
};
