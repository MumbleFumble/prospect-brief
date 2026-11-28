import { describe, expect, it } from 'vitest';
import {
  batchRegenFailed,
  batchRegenSucceeded,
  initialBatchRegenState,
  initialSectionRegenState,
  sectionRegenFailed,
  sectionRegenSucceeded,
  startBatchRegen,
  startSectionRegen,
} from './section-regen-state';

describe('section regen panel state (busy isolation)', () => {
  it('starting one section marks only that section busy', () => {
    const s = startSectionRegen(initialSectionRegenState, 'risks');
    expect(s.busy).toEqual({ risks: true });
    expect(s.errors).toEqual({});
  });

  it('a failure lands in that section only and clears only its busy flag', () => {
    let s = startSectionRegen(initialSectionRegenState, 'risks');
    s = startSectionRegen(s, 'overview');
    s = sectionRegenFailed(s, 'risks', 'Invalid section response: invalid-json');
    expect(s.errors).toEqual({ risks: 'Invalid section response: invalid-json' });
    // The other section is untouched: still busy, no error.
    expect(s.busy).toEqual({ overview: true });
  });

  it('success clears only that section busy flag and leaves other errors intact', () => {
    let s = sectionRegenFailed(initialSectionRegenState, 'overview', 'prompt-over-ceiling: x');
    s = startSectionRegen(s, 'talkingPoints');
    s = sectionRegenSucceeded(s, 'talkingPoints');
    expect(s.busy).toEqual({});
    expect(s.errors).toEqual({ overview: 'prompt-over-ceiling: x' });
  });

  it('starting a section clears its own previous error, not others', () => {
    let s = sectionRegenFailed(initialSectionRegenState, 'risks', 'boom');
    s = sectionRegenFailed(s, 'overview', 'bang');
    s = startSectionRegen(s, 'risks');
    expect(s.errors).toEqual({ overview: 'bang' });
    expect(s.busy).toEqual({ risks: true });
  });

  it('transitions never mutate the input state', () => {
    const before = sectionRegenFailed(initialSectionRegenState, 'risks', 'boom');
    const snapshot = structuredClone(before);
    startSectionRegen(before, 'overview');
    sectionRegenSucceeded(before, 'risks');
    sectionRegenFailed(before, 'overview', 'x');
    expect(before).toEqual(snapshot);
  });
});

describe('batch regen panel state (inc-039)', () => {
  const ALL_END_TURN = {
    overview: 'end_turn',
    talkingPoints: 'end_turn',
    risks: 'end_turn',
    opportunities: 'end_turn',
  } as const;

  it('starting a batch sets busy and clears any previous error and truncation note', () => {
    const dirty = batchRegenFailed(initialBatchRegenState, 'boom');
    const s = startBatchRegen(dirty);
    expect(s).toEqual({ busy: true, error: null, truncatedSections: [] });
  });

  it('success records exactly the max_tokens sections, in batch order', () => {
    const s = batchRegenSucceeded(initialBatchRegenState, {
      overview: 'end_turn',
      talkingPoints: 'max_tokens',
      risks: 'max_tokens',
      opportunities: 'end_turn',
    });
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
    expect(s.truncatedSections).toEqual(['talkingPoints', 'risks']);
  });

  it('success with no max_tokens sections records no truncation note', () => {
    const s = batchRegenSucceeded(initialBatchRegenState, ALL_END_TURN);
    expect(s.truncatedSections).toEqual([]);
  });

  it('failure records the error verbatim and clears busy', () => {
    const message = "Batch regeneration failed at section 'risks': Invalid section response: invalid-json";
    const s = batchRegenFailed(startBatchRegen(initialBatchRegenState), message);
    expect(s).toEqual({ busy: false, error: message, truncatedSections: [] });
  });
});
