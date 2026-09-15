import { state } from "./state.js";
import { $, advancedMode, configStatus, dbg } from "./dom.js";
import { localMetadata } from "./api.js";
import { setAdvanced, setBusy } from "./review.js";
import { controls, render } from "./render.js";
import { commonResult } from "./metadata.js";
const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
function applyTheme(preference = "system") {
  state.themePreference = ["light", "dark", "system"].includes(preference)
    ? preference
    : "system";
  const resolved =
    state.themePreference === "system"
      ? systemTheme?.matches
        ? "dark"
        : "light"
      : state.themePreference;
  document.documentElement?.setAttribute("data-theme", resolved);
}
async function openSettings() {
  if (state.busy) return;
  const dialog = $("#settingsDialog");
  $("#settingsMessage").textContent = "Loading…";
  $("#settingsSave").disabled = true;
  $("#settingsSono").value = "";
  $("#settingsAudio").value = "";
  $("#settingsDiscogs").value = "";
  dialog.showModal();
  try {
    const c = await localMetadata("config");
    if (!Object.hasOwn(c, "theme") || c.config_storage !== "env")
      throw Error(
        "The running server is outdated and cannot save the current settings format. Stop server.py, start it again, then reopen Settings.",
      );
    $("#settingsSono").placeholder = c.sonovault_configured
      ? "********"
      : "Enter API key";
    $("#settingsAudio").placeholder = c.audiodb_configured
      ? "********"
      : "Enter API key";
    $("#settingsDiscogs").placeholder = c.discogs_configured ? "********" : "Enter token";
    $("#settingsTheme").value = c.theme || "system";
    $("#settingsDebug").checked = c.show_debug_log === true;
    $("#settingsAdvanced").checked = c.advanced_mode === true;
    $("#settingsOverwrite").checked = c.overwrite_custom_tags === true;
    $("#settingsMix").checked = c.include_mix_tags_from_title !== false;
    $("#settingsMessage").textContent = "";
    $("#settingsSave").disabled = false;
  } catch (e) {
    $("#settingsMessage").textContent = e.message;
  }
}
async function clearMetadataCache() {
  if (state.busy) return;
  setBusy(true);
  $("#clearCacheButton").disabled = true;
  $("#settingsSave").disabled = true;
  $("#settingsMessage").textContent = "Clearing cache…";
  try {
    const response = await fetch("/metadata/cache/clear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const data = await response.json();
    if (!response.ok || !data.cleared)
      throw Error(
        data.error || "Could not clear cache; restart server.py and try again.",
      );
    state.sourceRecords.clear();
    render();
    $("#settingsMessage").textContent =
      "Cache cleared. Future lookups will fetch fresh metadata.";
  } catch (e) {
    $("#settingsMessage").textContent = e.message;
  } finally {
    state.busy = false;
    controls();
    $("#clearCacheButton").disabled = false;
    $("#settingsSave").disabled = false;
  }
}
async function saveSettings() {
  if (state.busy) return;
  const changes = {
    advanced_mode: $("#settingsAdvanced").checked,
    overwrite_custom_tags: $("#settingsOverwrite").checked,
    include_mix_tags_from_title: $("#settingsMix").checked,
    show_debug_log: $("#settingsDebug").checked,
    theme: $("#settingsTheme").value,
  };
  for (const [id, key] of [
    ["settingsSono", "sonovault_api_key"],
    ["settingsAudio", "audiodb_api_key"],
    ["settingsDiscogs", "discogs_api_key"],
  ]) {
    const value = $("#" + id).value.trim();
    if (value) changes[key] = value;
  }
  if (
    !confirm(
      "Update settings?\n\n" +
        [
          "Appearance: " + changes.theme,
          "Advanced mode: " + (changes.advanced_mode ? "On" : "Off"),
          "Overwrite custom tags by default: " +
            (changes.overwrite_custom_tags ? "On" : "Off"),
          "Include Mix tags from title: " +
            (changes.include_mix_tags_from_title ? "On" : "Off"),
          "Show debug log: " + (changes.show_debug_log ? "On" : "Off"),
          ...(changes.discogs_api_key ? ["Replace Discogs token"] : []),
          ...(changes.sonovault_api_key ? ["Replace SonoVault API key"] : []),
          ...(changes.audiodb_api_key ? ["Replace TheAudioDB API key"] : []),
        ].join("\n"),
    )
  )
    return;
  $("#settingsSave").disabled = true;
  try {
    const response = await fetch("/metadata/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(changes),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not save settings");
    state.tagDefaults = {
      tagMode: data.overwrite_custom_tags ? "replace" : "add",
      includeMix: data.include_mix_tags_from_title,
    };
    applyTheme(data.theme);
    setAdvanced(data.advanced_mode);
    $("#debugPanel").classList.toggle("hidden", !data.show_debug_log);
    configStatus.textContent = data.sonovault_configured
      ? "SonoVault key configured"
      : "Add your SonoVault key in Settings";
    $("#settingsSono").value = "";
    $("#settingsAudio").value = "";
  $("#settingsDiscogs").value = "";
    $("#settingsDialog").close();
  } catch (e) {
    $("#settingsMessage").textContent = e.message;
  } finally {
    $("#settingsSave").disabled = false;
  }
}
async function loadLocalSettings() {
  try {
    const settings = await localMetadata("config");
    applyTheme(settings.theme);
    state.tagDefaults = {
      tagMode: settings.overwrite_custom_tags === true ? "replace" : "add",
      includeMix: settings.include_mix_tags_from_title !== false,
    };
    advancedMode.checked = settings.advanced_mode === true;
    setAdvanced(advancedMode.checked);
    $("#debugPanel").classList.toggle("hidden", !settings.show_debug_log);
    configStatus.textContent = settings.sonovault_configured
      ? "SonoVault key configured"
      : "Add your SonoVault key once in .env";
    const saved = await localMetadata("records");
    for (const [index,entry] of saved.records.entries()) {
      const record = commonResult(entry.provider, entry.record, "", "");
      const stored = state.sourceRecords.get(entry.provider + ':' + record._recordId);
      if(stored) stored._savedAt = typeof entry.saved_at === 'number' ? entry.saved_at * 1000 : -index;
    }
    render();
    controls();
  } catch (e) {
    configStatus.textContent =
      "Restart server.py to enable local configuration and caching.";
    dbg("Local setup", e.message);
  }
}
export {
  systemTheme,
  applyTheme,
  openSettings,
  clearMetadataCache,
  saveSettings,
  loadLocalSettings,
};
