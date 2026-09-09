<img src="assets/logo.svg" width="64" height="64" alt="Red CD and hammer logo">

# Lexicon Metadata Reviewer

A local review tool for [Lexicon DJ](https://www.lexicondj.com/). Find metadata with TheAudioDB or SonoVault, compare it with your library, and choose exactly which values to keep before applying changes.

Built with Python’s standard library and HTML, CSS, and native JavaScript ES modules. No npm install, Python packages, cloud hosting, or build step is required to run it. This is an independent project, not affiliated with Lexicon, TheAudioDB, SonoVault, or BPM Supreme.

## Quick start

You need Python 3.10 or newer, a modern desktop browser, and Lexicon DJ running on the same computer. Internet access is needed for uncached provider lookups.

1. Download or clone this repository and open a terminal in its folder.
2. In Lexicon, open **Settings → Integrations** and enable **Local API**.
3. Start the reviewer:

   ```sh
   python3 server.py
   ```

   On Windows, use `py -3 server.py` if `python3` is unavailable.

4. Open **http://127.0.0.1:8765**. Keep the terminal open while using the app.
5. Open the **gear → Settings** to enter your provider key and choose defaults. Blank key fields keep the saved key. Press **Save settings** and confirm.

The reviewer attempts a connection on startup. If Lexicon is unavailable, an inline message explains setup and shows **Retry connection**. It does not retry in the background.

Use `Ctrl+C` to stop the server. After updating application code, stop and restart it, then refresh your browser. Opening `index.html` directly will not work.

> Before your first real batch, make a Lexicon database backup and try a few tracks you can verify. Lookup alone does not modify your library; applying and restoring require confirmation.

## Review your tracks

1. Search your Lexicon library by artist, title, genre, album, or custom tag, or load the first 100 tracks.
2. Choose a metadata provider or fallback order, then click **Lookup metadata**.
3. Click individual values in **Current** or **API match**. **Final output** shows the values to apply.
4. Review the custom tags and version markers, then **Accept** the song.
5. Click **Apply accepted on this page** and review the confirmation.

Only accepted songs on the current page are applied or exported. Changing a selection resets that song’s acceptance. The bulk-accept control excludes replacements, manual/source-record choices, low-confidence results, and warnings.

Search fields are combined with AND. Text search matches partial text, ignoring case; it is not typo-tolerant fuzzy search. Custom-tag suggestions support full labels or a uniquely matching partial label. Lexicon search can return at most 1,000 tracks; narrow your search if the app reports truncation.

**CSV mode** supports importing Artist/Title rows and exporting reviewed metadata. Include Location to retain file paths. CSV export does not write to Lexicon. `CustomTagAction` is a reviewer-specific column, not a guarantee that another importer will implement tag replacement.

## Advanced mode and title protection

Advanced mode reveals two additional sources:

- **Selected record:** reuse individual fields from a saved provider record, including when another version of the song did not match. Provider record IDs are shown separately from Lexicon track IDs. Cached IDs do not trigger a new provider request; unknown IDs require a lookup.
- **Type a value:** typing automatically selects your value. Empty text intentionally clears a text field. Year and track number require nonnegative whole numbers.

Turning Advanced mode off returns pending Record/Typed selections to Current and resets acceptance. The drafts remain available during the session.

A **Version title protected** tooltip explains when words such as Clean, Extended, Remix, or Instrumental are detected in the title, file path, mix, or remixer. The app keeps the original title to avoid dropping version details; other metadata remains editable. This is a text heuristic, not audio identification, and can be conservative.

## Genres and custom tags

The read-only **Main Genre** display follows the final Genre selection. API and source-record genres use the first parsed genre; Current and Typed use their selected value. Every nonempty final genre is automatically included in the custom tags, even after **Clear all**.

- **Overwrite off:** keep existing custom tags and add the final genre plus checked tags.
- **Overwrite on:** replace the song’s complete custom-tag list with the final genre plus checked tags and any enabled detected Mix tags. Unselected Mood, Mix, and other category tags are removed from that song.
- **Include Mix tags from title:** when overwriting, also include displayed markers such as Clean, Extended, Intro, or Instrumental. It does not rename the audio file.

Existing tag labels are reused without moving categories. New detected version tags go in Mix; other new tags go in Genre. Clear all clears optional selections, not the automatic final-genre tag. An overwrite clears every tag only when the final genre is empty and no optional or Mix tags remain.

## Configuration

On first startup, the app creates a private **`.env`** beside `server.py`. You may also copy `.env.example` to `.env` before starting. Settings saves update this file immediately; changes are confirmed before saving.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SONOVAULT_API_KEY` | empty | Your SonoVault API key |
| `AUDIODB_API_KEY` | `123` | TheAudioDB key; replace with your own if required |
| `ADVANCED_MODE` | `false` | Show Record and Typed sources |
| `OVERWRITE_CUSTOM_TAGS` | `false` | Default action for newly loaded songs |
| `INCLUDE_MIX_TAGS_FROM_TITLE` | `true` | Include detected Mix tags when overwriting |
| `SHOW_DEBUG_LOG` | `false` | Display the debug panel |
| `THEME` | `system` | `light`, `dark`, or `system` |

System appearance follows OS changes while the page is open. Tag defaults apply to newly loaded, uncached songs; existing review choices are kept. API keys supplied as process environment variables override keys in `.env`.

The `.env` parser accepts `NAME=value`, quoted strings, and whole-line comments. It does not execute commands or expand shell variables. Use Settings to avoid quoting mistakes. Saved keys are never returned to the browser; `********` is only a placeholder.

For existing installations, a missing `.env` is created from the old `config.json` if present. The old file is left untouched as a private migration backup and is no longer used once `.env` exists. Both files are ignored by Git. You can remove the legacy file after verifying your settings.

Check provider access requirements before using your own account:
[TheAudioDB](https://www.theaudiodb.com/free_music_api) · [SonoVault](https://sonovault.now/).

## Cache and restore history

Private files are stored alongside `server.py`:

| File | Contents |
| --- | --- |
| `.env` | API keys and preferences |
| `metadata-cache.sqlite3` | Provider search responses and source records |
| `change-history.json` | Before/after snapshots of reviewer writes |

**Settings → Clear metadata cache** clears saved provider results and the current page’s source-record cache. It keeps settings, change history, and current review selections. Future lookups contact providers again. Refresh other open tabs to discard their in-memory caches. Cache entries do not expire automatically.

**Change history** retains the last three verified changes **per song**, keyed by Lexicon track ID. A durable backup is saved before the write; if it cannot be saved, the write stops. Restore the newest change first. Restore checks for conflicting newer values and changes only the fields recorded in that entry.

History records filenames and full paths before/after writes and at restore. A renamed track can still be identified by its Lexicon ID, but the app does **not** monitor external renames or rename physical audio files during restore. The history is not a backup of your audio files or entire Lexicon database.

If a network failure leaves a write’s outcome uncertain, its original values remain in the log and further writes to that song are blocked. Inspect the song and history before proceeding; automatic recovery of uncertain entries is not implemented. Changes made before logging was installed cannot be recovered.

## Troubleshooting

- **Cannot connect:** keep Lexicon running, enable Local API, and press Retry connection. Start the reviewer through `server.py`.
- **Outdated server/settings error:** stop the old process with `Ctrl+C`, restart, and refresh. Edit the `.env` in the same folder as the running server.
- **Port 8765 already in use:** another reviewer may be running. Stop it before starting a second instance.
- **TLS/certificate error:** use a Python installation with a working certificate store. Verified HTTPS stays enabled; on macOS, the app can use `/etc/ssl/cert.pem` when Python has no roots. Explicit `SSL_CERT_FILE`/`SSL_CERT_DIR` settings are respected.
- **Wrong or missing provider match:** inspect the artist/title similarity and record ID. Try another provider or Advanced mode; do not assume a match identifies a particular DJ edit.
- **Cannot save:** the app folder must be writable. Private settings/history/cache files can contain credentials or personal library paths—do not attach them to public bug reports.

## Privacy and known limits

The server listens on `127.0.0.1:8765` and is intended for one local user. Do not expose it to the network or deploy it as a public web service. Provider lookups send the searched artist/title or provider record ID to the selected provider. No audio is uploaded by this tool.

Review decisions are retained across page navigation but are **not saved across browser refreshes**. Avoid simultaneous edits to the same tracks in multiple tabs or apps: Lexicon API writes and local history are not a shared database transaction. History is tied to Lexicon IDs; do not reuse an old history file with an unrelated/rebuilt library.

The interface supports modern desktop browsers. Automated tests use mocks and temporary files; verify a small real-library workflow on your platform before relying on it for large batches.

## Development and tests

Python has no third-party runtime dependencies. Node.js is needed only for the JavaScript tests.

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

On macOS/Linux:

```sh
for test in tests/*.cjs; do
  node "$test" || exit 1
done
```

Tests cover configuration creation/migration, secret handling, parser behavior, tag operations, themes, connection flow, cache behavior, and journal/restore safeguards. They do not write to your live Lexicon library.

Contributions and forks are welcome. Include a clear reproduction and relevant test results with fixes. Never include `.env`, cache/history files, real keys, or private library data in commits or issues. See `.env.example` for public defaults. A project license should be selected before redistribution permissions are advertised beyond GitHub forking.

## Source layout

- `index.html`: page structure and dialogs.
- `styles/base.css`, `styles/themes.css`: layout/components and appearance variants.
- `js/app.js`: startup, event bindings, and the explicit bridge for inline row controls.
- `js/state.js`, `js/dom.js`, `js/utils.js`: shared state, DOM references, and utilities.
- `js/model.js`, `js/review.js`, `js/render.js`: review rules, user actions, and rendering.
- `js/api.js`, `js/lexicon.js`, `js/metadata.js`: HTTP requests, library operations, and metadata providers.
- `js/tags.js`, `js/csv.js`, `js/settings.js`, `js/history.js`: feature modules.
- `server.py`: local HTTP service and provider cache/proxy.
- `config_store.py`, `change_history.py`: private configuration and durable change history.
- `tests/`: Python unit tests, JavaScript behavior regressions, and native ES-module integration tests.

Modules use browser-native imports; no bundler is required. The server explicitly allows only public HTML, JavaScript, CSS, and logo paths. When adding a public asset, update that allowlist and its test. Never allow an entire directory of private application files.

`node tests/modules.cjs` checks real ES-module linking, startup, UI handlers, and a mocked apply flow. It automatically enables Node’s experimental VM-module flag for this test only. Older behavior suites use the compatibility helper in `tests/helpers/frontend.cjs` to retain their existing mocks.
