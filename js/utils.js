const PAGE_SIZE = 100;
const FIELDS = [
  "Title",
  "Artist",
  "AlbumTitle",
  "Genre",
  "Year",
  "TrackNumber",
  "Label",
];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
function val(o, ...names) {
  for (const n of names) {
    if (o?.[n] != null) return o[n];
    const k = Object.keys(o || {}).find(
      (x) => x.toLowerCase() === n.toLowerCase(),
    );
    if (k) return o[k];
  }
  return "";
}
function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(?:feat|ft)\b\.?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(" ")),
    B = new Set(b.split(" "));
  let n = 0;
  A.forEach((x) => B.has(x) && n++);
  return n / Math.max(A.size, B.size);
}
function payload(d) {
  while (d && typeof d === "object" && !Array.isArray(d) && d.data != null)
    d = d.data;
  return d;
}
function unwrapList(data, keys = ["tracks", "results", "items"]) {
  const d = payload(data);
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  throw new Error("Unexpected response: no " + keys.join("/") + " list");
}
export {
  esc,
  val,
  normalize,
  similarity,
  payload,
  unwrapList,
  FIELDS,
  PAGE_SIZE,
};
