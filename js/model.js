import { FIELDS, val } from "./utils.js";
import { canonicalGenre, selectedTags, splitGenres } from "./tags.js";
import { state } from "./state.js";
function versionProtected(item) {
  return /\b(clean|dirty|explicit|radio[ -]?edit|extended|main|edit|mix|dub|intro|outro|quick[ -]?hit|acapella|a[ -]?cappella|instrumental|remix|bootleg|mashup|re[ -]?drum|transition)\b/i.test(
    [
      val(item.original, "Title"),
      val(item.original, "Location"),
      item.lexiconTrack?.mix,
      item.lexiconTrack?.remixer,
    ]
      .filter(Boolean)
      .join(" "),
  );
}
function canUse(item, f, choice = "api") {
  if (f === "Title" && versionProtected(item)) return false;
  if (choice === "manual")
    return Object.hasOwn(item.manual || {}, f) && !manualError(item, f);
  return !!proposed(choice === "record" ? item.reference : item.result, f);
}
function manualError(item, f) {
  const v = item.manual?.[f];
  if (
    ["Year", "TrackNumber"].includes(f) &&
    (!/^\d+$/.test(String(v ?? "")) || !Number.isSafeInteger(Number(v)))
  )
    return "Enter a whole number of 0 or greater.";
  return "";
}
function invalidManual(item) {
  return FIELDS.some(
    (f) => item.fields[f] === "manual" && !canUse(item, f, "manual"),
  );
}
function hasProposal(item) {
  return !!(
    item.result ||
    item.reference ||
    Object.keys(item.manual || {}).length ||
    item.tagMode === "replace" ||
    selectedTags(item).length
  );
}
function chosenValue(item, f) {
  const choice = item.fields[f] || "current";
  if (choice === "current") return val(item.original, f);
  if (choice === "manual") return item.manual?.[f] ?? "";
  return canUse(item, f, choice)
    ? proposed(choice === "record" ? item.reference : item.result, f)
    : val(item.original, f);
}
function invalidate(item) {
  if (!item.applied) item.decision = "pending";
}
function bulkEligible(item) {
  return (
    !!item.result &&
    item.tagMode !== "replace" &&
    !Object.values(item.fields).includes("manual") &&
    !item.reference &&
    !item.error &&
    !item.applied &&
    (item.result._score || 0) >= 0.55
  );
}
function rememberRows() {
  for (const r of state.rows)
    if (r.lexiconId != null) state.reviewCache.set(String(r.lexiconId), r);
}
function trackToOriginal(t) {
  return {
    Location: val(t, "location", "filePath", "path"),
    Title: val(t, "title"),
    Artist: val(t, "artist"),
    AlbumTitle: val(t, "albumTitle", "album"),
    Genre: val(t, "genre"),
    Year: val(t, "year"),
    TrackNumber: val(t, "trackNumber"),
    Label: val(t, "label"),
  };
}
function trackId(t) {
  return val(t, "id", "trackId");
}
function proposed(r, f) {
  if (!r) return "";
  return (
    {
      Title: r.strTrack,
      Artist: r.strArtist,
      AlbumTitle: r.strAlbum,
      Genre: r.strGenre,
      Year: r.intYearReleased || r.intYear,
      TrackNumber: r.intTrackNumber,
      Label: r.strLabel,
    }[f] ?? ""
  );
}
function fieldSource(r, f) {
  return r?._sources?.[f] || r?._source || "";
}
function initChoices(item) {
  item.tagMode ??= state.tagDefaults.tagMode;
  item.fields = {};
  FIELDS.forEach((f) => (item.fields[f] = canUse(item, f) ? "api" : "current"));
  if(item.result?._ai){
    item.fields.Title='current';
    item.fields.Artist='current';
    item.genreTags=(item.result._aiTags || []).map(t=>({label:t.label,enabled:true}));
    item.mainGenre=item.result.strGenre || val(item.original,'Genre');
    return;
  }
  item.genreTags = splitGenres(proposed(item.result, "Genre"));
  item.mainGenre =
    item.genreTags[0] ||
    canonicalGenre(proposed(item.result, "Genre")) ||
    val(item.original, "Genre");
}
function finalValue(item, f) {
  return f === "Genre" && ["api", "record"].includes(item.fields[f])
    ? item.mainGenre
    : chosenValue(item, f);
}
function syncMainGenre(item) {
  const value = chosenValue(item, "Genre");
  item.mainGenre = ["api", "record"].includes(item.fields.Genre)
    ? ((item.fields.Genre === "record" ? item.reference : item.result)?._ai ? value : splitGenres(value)[0] || value || "")
    : value || "";
}
export {
  versionProtected,
  canUse,
  manualError,
  invalidManual,
  hasProposal,
  chosenValue,
  invalidate,
  bulkEligible,
  rememberRows,
  trackToOriginal,
  trackId,
  proposed,
  fieldSource,
  initChoices,
  finalValue,
  syncMainGenre,
};
