import type { Brief } from './brief';
import type { Detection, NewsItem } from './types';
import type { HiringSignals } from './hiring';

/**
 * Saved briefs: persistent history in chrome.storage.local.
 *
 * Unlike the 24h per-domain cache, saved briefs never expire. Every
 * generated brief is saved automatically (most recent first, capped).
 */

export interface SavedBrief {
  /** Stable id: domain + timestamp. */
  id: string;
  company: string;
  domain: string;
  url: string;
  brief: Brief;
  detections: Detection[];
  news: NewsItem[];
  hiring: HiringSignals | null;
  savedAt: number;
}

const STORAGE_KEY = 'saved:briefs';
export const MAX_SAVED = 100;

export async function listSavedBriefs(): Promise<SavedBrief[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = stored[STORAGE_KEY];
  return Array.isArray(list) ? (list as SavedBrief[]) : [];
}

/** Save a brief; replaces any existing entry for the same domain. */
export async function saveBrief(entry: Omit<SavedBrief, 'id' | 'savedAt'>): Promise<void> {
  const existing = await listSavedBriefs();
  const now = Date.now();
  const saved: SavedBrief = {
    ...entry,
    id: `${entry.domain}:${now}`,
    savedAt: now,
  };
  const deduped = existing.filter((e) => e.domain !== entry.domain);
  await chrome.storage.local.set({
    [STORAGE_KEY]: [saved, ...deduped].slice(0, MAX_SAVED),
  });
}

export async function deleteSavedBrief(id: string): Promise<void> {
  const existing = await listSavedBriefs();
  await chrome.storage.local.set({
    [STORAGE_KEY]: existing.filter((e) => e.id !== id),
  });
}

export async function clearSavedBriefs(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
