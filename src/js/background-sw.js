/*global importScripts */
// why: MV3 service worker entry. importScripts preserves the MV2 load order and
// shared-global design; the window shim lets gs libs keep using window.setTimeout etc.
'use strict';
self.window = self;
importScripts(
  'gsUtils.js',
  'gsChrome.js',
  'gsStorage.js',
  'db.js',
  'gsIndexedDb.js',
  'gsMessages.js',
  'gsSession.js',
  'gsTabQueue.js',
  'gsTabCheckManager.js',
  'gsFavicon.js',
  'gsCleanScreencaps.js',
  'gsTabSuspendManager.js',
  'gsTabDiscardManager.js',
  'background.js'
);
