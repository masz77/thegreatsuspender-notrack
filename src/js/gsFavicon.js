/*global chrome, gsUtils, gsIndexedDb, OffscreenCanvas, createImageBitmap, AbortController, FileReader */
// eslint-disable-next-line no-unused-vars
var gsFavicon = (function() {
  'use strict';

  // const GOOGLE_S2_URL = 'https://www.google.com/s2/favicons?domain_url=';
  const FALLBACK_CHROME_FAVICON_META = {
    favIconUrl: 'chrome-extension://_favicon/fallbackChromeFaviconMeta',
    isDark: true,
    normalisedDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVQ4T2NkoBAwIuuPior6j8O8xmXLljVgk8MwYNmyZdgMfcjAwLAAmyFEGfDv3z9FJiamA9gMIcoAkKsiIiIUsBlClAHofkf2JkED0DWDAnrUgOEfBsRkTpzpgBjN6GoA24V1Efr1zoAAAAAASUVORK5CYII=',
    transparentDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkoBAwIuuPioqqx2YeExPTwSVLlhzAJodhwLJlyxrRDWVkZPzIyMh4AZshRBnAxsY28ffv3wnYDCHKAJCrEhISBLAZQpQB6H5H9iZBA9A1gwJ61IDhHwbEZE6c6YAYzehqAAmQeBHM42eMAAAAAElFTkSuQmCC',
  };

  const _defaultFaviconFingerprintById = {};
  let _defaultChromeFaviconMeta;

  async function initAsPromised() {
    // why: default-favicon fingerprints are deterministic per version; cache in
    // storage.session (clears on browser restart) so we skip regenerating ~7 icons
    // on every ~30s worker wake instead of blocking the init critical path.
    const cached = await new Promise(r =>
      chrome.storage.session.get('gsFaviconDefaults', o => r(o.gsFaviconDefaults))
    );
    if (cached && cached.chromeMeta) {
      Object.assign(_defaultFaviconFingerprintById, cached.fingerprints);
      _defaultChromeFaviconMeta = cached.chromeMeta;
    } else {
      await addFaviconDefaults();
    }
    gsUtils.log('gsFavicon', 'init successful');
  }

  async function addFaviconDefaults() {
    // Generate a list of potential 'default' favicons so we can avoid caching
    // anything that matches these defaults
    const defaultIconUrls = [
      generateChromeFavIconUrlFromUrl('http://chromeDefaultFavicon'),
      generateChromeFavIconUrlFromUrl('chromeDefaultFavicon'),
      chrome.runtime.getURL('img/ic_suspendy_16x16.png'),
      chrome.runtime.getURL('img/chromeDefaultFavicon.png'),
      chrome.runtime.getURL('img/chromeDefaultFaviconSml.png'),
      chrome.runtime.getURL('img/chromeDevDefaultFavicon.png'),
      chrome.runtime.getURL('img/chromeDevDefaultFaviconSml.png'),
    ];

    const faviconPromises = [];
    for (let i = 0; i < defaultIconUrls.length; i += 1) {
      const iconUrl = defaultIconUrls[i];
      faviconPromises.push(
        new Promise(async resolve => {
          const faviconMeta = await addDefaultFaviconMeta(iconUrl);
          if (faviconMeta) {
            gsUtils.log(
              'gsFavicon',
              `Successfully built default faviconMeta for url: ${iconUrl}`,
              faviconMeta
            );
          } else {
            gsUtils.warning(
              'gsFavicon',
              `Failed to build faviconMeta for url: ${iconUrl}`
            );
          }
          // Set the first url as the default favicon
          if (i === 0) {
            _defaultChromeFaviconMeta =
              faviconMeta || FALLBACK_CHROME_FAVICON_META;
            gsUtils.log(
              'gsFavicon',
              'Set _defaultChromeFaviconMeta',
              _defaultChromeFaviconMeta
            );
          }
          resolve();
        })
      );
    }
    await Promise.all(faviconPromises);
    chrome.storage.session.set({
      gsFaviconDefaults: {
        fingerprints: _defaultFaviconFingerprintById,
        chromeMeta: _defaultChromeFaviconMeta,
      },
    }); // fire & forget
  }

  async function addDefaultFaviconMeta(url) {
    let faviconMeta;
    try {
      faviconMeta = await gsUtils.executeWithRetries(
        buildFaviconMetaData,
        [url],
        4,
        0
      );
    } catch (e) {
      gsUtils.warning('gsFavicon', e);
    }
    addFaviconMetaToDefaultFingerprints(faviconMeta, url);
    return faviconMeta;
  }

  async function addFaviconMetaToDefaultFingerprints(faviconMeta, id) {
    _defaultFaviconFingerprintById[id] = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    _defaultFaviconFingerprintById[
      id + 'Transparent'
    ] = await createImageFingerprint(faviconMeta.transparentDataUrl);
  }

  function generateChromeFavIconUrlFromUrl(url) {
    // why: MV3 removed the legacy favicon URL scheme; the favicon permission exposes /_favicon/ instead
    return chrome.runtime.getURL(
      '/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'
    );
  }

  // why: MV3 workers have no DOM Image/canvas; fetch the bytes and decode off-thread.
  async function loadImageBitmap(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Failed to fetch image: ' + url);
      const blob = await response.blob();
      return await createImageBitmap(blob);
    } finally {
      clearTimeout(timer);
    }
  }

  async function canvasToDataUrl(canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function getFaviconMetaData(tab) {
    if (gsUtils.isFileTab(tab)) {
      // why: page contexts never run initAsPromised, so _defaultChromeFaviconMeta can
    // be undefined; fall back to the constant so callers never read off undefined.
    return _defaultChromeFaviconMeta || FALLBACK_CHROME_FAVICON_META;
    }

    // First try to fetch from cache
    let originalUrl = tab.url;
    if (gsUtils.isSuspendedTab(tab)) {
      originalUrl = gsUtils.getOriginalUrl(tab.url);
    }
    let faviconMeta = await getCachedFaviconMetaData(originalUrl);
    if (faviconMeta) {
      // gsUtils.log(
      //   tab.id,
      //   'Found favicon cache hit for url: ' + originalUrl,
      //   faviconMeta
      // );
      return faviconMeta;
    }

    // Else try to build from chrome's favicon cache
    faviconMeta = await buildFaviconMetaFromChromeFaviconCache(originalUrl);
    if (faviconMeta) {
      gsUtils.log(
        tab.id,
        'Saving faviconMeta from favicon service into cache',
        faviconMeta
      );
      // Save to tgs favicon cache
      await saveFaviconMetaDataToCache(originalUrl, faviconMeta);
      return faviconMeta;
    }

    // Else try to build from tab.favIconUrl
    gsUtils.log(
      tab.id,
      'No entry in chrome favicon cache for url: ' + originalUrl
    );
    if (
      tab.favIconUrl &&
      tab.favIconUrl !== chrome.runtime.getURL('img/ic_suspendy_16x16.png')
    ) {
      faviconMeta = await buildFaviconMetaFromTabFavIconUrl(tab.favIconUrl);
      if (faviconMeta) {
        gsUtils.log(
          tab.id,
          'Built faviconMeta from tab.favIconUrl',
          faviconMeta
        );
        return faviconMeta;
      }
    }

    // Else try to fetch from google
    // if (fallbackToGoogle) {
    //   const rootUrl = encodeURIComponent(gsUtils.getRootUrl(originalUrl));
    //   const tabFavIconUrl = GOOGLE_S2_URL + rootUrl;
    //   //TODO: Handle reject case below
    //   faviconMeta = await buildFaviconMetaData(tabFavIconUrl, 5000);
    //   faviconMetaValid = await isFaviconMetaValid(faviconMeta);
    //   if (faviconMetaValid) {
    //     gsUtils.log(
    //       tab.id,
    //       'Built faviconMeta from google.com/s2 service',
    //       faviconMeta
    //     );
    //     return faviconMeta;
    //   }
    // }

    // Else return the default chrome favicon
    gsUtils.log(tab.id, 'Failed to build faviconMeta. Using default icon');
    // why: page contexts never run initAsPromised, so _defaultChromeFaviconMeta can
    // be undefined; fall back to the constant so callers never read off undefined.
    return _defaultChromeFaviconMeta || FALLBACK_CHROME_FAVICON_META;
  }

  async function buildFaviconMetaFromChromeFaviconCache(url) {
    const chromeFavIconUrl = generateChromeFavIconUrlFromUrl(url);
    gsUtils.log(
      'gsFavicon',
      `Building faviconMeta from url: ${chromeFavIconUrl}`
    );
    try {
      const faviconMeta = await buildFaviconMetaData(chromeFavIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning('gsUtils', e);
    }
    return null;
  }

  async function buildFaviconMetaFromTabFavIconUrl(favIconUrl) {
    try {
      const faviconMeta = await buildFaviconMetaData(favIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning('gsUtils', e);
    }
    return null;
  }

  async function getCachedFaviconMetaData(url) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    let faviconMetaData = await gsIndexedDb.fetchFaviconMeta(fullUrl);
    if (!faviconMetaData) {
      const rootUrl = gsUtils.getRootUrl(url, false, false);
      faviconMetaData = await gsIndexedDb.fetchFaviconMeta(rootUrl);
    }
    return faviconMetaData || null;
  }

  async function saveFaviconMetaDataToCache(url, faviconMeta) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    const rootUrl = gsUtils.getRootUrl(url, false, false);
    gsUtils.log(
      'gsFavicon',
      'Saving favicon cache entry for: ' + fullUrl,
      faviconMeta
    );
    await gsIndexedDb.addFaviconMeta(fullUrl, Object.assign({}, faviconMeta));
    await gsIndexedDb.addFaviconMeta(rootUrl, Object.assign({}, faviconMeta));
  }

  // dont use this function as it causes rate limit issues
  // eslint-disable-next-line no-unused-vars
  // function fetchFallbackFaviconDataUrl(url) {
  //   return new Promise(resolve => {
  //     let imageLoaded = false;
  //
  //     const rootUrl = gsUtils.encodeString(gsUtils.getRootUrl(url));
  //     const requestUrl = GOOGLE_S2_URL + rootUrl;
  //
  //     const xmlHTTP = new XMLHttpRequest();
  //     xmlHTTP.open('GET', requestUrl, true);
  //
  //     xmlHTTP.responseType = 'arraybuffer';
  //     xmlHTTP.onload = function(e) {
  //       imageLoaded = true;
  //       const arr = new Uint8Array(xmlHTTP.response);
  //       const raw = String.fromCharCode.apply(null, arr);
  //       const b64 = btoa(raw);
  //       const dataUrl = 'data:image/png;base64,' + b64;
  //       resolve(dataUrl);
  //     };
  //     xmlHTTP.send();
  //     setTimeout(() => {
  //       if (!imageLoaded) {
  //         gsUtils.log('gsFavicon', 'Failed to load image from: ' + url);
  //         resolve(null);
  //       }
  //     }, 3000);
  //   });
  // }

  async function isFaviconMetaValid(faviconMeta) {
    if (
      !faviconMeta ||
      faviconMeta.normalisedDataUrl === 'data:,' ||
      faviconMeta.transparentDataUrl === 'data:,'
    ) {
      return false;
    }
    const normalisedFingerprint = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    const transparentFingerprint = await createImageFingerprint(
      faviconMeta.transparentDataUrl
    );

    for (let id of Object.keys(_defaultFaviconFingerprintById)) {
      const defaultFaviconFingerprint = _defaultFaviconFingerprintById[id];
      if (
        normalisedFingerprint === defaultFaviconFingerprint ||
        transparentFingerprint === defaultFaviconFingerprint
      ) {
        gsUtils.log(
          'gsFavicon',
          'FaviconMeta not valid as it matches fingerprint of default favicon: ' +
            id,
          faviconMeta
        );
        return false;
      }
    }
    return true;
  }

  // Turns the img into a 16x16 black and white dataUrl
  async function createImageFingerprint(dataUrl) {
    const img = await loadImageBitmap(dataUrl);
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext('2d');
    const threshold = 80;

    context.drawImage(img, 0, 0, 16, 16);

    const imageData = context.getImageData(0, 0, 16, 16);
    for (var i = 0; i < imageData.data.length; i += 4) {
      var luma = Math.floor(
        imageData.data[i] * 0.3 +
          imageData.data[i + 1] * 0.59 +
          imageData.data[i + 2] * 0.11
      );
      imageData.data[i] = imageData.data[i + 1] = imageData.data[i + 2] =
        luma > threshold ? 255 : 0;
      imageData.data[i + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
    return await canvasToDataUrl(canvas);
  }

  async function buildFaviconMetaData(url) {
    // loadImageBitmap's 5s abort replaces the old manual image-load timeout.
    const img = await loadImageBitmap(url);

    const canvas = new OffscreenCanvas(img.width, img.height);
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    const origDataArray = imageData.data;
    const normalisedDataArray = new Uint8ClampedArray(origDataArray);
    const transparentDataArray = new Uint8ClampedArray(origDataArray);

    let r, g, b, a;
    let fuzzy = 0.1;
    let light = 0;
    let dark = 0;
    let maxAlpha = 0;
    let maxRgb = 0;

    for (let x = 0; x < origDataArray.length; x += 4) {
      r = origDataArray[x];
      g = origDataArray[x + 1];
      b = origDataArray[x + 2];
      a = origDataArray[x + 3];

      let localMaxRgb = Math.max(Math.max(r, g), b);
      if (localMaxRgb < 128 || a < 128) dark++;
      else light++;
      maxAlpha = Math.max(a, maxAlpha);
      maxRgb = Math.max(localMaxRgb, maxRgb);
    }

    //saftey check to make sure image is not completely transparent
    if (maxAlpha === 0) {
      throw new Error(
        'Aborting favicon generation as image is completely transparent. url: ' +
          url
      );
    }

    const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
    const isDark = darkLightDiff + fuzzy < 0;
    const normaliserMultiple = 1 / (maxAlpha / 255);

    for (let x = 0; x < origDataArray.length; x += 4) {
      a = origDataArray[x + 3];
      normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
    }
    for (let x = 0; x < normalisedDataArray.length; x += 4) {
      a = normalisedDataArray[x + 3];
      transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
    }

    imageData.data.set(normalisedDataArray);
    context.putImageData(imageData, 0, 0);
    const normalisedDataUrl = await canvasToDataUrl(canvas);

    imageData.data.set(transparentDataArray);
    context.putImageData(imageData, 0, 0);
    const transparentDataUrl = await canvasToDataUrl(canvas);

    return {
      favIconUrl: url,
      isDark,
      normalisedDataUrl,
      transparentDataUrl,
    };
  }

  return {
    initAsPromised,
    getFaviconMetaData,
    generateChromeFavIconUrlFromUrl,
    buildFaviconMetaFromChromeFaviconCache,
    saveFaviconMetaDataToCache,
  };
})();
