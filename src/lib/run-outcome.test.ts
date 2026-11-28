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
    opportunities: [],
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

describe('classifyRunOutcome — ref resolution beyond the overview (inc-036)', () => {
  const tp = (sourceRefs: number[], stackRefs: number[] = []) => ({
    point: 'A point.',
    sourceRefs,
    stackRefs,
    basis: 'news' as const,
  });

  it('an out-of-range sourceRef in talkingPoints classifies partial/unresolved-refs with the named detail', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ talkingPoints: [tp([0, 5])] }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-refs');
    expect(outcome.detail).toBe(
      'Talking points cite headline index(es) 5 but only 3 headline(s) were provided.',
    );
  });

  it('an out-of-range sourceRef in risks classifies the same way', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({
        risks: [{ point: 'A risk.', sourceRefs: [7], stackRefs: [], basis: 'inference' }],
      }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-refs');
    expect(outcome.detail).toBe(
      'Risks cite headline index(es) 7 but only 3 headline(s) were provided.',
    );
  });

  it('an out-of-range sourceRef in opportunities classifies the same way', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({
        opportunities: [{ point: 'An opening.', sourceRefs: [4], stackRefs: [], basis: 'news' }],
      }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-refs');
    expect(outcome.detail).toBe(
      'Opportunities cite headline index(es) 4 but only 3 headline(s) were provided.',
    );
  });

  it('an out-of-range overviewStackRef classifies partial/unresolved-refs against the detections count', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ overviewStackRefs: [9] }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-refs');
    expect(outcome.detail).toBe(
      'Overview cites tech index(es) 9 but only 2 detection(s) were provided.',
    );
  });

  it('an out-of-range stackRef in a section classifies the same way', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({
        risks: [{ point: 'A risk.', sourceRefs: [], stackRefs: [3], basis: 'inference' }],
      }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('unresolved-refs');
    expect(outcome.detail).toBe(
      'Risks cite tech index(es) 3 but only 2 detection(s) were provided.',
    );
  });

  it('in-range refs in ALL sections classify exactly as before (ok/success)', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({
        overviewRefs: [0, 2],
        overviewStackRefs: [1],
        talkingPoints: [tp([0, 2], [0, 1])],
        risks: [{ point: 'A risk.', sourceRefs: [1], stackRefs: [1], basis: 'inference' }],
        opportunities: [{ point: 'An opening.', sourceRefs: [2], stackRefs: [0], basis: 'news' }],
      }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome).toEqual({
      status: 'ok',
      reason: 'success',
      detail: 'Brief produced, complete, and fully grounded.',
    });
  });

  it('absent counts skip the new checks — no new failures are invented', () => {
    const wild = brief({
      overviewRefs: [0],
      overviewStackRefs: [99],
      talkingPoints: [tp([99], [99])],
      risks: [{ point: 'A risk.', sourceRefs: [99], stackRefs: [99], basis: 'inference' }],
    });
    // No counts at all: even the overview check skips (existing semantics).
    expect(classifyRunOutcome({ schemaValid: true, stopReason: 'end_turn', brief: wild }).status).toBe('ok');
    // newsCount only: sourceRefs resolve (and fail), stack checks skip.
    const newsOnly = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: wild,
      newsCount: 3,
    });
    expect(newsOnly.reason).toBe('unresolved-refs');
    // detectionsCount only: stack checks run, source checks skip —
    // a brief whose ONLY bad refs are sourceRefs stays ok.
    const sourceOnlyBad = brief({ talkingPoints: [tp([99])] });
    expect(
      classifyRunOutcome({
        schemaValid: true,
        stopReason: 'end_turn',
        brief: sourceOnlyBad,
        detectionsCount: 2,
      }).status,
    ).toBe('ok');
  });

  it('the overview-only failure is byte-identical to the pre-inc-036 output', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ overviewRefs: [0, 9] }),
      newsCount: 3,
      detectionsCount: 2,
    });
    expect(outcome).toEqual({
      status: 'partial',
      reason: 'unresolved-overview-refs',
      detail: 'Overview cites headline index(es) 9 but only 3 headline(s) were provided.',
    });
  });

  it('reported indexes follow the overview filter behaviour: item order, duplicates preserved', () => {
    const outcome = classifyRunOutcome({
      schemaValid: true,
      stopReason: 'end_turn',
      brief: brief({ talkingPoints: [tp([8]), tp([7, 8])] }),
      newsCount: 3,
    });
    expect(outcome.detail).toBe(
      'Talking points cite headline index(es) 8, 7, 8 but only 3 headline(s) were provided.',
    );
  });
});
