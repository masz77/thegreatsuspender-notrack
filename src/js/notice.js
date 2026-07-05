/*global gsStorage, gsUtils */
(function() {
  'use strict';

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(async function() {
    var notice = await gsUtils.sendTgsRpc('requestNotice');
    if (
      notice &&
      notice.hasOwnProperty('text') &&
      notice.hasOwnProperty('version')
    ) {
      var noticeContentEl = document.getElementById('gsNotice');
      noticeContentEl.innerHTML = notice.text;
      //update local notice version
      gsStorage.setNoticeVersion(notice.version);
    }

    //clear notice (to prevent it showing again)
    gsUtils.sendTgsRpc('clearNotice');
  });
})();
