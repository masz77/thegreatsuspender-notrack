/*global chrome, gsUtils, gsChrome, GsTabQueue */
// eslint-disable-next-line no-unused-vars
var gsTabDiscardManager = (function() {
  'use strict';

  const DEFAULT_CONCURRENT_DISCARDS = 5;
  const DEFAULT_DISCARD_TIMEOUT = 5 * 1000;

  const QUEUE_ID = '_discardQueue';

  let _discardQueue;

  function initAsPromised() {
    return new Promise(resolve => {
      const queueProps = {
        concurrentExecutors: DEFAULT_CONCURRENT_DISCARDS,
        jobTimeout: DEFAULT_DISCARD_TIMEOUT,
        executorFn: performDiscard,
        exceptionFn: handleDiscardException,
      };
      _discardQueue = GsTabQueue(QUEUE_ID, queueProps);
      gsUtils.log(QUEUE_ID, 'init successful');
      resolve();
    });
  }

  function queueTabForDiscard(tab, executionProps, processingDelay) {
    queueTabForDiscardAsPromise(tab, executionProps, processingDelay).catch(
      e => {
        gsUtils.log(tab.id, QUEUE_ID, e);
      }
    );
  }

  function queueTabForDiscardAsPromise(tab, executionProps, processingDelay) {
    gsUtils.log(tab.id, QUEUE_ID, `Queueing tab for discarding.`);
    executionProps = executionProps || {};
    return _discardQueue.queueTabAsPromise(
      tab,
      executionProps,
      processingDelay
    );
  }

  function unqueueTabForDiscard(tab) {
    const removed = _discardQueue.unqueueTab(tab);
    if (removed) {
      gsUtils.log(tab.id, QUEUE_ID, 'Removed tab from discard queue');
    }
  }

  // This is called remotely by the _discardQueue
  // So we must first re-fetch the tab in case it has changed
  async function performDiscard(tab, executionProps, resolve, reject, requeue) {
    let _tab = null;
    try {
      _tab = await gsChrome.tabsGet(tab.id);
    } catch (error) {
      // assume tab has been discarded
    }
    if (!_tab) {
      gsUtils.warning(
        tab.id,
        QUEUE_ID,
        `Failed to discard tab. Tab may have already been discarded or removed.`
      );
      resolve(false);
      return;
    }
    tab = _tab;

    if (gsUtils.isSuspendedTab(tab) && tab.status === 'loading') {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is still loading');
      requeue();
      return;
    }
    // why: only a manual suspend may move focus; other paths must not discard the tab the user just picked
    if (tab.active && !executionProps.allowActive) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is active. Aborting discard.');
      resolve(false);
      return;
    }
    // why: chrome.tabs.discard rejects the active tab, so focus a neighbour first
    if (tab.active && !(await activateNeighbourTab(tab))) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab is active with no other tab. Aborting discard.');
      resolve(false);
      return;
    }
    if (gsUtils.isDiscardedTab(tab)) {
      gsUtils.log(tab.id, QUEUE_ID, 'Tab already discarded');
      resolve(false);
      return;
    }
    gsUtils.log(tab.id, QUEUE_ID, 'Forcing discarding of tab.');
    chrome.tabs.discard(tab.id, () => {
      if (chrome.runtime.lastError) {
        gsUtils.warning(tab.id, QUEUE_ID, chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }

  // Activates the tab to the right, else the left, in the same window. Resolves false if none exists.
  async function activateNeighbourTab(tab) {
    const windowTabs = await gsChrome.tabsQuery({ windowId: tab.windowId });
    const sorted = windowTabs.sort((a, b) => a.index - b.index);
    const position = sorted.findIndex(t => t.id === tab.id);
    const neighbour = sorted[position + 1] || sorted[position - 1];
    if (!neighbour) {
      return false;
    }
    const updated = await gsChrome.tabsUpdate(neighbour.id, { active: true });
    return updated !== null;
  }

  function handleDiscardException(
    tab,
    executionProps,
    exceptionType,
    resolve,
    reject,
    requeue
  ) {
    gsUtils.warning(
      tab.id,
      QUEUE_ID,
      `Failed to discard tab: ${exceptionType}`
    );
    resolve(false);
  }

  // why: discard is the only suspend mode, so a discarded tab keeps its real url and needs no placeholder
  // Kept as a no-op because background.js:689 and gsUtils.js:743 still call it.
  function handleDiscardedUnsuspendedTab() {}

  return {
    initAsPromised,
    queueTabForDiscard,
    queueTabForDiscardAsPromise,
    unqueueTabForDiscard,
    handleDiscardedUnsuspendedTab,
  };
})();
