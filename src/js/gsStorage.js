/*global chrome, gsSession, localStorage, gsUtils */
'use strict';

// Used to keep track of which settings were defined in the managed storage
const managedOptions = []; // Example: ["gsTheme, gsWhitelist"]

// why: MV3 service workers have no localStorage; settings live in chrome.storage.local
// behind this synchronous in-memory cache so the ~65 sync getOption() call sites keep working.
let _settingsCache = null;
const _metaCache = {};
let _initCachePromise = null;

const gsStorageSettings = {
  SCREEN_CAPTURE: 'screenCapture',
  SCREEN_CAPTURE_FORCE: 'screenCaptureForce',
  SUSPEND_IN_PLACE_OF_DISCARD: 'suspendInPlaceOfDiscard',
  UNSUSPEND_ON_FOCUS: 'gsUnsuspendOnFocus',
  SUSPEND_TIME: 'gsTimeToSuspend',
  IGNORE_WHEN_OFFLINE: 'onlineCheck',
  IGNORE_WHEN_CHARGING: 'batteryCheck',
  IGNORE_PINNED: 'gsDontSuspendPinned',
  IGNORE_FORMS: 'gsDontSuspendForms',
  IGNORE_AUDIO: 'gsDontSuspendAudio',
  IGNORE_ACTIVE_TABS: 'gsDontSuspendActiveTabs',
  IGNORE_CACHE: 'gsIgnoreCache',
  ADD_CONTEXT: 'gsAddContextMenu',
  SYNC_SETTINGS: 'gsSyncSettings',
  NO_NAG: 'gsNoNag',
  THEME: 'gsTheme',
  WHITELIST: 'gsWhitelist',

  DISCARD_AFTER_SUSPEND: 'discardAfterSuspend',
  DISCARD_IN_PLACE_OF_SUSPEND: 'discardInPlaceOfSuspend',
  USE_ALT_SCREEN_CAPTURE_LIB: 'useAlternateScreenCaptureLib',
  ENABLE_CLEAN_SCREENCAPS: 'cleanScreencaps'
};

