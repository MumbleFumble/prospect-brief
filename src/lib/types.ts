/**
 * Raw signals collected from a page. Step 2 collects these; step 3+
 * feeds them into tech detection, news, and the LLM.
 */

/** Signals visible to the isolated world (DOM). */
export interface DomSignals {
  url: string;
  title: string;
  /** <meta name="description"> content, if present. */
  metaDescription: string | null;
  /** <meta name="generator"> content, if present. */
  generator: string | null;
  /** All Open Graph / Twitter meta tags as name -> content. */
  ogTags: Record<string, string>;
  /** Visible text from hero, nav, footer — truncated to a token budget. */
  visibleText: string;
  /** Every <script src="..."> URL on the page. */
  scriptSrcs: string[];
  /** Every <link href="..."> URL on the page. */
  linkHrefs: string[];
  /** Cookie names only — never values. */
  cookieNames: string[];
}

/** Signals only visible in the page's main JS world. */
export interface MainWorldSignals {
  reactDevtoolsHook: boolean;
  nextData: boolean;
  nuxtData: boolean;
  shopify: boolean;
  dataLayer: boolean;
  googleAnalytics: boolean;
  intercom: boolean;
  stripe: boolean;
  hubspot: boolean;
  segment: boolean;
}

/** Everything the collectors return for one page load. */
export interface PageSignals {
  dom: DomSignals;
  mainWorld: MainWorldSignals | null;
  collectedAt: number;
}

/** Message from side panel to background requesting collection. */
export type CollectRequest =
  | { type: 'COLLECT_SIGNALS'; tabId: number }
  | {
      type: 'GENERATE_BRIEF';
      signals: PageSignals;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
    }
  | {
      type: 'REGENERATE_SECTION';
      brief: Brief;
      section: BriefSectionKey;
      signals: PageSignals;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
    }
  | {
      type: 'GENERATE_OUTREACH';
      company: string;
      brief: Brief;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
    }
  | { type: 'CLEAR_CACHE'; url: string }
  | {
      type: 'GENERATE_SEQUENCE';
      company: string;
      persona: string;
      brief: Brief;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
    }
  | { type: 'START_BATCH'; domains: string[] }
  | { type: 'GET_BATCH_STATE' }
  | { type: 'GET_RUN_SUMMARY' }
  | { type: 'RETRY_BATCH' }
  | { type: 'REFRESH_WATCH_BADGE' }
  | { type: 'CANCEL_BATCH' };

/** A detected technology with confidence and evidence. */
export interface Detection {
  name: string;
  category: string;
  confidence: 'low' | 'medium' | 'high';
  /** Human-readable evidence, e.g. 'script src matches /cdn.shopify.com/'. */
  evidence: string[];
}

import type { Brief } from './brief';
import type { BriefChange } from './diff';
import type { BriefSectionKey } from './regenerate';
import type { HiringSignals } from './hiring';
import type { OutreachDraft } from './outreach';
import type { Sequence } from './sequences';

/** A news headline about the company. */
export interface NewsItem {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
}

/** Response carrying signals, detections, news, and possibly a cached brief. */
export type CollectResponse =
  | {
      ok: true;
      signals: PageSignals;
      detections: Detection[];
      news: NewsItem[];
      hiring: HiringSignals | null;
      cachedBrief?: Brief;
      cachedAt?: number;
    }
  | { ok: false; error: string };

/**
 * Response carrying the generated brief, or an error. `changes`
 * (v0.6 step 2) is the diff against the previously saved brief
 * for the domain, captured before the save replaced it: null
 * when there was no previous saved brief, [] when the fresh
 * brief is identical to it.
 */
export type BriefResponse =
  | { ok: true; brief: Brief; changes?: BriefChange[] | null }
  | { ok: false; error: string };

/** Response carrying a generated outreach draft, or an error. */
export type OutreachResponse = { ok: true; draft: OutreachDraft } | { ok: false; error: string };

export type SequenceResponse =
  | { ok: true; sequence: Sequence }
  | { ok: false; error: string };
