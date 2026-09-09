import { state } from "./state.js";
import { controls, render } from "./render.js";
import { chosenValue, hasProposal, invalidManual } from "./model.js";
import { FIELDS, val } from "./utils.js";
import { effectiveTags } from "./tags.js";
function parseCSV(text) {
  const out = [];
  let row = [],
    f = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(f);
        f = "";
      } else if (c === "\n") {
        row.push(f);
        out.push(row);
        row = [];
        f = "";
      } else if (c !== "\r") f += c;
    }
  }
  if (f.length || row.length) {
    row.push(f);
    out.push(row);
  }
  return out.filter((r) => r.some((v) => v !== ""));
}
function importCSV(text) {
  const p = parseCSV(text);
  if (p.length < 2) throw new Error("CSV has no rows");
  const h = p[0].map((x) => x.trim());
  state.rows = p.slice(1).map((r, i) => {
    const o = {};
    h.forEach((k, j) => (o[k] = r[j] || ""));
    return {
      id: i + 1,
      original: o,
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
function toCSV(m) {
  return m
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
        })
        .join(","),
    )
    .join("\r\n");
}
function reviewedCSV() {
  if (state.rows.some((x) => x.decision === "accepted" && invalidManual(x)))
    throw new Error("Correct invalid typed fields before exporting.");
  const h = ["Location", ...FIELDS, "CustomGenreTags", "CustomTagAction"];
  const m = [h];
  state.rows
    .filter((x) => x.decision === "accepted" && hasProposal(x))
    .forEach((x) => {
      const o = {
        Location: val(x.original, "Location"),
        CustomTagAction: x.tagMode === "replace" ? "replace" : "add",
        CustomGenreTags: effectiveTags(x)
          .map((t) => "#" + t.replace(/\s+/g, "_"))
          .join(" "),
      };
      FIELDS.forEach((f) => {
        o[f] = chosenValue(x, f);
      });
      if (["api", "record"].includes(x.fields.Genre) && x.mainGenre)
        o.Genre = x.mainGenre;
      m.push(h.map((k) => o[k] ?? ""));
    });
  return toCSV(m);
}
function download() {
  const b = new Blob([reviewedCSV()], {
      type: "text/csv",
    }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = "lexicon-reviewed-metadata.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
export { parseCSV, importCSV, toCSV, reviewedCSV, download };
