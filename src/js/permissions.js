/*global chrome, historyUtils, gsChrome, gsUtils */
(function(global) {
  'use strict';

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    document.getElementById('exportBackupBtn').onclick = async function(e) {
      const currentSession = await gsUtils.sendTgsRpc('buildCurrentSession');
      if (!currentSession) {
        return;
      }
      historyUtils.exportSession(currentSession, function() {
        document.getElementById('exportBackupBtn').style.display = 'none';
      });
    };
    document.getElementById('setFilePermissiosnBtn').onclick = async function(
      e
    ) {
      await gsChrome.tabsCreate({
        url: 'chrome://extensions?id=' + chrome.runtime.id,
      });
    };
  });
})(this);
