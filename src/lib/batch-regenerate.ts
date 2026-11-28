import type { Brief } from './brief';
import { domainFor } from './cache';
import { diffAgainstSavedBrief } from './diff';
import type { HiringSignals } from './hiring';
import { companyQueryFor } from './news';
import { regenerateAllSections } from './regenerate';
import type { SavedBrief } from './saved';
import type { Settings } from './settings';
import type { BatchRegenResponse, Detection, NewsItem, PageSignals } from './types';

/**
 * Background orchestration for REGENERATE_ALL_SECTIONS
 * (inc-039) — the batch sibling of runSectionRegeneration
 * (inc-032), mirroring its message flow exactly. It lives in
 * its own module because inc-039 scopes library changes to
 * regenerate.ts out; the composition is identical in shape.
 */

/** The REGENERATE_ALL_SECTIONS message payload (types.ts CollectRequest). */
export interface BatchRegenRequest {
  brief: Brief;
  signals: PageSignals;
  detections: Detection[];
  news: NewsItem[];
  hiring: HiringSignals | null;
}

/** What runBatchRegeneration needs from the background worker. */
export interface BatchRegenDeps {
  getSettings: () => Promise<Settings>;
  regenerateAll: typeof regenerateAllSections;
  listSaved: () => Promise<SavedBrief[]>;
  /**
   * Persist a freshly generated brief exactly as GENERATE_BRIEF
   * does (cache + saved history + account upsert, best-effort
   * inside). Called ONLY on success, after the diff is captured.
   */
  persist: (entry: {
    domain: string;
    company: string;
    url: string;
    brief: Brief;
    signals: PageSignals;
    detections: Detection[];
    news: NewsItem[];
    hiring: HiringSignals | null;
  }) => Promise<void>;
}

/**
 * On success: the batch brief is persisted through the same
 * flow as GENERATE_BRIEF / REGENERATE_SECTION, the diff is
 * captured BEFORE persistence replaces the saved entry, and
 * the response carries the per-section stopReasons. On
 * failure: the response carries the library's section-named
 * error ("Batch regeneration failed at section '<key>': …")
 * and NOTHING is persisted — all-or-nothing end to end.
 */
export async function runBatchRegeneration(
  msg: BatchRegenRequest,
  deps: BatchRegenDeps,
): Promise<BatchRegenResponse> {
  try {
    const { apiKey, model, sellerProfile } = await deps.getSettings();
    const { brief, stopReasons } = await deps.regenerateAll(
      apiKey,
      model,
      msg.brief,
      msg.signals,
      msg.detections,
      msg.news,
      sellerProfile,
      msg.hiring,
    );
    const domain = domainFor(msg.signals.dom.url);
    const changes = await diffAgainstSavedBrief(domain, brief, deps.listSaved).catch(() => null);
    const company = companyQueryFor(msg.signals.dom.url, msg.signals.dom.title, msg.signals.dom.ogTags);
    await deps.persist({
      domain,
      company,
      url: msg.signals.dom.url,
      brief,
      signals: msg.signals,
      detections: msg.detections,
      news: msg.news,
      hiring: msg.hiring,
    });
    return { ok: true, brief, changes, stopReasons };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
