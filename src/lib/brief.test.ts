import { describe, expect, it } from 'vitest';
import { BriefSchema, buildPrompt } from './brief';
import type { PageSignals } from './types';

describe('BriefSchema', () => {
  it('accepts a valid brief', () => {
    const raw = {
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    };
    const parsed = BriefSchema.parse(raw);
    expect(parsed.overview).toContain('Acme');
    expect(parsed.talkingPoints).toHaveLength(1);
  });

  it('rejects missing overview', () => {
    expect(() => BriefSchema.parse({ talkingPoints: [{ point: 'x', sourceRefs: [] }] })).toThrow();
  });

  it('rejects empty talking points', () => {
    expect(() => BriefSchema.parse({ overview: 'x', talkingPoints: [] })).toThrow();
  });

  it('rejects talking point without sourceRefs', () => {
    expect(() => BriefSchema.parse({ overview: 'x', talkingPoints: [{ point: 'x' }] })).toThrow();
  });

  it('rejects non-integer sourceRefs', () => {
    expect(() =>
      BriefSchema.parse({ overview: 'x', talkingPoints: [{ point: 'x', sourceRefs: [1.5] }] }),
    ).toThrow();
  });
});

describe('buildPrompt seller context', () => {
  const baseSignals: PageSignals = {
    dom: {
      url: 'https://example.com/',
      title: 'Example',
      metaDescription: null,
      generator: null,
      visibleText: 'We sell widgets.',
      ogTags: {},
      scriptSrcs: [],
      linkHrefs: [],
      cookieNames: [],
    },
    mainWorld: null,
    collectedAt: 0,
  };

  it('includes seller context when profile is set', () => {
    const seller = {
      whatYouSell: 'Checkout optimization',
      idealCustomer: 'DTC brands',
      valueProps: ['Lift conversion 12%', 'Reduce cart abandonment'], competitors: [],
    };
    const prompt = buildPrompt(baseSignals, [], [], seller);
    expect(prompt).toContain('SELLER CONTEXT');
    expect(prompt).toContain('Checkout optimization');
    expect(prompt).toContain('Lift conversion 12%');
    expect(prompt).toContain("seller's value props");
  });

  it('omits seller context when profile is empty', () => {
    const seller = { whatYouSell: '', idealCustomer: '', valueProps: [], competitors: [] };
    const prompt = buildPrompt(baseSignals, [], [], seller);
    expect(prompt).not.toContain('SELLER CONTEXT');
    expect(prompt).toContain('sourceRefs');
  });

  it('omits seller context when null', () => {
    const prompt = buildPrompt(baseSignals, [], [], null);
    expect(prompt).not.toContain('SELLER CONTEXT');
  });
});

describe('grounding fields', () => {
  it('defaults basis/stackRefs/overviewRefs for older briefs', () => {
    const parsed = BriefSchema.parse({
      overview: 'Acme does things.',
      talkingPoints: [{ point: 'They raised money.', sourceRefs: [0] }],
    });
    expect(parsed.talkingPoints[0].basis).toBe('news');
    expect(parsed.talkingPoints[0].stackRefs).toEqual([]);
    expect(parsed.overviewRefs).toEqual([]);
  });

  it('accepts stack basis with stackRefs', () => {
    const parsed = BriefSchema.parse({
      overview: 'Acme does things.',
      overviewRefs: [],
      talkingPoints: [
        { point: 'They run Segment.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
      ],
    });
    expect(parsed.talkingPoints[0].basis).toBe('stack');
    expect(parsed.talkingPoints[0].stackRefs).toEqual([0]);
  });
});
