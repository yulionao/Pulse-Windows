# Pulse for Windows

Pulse is a focused Windows tray dashboard built on the UsageBoard plugin protocol. Its calm, opaque interface follows the Windows light or dark appearance automatically.

## Features

- Windows system tray app with a compact Pulse-style usage dashboard
- Automatic Windows light and dark appearance
- Grouped and tabbed layouts
- Manual, per-plugin, and scheduled refresh
- Persisted plugin output cache
- Built-in data-source forms for credentials, display options, and refresh intervals
- Line and stacked-bar token charts
- Start at Windows sign-in
- Chinese and English UI
- Bundled Python runtime in release builds
- Built-in SubAPI platform cards with automatically fetched spending, requests, tokens, and daily/weekly/monthly quotas (Sub2API-compatible)
- Official Codex device sign-in from the Codex plugin settings
- Bundled official Codex CLI 0.148.0 fallback when Codex is not installed system-wide
- Official Claude sign-in with Windows Credential Manager support
- Bundled official Claude CLI 2.1.235 fallback when the installed CLI is outdated
- Z.AI and Kimi CodePlan usage plugins
- OpenCodeGo Plan rolling, weekly, and monthly quota plugin

Application data remains in `%APPDATA%\\UsageBoard` for seamless upgrades from the previous Windows build. It includes `config.json`, `plugins`, and `states`.

## Development

```powershell
cd windows
npm install
npm test
npm run python:prepare
npm start
```

The development build can use Python from `vendor/python/python.exe` or a system `py`, `python3`, or `python` command.

## Release build

Prepare the pinned official Windows embeddable Python distribution, then build:

```powershell
npm run python:prepare
npm run dist
```

The Pulse NSIS installer and portable executable are written to `windows/dist`.
