# Contributing

Thanks for helping! This project is small, so the process is light.

## Getting set up

```bash
git clone https://github.com/n3yne/MakeVibeCode-Arcade.git
cd MakeVibeCode-Arcade
npm install
npm run dev
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains the desktop and mobile split.

## Guidelines

- **Keep one UI.** Logic shared by desktop and mobile belongs in `renderer/`. Call `window.platform.*` from `app.js`; put runtime-specific code in `platform.js` or `main.js`.
- **Keep both AI paths in sync.** `main.js` (desktop) and `renderer/platform.js` (mobile) each implement provider requests, the safety prefix and the jailbreak filter. Change both together.
- **Don't weaken child-safety rules** (safety prefix, jailbreak filter, default system prompt) without discussing it in an issue first.
- **Never commit secrets** such as API keys, certificates or `.env` files.
- Match the surrounding code style. There is no linter or test suite yet; adding them is welcome.
- Test manually on the platform you changed, and say which one in your PR.

## Pull requests

1. Branch from `main`.
2. Keep changes focused.
3. Describe what changed, why, and how you tested it. Add screenshots for UI changes.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/n3yne/MakeVibeCode-Arcade/issues/new/choose). For security problems, see [SECURITY.md](SECURITY.md) instead.
