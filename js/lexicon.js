import { state } from "./state.js";
import { makeRows, setBusy } from "./review.js";
import {
  $,
  connStatus,
  dbg,
  lexAlbum,
  lexArtist,
  lexGenre,
  lexTag,
  lexTitle,
  searchNotice,
  status,
} from "./dom.js";
import { api } from "./api.js";
import { FIELDS, PAGE_SIZE, payload, unwrapList, val } from "./utils.js";
import {
  effectiveTags,
  ensureCategory,
  ensureTag,
  findExistingTag,
  includedMixTags,
  parseTags,
  refreshTags,
  validLexiconId,
} from "./tags.js";
import { controls, render } from "./render.js";
import { canUse, chosenValue, hasProposal, invalidManual } from "./model.js";
async function connectLexicon() {
  if (state.busy) return;
  setBusy(true);
  connStatus.textContent = "Connecting to Lexicon…";
  connStatus.className = "status";
  try {
    const d = await api("/v1/tracks?limit=1&offset=0");
    unwrapList(d);
    state.connected = true;
    connStatus.textContent = "Connected to Lexicon";
    connStatus.className = "status ok";
    $("#connectionError").textContent = "";
    $("#connectionError").classList.toggle("hidden", true);
    try {
      parseTags(await api("/v1/tags"));
    } catch (e) {
      dbg("Tags preload failed", e.message);
    }
  } catch (e) {
    state.connected = false;
    connStatus.textContent = "Lexicon unavailable";
    connStatus.className = "status bad";
    $("#connectionError").textContent =
      "Open Lexicon DJ, go to Settings → Integrations, and enable Local API. Keep Lexicon running and open this reviewer through server.py. Once enabled, click Retry connection.";
    $("#connectionError").classList.toggle("hidden", false);
    dbg("Lexicon connection failed", e.message);
  } finally {
    state.busy = false;
    render();
    controls();
  }
}
async function loadPage(offset = 0) {
  if (state.busy) return;
  state.loadError = "";
  setBusy(true);
  try {
    status.textContent = "Loading Lexicon tracks…";
    let tracks, total;
    if (state.pageKind === "search") {
      tracks = state.searchTracks.slice(offset, offset + PAGE_SIZE);
      total = state.searchTracks.length;
    } else {
      const d = await api(`/v1/tracks?limit=${PAGE_SIZE}&offset=${offset}${$("#trackScope").value === "incoming" ? "&source=incoming" : ""}`);
      tracks = unwrapList(d);
      total = Number(payload(d)?.total ?? tracks.length);
    }
    state.pageOffset = offset;
    state.pageTotal = total;
    makeRows(tracks);
    dbg("Loaded page", {
      offset,
      count: tracks.length,
      total,
    });
  } catch (e) {
    dbg("Load failed", e.message);
    state.loadError = "Load failed: " + e.message;
  } finally {
    state.busy = false;
    render();
    controls();
    if (state.loadError) status.textContent = state.loadError;
  }
}
async function loadFirst() {
  if (state.busy) return;
  searchNotice.textContent = "";
  state.pageKind = "library";
  await loadPage(0);
}
function searchQuery() {
  const q = new URLSearchParams();
  if ($("#trackScope").value === "incoming") q.set("source", "incoming");
  for (const [field, input] of [
    ["artist", lexArtist],
    ["title", lexTitle],
    ["genre", lexGenre],
    ["albumTitle", lexAlbum],
  ]) {
    const text = input.value.trim();
    if (text) q.set(`filter[${field}]`, text);
  }
  const tag = lexTag.value.trim();
  if (tag) {
    const labels = [
      ...new Set(state.allTags.map((t) => String(val(t, "label", "name")))),
    ];
    const exact = labels.find((x) => x.toLowerCase() === tag.toLowerCase());
    const partial = labels.filter((x) =>
      x.toLowerCase().includes(tag.toLowerCase()),
    );
    if (!exact && partial.length !== 1)
      throw new Error(
        partial.length
          ? `Several tags match “${tag}”: ${partial.slice(0, 8).join(", ")}. Choose a full tag name from the suggestions.`
          : `No custom tag matches “${tag}”. Choose an existing tag from the suggestions.`,
      );
    q.set("filter[tags]", exact || partial[0]);
  }
  return q;
}
async function searchLexicon() {
  if (state.busy) return;
  if (
    ![lexArtist, lexTitle, lexGenre, lexAlbum, lexTag].some((input) =>
      input.value.trim(),
    )
  )
    return loadFirst();
  state.loadError = "";
  searchNotice.textContent = "";
  setBusy(true);
  try {
    status.textContent = "Searching Lexicon…";
    if (lexTag.value.trim()) await refreshTags();
    const q = searchQuery();
    const d = await api("/v1/search/tracks?" + q);
    const list = unwrapList(d);
    state.searchTracks = list;
    state.pageKind = "search";
    state.pageOffset = 0;
    state.pageTotal = list.length;
    makeRows(list.slice(0, PAGE_SIZE));
    const total = Number(payload(d)?.total ?? list.length);
    dbg("Search parsed", {
      count: list.length,
      total,
    });
    if (total > list.length)
      searchNotice.textContent = `Lexicon found ${total} matches but returned only the first ${list.length}. Narrow the filters to see other matches.`;
  } catch (e) {
    dbg("Search failed", e.message);
    state.loadError = "Search failed: " + e.message;
    searchNotice.textContent = e.message;
  } finally {
    state.busy = false;
    render();
    controls();
    if (state.loadError) status.textContent = state.loadError;
    else if (!state.rows.length)
      status.textContent = "No Lexicon tracks matched";
  }
}
async function patchTrack(id, patch, aiReview = null) {
  if (!validLexiconId(id)) throw new Error("Track has no valid Lexicon ID");
  return api("/v1/track", {
    method: "PATCH",
    body: JSON.stringify({
      id: Number(id),
      edits: patch,
      ...(aiReview ? {aiReview} : {}),
    }),
  });
}
async function applyOne(item) {
  if (!validLexiconId(item.lexiconId))
    throw new Error("Track has no valid Lexicon ID");
  if (invalidManual(item))
    throw new Error("Correct invalid typed fields before applying.");
  if (
    !state.advanced &&
    Object.values(item.fields).some((c) => ["record", "manual"].includes(c))
  )
    throw new Error("Enable Advanced mode to use record or typed values.");
  const patch = {},
    map = {
      Title: "title",
      Artist: "artist",
      AlbumTitle: "albumTitle",
      Genre: "genre",
      Year: "year",
      TrackNumber: "trackNumber",
      Label: "label",
    };
  for (const f of FIELDS) {
    const p = chosenValue(item, f);
    if (
      ["api", "record", "manual"].includes(item.fields[f]) &&
      canUse(item, f, item.fields[f]) &&
      (p !== "" || item.fields[f] === "manual")
    )
      patch[map[f]] = f === "Year" || f === "TrackNumber" ? Number(p) : p;
  }
  if (["api", "record"].includes(item.fields.Genre) && item.mainGenre)
    patch.genre = item.mainGenre;
  for (const field of ["year", "trackNumber"])
    if (field in patch && (!Number.isInteger(patch[field]) || patch[field] < 0))
      throw new Error("Invalid numeric value for " + field);
  const aiSource=item.fields.Genre === 'record' ? item.reference : item.result;
  const aiReview={genre:!!(aiSource?._ai && ['api','record'].includes(item.fields.Genre)),tags:[]};
  const aiTags=[...(item.result?._aiTags || []),...(item.reference?._aiTags || [])];
  const wanted = effectiveTags(item);
  if (wanted.length || item.tagMode === "replace") {
    // Read the latest tags to avoid replacing tags added since this page loaded.
    const d = payload(
        await api("/v1/track?id=" + encodeURIComponent(item.lexiconId)),
      ),
      current = d?.track;
    if (
      !current ||
      String(current.id) !== String(item.lexiconId) ||
      !Array.isArray(current.tags) ||
      !current.tags.every(validLexiconId)
    )
      throw new Error(
        "Could not read current track tags; no track update was sent.",
      );
    const ids = [];
    for (const label of wanted) {
      const suggested=aiTags.find(t=>t.label===label);
      if(suggested){
        const existing=state.allTags.find(t=>String(t.id)===String(suggested.id) && t.label===suggested.label && String(t.categoryId)===String(suggested.categoryId));
        if(!existing)throw new Error('An AI tag was removed or moved in Lexicon. Run lookup again before applying.');
        ids.push(Number(existing.id));aiReview.tags.push({id:existing.id,categoryId:existing.categoryId,label:existing.label});continue;
      }
      const categoryId =
        includedMixTags(item).includes(label) && !findExistingTag(label)
          ? (await ensureCategory("Mix")).id
          : undefined;
      ids.push(Number((await ensureTag(label, categoryId)).id));
    }
    patch.tags = [
      ...new Set(
        item.tagMode === "replace"
          ? ids
          : [...current.tags.map(Number), ...ids],
      ),
    ];
  }
  if (Object.keys(patch).length) await patchTrack(item.lexiconId, patch, aiReview.genre || aiReview.tags.length ? aiReview : null);
  item.applied = true;
  if (item.error?.startsWith("Lexicon write failed:")) item.error = null;
}
function applyConfirmation(todo) {
  const replaced = todo.filter((item) => item.tagMode === "replace");
  return (
    `Apply changes to ${todo.length} accepted Lexicon track(s)?` +
    (replaced.length
      ? "\n\nREPLACE ALL CUSTOM TAGS on these songs:\n" +
        replaced
          .map(
            (item) =>
              `${val(item.original, "Artist")} – ${val(item.original, "Title")} (Lexicon ${item.lexiconId}): ${effectiveTags(item).length ? effectiveTags(item).join(", ") : "CLEAR ALL CUSTOM TAGS"}`,
          )
          .join("\n")
      : "") +
    "\n\nOther songs keep their existing custom tags and add the selected genre and checked tags."
  );
}
async function applyAccepted() {
  if (state.busy) return;
  const todo = state.rows.filter(
    (r) =>
      r.decision === "accepted" &&
      hasProposal(r) &&
      !invalidManual(r) &&
      !r.applied,
  );
  if (!todo.length) return;
  if (!confirm(applyConfirmation(todo))) return;
  setBusy(true);
  try {
    if (todo.some((item) => effectiveTags(item).length)) await refreshTags();
  } catch (e) {
    state.busy = false;
    render();
    controls();
    alert("Could not refresh Lexicon tags: " + e.message);
    return;
  }
  for (let i = 0; i < todo.length; i++) {
    status.textContent = `Applying ${i + 1} of ${todo.length} to Lexicon…`;
    try {
      await applyOne(todo[i]);
    } catch (e) {
      todo[i].error = "Lexicon write failed: " + e.message;
      render();
      alert(
        `Stopped on ${val(todo[i].original, "Artist")} – ${val(todo[i].original, "Title")}\n\n${e.message}`,
      );
      break;
    }
    render();
    controls();
  }
  state.busy = false;
  render();
  controls();
}
export {
  connectLexicon,
  loadPage,
  loadFirst,
  searchQuery,
  searchLexicon,
  patchTrack,
  applyOne,
  applyConfirmation,
  applyAccepted,
};
