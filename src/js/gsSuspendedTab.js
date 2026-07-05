/*global chrome, gsUtils, gsStorage, gsIndexedDb, gsFavicon */
// eslint-disable-next-line no-unused-vars
var gsSuspendedTab = (function() {
  'use strict';

  // why: MV3 killed getBackgroundPage — this now runs inside suspended.html itself,
  // owning its own document/window instead of a remote handle to another page.
  let _initialised = false;
  let _sessionId = null;
  let _currentTab = null;
  // why: cached from init so updateTheme can recompute low-contrast without a refetch
  let _faviconMeta = null;

  async function init(payload) {
    payload = payload || {};
    _sessionId = payload.sessionId || null;
    const suspendedUrl = window.location.href;

    // Set title
    let title = gsUtils.getSuspendedTitle(suspendedUrl);
    if (title.indexOf('<') >= 0) {
      // Encode any raw html tags that might be used in the title
      title = gsUtils.htmlEncode(title);
    }
    setTitle(title);

    // Set faviconMeta
    const fakeTab = { url: suspendedUrl, id: _currentTab && _currentTab.id };
    _faviconMeta = await gsFavicon.getFaviconMetaData(fakeTab);
    setFaviconMeta(_faviconMeta);

    if (payload.quickInit) {
      _initialised = true;
      return;
    }

    gsUtils.localiseHtml(document);

    const options = gsStorage.getSettings();
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);

    // Add event listeners
    setUnloadTabHandler();
    setUnsuspendTabHandlers();

    // Set imagePreview
    const previewMode = options[gsStorage.SCREEN_CAPTURE];
    const previewUri = await getPreviewUri(suspendedUrl);
    await toggleImagePreviewVisibility(previewMode, previewUri);

    // Set theme
    const theme = options[gsStorage.THEME];
    setTheme(theme, _faviconMeta.isDark);

    // Set command
    setCommand(payload.hotkey);

    // Set url
    setUrl(originalUrl);

    // Set reason
    let suspendReason = null;
    if (payload.suspendReasonInt === 3) {
      suspendReason = chrome.i18n.getMessage('js_suspended_low_memory');
    }
    setReason(suspendReason);

    // Show the view
    showContents();

    // Set scrollPosition (must come after showing page contents)
    const scrollPosition = gsUtils.getSuspendedScrollPosition(suspendedUrl);
    setScrollPosition(scrollPosition, previewMode);

    _initialised = true;
  }

  function showNoConnectivityMessage() {
    if (!document.getElementById('disconnectedNotice')) {
      loadToastTemplate();
    }
    document.getElementById('disconnectedNotice').style.display = 'none';
    setTimeout(function() {
      document.getElementById('disconnectedNotice').style.display = 'block';
    }, 50);
  }

  async function updatePreviewMode(previewMode) {
    const suspendedUrl = window.location.href;
    const previewUri = await getPreviewUri(suspendedUrl);
    await toggleImagePreviewVisibility(previewMode, previewUri);

    const scrollPosition = gsUtils.getSuspendedScrollPosition(suspendedUrl);
    setScrollPosition(scrollPosition, previewMode);
  }

  function showContents() {
    document.querySelector('body').classList.remove('hide-initially');
  }

  function setScrollPosition(scrollPosition, previewMode) {
    const scrollPosAsInt = (scrollPosition && parseInt(scrollPosition)) || 0;
    const scrollImagePreview = previewMode === '2';
    if (scrollImagePreview && scrollPosAsInt > 15) {
      const offsetScrollPosition = scrollPosAsInt + 151;
      document.body.scrollTop = offsetScrollPosition;
      document.documentElement.scrollTop = offsetScrollPosition;
    } else {
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
  }

  function setTitle(title) {
    document.title = title;
    document.getElementById('gsTitle').innerHTML = title;
    document.getElementById('gsTopBarTitle').innerHTML = title;
    // Prevent unsuspend by parent container
    // Using mousedown event otherwise click can still be triggered if
    // mouse is released outside of this element
    document.getElementById('gsTopBarTitle').onmousedown = function(e) {
      e.stopPropagation();
    };
  }

  function setUrl(url) {
    // why: the url= hash param is decoded via decodeURIComponent and reaches this
    // sink; textContent prevents HTML/content injection into the chrome-extension:// page.
    document.getElementById('gsTopBarUrl').textContent = cleanUrl(url);
    document.getElementById('gsTopBarUrl').setAttribute('href', url);
    document.getElementById('gsTopBarUrl').onmousedown = function(e) {
      e.stopPropagation();
    };
  }

  function setFaviconMeta(faviconMeta) {
    document
      .getElementById('gsTopBarImg')
      .setAttribute('src', faviconMeta.normalisedDataUrl);
    document
      .getElementById('gsFavicon')
      .setAttribute('href', faviconMeta.transparentDataUrl);
  }

  function setTheme(theme, isLowContrastFavicon) {
    if (theme === 'dark') {
      document.querySelector('body').classList.add('dark');
    } else {
      document.querySelector('body').classList.remove('dark');
    }

    if (theme === 'dark' && isLowContrastFavicon) {
      document
        .getElementById('faviconWrap')
        .classList.add('faviconWrapLowContrast');
    } else {
      document
        .getElementById('faviconWrap')
        .classList.remove('faviconWrapLowContrast');
    }
  }

  function setReason(reason) {
    let reasonMsgEl = document.getElementById('reasonMsg');
    if (!reasonMsgEl) {
      reasonMsgEl = document.createElement('div');
      reasonMsgEl.setAttribute('id', 'reasonMsg');
      reasonMsgEl.classList.add('reasonMsg');
      const containerEl = document.getElementById('suspendedMsg-instr');
      containerEl.insertBefore(reasonMsgEl, containerEl.firstChild);
    }
    reasonMsgEl.innerHTML = reason;
  }

  async function getPreviewUri(suspendedUrl) {
    const originalUrl = gsUtils.getOriginalUrl(suspendedUrl);
    const preview = await gsIndexedDb.fetchPreviewImage(originalUrl);
    let previewUri = null;
    if (
      preview &&
      preview.img &&
      preview.img !== null &&
      preview.img !== 'data:,' &&
      preview.img.length > 10000
    ) {
      previewUri = preview.img;
    }
    return previewUri;
  }

  function buildImagePreview(previewUri) {
    return new Promise(resolve => {
      const previewEl = document.createElement('div');
      const bodyEl = document.getElementsByTagName('body')[0];
      previewEl.setAttribute('id', 'gsPreviewContainer');
      previewEl.classList.add('gsPreviewContainer');
      previewEl.innerHTML = document.getElementById('previewTemplate').innerHTML;
      const unsuspendTabHandler = buildUnsuspendTabHandler();
      previewEl.onclick = unsuspendTabHandler;
      gsUtils.localiseHtml(previewEl);
      bodyEl.appendChild(previewEl);

      const previewImgEl = document.getElementById('gsPreviewImg');
      const onLoadedHandler = function() {
        previewImgEl.removeEventListener('load', onLoadedHandler);
        previewImgEl.removeEventListener('error', onLoadedHandler);
        resolve();
      };
      previewImgEl.setAttribute('src', previewUri);
      previewImgEl.addEventListener('load', onLoadedHandler);
      previewImgEl.addEventListener('error', onLoadedHandler);
    });
  }

  function addWatermarkHandler() {
    document.querySelector('.watermark').onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('about.html') });
    };
  }

  async function toggleImagePreviewVisibility(previewMode, previewUri) {
    const builtImagePreview =
      document.getElementById('gsPreviewContainer') !== null;
    if (!builtImagePreview && previewUri && previewMode && previewMode !== '0') {
      await buildImagePreview(previewUri);
    } else {
      addWatermarkHandler();
    }

    if (!document.getElementById('gsPreviewContainer')) {
      return;
    }
    const overflow = previewMode === '2' ? 'auto' : 'hidden';
    document.body.style['overflow'] = overflow;

    if (previewMode === '0' || !previewUri) {
      document.getElementById('gsPreviewContainer').style.display = 'none';
      document.getElementById('suspendedMsg').style.display = 'flex';
      document.body.classList.remove('img-preview-mode');
    } else {
      document.getElementById('gsPreviewContainer').style.display = 'block';
      document.getElementById('suspendedMsg').style.display = 'none';
      document.body.classList.add('img-preview-mode');
    }
  }

  function setCommand(command) {
    const hotkeyEl = document.getElementById('hotkeyWrapper');
    if (command) {
      hotkeyEl.innerHTML =
        '<span class="hotkeyCommand">(' + command + ')</span>';
    } else {
      const reloadString = chrome.i18n.getMessage(
        'js_suspended_hotkey_to_reload'
      );
      hotkeyEl.innerHTML = `<a id="setKeyboardShortcut" href="#">${reloadString}</a>`;
    }
  }

  function setUnloadTabHandler() {
    // beforeunload event will get fired if: the tab is refreshed, the url is changed,
    // the tab is closed, or the tab is frozen by chrome ??
    // the worker inspects sender.tab and records STATE_UNLOADED_URL if this is the
    // currently focused tab, so a refresh unsuspends on reload.
    window.addEventListener('beforeunload', function() {
      gsUtils.sendTgsRpc('reportSuspendedTabUnloading');
    });
  }

  function setUnsuspendTabHandlers() {
    const unsuspendTabHandler = buildUnsuspendTabHandler();
    document.getElementById('gsTopBarUrl').onclick = unsuspendTabHandler;
    document.getElementById('gsTopBar').onmousedown = unsuspendTabHandler;
    document.getElementById('suspendedMsg').onclick = unsuspendTabHandler;
  }

  function buildUnsuspendTabHandler() {
    return function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.id === 'setKeyboardShortcut') {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      } else if (e.which === 1) {
        showUnsuspendAnimation();
        gsUtils.sendTgsRpc('unsuspendSelf');
      }
    };
  }

  function showUnsuspendAnimation() {
    if (document.body.classList.contains('img-preview-mode')) {
      document.getElementById('refreshSpinner').classList.add('spinner');
    } else {
      document.body.classList.add('waking');
      document.getElementById('snoozyImg').src = chrome.runtime.getURL(
        'img/snoozy_tab_awake.svg'
      );
      document.getElementById('snoozySpinner').classList.add('spinner');
    }
  }

  function loadToastTemplate() {
    const toastEl = document.createElement('div');
    toastEl.setAttribute('id', 'disconnectedNotice');
    toastEl.classList.add('toast-wrapper');
    toastEl.innerHTML = document.getElementById('toastTemplate').innerHTML;
    gsUtils.localiseHtml(toastEl);
    document.getElementsByTagName('body')[0].appendChild(toastEl);
  }

  function cleanUrl(urlStr) {
    // remove scheme
    if (urlStr.indexOf('//') > 0) {
      urlStr = urlStr.substring(urlStr.indexOf('//') + 2);
    }
    // remove query string
    let match = urlStr.match(/\/?[?#]+/);
    if (match) {
      urlStr = urlStr.substring(0, match.index);
    }
    // remove trailing slash
    match = urlStr.match(/\/$/);
    if (match) {
      urlStr = urlStr.substring(0, match.index);
    }
    return urlStr;
  }

  // why: this page shares the runtime.onMessage bus with tgsRpc responses destined for
  // OTHER pages. Answer ONLY our known actions and return false/undefined for the rest,
  // or we would steal (and mis-answer) another page's RPC reply.
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    switch (request.action) {
      case 'initSuspendedTab':
        init(request.payload).then(() => sendResponse({ initialised: true }));
        return true;
      case 'requestSuspendedTabInfo':
        sendResponse({
          isInitialised: _initialised,
          sessionId: _sessionId,
          isVisible: !document.body.classList.contains('hide-initially'),
        });
        return false;
      case 'updateCommand':
        setCommand(request.hotkey);
        sendResponse({});
        return false;
      case 'updateTheme':
        setTheme(
          gsStorage.getOption(gsStorage.THEME),
          _faviconMeta ? _faviconMeta.isDark : false
        );
        sendResponse({});
        return false;
      case 'updatePreviewMode':
        updatePreviewMode(gsStorage.getOption(gsStorage.SCREEN_CAPTURE)).then(
          () => sendResponse({})
        );
        return true;
      case 'showNoConnectivityMessage':
        showNoConnectivityMessage();
        sendResponse({});
        return false;
      case 'ping':
        // why: recovery.js pings suspended tabs to detect responsiveness
        sendResponse({ action: 'pong' });
        return false;
      default:
        return false;
    }
  });

  gsUtils
    .documentReadyAndLocalisedAsPromsied(document)
    .then(async () => {
      _currentTab = await new Promise(r => chrome.tabs.getCurrent(r));
      let payload = null;
      for (let i = 0; i < 5 && !payload; i += 1) {
        payload = await gsUtils.sendTgsRpc('getSuspendedTabInitData');
        if (!payload) {
          await gsUtils.setTimeout(500);
        }
      }
      if (!_initialised) {
        await init(payload || {});
      }
    });

  return {
    init,
  };
})();
