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
export interface CollectRequest {
  type: 'COLLECT_SIGNALS';
  tabId: number;
}

/** A detected technology with confidence and evidence. */
export interface Detection {
  name: string;
  category: string;
  confidence: 'low' | 'medium' | 'high';
  /** Human-readable evidence, e.g. 'script src matches /cdn.shopify.com/'. */
  evidence: string[];
}

/** A news headline about the company. */
export interface NewsItem {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
}

/** Response carrying signals, detections, news, or an error. */
export type CollectResponse =
  | { ok: true; signals: PageSignals; detections: Detection[]; news: NewsItem[] }
  | { ok: false; error: string };
