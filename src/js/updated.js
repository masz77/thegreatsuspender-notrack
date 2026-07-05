/*global chrome, gsUtils */
(function(global) {
  'use strict';

  function toggleUpdated() {
    document.getElementById('updating').style.display = 'none';
    document.getElementById('updated').style.display = 'block';
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(async function() {
    // var versionEl = document.getElementById('updatedVersion');
    // versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

    document.getElementById('sessionManagerLink').onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    };

    var updateType = await gsUtils.sendTgsRpc('getUpdateType');
    if (updateType === 'major') {
      document.getElementById('patchMessage').style.display = 'none';
      document.getElementById('minorUpdateDetail').style.display = 'none';
    } else if (updateType === 'minor') {
      document.getElementById('patchMessage').style.display = 'none';
      document.getElementById('majorUpdateDetail').style.display = 'none';
    } else {
      document.getElementById('updateDetail').style.display = 'none';
    }

    if (await gsUtils.sendTgsRpc('isUpdated')) {
      toggleUpdated();
    }
  });

  // why: worker broadcasts toggleUpdated when the update completes; only handle our
  // own action and return nothing so other pages' tgsRpc replies pass through.
  chrome.runtime.onMessage.addListener(request => {
    if (request.action === 'toggleUpdated') {
      toggleUpdated();
    }
  });
})(this);
