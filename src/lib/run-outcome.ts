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

  return {
    status: 'ok',
    reason: 'success',
    detail: 'Brief produced, complete, and fully grounded.',
  };
}
