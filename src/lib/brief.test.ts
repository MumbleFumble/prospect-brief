import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BriefSchema,
  buildPrompt,
  generateBrief,
  generateBriefWithSignals,
  validateBriefResponse,
} from './brief';
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

  it('reads a legacy payload with no schemaVersion as version 1', () => {
    const parsed = BriefSchema.parse({
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(parsed.schemaVersion).toBe(1);
  });

  it('accepts an explicit schemaVersion 2 payload as version 2', () => {
    const parsed = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(parsed.schemaVersion).toBe(2);
  });

  it('rejects schemaVersion 3', () => {
    expect(() =>
      BriefSchema.parse({
        schemaVersion: 3,
        overview: 'x',
        talkingPoints: [{ point: 'x', sourceRefs: [] }],
      }),
    ).toThrow();
  });

  it('rejects a non-integer schemaVersion', () => {
    expect(() =>
      BriefSchema.parse({
        schemaVersion: 2.5,
        overview: 'x',
        talkingPoints: [{ point: 'x', sourceRefs: [] }],
      }),
    ).toThrow();
  });
});

describe('validateBriefResponse', () => {
  const validRaw = JSON.stringify({
    overview: 'Acme builds payments infrastructure.',
    overviewRefs: [0],
    talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
  });

  it('passes a valid response, with the parsed brief and no failures', () => {
    const result = validateBriefResponse(validRaw);
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.brief?.overview).toContain('Acme');
  });

  it('reads a legacy response (no schemaVersion) as version 1', () => {
    const result = validateBriefResponse(validRaw);
    expect(result.valid).toBe(true);
    expect(result.brief?.schemaVersion).toBe(1);
  });

  it('accepts an explicit schemaVersion 2 response as version 2', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(true);
    expect(result.brief?.schemaVersion).toBe(2);
  });

  it('rejects schemaVersion 3 with the invalid-schema-version reason', () => {
    const raw = JSON.stringify({
      schemaVersion: 3,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-schema-version']);
  });

  it('fails invalid JSON with the invalid-json reason', () => {
    const result = validateBriefResponse('not json at all');
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual(['invalid-json']);
  });

  it('fails a non-object response with the not-an-object reason', () => {
    expect(validateBriefResponse('[1,2]').failures).toEqual(['not-an-object']);
  });

  it('fails a missing overview with the missing-overview reason', () => {
    const raw = JSON.stringify({ talkingPoints: [{ point: 'x', sourceRefs: [] }] });
    expect(validateBriefResponse(raw).failures).toEqual(['missing-overview']);
  });

  it('fails an empty overview with the empty-overview reason', () => {
    const raw = JSON.stringify({
      overview: '',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(validateBriefResponse(raw).failures).toEqual(['empty-overview']);
  });

  it('fails a wrong-type overview with the overview-wrong-type reason', () => {
    const raw = JSON.stringify({
      overview: 42,
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(validateBriefResponse(raw).failures).toEqual(['overview-wrong-type']);
  });

  it('fails missing talking points with the missing-talking-points reason', () => {
    const raw = JSON.stringify({ overview: 'x' });
    expect(validateBriefResponse(raw).failures).toEqual(['missing-talking-points']);
  });

  it('fails empty talking points with the empty-talking-points reason', () => {
    const raw = JSON.stringify({ overview: 'x', talkingPoints: [] });
    expect(validateBriefResponse(raw).failures).toEqual(['empty-talking-points']);
  });

  it('fails an unresolved refs shape in overviewRefs with its named reason', () => {
    const raw = JSON.stringify({
      overview: 'x',
      overviewRefs: [1.5],
      talkingPoints: [{ point: 'x', sourceRefs: [0] }],
    });
    expect(validateBriefResponse(raw).failures).toEqual(['invalid-ref-shape:overviewRefs']);
  });

  it('fails an unresolved refs shape in sourceRefs with its named reason', () => {
    const raw = JSON.stringify({
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [-1] }],
    });
    expect(validateBriefResponse(raw).failures).toEqual(['invalid-ref-shape:sourceRefs']);
  });
});

describe('generateBriefWithSignals', () => {
  const signals: PageSignals = {
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

  const validText = JSON.stringify({
    overview: 'Example sells widgets.',
    overviewRefs: [0],
    talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0] }],
  });

  function mockAnthropic(responses: Array<{ text: string; stopReason?: string | null }>) {
    const fetchFn = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('mock exhausted');
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: next.text }],
          stop_reason: next.stopReason ?? 'end_turn',
        }),
        text: async () => '',
      };
    });
    vi.stubGlobal('fetch', fetchFn);
    return fetchFn;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces stop_reason and a valid validation result on success', async () => {
    mockAnthropic([{ text: validText, stopReason: 'end_turn' }]);
    const result = await generateBriefWithSignals('key', 'model', signals, [], []);
    expect(result.brief.overview).toContain('Example sells widgets');
    expect(result.stopReason).toBe('end_turn');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.failures).toEqual([]);
  });

  it('surfaces a max_tokens stop_reason unchanged, brief still returned', async () => {
    mockAnthropic([{ text: validText, stopReason: 'max_tokens' }]);
    const result = await generateBriefWithSignals('key', 'model', signals, [], []);
    expect(result.stopReason).toBe('max_tokens');
    expect(result.brief.overview).toContain('Example sells widgets');
  });

  it('retries once on a schema-invalid response, then succeeds (behaviour unchanged)', async () => {
    const fetchFn = mockAnthropic([
      { text: JSON.stringify({ overview: 'x', talkingPoints: [] }) },
      { text: validText },
    ]);
    const result = await generateBriefWithSignals('key', 'model', signals, [], []);
    expect(result.brief.overview).toContain('Example sells widgets');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws after two schema-invalid responses, naming the failure reason', async () => {
    mockAnthropic([
      { text: JSON.stringify({ overview: 'x', talkingPoints: [] }) },
      { text: JSON.stringify({ overview: 'x', talkingPoints: [] }) },
    ]);
    await expect(generateBriefWithSignals('key', 'model', signals, [], [])).rejects.toThrow(
      'empty-talking-points',
    );
  });

  it('leaves the thrown/network error path unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(generateBriefWithSignals('key', 'model', signals, [], [])).rejects.toThrow(
      'Failed to fetch',
    );
    await expect(generateBrief('key', 'model', signals, [], [])).rejects.toThrow('Failed to fetch');
  });

  it('generateBrief still returns just the brief for successful runs', async () => {
    mockAnthropic([{ text: validText }]);
    const brief = await generateBrief('key', 'model', signals, [], []);
    expect(brief.overview).toContain('Example sells widgets');
    expect(brief.talkingPoints).toHaveLength(1);
  });

  it('stamps generated briefs with schemaVersion 2 (model text omits the field)', async () => {
    mockAnthropic([{ text: validText }]);
    const result = await generateBriefWithSignals('key', 'model', signals, [], []);
    expect(result.brief.schemaVersion).toBe(2);
    expect(result.validation.brief?.schemaVersion).toBe(2);
  });

  it('stamps a generated brief as 2 even when the model claims version 1', async () => {
    mockAnthropic([
      {
        text: JSON.stringify({
          schemaVersion: 1,
          overview: 'Example sells widgets.',
          overviewRefs: [0],
          talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0] }],
        }),
      },
    ]);
    const brief = await generateBrief('key', 'model', signals, [], []);
    expect(brief.schemaVersion).toBe(2);
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
