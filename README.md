# Zane's Utilities

Windows desktop app (Electron) with 14 tools: chat and voice host, game library, crash analyzer, game optimizer, media player,
web games, FMHY browser, driver updater, phone mirroring, file shredder, encrypted vault, SSH terminal, app lock and settings.

Status: **overhaul in progress**, following `Zane's Utilities Overhaul Plan v1.0`. Phase 0 (baseline and safety net) is done; see `CHANGELOG.md`.

## Run it

```
npm install
npm start
```

Needs Windows 10 or 11 (x64) and Node 22 or newer. The bundled `scrcpy/`, `cloudflared/` and `mumble/` folders are not in git; put them next to
`main.js` as before.

## Check it

| Command                                 | What it does                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test`                              | Unit and characterization tests (Node's built-in runner, no extra packages). Runs on any OS.             |
| `npm run test:e2e`                      | Starts the real app with a throwaway profile and clicks through it (Playwright). Run on Windows.         |
| `npm run lint` / `npm run format:check` | ESLint and Prettier.                                                                                     |
| `npm run typecheck`                     | TypeScript check of the new modules (`logger.js`, `diagnostics.js`, `scripts/`, `test/`).                |
| `npm run baseline`                      | Writes timing numbers to `baseline/` (module load cost, PowerShell spawn cost on Windows).               |
| `npm run verify:binaries`               | Compares bundled binaries against `binaries.sha256.json`. Create or refresh the file with `-- --update`. |
| `npm run sbom`                          | CycloneDX list of shipped npm packages.                                                                  |
| `npm run check`                         | Lint, format check and unit tests together.                                                              |

## Logs and diagnostics

The app keeps a small rotating log in Electron's logs folder (`app.getPath('logs')`, normally `%APPDATA%\Zanes Utilities\logs`). Paths, your user
name, LAN addresses, tunnel hosts, long hex strings and `password=` style values are redacted before anything is written. Nothing is sent anywhere.

`window.appDiag.exportBundle()` asks where to save a JSON file with versions, hardware class, startup timings, loaded tools and the redacted log.
A button for it arrives with the new Settings page in Phase 1.

## Layout (today)

- `main.js`, `preload.js`: window, trusted-sender IPC gate, lazy loading of tool modules.
- `*-ipc.js`: main-process side of each tool. `*-ui.js`, `app.js`, `index.html`: renderer side.
- `chat-*.js`, `mumble-ipc.js`: chat hub, HTTP server, tunnel, remote client, Mumble.
- `keystore.js`, `secure-store.js`, `secure-ls.js`: encrypted state at rest.
- `ps/`: PowerShell scripts for system queries.
- `test/unit`: characterization tests. `tests/e2e`: Electron smoke tests. `scripts/`: baseline and binary hash tools.
