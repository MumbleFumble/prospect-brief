import { describe, expect, it } from 'vitest';
import {
  initialSectionRegenState,
  sectionRegenFailed,
  sectionRegenSucceeded,
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
