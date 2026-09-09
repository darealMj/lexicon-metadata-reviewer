// Compatibility harness for the existing behavior regressions. Native ESM linking
// is verified separately by modules.cjs; production never uses this concatenation.
const fs = require("fs");
const path = require("path");
const order = [
  "state",
  "dom",
  "utils",
  "api",
  "model",
  "tags",
  "metadata",
  "lexicon",
  "render",
  "review",
  "settings",
  "history",
  "csv",
  "app",
];
const aliases = [
  "sourceRecords",
  "advanced",
  "tagDefaults",
  "loadError",
  "busy",
  "pageOffset",
  "pageTotal",
  "pageKind",
  "searchTracks",
  "reviewCache",
  "rows",
  "sourceMode",
  "connected",
  "allTags",
  "tagCategories",
  "historyEntries",
  "themePreference",
];
function loadSource() {
  return (
    order
      .map((name) =>
        fs
          .readFileSync(path.join(__dirname, "../../js", name + ".js"), "utf8")
          .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
          .replace(/^export\s*\{[\s\S]*?\};\s*/gm, ""),
      )
      .join("\n") +
    "\n" +
    aliases
      .map(
        (name) =>
          `Object.defineProperty(globalThis, '${name}', {configurable:true, get(){return state.${name}}, set(value){state.${name}=value}});`,
      )
      .join("\n")
  );
}
module.exports = { loadSource };
