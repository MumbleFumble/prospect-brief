import { BATCH_SECTION_ORDER, type BriefSectionKey } from './regenerate';

/**
 * Panel state for per-section regeneration (inc-032), extracted
 * as pure transitions so the busy-isolation rules are testable
 * (the codebase has no component-test harness; this follows the
 * batch-engine / diff-capture extraction precedent).
 *
 * Isolation contract: each section has its OWN busy flag and its
 * OWN error slot. Starting, succeeding, or failing one section
 * never touches another section's state, and the displayed brief
 * is replaced by the caller only on an ok response — this state
 * carries no brief, so a failure cannot alter what's displayed.
 */
export interface SectionRegenState {
  busy: Partial<Record<BriefSectionKey, boolean>>;
  errors: Partial<Record<BriefSectionKey, string>>;
}

export const initialSectionRegenState: SectionRegenState = { busy: {}, errors: {} };

export function startSectionRegen(
  state: SectionRegenState,
  section: BriefSectionKey,
): SectionRegenState {
  const errors = { ...state.errors };
  delete errors[section];
  return { busy: { ...state.busy, [section]: true }, errors };
}

export function sectionRegenSucceeded(
  state: SectionRegenState,
  section: BriefSectionKey,
): SectionRegenState {
  const busy = { ...state.busy };
  delete busy[section];
  return { ...state, busy };
}

export function sectionRegenFailed(
  state: SectionRegenState,
  section: BriefSectionKey,
  message: string,
): SectionRegenState {
  const busy = { ...state.busy };
  delete busy[section];
  return { busy, errors: { ...state.errors, [section]: message } };
}

/* ------------------------------------------------------------------ */
/* Batch regeneration (inc-039): all four sections at once.            */
/* ------------------------------------------------------------------ */

/**
 * Panel state for a batch run. truncatedSections names the
 * sections whose stopReason came back 'max_tokens' on the last
 * successful batch (in BATCH_SECTION_ORDER), so the view can
 * surface them; it is cleared when a new batch starts.
 */
export interface BatchRegenState {
  busy: boolean;
  error: string | null;
  truncatedSections: BriefSectionKey[];
}

export const initialBatchRegenState: BatchRegenState = {
  busy: false,
  error: null,
  truncatedSections: [],
};

export function startBatchRegen(_state: BatchRegenState): BatchRegenState {
  return { busy: true, error: null, truncatedSections: [] };
}

export function batchRegenSucceeded(
  _state: BatchRegenState,
  stopReasons: Record<BriefSectionKey, string | null>,
): BatchRegenState {
  return {
    busy: false,
    error: null,
    truncatedSections: BATCH_SECTION_ORDER.filter((s) => stopReasons[s] === 'max_tokens'),
  };
}

export function batchRegenFailed(_state: BatchRegenState, message: string): BatchRegenState {
  return { busy: false, error: message, truncatedSections: [] };
}
