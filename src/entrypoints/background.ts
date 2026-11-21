import { defineBackground } from 'wxt/utils/define-background';
import { collectDomSignals, collectMainWorldSignals } from '../lib/collectors';
import { detectTech } from '../detection/engine';
import { GoogleNewsRssProvider, companyQueryFor } from '../lib/news';
import { fetchHiringSignals } from '../lib/hiring';
import { listSavedBriefs, saveBrief } from '../lib/saved';
import {
  applySnapshot,
  latestSnapshot,
  listAccounts,
  migrateSavedBriefsIfNeeded,
  putAccount,
  upsertAccount,
  type SignalSnapshot,
} from '../lib/accounts';
import { diffSnapshots, pendingWatchEvents } from '../lib/watch';
import {
  MAX_BATCH,
  batchProgress,
  getBatchState,
  setBatchState,
  signalsFromHtml,
  type BatchState,
} from '../lib/batch';
import { generateBrief } from '../lib/brief';
import { generateOutreach } from '../lib/outreach';
import { generateSequence } from '../lib/sequences';
import { getSettings } from '../lib/settings';
import { domainFor, getCachedBrief, setCachedBrief, clearCachedBrief } from '../lib/cache';
import type {
  BriefResponse,
  OutreachResponse,
  SequenceResponse,
  CollectRequest,
  CollectResponse,
  NewsItem,
  PageSignals,
} from '../lib/types';

import { RESTRICTED_RE, BLOCKED_HOSTS_RE, friendlyCollectError } from '../lib/errors';

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
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  if (!url || RESTRICTED_RE.test(url) || BLOCKED_HOSTS_RE.test(hostname)) {
    return {
      ok: false,
      error: friendlyCollectError('blocked', url),
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

    // News and hiring fetches are best-effort and run in parallel;
    // a failure in either shouldn't block the brief.
    const query = companyQueryFor(signals.dom.url, signals.dom.title, signals.dom.ogTags);
    const [newsResult, hiring] = await Promise.all([
      new GoogleNewsRssProvider().fetchNews(query, 5).catch((e) => {
        console.warn('News fetch failed:', e);
        return [] as NewsItem[];
      }),
      fetchHiringSignals(signals).catch((e) => {
        console.warn('Hiring fetch failed:', e);
        return null;
      }),
    ]);
    const news: NewsItem[] = newsResult;

    // Include a cached brief if we have a fresh one for this domain.
    const domain = domainFor(signals.dom.url);
    const cached = await getCachedBrief(domain).catch(() => null);

    return {
      ok: true,
      signals,
      detections,
      news,
      hiring,
      ...(cached ? { cachedBrief: cached.brief, cachedAt: cached.cachedAt } : {}),
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, error: friendlyCollectError(raw, url) };
  }
}

/** Latest collection result per tab, populated during onClicked (activeTab valid). */
const pendingByTab = new Map<number, Promise<CollectResponse>>();

/* ------------------------------------------------------------------ */
/* Batch research (v0.3 element 2)                                     */
/*                                                                     */
/* The queue lives in chrome.storage.local so it survives the MV3      */
/* service worker being killed; a 1-minute alarm resumes processing   */
/* when the heartbeat goes stale.                                      */
/* ------------------------------------------------------------------ */

let batchRunning = false;
const BATCH_ALARM = 'batch-resume';

