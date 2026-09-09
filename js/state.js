const state = {
  sourceRecords: new Map(),
  advanced: false,
  tagDefaults: {
    tagMode: "add",
    includeMix: true,
  },
  loadError: "",
  busy: false,
  pageOffset: 0,
  pageTotal: 0,
  pageKind: "library",
  searchTracks: [],
  reviewCache: new Map(),
  rows: [],
  sourceMode: "lexicon",
  connected: false,
  allTags: [],
  tagCategories: [],
  historyEntries: [],
  themePreference: "system",
};
export { state };
