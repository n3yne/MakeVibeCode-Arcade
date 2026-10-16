# Architecture

MakeVibeCode Arcade is one web UI (`renderer/`) that runs inside two shells:

- **Desktop:** Electron (`main.js`, `preload.js`)
- **Mobile:** Capacitor (Android and iOS) plus a custom native plugin, `MakeCodeBridge`

`renderer/app.js` only calls `window.platform.*`. `renderer/platform.js` decides at load time which implementation to install.

## Platform layer (`renderer/platform.js`)

| Runtime | Detection | Arcade view | AI, settings, conversations |
|---|---|---|---|
| Electron | `window.electronAPI` exists (set by `preload.js`) | `<webview>` element pointing at `https://arcade.makecode.com` | IPC to the main process |
| Capacitor | `window.Capacitor` exists | Native overlay WebView via `MakeCodeBridge` | `CapacitorHttp`, `Preferences`, `Filesystem` |
| Browser | neither | no-op stub | stubbed |

The shared interface includes `aiRequest`, `testApiKey`, `settingsGet/Set`, `convList/Load/Save/Delete`, `openExternal`, `initArcadeView`, `wvRun` and `wvEval`.

## Electron main process (`main.js`)

- Creates the window (`webviewTag: true`, `contextIsolation: true`, `nodeIntegration: false`).
- Rewrites response headers with a permissive Content-Security-Policy so the embedded MakeCode page can load its resources.
- Grants `usb`, `bluetooth`, `serial` and `hid` permissions on the main session and the webview session so MakeCode can flash hardware.
- Resolves WebUSB and Web Bluetooth pickers by selecting the first device found.
- Exposes IPC handlers:

| Channel | Purpose |
|---|---|
| `ai-request` | Proxies a chat request to the chosen provider (avoids CORS) |
| `test-api-key` | Verifies a key and returns the provider's model list |
| `settings-get`, `settings-set` | Reads and writes `settings.json` in `userData` |
| `conv-list`, `conv-load`, `conv-save`, `conv-delete` | Stores conversations as JSON under `userData/conversations` |
| `open-external` | Opens a URL in the system browser |

### AI request handling and safety

Every `ai-request` goes through two checks (duplicated for mobile in `platform.js`):

1. **Jailbreak filter.** The last 6 user messages are tested against a list of regexes. A match returns a canned refusal without calling the provider.
2. **Safety prefix.** A fixed rule block is always prepended to the system prompt, whatever the user configured in Settings.

Provider differences (endpoints, auth headers, request and response shapes) are handled in the `switch (provider)` in `main.js` and in `buildAIRequest` in `platform.js`. When adding a provider, update both, plus the Settings dropdown in `renderer/index.html`.

## The vibe coding pipeline (`renderer/app.js`)

`vibeCodingPipeline(userText)`:

1. `detectView()` finds whether MakeCode is in Blocks or JavaScript view.
2. If needed, `switchView('javascript')` and wait for the Monaco editor to appear.
3. `getEditorCode()` reads the current code and attaches it to the prompt.
4. `callAI()` sends the conversation history.
5. `extractFirstCodeBlock()` pulls the first fenced code block from the reply.
6. `applyCodeToArcade()` writes it into Monaco. On failure a JSON diagnostic is shown in chat.
7. `waitForErrorsToSettle()` (2.5 s settle time) reads editor errors. If any, it asks the AI for a corrected full file and re-applies, up to `MAX_ERROR_ITERATIONS` (3).
8. `restoreBlocks()` returns to Blocks view if the user started there.

The page-side scripts are injected as strings through `wvRun`. `HELPERS_BLOCK` holds shared helpers for them. This is the most fragile part of the app, because it depends on MakeCode's DOM and Monaco setup.

### Response format

The default system prompt asks the model for:

```
📋 one-sentence summary
▶ one-sentence next step

---

full details and one complete ```typescript block
```

`parseAIResponse()` renders the first two lines collapsed and the rest on demand.

## Mobile overlay design (`native-plugins/`)

A Capacitor WebView is the app, so a second site needs a separate native view. `MakeCodeBridge` adds a native WebView that loads MakeCode and supports `executeScript` with a returned value (the equivalent of Electron's `webview.executeJavaScript`).

- The overlay sits **behind** the Capacitor WebView, below the status bar and above a 56 pt/dp tab bar.
- The Capacitor WebView is made transparent, and `#arcade-container` is a transparent hole in `renderer/styles.css`, so the overlay shows through.
- The Editor and AI Chat tabs show or hide the Capacitor layer to switch views.
- On iOS, Capacitor 8 registers only the plugin classes listed in the bundled `capacitor.config.json`'s `packageClassList`, which `cap sync` fills from npm-installed plugins alone. `.github/scripts/add_ios_plugin.rb` adds the plugin sources to the generated Xcode project and appends `MakeCodeBridgePlugin` to that list; without it, `Capacitor.Plugins.MakeCodeBridge` is `undefined` and `platform.js` fails to initialise.

Plugin API details: [native-plugins/README.md](../native-plugins/README.md).

## Data locations

| Platform | Settings | Conversations |
|---|---|---|
| Desktop | `<userData>/settings.json` | `<userData>/conversations/*.json` |
| Mobile | Capacitor Preferences key `settings` | App data directory (`Directory.Data`) |

`<userData>` is Electron's per-user app folder (for example `%APPDATA%/makevibecode-arcade` on Windows, `~/Library/Application Support/makevibecode-arcade` on macOS, `~/.config/makevibecode-arcade` on Linux).