/** Fetch a domain's HTML and build partial signals + detections + news + hiring. */
async function collectFromHtml(domain: string) {
  const res = await fetch(`https://${domain}/`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const html = await res.text();

  const signals = signalsFromHtml(domain, html);
  const detections = detectTech(signals, headers);
  const company = companyQueryFor(signals.dom.url, signals.dom.title, signals.dom.ogTags);

  const provider = new GoogleNewsRssProvider();
  const news = await provider.fetchNews(company).catch(() => [] as NewsItem[]);
  const hiring = await fetchHiringSignals(signals).catch(() => null);
  return { signals, detections, company, news, hiring };
}

/** Research one domain from fetched HTML and store the account + brief. */
async function researchDomain(domain: string): Promise<void> {
  const { apiKey, model, sellerProfile } = await getSettings();
  if (!apiKey) throw new Error('No Anthropic API key set. Open the extension options to add one.');

  const { signals, detections, company, news, hiring } = await collectFromHtml(domain);

  const brief = await generateBrief(apiKey, model, signals, detections, news, sellerProfile, hiring);

  await setCachedBrief({ domain, brief, signals, detections, news, hiring }).catch(() => {});
  await saveBrief({
    company,
    domain,
    url: signals.dom.url,
    brief,
    detections,
    news,
    hiring,
  }).catch(() => {});
  await upsertAccount(
    domain,
    company,
    signals.dom.url,
    (account) =>
      applySnapshot(
        account,
        {
          takenAt: Date.now(),
          detections,
          news,
          hiring,
          detectionQuality: 'partial',
        },
        brief,
      ),
    Date.now(),
  );
}

async function processBatch(): Promise<void> {
  if (batchRunning) return;
  batchRunning = true;
  try {
    for (;;) {
      const state = await getBatchState();
      if (!state) return;
      // An item stuck in 'running' means a previous worker died mid-item.
      const stuck = state.items.find((i) => i.status === 'running');
      if (stuck) stuck.status = 'queued';
      const next = state.items.find((i) => i.status === 'queued');
      if (!next) {
        state.heartbeat = Date.now();
        await setBatchState(state);
        await chrome.alarms.clear(BATCH_ALARM).catch(() => false);
        return;
      }
      next.status = 'running';
      state.heartbeat = Date.now();
      await setBatchState(state);
      try {
        await researchDomain(next.domain);
        next.status = 'done';
      } catch (e) {
        next.status = 'error';
        next.error = e instanceof Error ? e.message : String(e);
      }
      next.finishedAt = Date.now();
      state.heartbeat = Date.now();
      await setBatchState(state);
    }
  } finally {
    batchRunning = false;
  }
}

async function startBatch(domains: string[]): Promise<BatchState> {
  const existing = await getBatchState();
  if (existing && batchProgress(existing).active) {
    throw new Error('A batch is already running. Cancel it before starting another.');
  }
  const state: BatchState = {
    items: domains.slice(0, MAX_BATCH).map((domain) => ({ domain, status: 'queued' as const })),
    createdAt: Date.now(),
    heartbeat: Date.now(),
  };
  await setBatchState(state);
  await chrome.alarms.create(BATCH_ALARM, { periodInMinutes: 1 });
  void processBatch();
  return state;
}

/* ------------------------------------------------------------------ */
/* Watch & re-engage (v0.3 element 5)                                  */
/*                                                                     */
/* Every 6 hours, watched accounts are re-fetched and diffed against   */
/* their last snapshot (deterministic — no model call). Changes are     */
/* stored as pending events and surfaced via the icon badge + Today.   */
/* Local-only: checks run only while Chrome is open.                   */
/* ------------------------------------------------------------------ */

const WATCH_ALARM = 'watch-check';
const WATCH_PERIOD_MINUTES = 360;

async function updateWatchBadge(): Promise<void> {
  const accounts = await listAccounts().catch(() => []);
  const total = accounts.reduce((sum, a) => sum + pendingWatchEvents(a).length, 0);
  await chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' }).catch(() => {});
  if (total > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#b45309' }).catch(() => {});
  }
}

async function runWatchChecks(): Promise<void> {
  const accounts = await listAccounts();
  for (const account of accounts) {
    if (!account.watched) continue;
    const prev = latestSnapshot(account);
    if (!prev) continue;
    try {
      const { detections, news, hiring } = await collectFromHtml(account.domain);
      const next: SignalSnapshot = {
        takenAt: Date.now(),
        detections,
        news,
        hiring,
        detectionQuality: 'partial',
      };
      const events = diffSnapshots(prev, next);
      if (events.length > 0) {
        const withSnapshot = applySnapshot(account, next);
        await putAccount({
          ...withSnapshot,
          watchEvents: [...pendingWatchEvents(account), ...events],
          lastWatchCheckAt: Date.now(),
        });
      } else {
        await putAccount({ ...account, lastWatchCheckAt: Date.now() });
      }
    } catch (e) {
      console.warn(`Watch check failed for ${account.domain}:`, e);
    }
  }
  await updateWatchBadge();
}

export default defineBackground(() => {
  startHeaderCapture();

  // One-time migration of v0.2 saved briefs into the account store.
  migrateSavedBriefsIfNeeded(listSavedBriefs).catch((e) =>
    console.warn('Account migration failed:', e),
  );

  // Collect signals DURING the click gesture (activeTab is granted here),
  // then open the side panel. The panel picks up the result via COLLECT_SIGNALS.
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    pendingByTab.set(tab.id, collectSignals(tab.id));
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((msg: CollectRequest, _sender, sendResponse) => {
    if (msg.type === 'COLLECT_SIGNALS') {
      const pending = pendingByTab.get(msg.tabId);
      if (pending) {
        pending.then(sendResponse);
        pendingByTab.delete(msg.tabId);
      } else {
        // Fallback: try collecting directly (may fail without activeTab).
        collectSignals(msg.tabId).then(sendResponse);
      }
      return true;
    }
    if (msg.type === 'GENERATE_BRIEF') {
      (async (): Promise<BriefResponse> => {
        try {
          const { apiKey, model, sellerProfile } = await getSettings();
          const brief = await generateBrief(
            apiKey,
            model,
            msg.signals,
            msg.detections,
            msg.news,
            sellerProfile,
            msg.hiring,
          );
          // Cache the completed brief per domain (best-effort).
          const domain = domainFor(msg.signals.dom.url);
          await setCachedBrief({
            domain,
            brief,
            signals: msg.signals,
            detections: msg.detections,
            news: msg.news,
            hiring: msg.hiring,
          }).catch((e) => console.warn('Cache write failed:', e));
          // Also persist to saved history (best-effort, never expires).
          const company = companyQueryFor(
            msg.signals.dom.url,
            msg.signals.dom.title,
            msg.signals.dom.ogTags,
          );
          await saveBrief({
            company,
            domain,
            url: msg.signals.dom.url,
            brief,
            detections: msg.detections,
            news: msg.news,
            hiring: msg.hiring,
          }).catch((e) => console.warn('Save failed:', e));
          // Upsert the account record (v0.3 store) with a fresh snapshot.
          await upsertAccount(
            domain,
            company,
            msg.signals.dom.url,
            (account) =>
              applySnapshot(
                account,
                {
                  takenAt: Date.now(),
                  detections: msg.detections,
                  news: msg.news,
                  hiring: msg.hiring,
                  detectionQuality: 'full',
                },
                brief,
              ),
            Date.now(),
          ).catch((e) => console.warn('Account upsert failed:', e));
          return { ok: true, brief };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })().then(sendResponse);
      return true;
    }
    if (msg.type === 'GENERATE_OUTREACH') {
      (async (): Promise<OutreachResponse> => {
        try {
          const { apiKey, model, sellerProfile } = await getSettings();
          const draft = await generateOutreach(
            apiKey,
            model,
            msg.company,
            msg.brief,
            msg.detections,
            msg.news,
            msg.hiring,
            sellerProfile,
          );
          return { ok: true, draft };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })().then(sendResponse);
      return true;
    }
    if (msg.type === 'GENERATE_SEQUENCE') {
      (async (): Promise<SequenceResponse> => {
        try {
          const { apiKey, model, sellerProfile } = await getSettings();
          const sequence = await generateSequence(
            apiKey,
            model,
            msg.company,
            msg.persona,
            msg.brief,
            msg.detections,
            msg.news,
            msg.hiring,
            sellerProfile,
          );
          return { ok: true, sequence };
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
    if (msg.type === 'START_BATCH') {
      startBatch(msg.domains)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((e) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }
    if (msg.type === 'GET_BATCH_STATE') {
      getBatchState().then((state) => sendResponse({ ok: true, state }));
      return true;
    }
    if (msg.type === 'REFRESH_WATCH_BADGE') {
      updateWatchBadge().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'CANCEL_BATCH') {
      (async () => {
        const state = await getBatchState();
        if (state) {
          for (const item of state.items) {
            if (item.status === 'queued') item.status = 'cancelled';
          }
          state.heartbeat = Date.now();
          await setBatchState(state);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }
    return false;
  });

  // Ensure the watch schedule exists, and show any pending badge.
  void (async () => {
    const existing = await chrome.alarms.get(WATCH_ALARM).catch(() => undefined);
    if (!existing) {
      await chrome.alarms
        .create(WATCH_ALARM, { periodInMinutes: WATCH_PERIOD_MINUTES })
        .catch(() => {});
    }
    await updateWatchBadge();
  })();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCH_ALARM) {
      void runWatchChecks();
      return;
    }
    if (alarm.name !== BATCH_ALARM) return;
    void (async () => {
      const state = await getBatchState();
      if (!state) return;
      const progress = batchProgress(state);
      if (!progress.active) {
        await chrome.alarms.clear(BATCH_ALARM).catch(() => false);
        return;
      }
      if (!batchRunning && Date.now() - state.heartbeat > 90_000) void processBatch();
    })();
  });
});
