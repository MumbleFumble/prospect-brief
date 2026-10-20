import type { Brief } from './brief';
import type { Detection, NewsItem, PageSignals } from './types';
import type { HiringSignals } from './hiring';

/**
 * Per-domain brief cache (step 6). Completed briefs are stored in
 * chrome.storage.local with a timestamp; entries older than the TTL
 * are treated as stale.
 */

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedBrief {
  domain: string;
  brief: Brief;
  signals: PageSignals;
  detections: Detection[];
  news: NewsItem[];
  hiring?: HiringSignals | null;
  cachedAt: number;
}

function keyFor(domain: string): string {
  return `brief:${domain}`;
}

export function domainFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function getCachedBrief(domain: string): Promise<CachedBrief | null> {
  const stored = await chrome.storage.local.get(keyFor(domain));
  const entry = stored[keyFor(domain)] as CachedBrief | undefined;
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    await chrome.storage.local.remove(keyFor(domain));
    return null;
  }
  return entry;
}

export async function setCachedBrief(entry: Omit<CachedBrief, 'cachedAt'>): Promise<void> {
  const full: CachedBrief = { ...entry, cachedAt: Date.now() };
  await chrome.storage.local.set({ [keyFor(entry.domain)]: full });
}

export async function clearCachedBrief(domain: string): Promise<void> {
  await chrome.storage.local.remove(keyFor(domain));
}
