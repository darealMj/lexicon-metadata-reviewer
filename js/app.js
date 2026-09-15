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
const trackScope = document.querySelector("#trackScope");
trackScope.value = localStorage.getItem("trackScope") === "incoming" ? "incoming" : "non-archived";
trackScope.onchange = () => {
  localStorage.setItem("trackScope", trackScope.value);
  if (state.connected && !state.busy) searchLexicon();
};
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
const savedSource = (localStorage.getItem("metadataSource") || "audiodb-sonovault").split("-");
const allowedSources = ["ai", "discogs", "audiodb", "sonovault"];
metadataSource.value = allowedSources.includes(savedSource[0]) ? savedSource[0] : "audiodb";
const fallbackSelect = document.querySelector("#metadataFallback");
const savedFallback = localStorage.getItem("metadataFallback") ?? savedSource[1] ?? "";
fallbackSelect.value = allowedSources.includes(savedFallback) && savedFallback !== metadataSource.value ? savedFallback : "";
function saveSourceChoices() {
  if(fallbackSelect.value === metadataSource.value) fallbackSelect.value = "";
  for(const option of (fallbackSelect.options || [])) option.disabled = option.value === metadataSource.value;
  localStorage.setItem("metadataSource", metadataSource.value);
  localStorage.setItem("metadataFallback", fallbackSelect.value);
}
metadataSource.onchange = saveSourceChoices;
fallbackSelect.onchange = saveSourceChoices;
saveSourceChoices();
prevPage.onclick = () => loadPage(Math.max(0, state.pageOffset - PAGE_SIZE));
nextPage.onclick = () => loadPage(state.pageOffset + PAGE_SIZE);
document.querySelector("#prevPageBottom").onclick = prevPage.onclick;
document.querySelector("#nextPageBottom").onclick = nextPage.onclick;
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

let overridePreviewTimer;
window.setPageOverride = (field,value) => {
  if(state.busy || !['Title','Artist','AlbumTitle','Genre','Year','TrackNumber','Label','CustomTags'].includes(field)) return;
  state.pageOverrides ??= {};
  state.pageOverrides[field] = value;
  for(const item of state.rows) if(item.usePageOverrides && !item.applied) item.decision='pending';
  document.querySelector('#overrideError').textContent = ['Year','TrackNumber'].some(f=>String(state.pageOverrides[f] || '').trim() && (!/^\d+$/.test(state.pageOverrides[f].trim()) || !Number.isSafeInteger(Number(state.pageOverrides[f])))) ? 'Year and track number must be whole numbers of 0 or greater.' : '';
  // Store values and invalidate approvals immediately; batch expensive row rendering.
  clearTimeout(overridePreviewTimer);
  if(state.rows.some(item=>item.usePageOverrides && !item.applied)) {
    controls();
    overridePreviewTimer = setTimeout(() => { render(); controls(); }, 200);
  }
};
window.togglePageOverride = (id,enabled) => {
  if(state.busy)return;
  const item=state.rows.find(r=>r.id===id);
  if(!item || item.applied)return;
  item.usePageOverrides=enabled; item.decision='pending'; render(); controls();
};
window.allPageOverrides = enabled => {
  if(state.busy)return;
  for(const item of state.rows) if(!item.applied){item.usePageOverrides=enabled;item.decision='pending';}
  render(); controls();
};

const overridePillColors = new Map();
function drawOverrideTagPills() {
  const container=document.querySelector('#overrideTagPills');
  container.replaceChildren();
  const tags=String(state.pageOverrides?.CustomTags || '').split(',').map(t=>t.trim()).filter(Boolean);
  tags.forEach((tag,index)=>{
    const pill=document.createElement('span');pill.className='tagchip override-tag-pill';
    const colorKey=tag.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
    if(!overridePillColors.has(colorKey)) overridePillColors.set(colorKey, Math.floor(Math.random()*5));
    pill.classList.add('override-color-'+overridePillColors.get(colorKey));
    const text=document.createElement('span');text.textContent=tag;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+tag);
    remove.onclick=()=>{
      if(state.busy)return;
      tags.splice(index,1);window.setPageOverride('CustomTags',tags.join(', '));drawOverrideTagPills();
    };
    pill.append(text,remove);container.append(pill);
  });
}
window.commitOverrideTags=(input,flush)=>{
  if(state.busy)return;
  const parts=input.value.split(',');
  if(!flush && parts.length===1)return;
  const remaining=flush?'':parts.pop();
  const tags=String(state.pageOverrides?.CustomTags || '').split(',').map(t=>t.trim()).filter(Boolean);
  const key=t=>t.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
  for(const part of parts){const tag=part.trim();if(tag && !tags.some(t=>key(t)===key(tag)))tags.push(tag);}
  input.value=remaining;
  window.setPageOverride('CustomTags',tags.join(', '));drawOverrideTagPills();
};

window.setOverrideTagMode = enabled => {
  if(state.busy)return;
  state.pageOverrides ??= {};
  state.pageOverrides.OverwriteTags=!!enabled;
  for(const item of state.rows) if(item.usePageOverrides && !item.applied)item.decision='pending';
  const note=document.querySelector('#overrideTagModeNote');
  note.textContent=enabled?'Custom tags · Overwrite mode':'Custom tags · Additive mode';
  note.classList.toggle('overwrite',!!enabled);
  render();controls();
};
