import {
  activateManual,
  allFields,
  decide,
  fieldChoice,
  setAdvanced,
  setManual,
  setMode,
} from "./review.js";
import {
  addGenreTag,
  allGenreTags,
  setIncludeMix,
  setTagMode,
  toggleGenreTag,
} from "./tags.js";
import {
  clearRecord,
  loadRecordById,
  lookupAll,
  useFoundRecord,
} from "./metadata.js";
import { openHistory, restoreHistory } from "./history.js";
import {
  applyTheme,
  clearMetadataCache,
  loadLocalSettings,
  openSettings,
  saveSettings,
  systemTheme,
} from "./settings.js";
import {
  applyAccepted,
  connectLexicon,
  loadFirst,
  loadPage,
  searchLexicon,
} from "./lexicon.js";
import { state } from "./state.js";
import {
  acceptAll,
  advancedMode,
  applyBtn,
  csvFile,
  csvTab,
  exportBtn,
  lexAlbum,
  lexArtist,
  lexGenre,
  lexSearch,
  lexTab,
  lexTag,
  lexTitle,
  loadDemo,
  loadTracks,
  metadataSource,
  nextPage,
  prevPage,
  rejectAll,
  searchBtn,
} from "./dom.js";
import { bulkEligible } from "./model.js";
import { controls, render } from "./render.js";
import { download, importCSV } from "./csv.js";
import { PAGE_SIZE } from "./utils.js";
Object.assign(window, {
  setAdvanced,
  setManual,
  setTagMode,
  allGenreTags,
  decide,
  fieldChoice,
  allFields,
  toggleGenreTag,
  addGenreTag,
  setIncludeMix,
  useFoundRecord,
  clearRecord,
  openHistory,
  restoreHistory,
  openSettings,
  clearMetadataCache,
  saveSettings,
  loadRecordById,
  activateManual,
  connectLexicon,
});
systemTheme?.addEventListener("change", () => {
  if (state.themePreference === "system") applyTheme("system");
});
applyTheme();
loadTracks.onclick = loadFirst;
lexSearch.onclick = searchLexicon;
searchBtn.onclick = lookupAll;
acceptAll.onclick = () => {
  if (state.busy) return;
  state.rows.forEach((r) => {
    if (bulkEligible(r)) r.decision = "accepted";
  });
  render();
  controls();
};
rejectAll.onclick = () => {
  if (state.busy) return;
  state.rows.forEach((r) => {
    if (!r.applied) r.decision = "rejected";
  });
  render();
  controls();
};
applyBtn.onclick = applyAccepted;
exportBtn.onclick = download;
lexTab.onclick = () => setMode("lexicon");
csvTab.onclick = () => setMode("csv");
csvFile.onchange = async (e) => {
  if (e.target.files[0]) importCSV(await e.target.files[0].text());
};
loadDemo.onclick = () =>
  importCSV(
    "Location,Title,Artist,AlbumTitle,Genre,Year\n/Volumes/Music/Beyonce - Crazy in Love.mp3,Crazy in Love,Beyoncé,,HipHap,2003",
  );
window.addEventListener("error", (e) =>
  console.error(
    "[JS ERROR]",
    e.message,
    e.filename + ":" + e.lineno + ":" + e.colno,
    e.error,
  ),
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("[UNHANDLED PROMISE]", e.reason),
);
console.info(
  "[App] Lexicon Metadata Reviewer loaded",
  new Date().toISOString(),
);
localStorage.removeItem("sonovaultKey");
metadataSource.value =
  localStorage.getItem("metadataSource") || "audiodb-sonovault";
prevPage.onclick = () => loadPage(Math.max(0, state.pageOffset - PAGE_SIZE));
nextPage.onclick = () => loadPage(state.pageOffset + PAGE_SIZE);
for (const input of [lexArtist, lexTitle, lexGenre, lexAlbum, lexTag])
  input.onkeydown = (e) => {
    if (e.key === "Enter" && state.connected && !state.busy) searchLexicon();
  };
advancedMode.onchange = () => setAdvanced(advancedMode.checked);
window.addEventListener("load", async () => {
  await loadLocalSettings();
  await connectLexicon();
});
render();
controls();
