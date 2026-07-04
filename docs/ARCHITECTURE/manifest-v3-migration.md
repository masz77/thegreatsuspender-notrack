# Manifest V3 Migration

## Overview

Chrome removed Manifest V2 support (enterprise policy escape hatch ended with Chrome 138, mid-2025), which hard-disables this extension. This doc records the migration architecture from MV2 (persistent background page, shared window globals) to MV3 (service worker, message passing).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Background | Classic service worker `js/background-sw.js` that `importScripts()` the existing 14 background files in manifest order, with a `self.window = self` shim | Preserves the load-order/global-variable design; smallest possible diff to working code |
| Settings storage | `chrome.storage.local` behind a synchronous in-memory cache in `gsStorage`, initialised before anything else runs | Service workers have no `localStorage`; ~65 call sites expect sync `getOption()` — a cache keeps them untouched |
| Settings migration | Extension pages (which still have `localStorage`) copy legacy `gsSettings`/metadata keys into `chrome.storage.local` on first load after update | The worker cannot read the old `localStorage`; pages can |
| Suspended tab | `suspended.html` becomes self-initialising: it loads gs* libs itself plus `gsSuspendedTab.js` and reads its state from the URL hash, settings, and IndexedDB. Background communicates via `chrome.tabs.sendMessage` | `chrome.extension.getViews()` no longer exists; the worker cannot touch another page's DOM |
| Other HTML pages | Each page loads the gs* libs it needs via `<script>` tags; calls into background state go through a small `tgs` RPC over `chrome.runtime.sendMessage` | Replaces `getBackgroundPage().tgs.setViewGlobals()`; libs are stateless against shared chrome.storage/IndexedDB so local copies are safe |
| Auto-suspend timers | Per-tab `chrome.alarms` (`gsAutoSuspend:<tabId>`) instead of hour-long `setTimeout` | Worker dies after ~30s idle; alarms survive |
| Periodic jobs | `chrome.alarms` for session metrics (15 min) and notice check (12 h) | Same lifetime reason |
| Tab runtime state | `_tabStateByTabId` mirrored to `chrome.storage.session`, rehydrated on worker start | Worker restarts must not lose unsuspend-on-reload/scroll state |
| Favicons | `chrome.runtime.getURL('/_favicon/...')` + `favicon` permission; canvas work via `OffscreenCanvas`/`createImageBitmap` | `chrome://favicon/*` and DOM `Image`/canvas are unavailable in MV3 workers |
| Script injection | `chrome.scripting.executeScript` with `files` / `func`+`args` | `chrome.tabs.executeScript` (incl. code strings) removed in MV3 |
| Context menus | Single `chrome.contextMenus.onClicked` listener dispatching by menu id | MV3 forbids the `onclick` create property |
| Screencap request blocking | Dropped (`gsCleanScreencaps` webRequest-blocking listener) | Blocking webRequest is removed in MV3; the permission was never declared so it was already dead code |
| Battery / online-offline | Guarded: `navigator.getBattery` if present; `navigator.onLine` checks retained | Not available in service workers |

## Key Files

| File | Purpose |
|------|---------|
| `src/manifest.json` | MV3 manifest: `action`, `host_permissions`, SW background, object CSP/WAR |
| `src/js/background-sw.js` | Service worker entry: window shim + `importScripts` in dependency order |
| `src/js/gsStorage.js` | chrome.storage.local-backed settings with sync cache + legacy localStorage migration |
| `src/js/background.js` | tgs core: alarms, contextMenus dispatch, RPC handler, suspended-tab messaging |
| `src/js/gsSuspendedTab.js` | Now runs inside suspended.html; self-init + message listener |
| `src/suspended.html` | Loads gs* libs + gsSuspendedTab |
| `src/js/gsMessages.js` | `chrome.scripting`-based injection |
| `src/js/gsFavicon.js` | `_favicon` API + OffscreenCanvas |
| view scripts (`popup.js`, `options.js`, …) | Local lib loading + `tgs` RPC instead of `getBackgroundPage` |

## Data Flow

- Pages/worker share persistent data only through `chrome.storage.*` and IndexedDB — never through shared JS globals.
- Background-only runtime state (focused tab tracking, tab state flags) lives in the worker, mirrored to `chrome.storage.session`.
- Pages → background: `chrome.runtime.sendMessage({ action: 'tgsRpc', fn, args })` against an allowlist.
- Background → suspended tabs / content scripts: `chrome.tabs.sendMessage`.

## Security Considerations

- CSP tightens to MV3 `extension_pages` form; no remote code, no new origins.
- The tgs RPC dispatches only allowlisted function names; messages from web pages cannot reach it (content scripts use distinct message shapes, and `web_accessible_resources` stays limited to `suspended.html`).
- No new permissions beyond MV3 mechanical replacements (`scripting`, `alarms`, `favicon`, `offscreen` not needed).
