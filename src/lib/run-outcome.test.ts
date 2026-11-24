import { describe, expect, it } from 'vitest';
import { classifyRunOutcome } from './run-outcome';
import type { Brief } from './brief';

function brief(partial: Partial<Brief>): Brief {
  return {
    schemaVersion: 1,
    overview: 'Acme sells widgets to mid-market retailers.',
    overviewRefs: [0],
    overviewStackRefs: [],
    overviewBasis: 'site',
    risks: [],
    talkingPoints: [
      { point: 'Ask about their recent expansion.', sourceRefs: [0], stackRefs: [], basis: 'news' },
    ],
    ...partial,
  };
}

describe('classifyRunOutcome', () => {
  it('classifies a clean success as ok', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({}),
      newsCount: 3,
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.reason).toBe('success');
  });

  it('classifies a schema-invalid response as failed', () => {
    const outcome = classifyRunOutcome({ schemaValid: false, brief: null });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('schema-invalid');
  });

  it('classifies empty talkingPoints as partial', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ talkingPoints: [] }),
      newsCount: 3,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('empty-talking-points');
  });

  it('classifies unresolved overviewRefs as partial and names the index', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ overviewRefs: [0, 5] }),
      newsCount: 3,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-overview-refs');
    expect(outcome.detail).toContain('5');
    expect(outcome.detail).toContain('3');
  });

  it('does not judge overviewRefs when the news count is unknown', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ overviewRefs: [7] }),
    });
    expect(outcome.status).toBe('ok');
  });

  it('classifies a max_tokens stop as partial, ahead of content checks', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'max_tokens',
      brief: brief({ talkingPoints: [] }),
      newsCount: 3,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('max-tokens');
  });

  it('classifies a thrown network error as failed with the network reason', () => {
    const outcome = classifyRunOutcome({ error: new TypeError('Failed to fetch') });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('network-error');
    expect(outcome.detail).toContain('Failed to fetch');
  });

  it('classifies a thrown non-network error as failed with the generic reason', () => {
    const outcome = classifyRunOutcome({
      error: new Error('Anthropic API error: HTTP 401'),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('error');
    expect(outcome.detail).toContain('401');
  });

  it('classifies a skipped account, with its reason when given', () => {
    const outcome = classifyRunOutcome({ skipped: true, skipReason: 'not watched' });
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('skipped');
    expect(outcome.detail).toContain('not watched');
  });

  it('takes skipped over every other signal', () => {
    const outcome = classifyRunOutcome({
      skipped: true,
      error: new Error('should not matter'),
      schemaValid: false,
    });
    expect(outcome.status).toBe('skipped');
  });

  it('classifies a run with no brief and no error as failed', () => {
    const outcome = classifyRunOutcome({ schemaValid: true, brief: null });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('error');
  });

  it('is deterministic: the same input gives the same outcome', () => {
    const input = {
      schemaValid: true,
      stopReason: 'end_turn' as const,
      brief: brief({ overviewRefs: [9] }),
      newsCount: 2,
    };
    expect(classifyRunOutcome(input)).toEqual(classifyRunOutcome(input));
  });
});
