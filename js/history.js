import { state } from "./state.js";
import { $ } from "./dom.js";
import { localMetadata } from "./api.js";
import { esc } from "./utils.js";
import { setBusy } from "./review.js";
import { controls, render } from "./render.js";
async function openHistory() {
  if (state.busy) return;
  $("#historyDialog").showModal();
  await loadHistory();
}
async function loadHistory() {
  $("#historyMessage").textContent = "Loading history…";
  try {
    const data = await localMetadata("history");
    state.historyEntries = data.entries;
    $("#historyEntries").innerHTML =
      state.historyEntries
        .slice()
        .reverse()
        .map((entry) => {
          const newest =
            state.historyEntries
              .filter(
                (e) => e.track_id === entry.track_id && e.status !== "restored",
              )
              .at(-1)?.id === entry.id;
          const changes = Object.keys(entry.requested)
            .map(
              (key) =>
                `<tr><td>${esc(key)}</td><td>${esc(JSON.stringify(entry.before.fields[key]))}</td><td>${esc(JSON.stringify(entry.after?.fields[key] ?? entry.requested[key]))}</td></tr>`,
            )
            .join("");
          return `<section class="tagbox"><b>${esc(entry.before.fields.artist || "")} — ${esc(entry.before.fields.title || "Track " + entry.track_id)}</b><p class="muted">Lexicon ${entry.track_id} · ${esc(new Date(entry.time * 1000).toLocaleString())} · ${esc(entry.status)}</p><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${changes}</tbody></table><p class="muted">File before: ${esc(entry.before.location || "Unknown")}<br>File after: ${esc(entry.after?.location || "Not verified")}${entry.restore_before ? "<br>File at restore: " + esc(entry.restore_before.location) : ""}</p>${entry.status === "applied" && newest ? `<button onclick="restoreHistory('${entry.id}')">Restore this change</button>` : entry.status === "pending" || entry.status === "restoring" ? "<p>Outcome uncertain. Original values are saved; verify the track in Lexicon before proceeding.</p>" : ""}</section>`;
        })
        .join("") || "<p>No changes recorded yet.</p>";
    $("#historyMessage").textContent = "";
  } catch (e) {
    $("#historyMessage").textContent =
      "Could not load history. Restart server.py after updating. " + e.message;
  }
}
async function restoreHistory(id) {
  if (state.busy) return;
  const entry = state.historyEntries.find((e) => e.id === id);
  if (
    !entry ||
    !confirm(
      "Restore the previous values for " +
        (entry.before.fields.title || "this track") +
        "?\nFields: " +
        Object.keys(entry.requested).join(", ") +
        "\nAudio filenames will not be changed.",
    )
  )
    return;
  setBusy(true);
  $("#historyEntries")
    .querySelectorAll("button")
    .forEach((b) => (b.disabled = true));
  try {
    const response = await fetch("/metadata/history/restore", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Restore failed");
    state.reviewCache.delete(String(result.track_id));
    state.rows = state.rows.filter(
      (item) => String(item.lexiconId) !== String(result.track_id),
    );
    render();
    await loadHistory();
    $("#historyMessage").textContent =
      "Restored. Reload or search the song to review its restored values.";
  } catch (e) {
    $("#historyMessage").textContent = e.message;
  } finally {
    state.busy = false;
    controls();
    $("#historyEntries")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = false));
  }
}
export { openHistory, loadHistory, restoreHistory };