var gsStorage = {
  ...gsStorageSettings,

  APP_VERSION: 'gsVersion',
  LAST_NOTICE: 'gsNotice',
  LAST_EXTENSION_RECOVERY: 'gsExtensionRecovery',

  SM_SESSION_METRICS: 'gsSessionMetrics',
  SM_TIMESTAMP: 'sessionTimestamp',
  SM_SUSPENDED_TAB_COUNT: 'suspendedTabCount',
  SM_TOTAL_TAB_COUNT: 'totalTabCount',

  // chrome.storage.local keys that back the synchronous cache
  STORAGE_KEYS: [
    'gsSettings',
    'gsVersion',
    'gsNotice',
    'gsExtensionRecovery',
    'gsSessionMetrics',
    'gsSettingsMigrated',
  ],

  noop: function() {},

  getSettingsDefaults: function() {
    const defaults = {};
    defaults[gsStorage.SCREEN_CAPTURE] = '0';
    defaults[gsStorage.SCREEN_CAPTURE_FORCE] = false;
    defaults[gsStorage.SUSPEND_IN_PLACE_OF_DISCARD] = false;
    defaults[gsStorage.DISCARD_IN_PLACE_OF_SUSPEND] = false;
    defaults[gsStorage.USE_ALT_SCREEN_CAPTURE_LIB] = false;
    defaults[gsStorage.DISCARD_AFTER_SUSPEND] = false;
    defaults[gsStorage.IGNORE_WHEN_OFFLINE] = false;
    defaults[gsStorage.IGNORE_WHEN_CHARGING] = false;
    defaults[gsStorage.UNSUSPEND_ON_FOCUS] = false;
    defaults[gsStorage.IGNORE_PINNED] = true;
    defaults[gsStorage.IGNORE_FORMS] = true;
    defaults[gsStorage.IGNORE_AUDIO] = true;
    defaults[gsStorage.IGNORE_ACTIVE_TABS] = true;
    defaults[gsStorage.IGNORE_CACHE] = false;
    defaults[gsStorage.ADD_CONTEXT] = true;
    defaults[gsStorage.SYNC_SETTINGS] = true;
    defaults[gsStorage.SUSPEND_TIME] = '60';
    defaults[gsStorage.NO_NAG] = false;
    defaults[gsStorage.WHITELIST] = '';
    defaults[gsStorage.THEME] = 'light';
    defaults[gsStorage.ENABLE_CLEAN_SCREENCAPS] = false;

    return defaults;
  },

  /**
   * LOCAL STORAGE FUNCTIONS
   */

  // Loads the chrome.storage.local-backed cache. Idempotent; safe to await from any context.
  initSettingsCacheAsPromised: function() {
    if (_initCachePromise) {
      return _initCachePromise;
    }
    _initCachePromise = new Promise(function(resolve) {
      chrome.storage.local.get(gsStorage.STORAGE_KEYS, function(result) {
        result = result || {};
        const metaKeys = [
          gsStorage.APP_VERSION,
          gsStorage.LAST_NOTICE,
          gsStorage.LAST_EXTENSION_RECOVERY,
          gsStorage.SM_SESSION_METRICS,
        ];

        // why: only extension PAGES have localStorage; the worker cannot read the legacy
        // MV2 settings, so pages migrate them once (guarded by the gsSettingsMigrated flag).
        if (!result.gsSettingsMigrated && typeof localStorage !== 'undefined') {
          const migrated = {};
          try {
            const legacySettings = JSON.parse(localStorage.getItem('gsSettings'));
            if (legacySettings) {
              // legacy settings WIN over any defaults the worker may have auto-created
              result.gsSettings = legacySettings;
            }
          } catch (e) {
            gsUtils.error('gsStorage', 'Failed to parse legacy gsSettings', e);
          }
          if (typeof result.gsSettings !== 'undefined') {
            migrated.gsSettings = result.gsSettings;
          }
          for (const key of metaKeys) {
            // why: worker may already have advanced gsVersion — only copy legacy meta if absent
            if (typeof result[key] !== 'undefined') {
              continue;
            }
            let legacyValue;
            try {
              legacyValue = JSON.parse(localStorage.getItem(key));
            } catch (e) {
              legacyValue = undefined;
            }
            if (typeof legacyValue !== 'undefined' && legacyValue !== null) {
              result[key] = legacyValue;
              migrated[key] = legacyValue;
            }
          }
          migrated.gsSettingsMigrated = true;
          chrome.storage.local.set(migrated, function() {
            if (chrome.runtime.lastError) {
              gsUtils.error(
                'gsStorage',
                'failed to persist migrated settings',
                chrome.runtime.lastError
              );
            }
          });
        }

        _settingsCache =
          typeof result.gsSettings !== 'undefined' ? result.gsSettings : null;
        for (const key of metaKeys) {
          _metaCache[key] = result[key];
        }

        // why: options page writes must reach the worker cache and vice versa
        chrome.storage.onChanged.addListener(function(changes, namespace) {
          if (namespace !== 'local' || !changes) {
            return;
          }
          if (changes.gsSettings) {
            _settingsCache = changes.gsSettings.newValue;
          }
          for (const key of metaKeys) {
            if (changes[key]) {
              _metaCache[key] = changes[key].newValue;
            }
          }
        });

        // Populate managedOptions so isOptionManaged works in every context.
        chrome.storage.managed.get(
          Object.keys(gsStorageSettings),
          function(managed) {
            managed = managed || {};
            Object.keys(managed).forEach(function(key) {
              if (managedOptions.indexOf(gsStorage[key]) === -1) {
                managedOptions.push(gsStorage[key]);
              }
            });
            resolve();
          }
        );
      });
    });
    return _initCachePromise;
  },

  //populate settings with sync settings where undefined
  initSettingsAsPromised: async function() {
    await gsStorage.initSettingsCacheAsPromised();
    return new Promise(function(resolve) {
      var defaultSettings = gsStorage.getSettingsDefaults();
      var defaultKeys = Object.keys(defaultSettings);
      chrome.storage.sync.get(defaultKeys, function(syncedSettings) {
        gsUtils.log('gsStorage', 'syncedSettings on init: ', syncedSettings);
        gsSession.setSynchedSettingsOnInit(syncedSettings);

        var rawLocalSettings = _settingsCache || {};
        if (!rawLocalSettings || Object.keys(rawLocalSettings).length === 0) {
          rawLocalSettings = {};
        } else {
          //if we have some rawLocalSettings but SYNC_SETTINGS is not defined
          //then define it as FALSE (as opposed to default of TRUE)
          rawLocalSettings[gsStorage.SYNC_SETTINGS] =
            rawLocalSettings[gsStorage.SYNC_SETTINGS] || false;
        }
        gsUtils.log('gsStorage', 'localSettings on init: ', rawLocalSettings);
        var shouldSyncSettings = rawLocalSettings[gsStorage.SYNC_SETTINGS];

        var mergedSettings = {};
        for (const key of defaultKeys) {
          if (key === gsStorage.SYNC_SETTINGS) {
            if (chrome.extension.inIncognitoContext) {
              mergedSettings[key] = false;
            } else {
              mergedSettings[key] = rawLocalSettings.hasOwnProperty(key)
                ? rawLocalSettings[key]
                : defaultSettings[key];
            }
            continue;
          }
          // If nags are disabled locally, then ensure we disable them on synced profile
          if (
            key === gsStorage.NO_NAG &&
            shouldSyncSettings &&
            rawLocalSettings.hasOwnProperty(gsStorage.NO_NAG) &&
            rawLocalSettings[gsStorage.NO_NAG]
          ) {
            mergedSettings[gsStorage.NO_NAG] = true;
            continue;
          }
          // if synced setting exists and local setting does not exist or
          // syncing is enabled locally then overwrite with synced value
          if (
            syncedSettings.hasOwnProperty(key) &&
            (!rawLocalSettings.hasOwnProperty(key) || shouldSyncSettings)
          ) {
            mergedSettings[key] = syncedSettings[key];
          }
          //fallback on rawLocalSettings
          if (!mergedSettings.hasOwnProperty(key)) {
            mergedSettings[key] = rawLocalSettings[key];
          }
          //fallback on defaultSettings
          if (
            typeof mergedSettings[key] === 'undefined' ||
            mergedSettings[key] === null
          ) {
            gsUtils.errorIfInitialised(
              'gsStorage',
              'Missing key: ' + key + '! Will init with default.'
            );
            mergedSettings[key] = defaultSettings[key];
          }
        }
        gsStorage.saveSettings(mergedSettings);
        gsUtils.log('gsStorage', 'mergedSettings: ', mergedSettings);

        // if any of the new settings are different to those in sync, then trigger a resync
        var triggerResync = false;
        for (const key of defaultKeys) {
          if (
            key !== gsStorage.SYNC_SETTINGS &&
            syncedSettings[key] !== mergedSettings[key]
          ) {
            triggerResync = true;
          }
        }
        if (triggerResync) {
          gsStorage.syncSettings();
        }
        gsStorage.addSettingsSyncListener();
        gsUtils.log('gsStorage', 'init successful');
        resolve();
      });
    });
  },

  /**
   * Checks the managed storage for settings and overrides the local storage
   * Settings in managed storage are stored by key
   * Settings in local storage are stored by name
   * Example: in managed storage you will find "SYNC_SETTINGS": true.
   *          in local storage you will find "gsSyncSettings": true
   * I did this because I think the key is easier to interpret for someone
   * editing the managed storage manually.
   */
  checkManagedStorageAndOverride() {
    const settingsList = Object.keys(gsStorageSettings);
    chrome.storage.managed.get(settingsList, result => {
      const settings = gsStorage.getSettings();

      Object.keys(result).forEach(key => {
        if (key === 'WHITELIST') {
          settings[gsStorage[key]] = result[key].replace(/[\s\n]+/g, '\n');
        } else {
          settings[gsStorage[key]] = result[key];
        }

        // Mark option as managed
        managedOptions.push(gsStorage[key]);
      });

      gsStorage.saveSettings(settings);
      gsUtils.log(
        'gsStorage',
        'overrode settings with managed storage config:',
        settings
      );
    });
  },

  // Listen for changes to synced settings
  addSettingsSyncListener: function() {
    chrome.storage.onChanged.addListener(function(remoteSettings, namespace) {
      if (namespace !== 'sync' || !remoteSettings) {
        return;
      }
      var shouldSync = gsStorage.getOption(gsStorage.SYNC_SETTINGS);
      if (shouldSync) {
        var localSettings = gsStorage.getSettings();
        var changedSettingKeys = [];
        var oldValueBySettingKey = {};
        var newValueBySettingKey = {};
        Object.keys(remoteSettings).forEach(function(key) {
          var remoteSetting = remoteSettings[key];

          // If nags are disabled locally, then ensure we disable them on synced profile
          if (key === gsStorage.NO_NAG) {
            if (remoteSetting.newValue === false) {
              return false; // don't process this key
            }
          }

          if (localSettings[key] !== remoteSetting.newValue) {
            gsUtils.log(
              'gsStorage',
              'Changed value from sync',
              key,
              remoteSetting.newValue
            );
            changedSettingKeys.push(key);
            oldValueBySettingKey[key] = localSettings[key];
            newValueBySettingKey[key] = remoteSetting.newValue;
            localSettings[key] = remoteSetting.newValue;
          }
        });

        if (changedSettingKeys.length > 0) {
          gsStorage.saveSettings(localSettings);
          gsUtils.performPostSaveUpdates(
            changedSettingKeys,
            oldValueBySettingKey,
            newValueBySettingKey
          );
        }
      }
    });
  },

  //due to migration issues and new settings being added, i have built in some redundancy
  //here so that getOption will always return a valid value.
  getOption: function(prop) {
    var settings = gsStorage.getSettings();
    if (typeof settings[prop] === 'undefined' || settings[prop] === null) {
      settings[prop] = gsStorage.getSettingsDefaults()[prop];
      gsStorage.saveSettings(settings);
    }
    return settings[prop];
  },

  setOption: function(prop, value) {
    var settings = gsStorage.getSettings();
    settings[prop] = value;
    // gsUtils.log('gsStorage', 'gsStorage', 'setting prop: ' + prop + ' to value ' + value);
    gsStorage.saveSettings(settings);
  },

  // Important to note that setOption (and ultimately saveSettings) uses chrome.storage.local
  // whereas syncSettings saves to chrome.storage.sync.
  // Calling syncSettings has the unfortunate side-effect of triggering the chrome.storage.onChanged
  // listener which then re-saves the setting to local a second time.
  setOptionAndSync: function(prop, value) {
    gsStorage.setOption(prop, value);
    gsStorage.syncSettings();
  },

  getSettings: function() {
    var settings = _settingsCache;
    if (!settings) {
      settings = gsStorage.getSettingsDefaults();
      gsStorage.saveSettings(settings);
    }
    return settings;
  },

  saveSettings: function(settings) {
    _settingsCache = settings;
    chrome.storage.local.set({ gsSettings: settings }, function() {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save gsSettings to chrome.storage.local',
          chrome.runtime.lastError
        );
      }
    });
  },

  // Push settings to sync
  syncSettings: function() {
    var settings = gsStorage.getSettings();
    if (settings[gsStorage.SYNC_SETTINGS]) {
      // Since sync is a local setting, delete it to simplify things.
      // Copy so we don't mutate the cached settings object.
      settings = Object.assign({}, settings);
      delete settings[gsStorage.SYNC_SETTINGS];
      gsUtils.log(
        'gsStorage',
        'gsStorage',
        'Pushing local settings to sync',
        settings
      );
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          gsUtils.error(
            'gsStorage',
            'failed to save to chrome.storage.sync: ',
            chrome.runtime.lastError
          );
        }
      });
    }
  },

  saveMeta: function(key, value) {
    _metaCache[key] = value;
    chrome.storage.local.set({ [key]: value }, function() {
      if (chrome.runtime.lastError) {
        gsUtils.error(
          'gsStorage',
          'failed to save ' + key + ' to chrome.storage.local',
          chrome.runtime.lastError
        );
      }
    });
  },

  fetchLastVersion: function() {
    var version = _metaCache[gsStorage.APP_VERSION];
    version = version || '0.0.0';
    return version + '';
  },
  setLastVersion: function(newVersion) {
    gsStorage.saveMeta(gsStorage.APP_VERSION, newVersion);
  },

  fetchNoticeVersion: function() {
    var lastNoticeVersion = _metaCache[gsStorage.LAST_NOTICE];
    lastNoticeVersion = lastNoticeVersion || '0';
    return lastNoticeVersion + '';
  },
  setNoticeVersion: function(newVersion) {
    gsStorage.saveMeta(gsStorage.LAST_NOTICE, newVersion);
  },

  fetchLastExtensionRecoveryTimestamp: function() {
    return _metaCache[gsStorage.LAST_EXTENSION_RECOVERY];
  },
  setLastExtensionRecoveryTimestamp: function(extensionRecoveryTimestamp) {
    gsStorage.saveMeta(
      gsStorage.LAST_EXTENSION_RECOVERY,
      extensionRecoveryTimestamp
    );
  },

  fetchSessionMetrics: function() {
    var sessionMetrics = _metaCache[gsStorage.SM_SESSION_METRICS];
    return sessionMetrics || {};
  },
  setSessionMetrics: function(sessionMetrics) {
    gsStorage.saveMeta(gsStorage.SM_SESSION_METRICS, sessionMetrics);
  },

  /**
   * Used by the options page to tell whether an option is set in managed storage
   * and thus should not be changed.
   *
   * @param option The option name, such as "gsWhitelist" (not "WHITELIST")
   */
  isOptionManaged: option => managedOptions.includes(option),
};
