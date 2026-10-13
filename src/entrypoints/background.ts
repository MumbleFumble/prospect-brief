import { defineBackground } from 'wxt/utils/define-background';
import { collectDomSignals, collectMainWorldSignals } from '../lib/collectors';
import { detectTech } from '../detection/engine';
import { GoogleNewsRssProvider, companyQueryFor } from '../lib/news';
import type { CollectRequest, CollectResponse, NewsItem, PageSignals } from '../lib/types';

const RESTRICTED_RE = /^(chrome|chrome-extension|edge|about|view-source):/;

/** Latest main-frame response headers per tab, captured via webRequest. */
const headersByTab = new Map<number, Record<string, string>>();

function startHeaderCapture(): void {
  const listener = (
    details: chrome.webRequest.OnHeadersReceivedDetails,
  ): chrome.webRequest.BlockingResponse | undefined => {
    const headers: Record<string, string> = {};
    for (const h of details.responseHeaders ?? []) {
      if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
    }
    headersByTab.set(details.tabId, headers);
    return undefined;
  };
  chrome.webRequest.onHeadersReceived.addListener(
    listener,
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['responseHeaders'],
  );
  // Avoid unbounded growth.
  chrome.tabs.onRemoved.addListener((tabId) => headersByTab.delete(tabId));
}

/**
 * Run both collectors in the tab, then run tech detection over the
 * signals plus any captured response headers.
 */
async function collectSignals(tabId: number): Promise<CollectResponse> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || RESTRICTED_RE.test(tab.url)) {
    return {
      ok: false,
      error:
        'Cannot collect signals from this page (browser-restricted URL). Try a regular website.',
    };
  }

  try {
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

    const headers = headersByTab.get(tabId) ?? {};
    const detections = detectTech(signals, headers);

    // News fetch is best-effort; a failure shouldn't block the brief.
    let news: NewsItem[] = [];
    try {
      const query = companyQueryFor(signals.dom.url, signals.dom.title, signals.dom.ogTags);
      news = await new GoogleNewsRssProvider().fetchNews(query, 5);
    } catch (e) {
      console.warn('News fetch failed:', e);
    }

    return { ok: true, signals, detections, news };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default defineBackground(() => {
  startHeaderCapture();

  // Open the side panel when the toolbar icon is clicked.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg: CollectRequest, _sender, sendResponse) => {
    if (msg?.type !== 'COLLECT_SIGNALS') return false;
    collectSignals(msg.tabId).then(sendResponse);
    return true; // async response
  });
});
