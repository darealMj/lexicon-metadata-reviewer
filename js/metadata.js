import { state } from "./state.js";
import { FIELDS, esc, payload, similarity, unwrapList, val } from "./utils.js";
import { splitGenres } from "./tags.js";
import { initChoices, invalidate, proposed, syncMainGenre } from "./model.js";
import { editable, setBusy } from "./review.js";
import { $, metadataSource, status } from "./dom.js";
import { controls, render } from "./render.js";
import { localMetadata } from "./api.js";
function registerRecord(result, provider, id) {
  result._savedAt = Date.now();
  result._provider = provider;
  result._recordId =
    typeof id === "string" || typeof id === "number" ? String(id) : "";
  if (result._recordId)
    state.sourceRecords.set(
      provider + ":" + result._recordId,
      JSON.parse(JSON.stringify(result)),
    );
  return result;
}
function recordLabel(r) {
  return `${r._source} · ID ${r._recordId || "not supplied"} · ${r.strArtist || "Unknown artist"} — ${r.strTrack || "Untitled"}${r.strAlbum ? " · " + r.strAlbum : ""}`;
}
function discogsChoices(item) {
  if(!item.discogsCandidates?.length)return '';
  return `<div class="tagbox"><label>Discogs release <select onchange="chooseDiscogs(${item.id},this.value)">${item.discogsCandidates.map(c=>`<option value="${esc(String(c.id))}" ${String(c.id)===item.result?._recordId?'selected':''}>${esc(c.title)} · ${esc(String(c.year || 'Year unknown'))} · ${esc(c.country || '')} · ${esc((c.format || []).join(', '))} · ID ${esc(String(c.id))}</option>`).join('')}</select></label><p>Release year may describe a reissue. Review the source before applying.</p></div>`;
}
function recordHTML(item) {
  if (!state.advanced)
    return discogsChoices(item) + (item.result
      ? `<p class="muted">API match: ${esc(recordLabel(item.result))}</p>`
      : "");
  const options = [...state.sourceRecords.entries()]
    .sort((a,b)=>(b[1]._savedAt || 0)-(a[1]._savedAt || 0))
    .map(
      ([key, r]) =>
        `<option value="${esc(key)}">${esc(recordLabel(r))}</option>`,
    )
    .join("");
  return discogsChoices(item) + `<div class="tagbox"><b>Use metadata from a source record</b>${item.result ? `<p class="muted">API match: ${esc(recordLabel(item.result))}</p>` : ""}${item.reference ? `<p class="muted">Selected record: ${esc(recordLabel(item.reference))}</p>` : ""}
 <div class="row"><label>Saved source records <select id="record-choice-${item.id}" aria-label="Source record for track ${item.id}" style="max-width:420px"><option value="">Choose a found record…</option>${options}</select></label><button class="secondary" onclick="useFoundRecord(${item.id})" ${!options ? "disabled" : ""}>Use selected record</button></div>
 <details style="margin-top:8px"><summary>Enter a source track ID</summary><div class="row" style="margin-top:8px"><select id="record-provider-${item.id}" aria-label="Record provider for track ${item.id}"><option value="audiodb">TheAudioDB</option><option value="sonovault">SonoVault</option></select><input id="record-id-${item.id}" type="text" placeholder="Provider track ID" aria-label="Record ID for track ${item.id}"><button class="secondary" onclick="loadRecordById(${item.id})">Load record by ID</button></div></details>
 ${item.reference ? `<p class="muted">Click values in Selected record to reuse individual fields. This does not identify or approve this local version.</p><button class="secondary" onclick="clearRecord(${item.id})">Remove selected record</button>` : ""}
 ${item.recordError ? `<p role="alert" style="color:#b42318">${esc(item.recordError)}</p>` : ""}</div>`;
}
function attachRecord(item, record) {
  item.tagMode ??= state.tagDefaults.tagMode;
  item.reference = JSON.parse(JSON.stringify(record));
  item.recordError = "";
  item.decision = "pending";
  FIELDS.forEach((f) => (item.fields[f] = "current"));
  item.genreTags = (record._ai ? (record._aiTags || []).map(t=>t.label) : splitGenres(proposed(record, "Genre"))).map((label) => ({
    label,
    enabled: false,
  }));
  syncMainGenre(item);
}
function useFoundRecord(id) {
  const item = editable(id);
  if (!state.advanced || !item) return;
  const record = state.sourceRecords.get($(`#record-choice-${id}`).value);
  if (!record) {
    item.recordError = "Choose a source record first.";
  } else attachRecord(item, record);
  render();
  controls();
}
function clearRecord(id) {
  const item = editable(id);
  if (!state.advanced || !item) return;
  item.reference = null;
  item.recordError = "";
  FIELDS.forEach((f) => {
    if (item.fields[f] === "record") item.fields[f] = "current";
  });
  item.genreTags = [];
  syncMainGenre(item);
  invalidate(item);
  render();
  controls();
}
async function fetchRecordById(provider, id) {
  id = String(id).trim();
  if (!/^[0-9]+$/.test(id))
    throw new Error(
      "Enter the numeric track ID from the selected provider, not a Lexicon ID or album ID.",
    );
  if (!["audiodb", "sonovault"].includes(provider))
    throw new Error("Choose a supported provider.");
  const cached = state.sourceRecords.get(provider + ":" + id);
  if (cached) return cached;
  const { payload: d } = await localMetadata(
    provider + "/record?id=" + encodeURIComponent(id),
  );
  const raw =
    provider === "audiodb"
      ? d.track?.find((t) => String(t.idTrack) === id)
      : payload(d)?.track || payload(d);
  const returnedId =
    provider === "audiodb"
      ? raw?.idTrack
      : (raw?.id ?? raw?.track_id ?? raw?.trackId);
  if (!raw || String(returnedId) !== id)
    throw new Error("The provider did not return the requested track ID.");
  return commonResult(provider, raw, "", "");
}
async function loadRecordById(id) {
  const item = editable(id);
  if (!state.advanced || !item) return;
  const provider = $(`#record-provider-${id}`).value,
    recordId = $(`#record-id-${id}`).value;
  setBusy(true);
  try {
    const record = await fetchRecordById(provider, recordId);
    attachRecord(item, record);
  } catch (e) {
    item.recordError = "Could not load record: " + e.message;
  } finally {
    state.busy = false;
    render();
    controls();
  }
}
function commonResult(source, c, artist, title) {
  if (source === "audiodb") {
    const score =
      (similarity(c.strArtist, artist) + similarity(c.strTrack, title)) / 2;
    const r = {
      strTrack: c.strTrack || "",
      strArtist: c.strArtist || "",
      strAlbum: c.strAlbum || "",
      strGenre: c.strGenre || "",
      intYearReleased: c.intYearReleased || c.intYear || "",
      intTrackNumber: c.intTrackNumber || "",
      strLabel: c.strLabel || "",
      _source: "TheAudioDB",
      _score: score,
      _raw: c,
      _sources: {},
    };
    FIELDS.forEach((f) => {
      if (proposed(r, f) !== "") r._sources[f] = "TheAudioDB";
    });
    return registerRecord(r, "audiodb", c.idTrack);
  }
  const artists = Array.isArray(c.artists)
    ? c.artists
        .map((a) => (typeof a === "string" ? a : a.name || a.artist || ""))
        .filter(Boolean)
    : [];
  const artistName =
    artists.join(", ") || c.artist || c.artist_name || c.artistName || "";
  const releases = Array.isArray(c.releases) ? c.releases : [];
  const rel = releases[0] || c.release || {};
  const album =
    (typeof rel === "string"
      ? rel
      : rel.title || rel.name || rel.album || "") ||
    c.album ||
    c.release_title ||
    "";
  let genres = c.genres ?? c.genre ?? c.genre_tags ?? c.tags ?? [];
  if (Array.isArray(genres))
    genres = genres
      .map((g) =>
        typeof g === "string" ? g : g.name || g.label || g.genre || "",
      )
      .filter(Boolean)
      .join(", ");
  else if (genres && typeof genres === "object")
    genres = Object.values(genres)
      .filter((v) => typeof v === "string")
      .join(", ");
  const date =
    c.release_date ||
    c.releaseDate ||
    c.date ||
    (typeof rel === "object" &&
      (rel.release_date || rel.releaseDate || rel.date || rel.year)) ||
    "";
  const year =
    String(date || "").match(/\b(19|20)\d{2}\b/)?.[0] || c.year || "";
  let label =
    c.label ||
    c.record_label ||
    (typeof rel === "object" &&
      (rel.label?.name || rel.label || rel.record_label)) ||
    "";
  if (label && typeof label === "object")
    label = label.name || label.label || "";
  const score =
    (similarity(artistName, artist) +
      similarity(c.title || c.name || "", title)) /
    2;
  const r = {
    strTrack: c.title || c.name || "",
    strArtist: artistName,
    strAlbum: album,
    strGenre: genres || "",
    intYearReleased: year,
    intTrackNumber: c.track_number || c.trackNumber || c.position || "",
    strLabel: label || "",
    _source: "Sonovault",
    _score: Number.isFinite(score) ? score : 0,
    _raw: c,
    _sources: {},
  };
  FIELDS.forEach((f) => {
    if (proposed(r, f) !== "") r._sources[f] = "Sonovault";
  });
  return registerRecord(r, "sonovault", c.id ?? c.track_id ?? c.trackId);
}
async function discogsRecord(item,id) {
  const r=await localMetadata('discogs/record?'+new URLSearchParams({id,artist:val(item.original,'Artist'),title:val(item.original,'Title')}));
  return registerRecord({strTrack:r.title || '',strArtist:(r.artists || []).join(', '),strAlbum:r.album || '',strGenre:r.main_genre || '',intYearReleased:r.year || '',strLabel:r.label || '',
    _source:'Discogs',_score:0,_ai:true,_discogs:true,_aiTags:r.categorized_tags,_warnings:r.warnings,_links:r.sources,_raw:r},'discogs',id);
}
async function lookupDiscogs(item) {
  const data=await localMetadata('discogs/search?'+new URLSearchParams({artist:val(item.original,'Artist'),title:val(item.original,'Title')}));
  item.discogsCandidates=(data.results || []).filter(c=>c.type==='release' && Number.isInteger(c.id));
  return item.discogsCandidates.length ? discogsRecord(item,String(item.discogsCandidates[0].id)) : null;
}
window.chooseDiscogs=async(id,releaseId)=>{
  const item=editable(id);if(!item || !item.discogsCandidates?.some(c=>String(c.id)===releaseId))return;
  setBusy(true);
  try {const result=await discogsRecord(item,releaseId);item.result=result;item.reference=null;item.manual={};initChoices(item);item.error='Discogs release requires individual review';invalidate(item);}
  catch(e){item.error=e.message;}
  finally{setBusy(false);render();controls();}
};
async function lookupAI(artist, title, currentAlbum = "") {
  const response=await fetch('/metadata/ai/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist,title,...(currentAlbum.trim() ? {current_album:currentAlbum.trim()} : {})})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'AI lookup failed');
  const r=data.result;
  return registerRecord({strTrack:r.title || '',strArtist:(r.artists || []).join(', '),strAlbum:r.album || '',strGenre:r.main_genre || '',intYearReleased:r.year || '',intTrackNumber:'',strLabel:r.label || '',
    _source:'AI / '+(r.resolved_model || r.model),_score:0,_ai:true,_cached:data.cached,_aiTags:r.categorized_tags,_warnings:r.warnings,
    _links:r.sources || [],_sources:{},_raw:r},'ai',data.id);
}
function aiEvidence(result) {
  if(!result?._ai)return '';
  if(result._discogs)return `<div class="tagbox"><b>Discogs release metadata</b><p>Genres: ${esc((result._raw.genres || []).join(', ') || 'None supplied')} · Styles: ${esc((result._raw.styles || []).join(', ') || 'None supplied')}</p>${(result._warnings || []).map(w=>`<p>${esc(w)}</p>`).join('')}<a href="https://www.discogs.com/release/${esc(result._recordId)}" target="_blank" rel="noopener noreferrer">View release on Discogs</a></div>`;
  const cost=result._raw?.usage?.cost;
  const costHTML=typeof cost==='number' && Number.isFinite(cost) && cost>=0 ? `<span class="ai-price-pill">${result._cached?'Original lookup':'Reported lookup'}: $${cost.toFixed(6)}</span>` : '';
  const wiki=result._raw?.wikipedia;
  const wikiHTML=wiki?.status==='matched' ? `<div><b>Wikipedia source evidence</b><p><a href="${esc(wiki.url)}" target="_blank" rel="noopener noreferrer">${esc(wiki.title)}</a> · Revision ${esc(String(wiki.revision_id || 'unknown'))} · Retrieved ${esc(wiki.retrieved_at)}</p>${Object.entries(wiki.fields).map(([k,v])=>`<p>${esc(k)}: ${esc(v)}</p>`).join('')}<p>AI mapping: ${esc(wiki.fields.genre || 'No source genre')} → ${esc(result.strGenre || 'Unresolved main genre')}</p></div>` : '';
  const links=(result._links || []).filter(s=>/^https?:\/\//i.test(s.url)).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)} (${esc(s.origin)})</a>`).join(' · ');
  return `<div class="tagbox">${costHTML}<b>AI suggestion · ${result._cached?'cached':'fresh'}</b><p>Review each field before accepting. Sources do not verify every suggestion.</p>${(result._warnings || []).map(w=>`<p>${esc(w)}</p>`).join('')}${wikiHTML}${links || '<p>No additional source links returned.</p>'}<p>${(result._aiTags || []).map(t=>`${esc(t.category)}: ${esc(t.label)} (${Math.round(t.confidence*100)}% self-reported)`).join(' · ')}</p></div>`;
}
async function lookupAudioDB(artist, title) {
  const { payload: d } = await localMetadata(
    "audiodb/search?" +
      new URLSearchParams({
        artist,
        title,
      }),
  );
  const candidates = d.track || [];
  return (
    candidates
      .map((c) => commonResult("audiodb", c, artist, title))
      .sort((a, b) => b._score - a._score)[0] || null
  );
}
async function lookupSonovault(artist, title) {
  const { payload: d } = await localMetadata(
    "sonovault/search?" +
      new URLSearchParams({
        artist,
        title,
      }),
  );
  return (
    unwrapList(d)
      .map((c) => commonResult("sonovault", c, artist, title))
      .sort((a, b) => b._score - a._score)[0] || null
  );
}
function usefulMissing(r) {
  return (r?._ai ? ["AlbumTitle", "Genre", "Year", "Label"] : ["AlbumTitle", "Genre", "Year", "TrackNumber", "Label"]).some(
    (f) => !proposed(r, f),
  );
}
function mergeResults(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const completeness = r => ["AlbumTitle", "Genre", "Year", "Label"].filter(f=>proposed(r,f)).length;
  const chosen = primary._ai || secondary._ai
    ? (completeness(secondary) > completeness(primary) ? secondary : primary)
    : (primary._score || 0) < 0.55 &&
    (secondary._score || 0) > (primary._score || 0) + 0.08
      ? secondary
      : primary;
  return {
    ...chosen,
    _alternative: chosen === primary ? secondary : primary,
  };
}
async function metadataLookup(item, audioKey, svKey, mode) {
  const artist = val(item.original, "Artist"),
    title = val(item.original, "Title");
  item.result = null;
  item.error = null;
  item.discogsCandidates = [];
  item.tagMode ??= state.tagDefaults.tagMode;
  item.decision = "pending";
  item.fields = {};
  item.genreTags = [];
  item.mainGenre = "";
  if (!artist || !title) {
    item.error = "Missing Artist or Title";
    return;
  }
  const get = async (src) =>
    src === "discogs" ? lookupDiscogs(item) : src === "ai" ? lookupAI(artist,title,String(val(item.original,"AlbumTitle") || "")) : src === "audiodb"
      ? lookupAudioDB(artist, title, audioKey)
      : lookupSonovault(artist, title, svKey);
  const pair = [...new Set(mode.split("-").filter(Boolean))];
  try {
    let first = null,
      primaryError = "";
    try {
      first = await get(pair[0]);
    } catch (e) {
      if (pair.length === 1) throw e;
      primaryError = e.message;
    }
    let result = first;
    if (
      pair.length > 1 &&
      (!first || usefulMissing(first) || (!first._ai && (first._score || 0) < 0.55))
    ) {
      let second = null;
      try {
        second = await get(pair[1]);
      } catch (e) {
        if (!first) throw e;
      }
      result = mergeResults(first, second);
    }
    if (!result) {
      item.error = primaryError
        ? "Primary lookup failed: " + primaryError + "; fallback found no match"
        : "No match";
      return;
    }
    item.result = result;
    if (result._ai) item.error = result._discogs ? "Discogs release requires individual review" : "AI suggestion requires individual review";
    else if ((result._score || 0) < 0.55) item.error = "Low-confidence result";
    initChoices(item);
  } catch (e) {
    item.error = "API error: " + e.message;
  }
}
async function lookupAll() {
  if (state.busy) return;
  const fallback = $("#metadataFallback").value;
  const sources = [metadataSource.value, fallback].filter((s,i,a)=>s && a.indexOf(s)===i);
  if(sources.includes('ai') && !confirm(`Look up ${state.rows.filter(r=>!r.applied).length} tracks using Model 1 from AI lab? Uncached tracks incur model/search charges. Artist, title, and the allowed custom-tag taxonomy are sent to the provider.`))return;
  setBusy(true);
  $("#searchBtn").classList.toggle("is-loading", true);
  $("#searchBtn").setAttribute?.("aria-busy", "true");
  const akey = "",
    svkey = "",
    mode = sources.join("-");
  localStorage.setItem("metadataSource", metadataSource.value);
  localStorage.setItem("metadataFallback", fallback);
  try {
    const pending = state.rows.filter((r) => !r.applied);
    for (let i = 0; i < pending.length; i++) {
      await metadataLookup(pending[i], akey, svkey, mode);
      render();
      controls();
      status.textContent = `Looked up ${i + 1} of ${pending.length}`;
      if (i < pending.length - 1)
        await new Promise((r) =>
          setTimeout(r, mode.includes("sonovault") ? 3100 : 2100),
        );
    }
  } finally {
    $("#searchBtn").classList.toggle("is-loading", false);
    $("#searchBtn").setAttribute?.("aria-busy", "false");
    state.busy = false;
    render();
    controls();
  }
}
export {
  lookupAI,
  aiEvidence,
  registerRecord,
  recordLabel,
  recordHTML,
  attachRecord,
  useFoundRecord,
  clearRecord,
  fetchRecordById,
  loadRecordById,
  commonResult,
  lookupAudioDB,
  lookupSonovault,
  usefulMissing,
  mergeResults,
  metadataLookup,
  lookupAll,
};
