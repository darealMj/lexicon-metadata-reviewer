// Real ES-module linking/evaluation; no bundler or runtime package dependency.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
if (!vm.SourceTextModule) {
  const result = require("child_process").spawnSync(
    process.execPath,
    ["--experimental-vm-modules", __filename],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
(async () => {
  const root = path.resolve(__dirname, "..");
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: "",
        textContent: "",
        innerHTML: "",
        disabled: false,
        classList: { toggle() {} },
        options: [{ text: "Test" }],
        selectedIndex: 0,
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute() {},
      });
    return elements.get(selector);
  };
  let loaded, patched;
  const context = {
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      documentElement: { setAttribute() {} },
    },
    addEventListener: (event, fn) => {
      if (event === "load") loaded = fn;
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    console: { info() {}, error() {}, warn() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    URLSearchParams,
    performance,
    AbortSignal,
    setTimeout,
    clearTimeout,
    confirm: () => true,
    alert: (message) => {
      throw Error(message);
    },
    fetch: async (url, options = {}) => {
      let body;
      if (url === "/metadata/config")
        body = {
          config_storage: "env",
          theme: "system",
          advanced_mode: false,
          include_mix_tags_from_title: true,
        };
      else if (url === "/metadata/records") body = { records: [] };
      else if (url.startsWith("/lexicon/v1/tracks?"))
        body = { data: { tracks: [] } };
      else if (url === "/lexicon/v1/tags")
        body = {
          data: {
            categories: [{ id: 1, label: "Genre" }],
            tags: [
              { id: 1, label: "Pop", categoryId: 1 },
              { id: 2, label: "Jazz", categoryId: 1 },
            ],
          },
        };
      else if (url === "/lexicon/v1/track?id=1")
        body = {
          data: { track: { id: 1, title: "Song", genre: "Pop", tags: [1] } },
        };
      else if (url === "/lexicon/v1/track" && options.method === "PATCH") {
        patched = JSON.parse(options.body);
        body = { recorded: true };
      } else throw Error("Unexpected request: " + url);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  };
  context.window = context;
  vm.createContext(context);
  const modules = new Map();
  const load = (filename) => {
    filename = path.resolve(filename);
    if (!filename.startsWith(path.join(root, "js") + path.sep))
      throw Error("Unexpected module path");
    if (!modules.has(filename))
      modules.set(
        filename,
        new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), {
          context,
          identifier: filename,
        }),
      );
    return modules.get(filename);
  };
  const app = load(path.join(root, "js/app.js"));
  await app.link((specifier, ref) =>
    load(path.resolve(path.dirname(ref.identifier), specifier)),
  );
  await app.evaluate();
  assert.equal(modules.size, 14);
  assert.equal(typeof loaded, "function");
  await loaded();
  const state = load(path.join(root, "js/state.js")).namespace.state;
  assert.equal(state.connected, true);
  const review = load(path.join(root, "js/review.js")).namespace;
  review.makeRows([
    { id: 1, title: "Song", artist: "Artist", genre: "Pop", tags: [1] },
  ]);
  context.setAdvanced(true);
  context.setManual(1, "Genre", "Jazz");
  assert.equal(state.rows[0].fields.Genre, "manual");
  assert.equal(state.rows[0].mainGenre, "Jazz");
  await load(path.join(root, "js/lexicon.js")).namespace.applyOne(
    state.rows[0],
  );
  assert.deepEqual(patched, { id: 1, edits: { genre: "Jazz", tags: [1, 2] } });
  assert.equal(state.rows[0].applied, true);
  for (const name of [
    "openSettings",
    "saveSettings",
    "connectLexicon",
    "openHistory",
    "restoreHistory",
    "activateManual",
    "fieldChoice",
  ])
    assert.equal(typeof context[name], "function");
  console.log(
    "PASS: 14 native ES modules link, initialize, connect, handle typing, and apply a mocked track update.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
