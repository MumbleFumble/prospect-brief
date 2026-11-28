import type { Brief } from './brief';

/**
 * Run outcomes (v0.4 "trustworthy runs", step 1).
 *
 * Every watch/batch account run ends in exactly one checkable outcome,
 * so a degraded run can never masquerade as a clean one. This module is
 * the foundation only: it defines the outcome type and a pure
 * classifier from a run's result data. It does no I/O, persists
 * nothing, and changes no validation behaviour — callers (a later
 * increment) decide what to record and what to show.
 */

export type RunOutcomeStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export type RunReasonCode =
  /** Brief produced, complete, and fully grounded. */
  | 'success'
  /** A model response was received but failed schema validation. */
  | 'schema-invalid'
  /** Brief produced but its talkingPoints list is empty. */
  | 'empty-talking-points'
  /** Brief produced but an overviewRef does not index a real headline. */
  | 'unresolved-overview-refs'
  /**
   * Brief produced but a section ref (sourceRefs/stackRefs on
   * talkingPoints, risks or opportunities, or overviewStackRefs)
   * does not index a real headline/detection (inc-036).
   */
  | 'unresolved-refs'
  /** The model stopped on max_tokens, so the response may be cut off. */
  | 'max-tokens'
  /** The run threw a network-level error (fetch failure, DNS, abort…). */
  | 'network-error'
  /** The run threw, or produced no brief, for any other reason. */
  | 'error'
  /** The account was not run at all. */
  | 'skipped';

export interface RunOutcome {
  status: RunOutcomeStatus;
  reason: RunReasonCode;
  /** Human-readable, names the evidence behind the classification. */
  detail: string;
}

/**
 * The plain result data of one account run, as a caller would hand it
 * to the classifier. Every field is optional so partial information
 * still classifies; the classifier checks them in precedence order
 * (skipped, thrown error, schema, truncation, content, grounding).
 */
export interface RunResult {
  /** The account was not run at all (not watched, cancelled, no prior snapshot…). */
  skipped?: boolean;
  /** Why it was skipped, when the caller knows. */
  skipReason?: string;
  /** Thrown error (network failure, API error, …), if the run threw. */
  error?: unknown;
  /** False when a model response was received but failed schema validation. */
  schemaValid?: boolean;
  /** Anthropic stop_reason for the response, e.g. 'end_turn' or 'max_tokens'. */
  stopReason?: string | null;
  /** The parsed brief, when one was produced. */
  brief?: Brief | null;
  /** Number of news items the brief's overviewRefs index into. */
  newsCount?: number;
  /** Number of detections the brief's stack refs index into (inc-036). */
  detectionsCount?: number;
}

const NETWORK_ERROR_RE = /fetch|network|econn|enotfound|eai_again|timed?\s?out|aborted/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isNetworkError(error: unknown): boolean {
  // Fetch failures surface as TypeError in browsers; API/HTTP failures
  // are raised as Error with the status in the message (brief.ts), so
  // only the message pattern and the TypeError name count as network.
  if (error instanceof Error && error.name === 'TypeError') return true;
  return NETWORK_ERROR_RE.test(errorMessage(error));
}

function unresolvedOverviewRefs(brief: Brief, newsCount: number): number[] {
  return brief.overviewRefs.filter(
    (ref) => !Number.isInteger(ref) || ref < 0 || ref >= newsCount,
  );
}

/**
 * Out-of-range refs in one ref array against its count, in
 * array order, duplicates preserved — the same filter behaviour
 * as unresolvedOverviewRefs (inc-036).
 */
function unresolvedRefs(refs: number[], count: number): number[] {
  return refs.filter((ref) => !Number.isInteger(ref) || ref < 0 || ref >= count);
}

/** Out-of-range refs across a section's items, in item order. */
function unresolvedItemRefs(
  items: ReadonlyArray<{ sourceRefs: number[]; stackRefs: number[] }>,
  field: 'sourceRefs' | 'stackRefs',
  count: number,
): number[] {
  return items.flatMap((item) => unresolvedRefs(item[field], count));
}

const SECTION_LABEL = {
  talkingPoints: 'Talking points',
  risks: 'Risks',
  opportunities: 'Opportunities',
} as const;

