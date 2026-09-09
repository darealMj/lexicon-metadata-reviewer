const $ = (s) => document.querySelector(s);
const tbody = $("#tbody"),
  status = $("#status"),
  searchBtn = $("#searchBtn"),
  acceptAll = $("#acceptAll"),
  rejectAll = $("#rejectAll"),
  exportBtn = $("#exportBtn"),
  applyBtn = $("#applyBtn"),
  connStatus = $("#connStatus"),
  lexSearch = $("#lexSearch"),
  loadTracks = $("#loadTracks"),
  lexArtist = $("#lexArtist"),
  lexTitle = $("#lexTitle"),
  lexGenre = $("#lexGenre"),
  lexAlbum = $("#lexAlbum"),
  lexTag = $("#lexTag"),
  tagSuggestions = $("#tagSuggestions"),
  searchNotice = $("#searchNotice"),
  advancedMode = $("#advancedMode"),
  configStatus = $("#configStatus"),
  metadataSource = $("#metadataSource"),
  lexPanel = $("#lexPanel"),
  csvPanel = $("#csvPanel"),
  lexTab = $("#lexTab"),
  csvTab = $("#csvTab"),
  csvFile = $("#csvFile"),
  loadDemo = $("#loadDemo"),
  prevPage = $("#prevPage"),
  nextPage = $("#nextPage"),
  pageInfo = $("#pageInfo");
const debugLog = $("#debugLog");
function dbg(...args) {
  const line = args
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2)))
    .join(" ");
  console.info("[DBG]", ...args);
  if (debugLog) {
    debugLog.textContent += (debugLog.textContent ? "\n" : "") + line;
    debugLog.scrollTop = debugLog.scrollHeight;
  }
}
export {
  $,
  tbody,
  status,
  searchBtn,
  acceptAll,
  rejectAll,
  exportBtn,
  applyBtn,
  connStatus,
  lexSearch,
  loadTracks,
  lexArtist,
  lexTitle,
  lexGenre,
  lexAlbum,
  lexTag,
  tagSuggestions,
  searchNotice,
  advancedMode,
  configStatus,
  metadataSource,
  lexPanel,
  csvPanel,
  lexTab,
  csvTab,
  csvFile,
  loadDemo,
  prevPage,
  nextPage,
  pageInfo,
  debugLog,
  dbg,
};
