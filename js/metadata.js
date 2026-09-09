import { state } from "./state.js";
import { FIELDS, esc, payload, similarity, unwrapList, val } from "./utils.js";
import { splitGenres } from "./tags.js";
import { initChoices, invalidate, proposed, syncMainGenre } from "./model.js";
import { editable, setBusy } from "./review.js";
import { $, metadataSource, status } from "./dom.js";
import { controls, render } from "./render.js";
import { localMetadata } from "./api.js";
function registerRecord(result, provider, id) {
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
function recordHTML(item) {
  if (!state.advanced)
    return item.result
      ? `<p class="muted">API match: ${esc(recordLabel(item.result))}</p>`
      : "";
  const options = [...state.sourceRecords.entries()]
    .map(
      ([key, r]) =>
        `<option value="${esc(key)}">${esc(recordLabel(r))}</option>`,
    )
    .join("");
  return `<div class="tagbox"><b>Use metadata from a source record</b>${item.result ? `<p class="muted">API match: ${esc(recordLabel(item.result))}</p>` : ""}${item.reference ? `<p class="muted">Selected record: ${esc(recordLabel(item.reference))}</p>` : ""}
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
  item.genreTags = splitGenres(proposed(record, "Genre")).map((label) => ({
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
  return ["AlbumTitle", "Genre", "Year", "TrackNumber", "Label"].some(
    (f) => !proposed(r, f),
  );
}
function mergeResults(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const chosen =
    (primary._score || 0) < 0.55 &&
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
    src === "audiodb"
      ? lookupAudioDB(artist, title, audioKey)
      : lookupSonovault(artist, title, svKey);
  const pair = mode.split("-");
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
      (!first || usefulMissing(first) || (first._score || 0) < 0.55)
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
    if ((result._score || 0) < 0.55) item.error = "Low-confidence result";
    initChoices(item);
  } catch (e) {
    item.error = "API error: " + e.message;
  }
}
async function lookupAll() {
  if (state.busy) return;
  setBusy(true);
  const akey = "",
    svkey = "",
    mode = metadataSource.value;
  localStorage.setItem("metadataSource", mode);
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
    state.busy = false;
    render();
    controls();
  }
}
export {
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
