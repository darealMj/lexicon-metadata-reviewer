import { FIELDS, PAGE_SIZE, esc, val } from "./utils.js";
import {
  bulkEligible,
  canUse,
  finalValue,
  hasProposal,
  invalidManual,
  manualError,
  proposed,
  versionProtected,
} from "./model.js";
import { detectedMixTags, effectiveTags } from "./tags.js";
import { recordHTML, aiEvidence } from "./metadata.js";
import { state } from "./state.js";
import {
  $,
  acceptAll,
  advancedMode,
  applyBtn,
  csvFile,
  csvTab,
  exportBtn,
  lexSearch,
  lexTab,
  loadDemo,
  loadTracks,
  metadataSource,
  nextPage,
  pageInfo,
  prevPage,
  rejectAll,
  searchBtn,
  status,
  tbody,
} from "./dom.js";
function tagHTML(item) {
  const chips = item.genreTags
    .map(
      (t, i) =>
        `<label class="tagchip"><input type="checkbox" ${typeof t === "string" || t.enabled !== false ? "checked" : ""} onchange="toggleGenreTag(${item.id},${i},this.checked)">${esc(typeof t === "string" ? t : t.label)}</label>`,
    )
    .join("");
  return `<div class="tagbox"><div><b>Main Genre:</b> <span id="main-genre-${item.id}">${esc(finalValue(item, "Genre") || "—")}</span> <span class="muted">Always included in custom tags</span></div><div class="row" style="margin-top:8px"><label title="Off adds checked tags to existing tags. On replaces the complete custom tag list."><input type="checkbox" role="switch" aria-label="Overwrite custom tags for track ${item.id}" ${item.tagMode === "replace" ? "checked" : ""} onchange="setTagMode(${item.id},this.checked?'replace':'add')"> Overwrite custom tags</label><label title="When overwriting, also include version markers found in this song's original title."><input type="checkbox" role="switch" aria-label="Include Mix tags from title for track ${item.id}" ${item.includeMix !== false ? "checked" : ""} ${item.tagMode !== "replace" ? "disabled" : ""} onchange="setIncludeMix(${item.id},this.checked)"> Include Mix tags from title</label></div><div class="small muted" style="margin-top:8px">Mix tags detected: ${detectedMixTags(item).map(esc).join(", ") || "None"}</div>${item.tagMode === "replace" ? `<p id="tag-preview-${item.id}" style="color:#b42318">${effectiveTags(item).length ? "Only these custom tags will remain: " + effectiveTags(item).map(esc).join(", ") : "No tags selected: all custom tags will be cleared."}</p>` : ""}<div class="tagrow"><b class="small">Custom Genre Tags:</b><button class="secondary" onclick="allGenreTags(${item.id},true)">Select all</button><button class="secondary" onclick="allGenreTags(${item.id},false)">Clear all</button>${chips || '<span class="muted">No genre tags parsed</span>'}</div><div class="row" style="margin-top:7px"><input id="extra-${item.id}" type="text" placeholder="Add tag, e.g. Rap"><button class="secondary" onclick="addGenreTag(${item.id})">Add tag</button></div></div>`;
}
function reviewHTML(item) {
  const picker = recordHTML(item) + aiEvidence(item.result) + aiEvidence(item.reference),
    showRecord = state.advanced && !!item.reference;
  if (!hasProposal(item) && !state.advanced)
    return (
      picker +
      tagHTML(item) +
      (item.error
        ? `<p style="color:#b42318">${esc(item.error)}</p>`
        : '<p class="muted">Not looked up yet</p>')
    );
  const columns = 4 + (showRecord ? 1 : 0) + (state.advanced ? 1 : 0);
  let h = `<div class="field-grid" style="grid-template-columns:90px repeat(${columns - 1},minmax(140px,1fr));min-width:${columns * 145}px"><div class="head">Field</div><div class="head column-current">Current</div><div class="head column-api">API match</div>${showRecord ? '<div class="head column-record">Selected record</div>' : ""}${state.advanced ? '<div class="head column-manual">Type a value</div>' : ""}<div class="head column-final">Final output</div>`;
  for (const f of FIELDS) {
    const ch = item.fields[f] || "current",
      c = val(item.original, f);
    h += `<div class="field-name">${esc(f)}</div>`;
    for (const [choice, label, value] of [
      ["current", "Current", c],
      ["api", "API", proposed(item.result, f)],
      ...(showRecord
        ? [["record", "Record", proposed(item.reference, f)]]
        : []),
    ])
      h += `<div class="source-cell column-${choice}"><button data-field="${f}" data-choice="${choice}" aria-label="Use ${label} for ${f} on track ${item.id}" aria-pressed="${ch === choice}" class="source-value ${ch === choice ? "active" : ""}" onclick="fieldChoice(${item.id},'${f}','${choice}')" ${choice !== "current" && !canUse(item, f, choice) ? "disabled" : ""}>${esc(value || "—")}</button></div>`;
    if (state.advanced)
      h += `<div class="source-cell column-manual"><input type="text" class="typed-value ${ch === "manual" ? "active" : ""}" id="typed-${item.id}-${f}" aria-label="Typed ${f} for track ${item.id}" placeholder="Type a value" value="${esc(item.manual?.[f] ?? "")}" ${f === "Title" && versionProtected(item) ? "disabled" : ""} onfocus="activateManual(${item.id},'${f}',this.value)" oninput="setManual(${item.id},'${f}',this.value)"><span id="manual-error-${item.id}-${f}" class="muted" style="color:#b42318">${Object.hasOwn(item.manual || {}, f) ? esc(manualError(item, f)) : ""}</span></div>`;
    h += `<div class="final-value column-final" id="final-${item.id}-${f}">${esc(finalValue(item, f) || "—")}</div>`;
  }
  return (
    picker +
    h +
    "</div>" +
    (item.result
      ? item.result._ai ? "" : `<p class="muted">API text match score: ${Math.round((item.result._score || 0) * 100)}/100 — artist/title similarity, not verified identification.</p>`
      : "") +
    (versionProtected(item)
      ? `<span class="version-notice muted">Version title protected <span class="help-wrap"><button type="button" class="info-button" aria-label="Why this title is protected" aria-describedby="version-help-${item.id}">i</button><span id="version-help-${item.id}" class="help-tooltip" role="tooltip">A version word such as Clean, Extended, Remix, or Instrumental was found in this track’s title, file path, mix, or remixer. The original title is kept so a generic metadata title cannot remove that detail. Title selection and typing are disabled; other fields can still be edited. This is a text check, not audio identification.</span></span></span>`
      : "") +
    tagHTML(item) +
    (item.error
      ? `<p class="muted">Original API lookup: ${esc(item.error)}</p>`
      : "")
  );
}
function render() {
  tbody.innerHTML = state.rows
    .map((item) => {
      const a = val(item.original, "Artist"),
        t = val(item.original, "Title"),
        l = val(item.original, "Location"),
        cls = item.applied
          ? "applied"
          : item.decision === "accepted"
            ? "accepted"
            : item.decision === "rejected"
              ? "rejected"
              : "pending";
      const label = item.applied ? "applied" : item.decision;
      return `<tr data-row-id="${item.id}"><td>${item.id}</td><td><div class="track-title">${esc(a)} – ${esc(t)}</div>${l ? `<div class="muted location">${esc(l)}</div>` : ""}${item.lexiconId ? `<div class="muted">Lexicon ID: ${esc(item.lexiconId)}</div>` : ""}</td><td>${reviewHTML(item)}</td><td><span class="pill ${cls}">${label}</span></td><td><div class="actions"><button class="success" onclick="decide(${item.id},'accepted')" ${!hasProposal(item) || invalidManual(item) || item.applied ? "disabled" : ""}>Accept</button><button class="danger" onclick="decide(${item.id},'rejected')">Reject</button>${hasProposal(item) ? `<button class="secondary" onclick="allFields(${item.id},'api')" ${!item.result ? "disabled" : ""}>All API</button><button class="secondary" onclick="allFields(${item.id},'current')">All current</button>` : ""}</div></td></tr>`;
    })
    .join("");
  const m = state.rows.filter((r) => r.result).length,
    refs = state.rows.filter((r) => r.reference).length,
    a = state.rows.filter((r) => r.decision === "accepted").length,
    ap = state.rows.filter((r) => r.applied).length;
  status.textContent = state.rows.length
    ? `${state.rows.length} tracks · ${m} API matched${refs ? ` · ${refs} with selected records` : ""} · ${a} accepted${ap ? ` · ${ap} applied` : ""}`
    : "No tracks loaded";
}
function controls() {
  $("#retryConnection").classList.toggle(
    "hidden",
    state.connected || state.busy,
  );
  $("#retryConnection").disabled = state.busy;
  searchBtn.disabled = state.busy || !state.rows.some((r) => !r.applied);
  acceptAll.disabled = state.busy || !state.rows.some(bulkEligible);
  rejectAll.disabled = state.busy || !state.rows.length;
  exportBtn.disabled =
    state.busy ||
    !state.rows.some(
      (r) => r.decision === "accepted" && hasProposal(r) && !invalidManual(r),
    );
  applyBtn.disabled =
    state.busy ||
    state.sourceMode !== "lexicon" ||
    !state.connected ||
    !state.rows.some(
      (r) =>
        r.decision === "accepted" &&
        hasProposal(r) &&
        !invalidManual(r) &&
        !r.applied,
    );
  lexSearch.disabled = loadTracks.disabled = state.busy || !state.connected;
  $("#trackScope").disabled = state.busy || !state.connected;
  prevPage.disabled =
    state.busy || state.sourceMode !== "lexicon" || state.pageOffset === 0;
  nextPage.disabled =
    state.busy ||
    state.sourceMode !== "lexicon" ||
    state.pageOffset + PAGE_SIZE >= state.pageTotal;
  for (const e of [
    lexTab,
    csvTab,
    csvFile,
    loadDemo,
    metadataSource,
    advancedMode,
    $("#settingsButton"),
  ])
    e.disabled = state.busy;
  pageInfo.textContent =
    state.sourceMode === "lexicon" && state.pageTotal
      ? `${state.pageOffset + 1}–${Math.min(state.pageOffset + state.rows.length, state.pageTotal)} of ${state.pageTotal} tracks`
      : "";
  const showPagination = state.sourceMode === "lexicon" && state.rows.length > 0;
  $("#paginationTop").hidden = $("#paginationBottom").hidden = !showPagination;
  $("#prevPageBottom").disabled = prevPage.disabled;
  $("#nextPageBottom").disabled = nextPage.disabled;
  $("#pageInfoBottom").textContent = pageInfo.textContent;
  document.querySelectorAll("#tbody tr").forEach((tr) => {
    const item = state.rows.find((r) => r.id === Number(tr.dataset.rowId));
    if (state.busy || item?.applied)
      tr.querySelectorAll("button,input,select").forEach(
        (e) => (e.disabled = true),
      );
  });
}
export { tagHTML, reviewHTML, render, controls };
