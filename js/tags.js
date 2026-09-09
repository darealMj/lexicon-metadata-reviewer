import { editable } from "./review.js";
import { finalValue, invalidate } from "./model.js";
import { controls, render } from "./render.js";
import { $, tagSuggestions } from "./dom.js";
import { esc, payload, unwrapList, val } from "./utils.js";
import { state } from "./state.js";
import { api } from "./api.js";
const GENRE_ALIASES = {
  "hip hop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  hiphop: "Hip-Hop",
  "r&b": "R&B",
  rnb: "R&B",
  "rhythm and blues": "R&B",
  rap: "Rap",
  pop: "Pop",
  soul: "Soul",
  funk: "Funk",
  reggae: "Reggae",
  dancehall: "Dancehall",
  rock: "Rock",
  house: "House",
  disco: "Disco",
  electronic: "Electronic",
  dance: "Dance",
  country: "Country",
  jazz: "Jazz",
  latin: "Latin",
  afrobeat: "Afrobeat",
  afrobeats: "Afrobeats",
};
function canonicalGenre(s) {
  const raw = (s || "").trim();
  const key = raw.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  return (
    GENRE_ALIASES[key] ||
    raw.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/R&B/gi, "R&B")
  );
}
function splitGenres(s) {
  if (!s) return [];
  let x = s
    .replace(/R\s*&\s*B/gi, "R_AND_B")
    .replace(/Hip\s*-?\s*Hop/gi, "HIP_HOP");
  let parts = x
    .split(/\s*[,;/|+]\s*|\s+&\s+/)
    .flatMap((p) => p.split(/\s*\/\s*/));
  return [
    ...new Set(
      parts
        .map((p) =>
          p
            .replace(/R_AND_B/g, "R&B")
            .replace(/HIP_HOP/g, "Hip-Hop")
            .trim(),
        )
        .filter(Boolean)
        .map(canonicalGenre),
    ),
  ];
}
function setTagMode(id, mode) {
  const item = editable(id);
  if (!item || !["add", "replace"].includes(mode)) return;
  item.tagMode = mode;
  invalidate(item);
  render();
  controls();
}
function allGenreTags(id, on) {
  const item = editable(id);
  if (!item) return;
  item.genreTags = item.genreTags.map((t) => ({
    label: typeof t === "string" ? t : t.label,
    enabled: !!on,
  }));
  invalidate(item);
  render();
  controls();
}
function toggleGenreTag(id, i, on) {
  const x = editable(id);
  if (!x) return;
  x.genreTags[i] = {
    label:
      typeof x.genreTags[i] === "string"
        ? x.genreTags[i]
        : x.genreTags[i].label,
    enabled: on,
  };
  invalidate(x);
  render();
  controls();
}
function addGenreTag(id) {
  const x = editable(id),
    inp = $(`#extra-${id}`);
  if (!x || !inp) return;
  const tag = canonicalGenre(inp.value);
  if (tag) {
    x.genreTags.push(tag);
    invalidate(x);
    render();
    controls();
  }
}
function detectedMixTags(item) {
  const title = val(item.original, "Title");
  const patterns = [
    ["Clean", /\bclean\b/i],
    ["Dirty", /\bdirty\b/i],
    ["Explicit", /\bexplicit\b/i],
    ["Extended", /\bextended\b/i],
    ["Intro", /\bintro\b/i],
    ["Outro", /\boutro\b/i],
    ["Instrumental", /\binstrumental\b/i],
    ["Acapella-In", /\b(?:a[ -]?ca?pp?ella)[ -]in\b/i],
    ["Acapella-Out", /\b(?:a[ -]?ca?pp?ella)[ -]out\b/i],
    ["Acapella", /\b(?:a[ -]?ca?pp?ella)\b(?![ -](?:in|out)\b)/i],
    ["Radio", /\bradio(?:[ -]edit)?\b/i],
    ["Remix", /\bremix\b/i],
    ["Club", /\bclub[ -](?:mix|edit|version)\b/i],
    ["Short Edit", /\bshort[ -]edit\b/i],
    ["Transition", /\btransition\b/i],
    ["Loop", /\bloop\b/i],
  ];
  return patterns.filter(([, re]) => re.test(title)).map(([label]) => label);
}
function includedMixTags(item) {
  return item.tagMode === "replace" && item.includeMix !== false
    ? detectedMixTags(item)
    : [];
}
function effectiveTags(item) {
  const genre = String(finalValue(item, "Genre") ?? "").trim();
  const tags = [
    ...(genre ? [genre] : []),
    ...selectedTags(item),
    ...includedMixTags(item),
  ];
  return tags.filter(
    (tag, i) =>
      tags.findIndex((other) => tagLabelKey(other) === tagLabelKey(tag)) === i,
  );
}
function setIncludeMix(id, enabled) {
  const item = editable(id);
  if (!item) return;
  item.includeMix = !!enabled;
  invalidate(item);
  render();
  controls();
}
function selectedTags(item) {
  return (item.genreTags || [])
    .map((x) =>
      typeof x === "string"
        ? {
            label: x,
            enabled: true,
          }
        : x,
    )
    .filter((x) => x.enabled !== false)
    .map((x) => x.label);
}
function parseTags(d) {
  d = payload(d);
  state.allTags = unwrapList(d, ["tags", "customTags"]);
  state.tagCategories = Array.isArray(d)
    ? []
    : unwrapList(d, ["categories", "customTagCategories"]);
  tagSuggestions.innerHTML = state.allTags
    .map((t) => `<option value="${esc(val(t, "label", "name"))}"></option>`)
    .join("");
}
function tagLabelKey(label) {
  return String(label ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function validLexiconId(id) {
  return (
    (typeof id === "number" || typeof id === "string") &&
    String(id).trim() !== "" &&
    Number.isSafeInteger(Number(id)) &&
    Number(id) > 0
  );
}
async function refreshTags() {
  parseTags(await api("/v1/tags"));
}
function findExistingTag(label, categoryId) {
  const matches = state.allTags.filter(
    (t) =>
      tagLabelKey(val(t, "label", "name")) === tagLabelKey(label) &&
      validLexiconId(t.id),
  );
  return (
    matches.find((t) => String(t.categoryId) === String(categoryId)) ||
    matches[0]
  );
}
function findGenreCategory() {
  return state.tagCategories.find(
    (c) =>
      tagLabelKey(val(c, "label", "name")) === "genre" && validLexiconId(c.id),
  );
}
function createdEntity(response, key) {
  const body = payload(response),
    entity = body?.[key] || body;
  if (!entity || !validLexiconId(entity.id))
    throw new Error(
      "Lexicon returned no valid " + key + " ID. Refresh and retry.",
    );
  return entity;
}
function isDuplicateError(error) {
  return /already exists|duplicate/i.test(String(error?.message || ""));
}
async function ensureGenreCategory() {
  return ensureCategory("Genre");
}
async function ensureCategory(label) {
  const findCategory = () =>
    state.tagCategories.find(
      (c) =>
        tagLabelKey(val(c, "label", "name")) === tagLabelKey(label) &&
        validLexiconId(c.id),
    );
  let cat = findCategory();
  if (cat) return cat;
  await refreshTags();
  cat = findCategory();
  if (cat) return cat;
  try {
    cat = createdEntity(
      await api("/v1/tag-category", {
        method: "POST",
        body: JSON.stringify({
          label,
        }),
      }),
      "category",
    );
    state.tagCategories.push(cat);
    return cat;
  } catch (e) {
    if (!isDuplicateError(e)) throw e;
    await refreshTags();
    cat = findCategory();
    if (cat) return cat;
    throw e;
  }
}
async function ensureTag(label, categoryId) {
  label = String(label ?? "").trim();
  if (!label) throw new Error("A custom tag label cannot be empty.");
  let tag = findExistingTag(label, categoryId);
  if (tag) return tag;
  await refreshTags();
  tag = findExistingTag(label, categoryId);
  if (tag) return tag;
  // Labels already present in another category are reused without moving them.
  const cat = categoryId
    ? state.tagCategories.find((c) => String(c.id) === String(categoryId))
    : await ensureGenreCategory();
  if (!cat || !validLexiconId(cat.id))
    throw new Error("Could not resolve the custom tag category.");
  try {
    tag = createdEntity(
      await api("/v1/tag", {
        method: "POST",
        body: JSON.stringify({
          label,
          categoryId: Number(cat.id),
        }),
      }),
      "tag",
    );
    state.allTags.push(tag);
    return tag;
  } catch (e) {
    if (!isDuplicateError(e)) throw e;
    await refreshTags();
    tag = findExistingTag(label, cat.id);
    if (tag) return tag;
    throw e;
  }
}
export {
  GENRE_ALIASES,
  canonicalGenre,
  splitGenres,
  detectedMixTags,
  includedMixTags,
  effectiveTags,
  selectedTags,
  tagLabelKey,
  validLexiconId,
  findExistingTag,
  findGenreCategory,
  createdEntity,
  isDuplicateError,
  ensureGenreCategory,
  ensureCategory,
  ensureTag,
  parseTags,
  refreshTags,
  setTagMode,
  allGenreTags,
  toggleGenreTag,
  addGenreTag,
  setIncludeMix,
};
