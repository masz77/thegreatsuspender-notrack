# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A privacy-focused fork of "The Great Suspender" Chrome extension (v7.2.x, **Manifest V3**) with all analytics/tracking removed. It suspends inactive tabs to free memory. No build step is needed for development — load the `src/` folder directly via chrome://extensions with Developer mode → "Load Unpacked". Requires Chrome 121+ (`minimum_chrome_version` in `src/manifest.json`).

The MV2→MV3 migration is recorded in full in `docs/ARCHITECTURE/manifest-v3-migration.md` (with warm-wake lifecycle rules) and `RADICAL-DECISIONS.txt` — read those before touching background/lifecycle code.

## Commands

- `npm run build` — grunt: copies `src/` to `build/`, forces `debugInfo`/`debugError` off in `gsUtils.js`, packages `.zip` and `.crx` (crx signing needs `key.pem`; generate with `npm run generate-key`)
- `grunt tgut` — test build variant with debug flags ON and renamed to "The Great Tester"
- `npx eslint src/js/<file>.js` — lint (config in `.eslintrc.js`, ES2017, no modules)
- Tests: no CLI runner. Open `src/tests.html` in Chrome with the extension loaded; test files live in `src/js/tests/` (`test_*.js` + fixtures, orchestrated by `tests.js`). `npm test` is a stub that exits 1.

## Architecture

Plain ES5/ES2017 scripts, no modules or bundler. Every file is an IIFE that exposes a global (e.g. `var tgs`, `gsUtils`, `gsStorage`). Load order matters: the background service worker `src/js/background-sw.js` `importScripts()` the gs* libs + `background.js` in dependency order — a new background file must be added to that `importScripts` list, not to `manifest.json`.

**Background service worker** (the core — event-based, NOT a persistent page; dies after ~30s idle and re-runs the module on every wake):
- `background-sw.js` — SW entry: a `self.window = self` shim then `importScripts()` of every gs* lib + `background.js`
- `background.js` (`tgs` global) — event handling, tab state machine, context menus, keyboard commands, icon state. Exposes an RPC allowlist (`_rpcHandlers`); pages call in via `gsUtils.sendTgsRpc(...)` over `chrome.runtime.sendMessage`
- `gsTabSuspendManager.js` / `gsTabDiscardManager.js` / `gsTabCheckManager.js` — queue-based workers built on `gsTabQueue.js` for suspending, discarding, and re-checking tabs
- `gsSession.js` — session save/restore and crash recovery
- `gsStorage.js` — settings in `chrome.storage.local` behind a synchronous in-memory cache (SWs have no `localStorage`); option keys defined here
- `gsIndexedDb.js` (wraps `db.js`) — session/preview data in IndexedDB
- `gsChrome.js` — promisified chrome.* API wrappers (use these, not raw callbacks)
- `gsMessages.js` — message passing to content scripts via `chrome.scripting` injection
- `gsUtils.js` — logging (`debugInfo`/`debugError` flags, rewritten at build time) + RPC helper + misc helpers

Auto-suspend and periodic jobs use `chrome.alarms` (not `setTimeout`), since the worker does not persist.

**Per-tab pieces:**
- `contentscript.js` — injected into all pages; tracks activity/form input, reports state back
- `suspended.html` + `gsSuspendedTab.js` — the placeholder page a suspended tab shows (URL-encoded original URL in the hash). It self-initialises (loads its own gs* libs) and is driven by the worker via `chrome.tabs.sendMessage`; `web_accessible_resources` only exposes `suspended.html`
- Other top-level pages (`options.html`, `popup.html`, `history.html`, `recovery.html`, …) each pair with a same-named JS file in `src/js/`. They load the gs* libs they need via `<script>` tags and reach background state through the `tgs` RPC — there is no `getBackgroundPage`/`setViewGlobals`

## Conventions

- Vendored libs (`html2canvas*.js`, `dom-to-image.js`, `db.js`) are excluded from lint — don't edit them
- The fork's purpose is *removing* tracking; never add analytics, remote requests, or telemetry. The MV3 CSP (`extension_pages: script-src 'self'; object-src 'self'`) blocks remote/inline scripts but does not restrict `connect-src` — keeping the no-network promise is a code-review discipline, not a CSP guarantee
- User-visible strings go through `chrome.i18n` / `__MSG_*__` keys in `src/_locales/`
- Prettier 1.x formatting (`.prettierrc`), single quotes, ES5-style code
