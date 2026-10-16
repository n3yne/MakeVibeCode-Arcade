# MakeVibeCode Arcade

**An AI "vibe coding" assistant built into a MakeCode Arcade editor, for desktop (Windows, macOS, Linux), Android and iOS.**

Describe the game you want in plain English. MakeVibeCode Arcade reads your project from [Microsoft MakeCode Arcade](https://arcade.makecode.com), asks an AI model to write the code, types it into the editor for you, then checks for compile errors and asks the AI to fix them.

It is aimed at kids (roughly ages 6–12) and the adults helping them. The assistant is restricted to child-friendly, MakeCode-Arcade-only conversations.

> **Status:** early (`v0.0.3`). Expect rough edges. See [Known limitations](#known-limitations).

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Using the AI assistant](#using-the-ai-assistant)
- [Supported AI providers](#supported-ai-providers)
- [Privacy and safety](#privacy-and-safety)
- [Building installers](#building-installers)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Embedded MakeCode Arcade editor.** The full editor at `arcade.makecode.com` sits next to an AI chat panel.
- **Vibe coding pipeline.** One message does the whole loop: read the editor's code, ask the AI, apply the result, check for errors, auto-fix up to 3 times.
- **Works with blocks and JavaScript.** The app switches to the JavaScript view to edit, then switches back to Blocks if you started there.
- **Bring your own AI.** Anthropic (Claude), OpenAI, Google Gemini or OpenRouter. A free Gemini key is enough to start.
- **Multiple saved conversations** that you can rename, switch between and delete.
- **Hardware upload support (desktop).** USB, Bluetooth, serial and HID permissions are granted so MakeCode can flash devices.
- **Kid-safe by default.** An immutable safety prompt and a jailbreak filter wrap every request.
- **Cross-platform.** Electron on desktop, Capacitor with a custom native WebView plugin on Android and iOS.

## How it works

```
You type a request
        │
        ▼
Read current code from the MakeCode (Monaco) editor
        │
        ▼
Send request + code to your chosen AI provider
        │
        ▼
Extract the first code block and write it into the editor
        │
        ▼
Wait for compile errors to settle ──► errors? ──► ask AI to fix (max 3 rounds)
        │
        ▼
Done (switch back to Blocks view if needed)
```

AI replies use a collapsed format: a one-sentence summary (📋), a next step (▶), and full details and code hidden behind a `---` separator. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Prerequisites: [Node.js](https://nodejs.org) 22 or newer (CI uses 22) and npm.

```bash
git clone https://github.com/n3yne/MakeVibeCode-Arcade.git
cd MakeVibeCode-Arcade
npm install
npm start          # launches the Electron desktop app
npm run dev        # same, with --dev passed through to Electron
```

Prebuilt installers for tagged releases are attached to the project's [Releases page](https://github.com/n3yne/MakeVibeCode-Arcade/releases) when available.

### First-time setup

1. Click the **gear icon** (Settings) in the top-right.
2. Pick an **AI Provider** and paste your **API key**.
3. Click **Load Models** (this also verifies the key) and choose a model.
4. Click **Save Settings**.

The **?** (Help) button has a step-by-step guide for getting a free Google Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Using the AI assistant

1. Open or create a project in the MakeCode panel.
2. Type what you want in the chat, for example *"Add a coin that the player can collect for points"*.
3. Watch the status line as the app reads, asks, applies and checks.
4. Use **Get Code** to attach the current editor code to the next message manually, and **Clear** to reset the chat.

On mobile, use the **Editor** and **AI Chat** tabs at the bottom to switch between the two views.

## Supported AI providers

| Provider | Default model | Notes |
|---|---|---|
| Google Gemini | `gemini-3.1-flash-lite` | Default. Free tier available. |
| Anthropic | `claude-sonnet-4-6` | |
| OpenAI | `gpt-4o` | |
| OpenRouter | `anthropic/claude-sonnet-4-6` | Any model OpenRouter offers. |

Use **Load Models** in Settings to list the models your key can access.

## Privacy and safety

- Requests go **directly from your device to the provider you choose**. There is no MakeVibeCode server.
- On desktop, the API key, settings and conversations are stored as **plain-text JSON in the Electron `userData` folder**. On mobile, settings go in Capacitor Preferences and conversations in the app's data directory. None of it is additionally encrypted by the app. Use a key with spending limits, and don't use this on shared accounts.
- Child-safety measures: a fixed safety prefix is always prepended to the system prompt, and a regex-based filter returns a canned reply for common jailbreak phrasing. These reduce risk but are not a guarantee. Supervise young children.
- To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Building installers

```bash
npm run dist:win      # Windows NSIS installer + portable (x64)
npm run dist:mac      # macOS universal DMG
npm run dist:linux    # Linux AppImage + .deb (x64)
npm run dist:all      # all desktop targets
```

You must add app icons to `build/` first (see [build/README.md](build/README.md)). Android and iOS builds, signing and CI are covered in [docs/BUILDING.md](docs/BUILDING.md).

## Project layout

| Path | Purpose |
|---|---|
| `main.js` | Electron main process: window, permissions, AI proxy, settings and conversation storage |
| `preload.js` | Safe `electronAPI` bridge exposed to the renderer |
| `launch.js` | Dev launcher that clears `ELECTRON_RUN_AS_NODE` before starting Electron |
| `renderer/` | UI shared by desktop and mobile (`index.html`, `app.js`, `platform.js`, `styles.css`) |
| `native-plugins/` | `MakeCodeBridge` Capacitor plugin sources (iOS Swift/Obj-C, Android Kotlin) |
| `android/` | Committed Capacitor Android project |
| `.github/workflows/build.yml` | 5-platform build and release pipeline |
| `docs/` | Architecture and build documentation |

## Known limitations

- The app drives MakeCode through its page DOM and Monaco editor, so changes to `arcade.makecode.com` can break it.
- `renderer/app.js` currently contains temporary on-device debug diagnostics (an overlay and a startup `alert()`) for the mobile overlay issue. They are marked in the source for removal.
- The iOS project is generated in CI (`npx cap add ios`) and not committed, so local iOS builds need extra setup.
- The jailbreak filter is pattern-based and can have both false positives and misses.
- No automated tests yet.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): processes, IPC, the vibe coding pipeline, mobile overlay design
- [Building and releasing](docs/BUILDING.md): desktop, Android, iOS, CI secrets
- [Native plugin](native-plugins/README.md): `MakeCodeBridge` API
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). MakeCode Arcade is a product of Microsoft and is not affiliated with this project.