/**
 * Classify one account run's result into a RunOutcome. Pure: no I/O,
 * no clock, no randomness — the same input always gives the same
 * outcome.
 */
export function classifyRunOutcome(result: RunResult): RunOutcome {
  if (result.skipped) {
    return {
      status: 'skipped',
      reason: 'skipped',
      detail: result.skipReason
        ? `Account was not run: ${result.skipReason}`
        : 'Account was not run.',
    };
  }

  if (result.error != null) {
    const message = errorMessage(result.error);
    return isNetworkError(result.error)
      ? {
          status: 'failed',
          reason: 'network-error',
          detail: `Run failed with a network error: ${message}`,
        }
      : {
          status: 'failed',
          reason: 'error',
          detail: `Run failed: ${message}`,
        };
  }

  if (result.schemaValid === false) {
    return {
      status: 'failed',
      reason: 'schema-invalid',
      detail: 'Model response did not match the brief schema.',
    };
  }

  if (!result.brief) {
    return {
      status: 'failed',
      reason: 'error',
      detail: 'Run produced no brief.',
    };
  }

  if (result.stopReason === 'max_tokens') {
    return {
      status: 'partial',
      reason: 'max-tokens',
      detail:
        'Model stopped on max_tokens; the brief may be truncated and cannot be trusted as complete.',
    };
  }

  if (result.brief.talkingPoints.length === 0) {
    return {
      status: 'partial',
      reason: 'empty-talking-points',
      detail: 'Brief has an overview but no talking points.',
    };
  }

  if (typeof result.newsCount === 'number') {
    const unresolved = unresolvedOverviewRefs(result.brief, result.newsCount);
    if (unresolved.length > 0) {
      return {
        status: 'partial',
        reason: 'unresolved-overview-refs',
        detail: `Overview cites headline index(es) ${unresolved.join(', ')} but only ${result.newsCount} headline(s) were provided.`,
      };
    }
  }

  // Ref resolution beyond the overview (inc-036): every
  // sourceRefs array resolves against the news count, every
  // stackRefs array plus overviewStackRefs against the
  // detections count. Same discipline as the overview check —
  // partial outcome, the offending indexes and the count named,
  // and a check is SKIPPED when its count was not supplied
  // (skip-when-unknown). Check order: section sourceRefs
  // (talkingPoints, risks, opportunities), then overview stack
  // refs, then section stackRefs; the first failure wins, as
  // with every check above.
  const brief = result.brief;
  if (typeof result.newsCount === 'number') {
    for (const key of ['talkingPoints', 'risks', 'opportunities'] as const) {
      const unresolved = unresolvedItemRefs(brief[key] ?? [], 'sourceRefs', result.newsCount);
      if (unresolved.length > 0) {
        return {
          status: 'partial',
          reason: 'unresolved-refs',
          detail: `${SECTION_LABEL[key]} cite headline index(es) ${unresolved.join(', ')} but only ${result.newsCount} headline(s) were provided.`,
        };
      }
    }
  }
  if (typeof result.detectionsCount === 'number') {
    const unresolvedOverviewStack = unresolvedRefs(
      brief.overviewStackRefs ?? [],
      result.detectionsCount,
    );
    if (unresolvedOverviewStack.length > 0) {
      return {
        status: 'partial',
        reason: 'unresolved-refs',
        detail: `Overview cites tech index(es) ${unresolvedOverviewStack.join(', ')} but only ${result.detectionsCount} detection(s) were provided.`,
      };
    }
    for (const key of ['talkingPoints', 'risks', 'opportunities'] as const) {
      const unresolved = unresolvedItemRefs(brief[key] ?? [], 'stackRefs', result.detectionsCount);
      if (unresolved.length > 0) {
        return {
          status: 'partial',
          reason: 'unresolved-refs',
          detail: `${SECTION_LABEL[key]} cite tech index(es) ${unresolved.join(', ')} but only ${result.detectionsCount} detection(s) were provided.`,
        };
      }
    }
  }

  return {
    status: 'ok',
    reason: 'success',
    detail: 'Brief produced, complete, and fully grounded.',
  };
}
