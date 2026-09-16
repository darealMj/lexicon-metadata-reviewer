import { state } from "./state.js";
import { controls, render } from "./render.js";
import {
  canUse,
  finalValue,
  hasProposal,
  invalidManual,
  invalidate,
  manualError,
  rememberRows,
  syncMainGenre,
  trackId,
  trackToOriginal,
  versionProtected,
} from "./model.js";
import {
  $,
  advancedMode,
  csvPanel,
  csvTab,
  lexPanel,
  lexTab,
  status,
} from "./dom.js";
import { FIELDS } from "./utils.js";
import { effectiveTags } from "./tags.js";
function setBusy(value) {
  state.busy = value;
  controls();
}
function makeRows(tracks) {
  rememberRows();
  state.rows = tracks.map((t, i) => {
    const cached = state.reviewCache.get(String(trackId(t)));
    return cached
      ? {
          ...cached,
          usePageOverrides: false,
          id: i + 1,
        }
      : {
          id: i + 1,
          lexiconTrack: t,
          lexiconId: trackId(t),
          original: trackToOriginal(t),
          ...state.tagDefaults,
          result: null,
          decision: "pending",
          error: null,
          fields: {},
          mainGenre: "",
          genreTags: [],
          applied: false,
        };
  });
  render();
  controls();
}
function editable(id) {
  return !state.busy && state.rows.find((r) => r.id === id && !r.applied);
}
function setAdvanced(on) {
  if (state.busy) return;
  state.advanced = !!on;
  advancedMode.checked = state.advanced;
  if (!state.advanced) {
    const all = new Set([...state.rows, ...state.reviewCache.values()]);
    for (const item of all) {
      if (item.applied) continue;
      let changed = false;
      for (const f of FIELDS)
        if (["record", "manual"].includes(item.fields[f])) {
          item.fields[f] = "current";
          changed = true;
        }
      if (changed) {
        syncMainGenre(item);
        invalidate(item);
      }
    }
  }
  render();
  controls();
}
function setManual(id, f, value) {
  const item = editable(id);
  if (
    !state.advanced ||
    !item ||
    !FIELDS.includes(f)
  )
    return;
  item.manual ??= {};
  item.manual[f] = value;
  item.fields[f] = "manual";
  if (f === "Genre") syncMainGenre(item);
  invalidate(item);
  const output = $(`#final-${id}-${f}`);
  if (output) output.textContent = value || "—";
  const input = $(`#typed-${id}-${f}`);
  if (input) input.classList.toggle("active", true);
  document
    .querySelectorAll(`tr[data-row-id="${id}"] button[data-field="${f}"]`)
    .forEach((button) => {
      button.classList.toggle("active", false);
      button.setAttribute("aria-pressed", "false");
    });
  if (f === "Genre") {
    const genre = $(`#main-genre-${id}`);
    if (genre) genre.textContent = finalValue(item, "Genre") || "—";
    const preview = $(`#tag-preview-${id}`);
    if (preview)
      preview.textContent = effectiveTags(item).length
        ? "Only these custom tags will remain: " +
          effectiveTags(item).join(", ")
        : "No tags selected: all custom tags will be cleared.";
  }
  const error = $(`#manual-error-${id}-${f}`);
  if (error) error.textContent = manualError(item, f);
  const button = document.querySelector(
    `[aria-label="Use Typed for ${f} on track ${id}"]`,
  );
  if (button) button.disabled = !canUse(item, f, "manual");
  const row = document.querySelector(`tr[data-row-id="${id}"]`);
  if (row) {
    const decision = row.querySelector(".pill");
    if (decision) {
      decision.textContent = "pending";
      decision.className = "pill pending";
    }
    const accept = row.querySelector(".actions .success");
    if (accept) accept.disabled = !hasProposal(item) || invalidManual(item);
  }
  status.textContent = `${state.rows.length} tracks · ${state.rows.filter((r) => r.decision === "accepted").length} accepted`;
  controls();
}
function decide(id, d) {
  const x = editable(id);
  if (x && (d !== "accepted" || (hasProposal(x) && !invalidManual(x)))) {
    x.decision = d;
    render();
    controls();
  }
}
function fieldChoice(id, f, c) {
  const x = editable(id);
  if (
    x &&
    (!["record", "manual"].includes(c) || state.advanced) &&
    ["current", "api", "record", "manual"].includes(c) &&
    (c === "current" || canUse(x, f, c))
  ) {
    x.fields[f] = c;
    if (f === "Genre") syncMainGenre(x);
    invalidate(x);
    render();
    controls();
  }
}
function allFields(id, c) {
  const x = editable(id);
  if (!x) return;
  FIELDS.forEach(
    (f) => (x.fields[f] = c === "api" && canUse(x, f) ? "api" : "current"),
  );
  syncMainGenre(x);
  if (c === "current") x.tagMode = "add";
  if (c === "current")
    x.genreTags = x.genreTags.map((t) => ({
      label: typeof t === "string" ? t : t.label,
      enabled: false,
    }));
  invalidate(x);
  render();
  controls();
}
function setMode(mode) {
  if (state.busy) return;
  rememberRows();
  state.pageOffset = 0;
  state.pageTotal = 0;
  state.sourceMode = mode;
  lexPanel.classList.toggle("hidden", mode !== "lexicon");
  csvPanel.classList.toggle("hidden", mode !== "csv");
  lexTab.classList.toggle("active", mode === "lexicon");
  csvTab.classList.toggle("active", mode === "csv");
  state.rows = [];
  render();
  controls();
}
function activateManual(id, f, value) {
  const item = editable(id);
  if (item && Object.hasOwn(item.manual || {}, f)) setManual(id, f, value);
}
export {
  setBusy,
  makeRows,
  editable,
  setAdvanced,
  setManual,
  decide,
  fieldChoice,
  allFields,
  setMode,
  activateManual,
};
