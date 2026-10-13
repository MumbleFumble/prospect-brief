import { defineBackground } from 'wxt/utils/define-background';
import { collectDomSignals, collectMainWorldSignals } from '../lib/collectors';
import { detectTech } from '../detection/engine';
import { GoogleNewsRssProvider, companyQueryFor } from '../lib/news';
import { generateBrief } from '../lib/brief';
import { getSettings } from '../lib/settings';
import { domainFor, getCachedBrief, setCachedBrief, clearCachedBrief } from '../lib/cache';
import type {
  BriefResponse,
  CollectRequest,
  CollectResponse,
  NewsItem,
  PageSignals,
} from '../lib/types';

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
  const url = tab.url ?? tab.pendingUrl ?? '';
  if (!url || RESTRICTED_RE.test(url)) {
    return {
      ok: false,
      error: `Cannot collect signals from this page (saw URL: "${url || '(empty)'}"). Try a regular website like stripe.com.`,
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

    // Include a cached brief if we have a fresh one for this domain.
    const domain = domainFor(signals.dom.url);
    const cached = await getCachedBrief(domain).catch(() => null);

    return {
      ok: true,
      signals,
      detections,
      news,
      ...(cached ? { cachedBrief: cached.brief, cachedAt: cached.cachedAt } : {}),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default defineBackground(() => {
  startHeaderCapture();

  // Open the side panel on toolbar click. Using onClicked (instead of
  // openPanelOnActionClick) so the click grants the activeTab permission,
  // which chrome.scripting.executeScript needs for host access.
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) await chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.runtime.onMessage.addListener((msg: CollectRequest, _sender, sendResponse) => {
    if (msg.type === 'COLLECT_SIGNALS') {
      collectSignals(msg.tabId).then(sendResponse);
      return true;
    }
    if (msg.type === 'GENERATE_BRIEF') {
      (async (): Promise<BriefResponse> => {
        try {
          const { apiKey, model } = await getSettings();
          const brief = await generateBrief(apiKey, model, msg.signals, msg.detections, msg.news);
          // Cache the completed brief per domain (best-effort).
          const domain = domainFor(msg.signals.dom.url);
          await setCachedBrief({
            domain,
            brief,
            signals: msg.signals,
            detections: msg.detections,
            news: msg.news,
          }).catch((e) => console.warn('Cache write failed:', e));
          return { ok: true, brief };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })().then(sendResponse);
      return true;
    }
    if (msg.type === 'CLEAR_CACHE') {
      clearCachedBrief(domainFor(msg.url)).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });
});
