import type { PageSignals } from './types';
import type { BriefGeneration } from './brief';
import { classifyRunOutcome, type RunOutcome } from './run-outcome';

/**
 * List intake & batch research (v0.3 element 2).
 *
 * Pure helpers live here (domain parsing, HTML signal extraction, cost
 * estimation); the background worker owns the queue execution. Batch
 * collection fetches raw HTML, so runtime-injected scripts and main-
 * world globals are missed — snapshots are labelled 'partial'.
 */

/* ------------------------------------------------------------------ */
/* Domain list parsing                                                 */
/* ------------------------------------------------------------------ */

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** Parse a pasted list (or CSV first column) into clean, deduped domains. */
export function parseDomainList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    let d = raw.trim().toLowerCase();
    if (!d) continue;
    d = d.replace(/^[a-z]+:\/\//, ''); // strip protocol
    d = d.split('/')[0]; // strip path
    d = d.split(':')[0]; // strip port
    d = d.replace(/^www\./, '');
    d = d.replace(/\.+$/, '');
    if (!DOMAIN_RE.test(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* HTML -> PageSignals (partial collection for batch)                  */
/* ------------------------------------------------------------------ */

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Build PageSignals from fetched raw HTML. mainWorld is null (partial). */
export function signalsFromHtml(domain: string, html: string): PageSignals {
  const url = `https://${domain}/`;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : domain;

  let metaDescription: string | null = null;
  let generator: string | null = null;
  const ogTags: Record<string, string> = {};
  for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
    const name = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (!content) continue;
    if (name === 'description') metaDescription = decodeEntities(content);
    else if (name === 'generator') generator = content;
    else if (name.startsWith('og:') || name.startsWith('twitter:')) {
      ogTags[name] = decodeEntities(content);
    }
  }

  const scriptSrcs: string[] = [];
  for (const tag of html.match(/<script[^>]+>/gi) ?? []) {
    const src = attr(tag, 'src');
    if (src) scriptSrcs.push(src.startsWith('//') ? `https:${src}` : src);
  }

  const linkHrefs: string[] = [];
  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (href) linkHrefs.push(href);
  }

  // Rough visible text: drop script/style, strip tags, collapse space.
  const visibleText = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, 4000);

  return {
    dom: {
      url,
      title,
      metaDescription,
      generator,
      ogTags,
      visibleText,
      scriptSrcs,
      linkHrefs,
      cookieNames: [],
    },
    mainWorld: null,
    collectedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Cost estimation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rough per-brief token usage, measured from typical v0.2 prompts:
 * ~3,000 input tokens (signals + detections + news + seller context)
 * and ~900 output tokens (brief JSON). Estimates carry a ±40% band.
 */
export const EST_INPUT_TOKENS = 3000;
export const EST_OUTPUT_TOKENS = 900;

const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus': { input: 15, output: 75 },
  'claude-sonnet': { input: 3, output: 15 },
  'claude-haiku': { input: 1, output: 5 },
};

export interface CostEstimate {
  domains: number;
  estUsd: number;
  lowUsd: number;
  highUsd: number;
  pricingKnown: boolean;
}

export function estimateBatchCost(count: number, model: string): CostEstimate {
  const key = Object.keys(PRICING_PER_MTOK).find((k) => model.startsWith(k));
  const price = key ? PRICING_PER_MTOK[key] : PRICING_PER_MTOK['claude-sonnet'];
  const perBrief =
    (EST_INPUT_TOKENS / 1_000_000) * price.input +
    (EST_OUTPUT_TOKENS / 1_000_000) * price.output;
  const est = perBrief * count;
  return {
    domains: count,
    estUsd: est,
    lowUsd: est * 0.6,
    highUsd: est * 1.4,
    pricingKnown: Boolean(key),
  };
}

/* ------------------------------------------------------------------ */
/* Queue state                                                         */
/* ------------------------------------------------------------------ */

export type BatchItemStatus = 'queued' | 'running' | 'done' | 'partial' | 'error' | 'cancelled';

export interface BatchItem {
  domain: string;
  status: BatchItemStatus;
  error?: string;
  /** The run outcome behind the final status (v0.4 step 3), when classified. */
  outcome?: RunOutcome;
  finishedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Run outcomes for batch generations (v0.4 step 3)                    */
/* ------------------------------------------------------------------ */

/**
 * Classify one batch generation from its REAL signals — the
 * stop_reason and schema-validation result surfaced by
 * generateBriefWithSignals (inc-008), fed straight into the inc-007
 * classifier. No defaults are substituted: a max_tokens stop comes
 * back partial/'max-tokens', a clean end_turn with a valid schema
 * comes back ok/'success'.
 */
export function classifyBatchGeneration(
  generation: BriefGeneration,
  newsCount: number,
): RunOutcome {
  return classifyRunOutcome({
    schemaValid: generation.validation.valid,
    stopReason: generation.stopReason,
    brief: generation.brief,
    newsCount,
  });
}

/** Map a run outcome onto the batch item status that reports it. */
export function batchStatusForOutcome(outcome: RunOutcome): BatchItemStatus {
  switch (outcome.status) {
    case 'ok':
      return 'done';
    case 'partial':
      return 'partial';
    case 'skipped':
      return 'cancelled';
    case 'failed':
      return 'error';
  }
}

export interface BatchState {
  items: BatchItem[];
  createdAt: number;
  /** Last processor heartbeat; a stale heartbeat means the worker died. */
  heartbeat: number;
}

const BATCH_KEY = 'batch:state';

export async function getBatchState(): Promise<BatchState | null> {
  const stored = await chrome.storage.local.get(BATCH_KEY);
  const state = stored[BATCH_KEY] as BatchState | undefined;
  return state && Array.isArray(state.items) ? state : null;
}

export async function setBatchState(state: BatchState): Promise<void> {
  await chrome.storage.local.set({ [BATCH_KEY]: state });
}

export function batchProgress(state: BatchState): {
  total: number;
  done: number;
  partial: number;
  errors: number;
  remaining: number;
  active: boolean;
} {
  const done = state.items.filter((i) => i.status === 'done').length;
  const partial = state.items.filter((i) => i.status === 'partial').length;
  const errors = state.items.filter((i) => i.status === 'error').length;
  const remaining = state.items.filter(
    (i) => i.status === 'queued' || i.status === 'running',
  ).length;
  return { total: state.items.length, done, partial, errors, remaining, active: remaining > 0 };
}

export const MAX_BATCH = 50;
