# Changelog

All notable changes to Zane's Utilities. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2.7.0] - 2026-10-28

Follows the V2.6.1 release.

### Phase 0: baseline and safety net (no user-visible change)

Added

- Git history with an untouched import of v1.0.0 as the first commit (QA-1).
- README, CHANGELOG, LICENSE, THIRD_PARTY_NOTICES (draft), EditorConfig, Prettier, ESLint flat config, tsconfig for type-checking the new modules (QA-1).
- 66 characterization tests in `test/unit` locking current behaviour of: crash dump parser and rule base, INI editor, driver version compare, ChatHub, vault (full round trip, tamper detection), shredder path guard, app-lock throttling, SFTP path helpers, logger and diagnostics (QA-2).
- Playwright for Electron smoke tests: launch, open every tool, lock and unlock, delete all data, security baseline, performance recording (QA-3).
- `npm run baseline` and a performance recording test for cold start, memory and PowerShell spawn cost (QA-4).
- Local rotating redacted log (`logger.js`) and a diagnostics bundle (`diagnostics.js`) reachable through `window.appDiag.exportBundle()`; the Settings button arrives with PLT-6 in Phase 1 (QA-5).
- GitHub Actions CI (Ubuntu and Windows), Dependabot, `npm audit` gate, CycloneDX SBOM, hash-verification script for bundled binaries (QA-6).

Changed

- Runtime dependencies pinned to the exact versions already in `package-lock.json` (QA-6).
- `package.json` `build.files` now includes `logger.js` and `diagnostics.js`.
- Small `_test` export seams added to `lock-ipc`, `shred-ipc`, `vault-ipc`, `vendor-sources` and `optimizer-ipc`. They add exports only; no logic changed.
- `main.js` now records startup timings and module load times and writes them to the local log. It logs uncaught errors with the non-intrusive `uncaughtExceptionMonitor` event, so crash behaviour is unchanged.

### Theme, build and startup fixes

Changed

- New starship-bridge theme (`cyber.css`, `cyber.js`) layered over the original styles.

Fixed

- App icons moved to `build/`, where `main.js`, the FMHY pop-out window and `package.json` look for them. The window had no icon and packaging pointed at missing files.
- The shredder's metadata helper moved to `ps/shred-meta.ps1`, where `shred-ipc.js` reads it. Before, it never started, so file attributes, hidden streams and creation dates were left as they were.
- `npm run build` no longer rebuilds native modules (`npmRebuild: false`). The only ones are ssh2's optional add-ons, which need a C++ toolchain and fall back to JavaScript.
- The main window stays hidden until its first paint and uses the theme background, so it no longer flashes at startup.

### Licence

Changed

- Licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). `LICENSE` holds the full GPL v3 text and `package.json` declares it. Before, `LICENSE` was a placeholder and `package.json` said `UNLICENSED`.

### Heavy work on worker threads

Changed

- The ad blocker parses its filter lists on a worker thread (`adblock-worker.js`). Before, the parse froze the whole app for 2-4 seconds the first time ad blocking was used and at every weekly list refresh; the main process now stalls for well under 0.1 s. The build itself takes about a second longer in the background.
- The crash analyzer reads and scans files on a Web Worker (`crash-worker.js`), using the analyzer code moved unchanged from `app.js` into `crash-core.js`. A 25 MB log used to freeze the window for about 0.75 s; it now stays responsive. If a worker cannot start, the scan runs on the page as before.
