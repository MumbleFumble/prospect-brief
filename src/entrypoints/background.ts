import { defineBackground } from 'wxt/utils/define-background';
import { collectDomSignals, collectMainWorldSignals } from '../lib/collectors';
import type { CollectRequest, CollectResponse, PageSignals } from '../lib/types';

const RESTRICTED_RE = /^(chrome|chrome-extension|edge|about|view-source):/;

/**
 * Run both collectors in the tab and return the combined signals.
 * The isolated collector attaches a message listener first; then the
 * main-world script posts its globals back.
 */
async function collectSignals(tabId: number): Promise<PageSignals> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || RESTRICTED_RE.test(tab.url)) {
    throw new Error(
      'Cannot collect signals from this page (browser-restricted URL). Try a regular website.',
    );
  }

  // Start the isolated collector; it waits up to 2s for main-world data.
  const isolated = chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: collectDomSignals,
  });

  // Give the listener a tick to attach, then run the main-world collector.
  await new Promise((r) => setTimeout(r, 50));
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: collectMainWorldSignals,
  });

  const [injection] = await isolated;
  const signals = injection.result as PageSignals | undefined;
  if (!signals) throw new Error('Signal collection returned nothing.');
  return signals;
}

export default defineBackground(() => {
  // Open the side panel when the toolbar icon is clicked.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.runtime.onMessage.addListener((msg: CollectRequest, _sender, sendResponse) => {
    if (msg?.type !== 'COLLECT_SIGNALS') return false;
    collectSignals(msg.tabId)
      .then((signals): CollectResponse => ({ ok: true, signals }))
      .then(sendResponse)
      .catch((e): void => {
        const response: CollectResponse = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
        sendResponse(response);
      });
    return true; // async response
  });
});
