import type { AccountRecord } from './accounts';
import { latestSnapshot } from './accounts';
import type { SellerProfile } from './settings';
import { findCompetitors } from './competitors';

/**
 * Account scoring (v0.3 element 3).
 *
 * Deterministic by design: ICP fit x signal strength/recency, with a
 * visible breakdown for every point. No learned model — once reply
 * outcomes accumulate in the store, learning the weights is a later
 * step. Every component names its evidence (grounding rule).
 */

export interface ScoringWeights {
  competitorDetected: number;
  hiringActive: number;
  hiringVolume: number;
  hiringGrowth: number;
  newsFresh: number;
  newsRecent: number;
  newsStale: number;
  stackDepth: number;
  icpKeyword: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  competitorDetected: 3,
  hiringActive: 1,
  hiringVolume: 2,
  hiringGrowth: 2,
  newsFresh: 2,
  newsRecent: 1,
  newsStale: -1,
  stackDepth: 1,
  icpKeyword: 1,
};

export interface ScoreComponent {
  label: string;
  points: number;
}

export interface AccountScore {
  total: number;
  components: ScoreComponent[];
}

const WEIGHTS_KEY = 'scoringWeights';

export async function getScoringWeights(): Promise<ScoringWeights> {
  const stored = await chrome.storage.local.get(WEIGHTS_KEY);
  const w = stored[WEIGHTS_KEY] as Partial<ScoringWeights> | undefined;
  if (!w || typeof w !== 'object') return { ...DEFAULT_WEIGHTS };
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
    if (typeof w[k] === 'number' && Number.isFinite(w[k])) out[k] = w[k];
  }
  return out;
}

export async function saveScoringWeights(weights: ScoringWeights): Promise<void> {
  await chrome.storage.local.set({ [WEIGHTS_KEY]: weights });
}

/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'that', 'with', 'from', 'they', 'them', 'then', 'than', 'have', 'want',
  'companies', 'company', 'businesses', 'business', 'teams', 'team',
  'using', 'used', 'looking', 'need', 'needs', 'sell', 'sells', 'into',
]);

/** Distinctive keywords from the free-text ideal-customer description. */
export function icpKeywords(idealCustomer: string): string[] {
  const words = idealCustomer
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}

function newestNewsAgeDays(account: AccountRecord, now: number): number | null {
  const snap = latestSnapshot(account);
  if (!snap || snap.news.length === 0) return null;
  let newest: number | null = null;
  for (const item of snap.news) {
    if (!item.pubDate) continue;
    const t = Date.parse(item.pubDate);
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  if (newest === null) return null;
  return Math.max(0, Math.floor((now - newest) / 86_400_000));
}

export function scoreAccount(
  account: AccountRecord,
  profile: SellerProfile | null,
  weights: ScoringWeights,
  now: number,
): AccountScore {
  if (account.status === 'disqualified') {
    return { total: 0, components: [{ label: 'Disqualified: excluded from the work queue', points: 0 }] };
  }
  const components: ScoreComponent[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) components.push({ label, points });
  };

  const snap = latestSnapshot(account);
  if (!snap) {
    return { total: 0, components: [{ label: 'Not researched yet', points: 0 }] };
  }

  // --- Signal strength -------------------------------------------------
  if (profile && profile.competitors.length > 0) {
    const hits = findCompetitors(snap.detections, profile.competitors);
    for (const hit of hits) {
      add(`Competitor in use: ${hit.competitor}`, weights.competitorDetected);
    }
  }

  if (snap.hiring && snap.hiring.totalRoles > 0) {
    add(`Hiring: ${snap.hiring.totalRoles} open roles`, weights.hiringActive);
    if (snap.hiring.totalRoles >= 10) {
      add(`Hiring volume: ${snap.hiring.totalRoles} roles (10+)`, weights.hiringVolume);
    }
    // Growth vs the previous snapshot with hiring data.
    const prev = [...account.snapshots]
      .slice(0, -1)
      .reverse()
      .find((s) => s.hiring);
    if (prev?.hiring) {
      const delta = snap.hiring.totalRoles - prev.hiring.totalRoles;
      if (delta >= 3) add(`Hiring grew by ${delta} roles since last check`, weights.hiringGrowth);
    }
  }

  const age = newestNewsAgeDays(account, now);
  if (age !== null) {
    if (age <= 14) add(`News within ${age === 0 ? 'a day' : `${age} days`}`, weights.newsFresh);
    else if (age <= 45) add(`News ${age} days old`, weights.newsRecent);
    else if (age > 90) add(`Stale news: newest is ${age} days old`, weights.newsStale);
  }

  if (snap.detections.length >= 8) {
    add(`Deep tech stack: ${snap.detections.length} technologies`, weights.stackDepth);
  }

  // --- ICP fit ----------------------------------------------------------
  if (profile && profile.idealCustomer.trim()) {
    const haystack = [
      account.brief?.overview ?? '',
      account.company,
      ...snap.detections.map((d) => `${d.name} ${d.category}`),
    ]
      .join(' ')
      .toLowerCase();
    let matches = 0;
    for (const kw of icpKeywords(profile.idealCustomer)) {
      if (haystack.includes(kw)) matches++;
    }
    const capped = Math.min(matches, 2);
    if (capped > 0) {
      add(
        `ICP keyword match (${capped}): ${profile.idealCustomer.slice(0, 60)}`,
        capped * weights.icpKeyword,
      );
    }

  }

  const total = components.reduce((sum, c) => sum + c.points, 0);
  return { total, components };
}
