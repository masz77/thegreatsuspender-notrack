/* global chrome, XMLHttpRequest, gsStorage, gsUtils */
(function() {
  'use strict';

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var versionEl = document.getElementById('aboutVersion');
    versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

    //hide incompatible sidebar items if in incognito mode
    if (chrome.extension.inIncognitoContext) {
      Array.prototype.forEach.call(
        document.getElementsByClassName('noIncognito'),
        function(el) {
          el.style.display = 'none';
        }
      );
    }
  });

})();
