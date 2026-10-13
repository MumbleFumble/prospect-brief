import type { Detection, MainWorldSignals, PageSignals } from '../lib/types';
import rulesData from './rules.json';

/** Rule as stored in rules.json. All patterns are regex strings. */
export interface TechRule {
  name: string;
  category: string;
  matchers: {
    scriptSrc?: string[];
    globals?: string[];
    headers?: Record<string, string>;
    meta?: Record<string, string>;
    cookies?: string[];
    html?: string[];
  };
}

export type Confidence = 'low' | 'medium' | 'high';

interface RuleSet {
  rules: TechRule[];
}

const RULES = (rulesData as RuleSet).rules;

function anyMatch(patterns: string[], values: string[]): string | null {
  for (const p of patterns) {
    const re = new RegExp(p, 'i');
    for (const v of values) {
      if (re.test(v)) return p;
    }
  }
  return null;
}

/**
 * Deterministic tech detection. Checks each rule's matchers against the
 * collected signals and response headers. Confidence is derived from the
 * number of distinct evidence items: 1 = low, 2 = medium, 3+ = high.
 */
export function detectTech(
  signals: PageSignals,
  headers: Record<string, string>,
  rules: TechRule[] = RULES,
): Detection[] {
  const { dom, mainWorld } = signals;
  const results: Detection[] = [];

  // Normalize headers to lowercase keys for case-insensitive lookup.
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;

  for (const rule of rules) {
    const evidence: string[] = [];
    const m = rule.matchers;

    if (m.scriptSrc) {
      const hit = anyMatch(m.scriptSrc, dom.scriptSrcs);
      if (hit) evidence.push(`script src matches /${hit}/`);
    }

    if (m.globals && mainWorld) {
      const mw = mainWorld as unknown as Record<string, unknown>;
      for (const g of m.globals) {
        if (mw[g]) {
          evidence.push(`window global "${g}" present`);
          break;
        }
      }
    }

    if (m.headers) {
      for (const [name, pattern] of Object.entries(m.headers)) {
        // Support wildcard-ish header names like "x-akamai-.*".
        const nameRe = new RegExp(`^${name}$`, 'i');
        for (const [hk, hv] of Object.entries(lowerHeaders)) {
          if (nameRe.test(hk) && new RegExp(pattern, 'i').test(hv)) {
            evidence.push(`header "${hk}" matches /${pattern}/`);
            break;
          }
        }
      }
    }

    if (m.meta) {
      const metaVals: Record<string, string> = {
        generator: dom.generator ?? '',
        description: dom.metaDescription ?? '',
      };
      for (const [name, pattern] of Object.entries(m.meta)) {
        const val = metaVals[name.toLowerCase()] ?? '';
        if (val && new RegExp(pattern, 'i').test(val)) {
          evidence.push(`meta "${name}" matches /${pattern}/`);
        }
      }
      // Also check ogTags for good measure.
      for (const [name, pattern] of Object.entries(m.meta)) {
        for (const [ok, ov] of Object.entries(dom.ogTags)) {
          if (ok.toLowerCase().includes(name.toLowerCase()) && new RegExp(pattern, 'i').test(ov)) {
            evidence.push(`og tag "${ok}" matches /${pattern}/`);
            break;
          }
        }
      }
    }

    if (m.cookies) {
      const hit = anyMatch(m.cookies, dom.cookieNames);
      if (hit) evidence.push(`cookie name matches /${hit}/`);
    }

    if (m.html) {
      const hit = anyMatch(m.html, [dom.visibleText, dom.title]);
      if (hit) evidence.push(`page text matches /${hit}/`);
    }

    if (evidence.length > 0) {
      const confidence: Confidence =
        evidence.length >= 3 ? 'high' : evidence.length === 2 ? 'medium' : 'low';
      results.push({ name: rule.name, category: rule.category, confidence, evidence });
    }
  }

  // Stable order: category, then name.
  results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return results;
}

/** Group detections by category for UI rendering. */
export function groupByCategory(detections: Detection[]): Map<string, Detection[]> {
  const groups = new Map<string, Detection[]>();
  for (const d of detections) {
    const list = groups.get(d.category) ?? [];
    list.push(d);
    groups.set(d.category, list);
  }
  return groups;
}
