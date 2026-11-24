import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

  it('defaults the overview grounding fields on a v1-shaped payload', () => {
    const parsed = BriefSchema.parse({
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(parsed.overviewStackRefs).toEqual([]);
    expect(parsed.overviewBasis).toBe('site');
  });

  it('defaults the overview grounding fields on a v2 payload without them', () => {
    const parsed = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      overviewRefs: [0],
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(parsed.overviewStackRefs).toEqual([]);
    expect(parsed.overviewBasis).toBe('site');
  });

  it('round-trips explicit overviewStackRefs and overviewBasis', () => {
    const parsed = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      overviewRefs: [0],
      overviewStackRefs: [0, 2],
      overviewBasis: 'stack',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(parsed.overviewStackRefs).toEqual([0, 2]);
    expect(parsed.overviewBasis).toBe('stack');
  });

  it('defaults risks to [] on v1-shaped and v2 payloads without the section', () => {
    const v1 = BriefSchema.parse({
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(v1.risks).toEqual([]);
    const v2 = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(v2.risks).toEqual([]);
  });

  it('defaults opportunities to [] on v1-shaped and v2 payloads without the section', () => {
    const v1 = BriefSchema.parse({
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(v1.opportunities).toEqual([]);
    const v2 = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
    });
    expect(v2.opportunities).toEqual([]);
  });

  it('parses opportunities with refs preserved and basis defaulting to news', () => {
    const parsed = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
      opportunities: [
        { point: 'Expansion into Europe announced.', sourceRefs: [0], stackRefs: [1], basis: 'hiring' },
        { point: 'New funding round reported.', sourceRefs: [0] },
      ],
    });
    expect(parsed.opportunities).toHaveLength(2);
    expect(parsed.opportunities[0]).toMatchObject({ sourceRefs: [0], stackRefs: [1], basis: 'hiring' });
    expect(parsed.opportunities[1].basis).toBe('news');
    expect(parsed.opportunities[1].stackRefs).toEqual([]);
  });

  it('parses risks with refs preserved and basis defaulting to inference', () => {
    const parsed = BriefSchema.parse({
      schemaVersion: 2,
      overview: 'x',
      talkingPoints: [{ point: 'x', sourceRefs: [] }],
      risks: [
        { point: 'Layoffs reported.', sourceRefs: [0], stackRefs: [1], basis: 'news' },
        { point: 'Stack mismatch with the seller stack.', sourceRefs: [] },
      ],
    });
    expect(parsed.risks).toHaveLength(2);
    expect(parsed.risks[0]).toMatchObject({ sourceRefs: [0], stackRefs: [1], basis: 'news' });
    expect(parsed.risks[1].basis).toBe('inference');
    expect(parsed.risks[1].stackRefs).toEqual([]);
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

  it('round-trips overviewStackRefs and overviewBasis through validation', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      overviewStackRefs: [1],
      overviewBasis: 'stack',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(true);
    expect(result.brief?.overviewStackRefs).toEqual([1]);
    expect(result.brief?.overviewBasis).toBe('stack');
  });

  it('names a malformed overviewStackRefs exactly invalid-ref-shape:overviewStackRefs', () => {
    const raw = JSON.stringify({
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      overviewStackRefs: 'not-an-array',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-ref-shape:overviewStackRefs']);
  });

  it('round-trips risks through validation with refs and basis preserved', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      risks: [
        { point: 'Hiring freeze reported.', sourceRefs: [0], stackRefs: [], basis: 'news' },
        { point: 'Legacy stack may resist migration.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
      ],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(true);
    expect(result.brief?.risks).toHaveLength(2);
    expect(result.brief?.risks[0]).toMatchObject({ sourceRefs: [0], basis: 'news' });
    expect(result.brief?.risks[1]).toMatchObject({ stackRefs: [0], basis: 'stack' });
  });

  it('names malformed risks sourceRefs exactly invalid-ref-shape:risks.sourceRefs', () => {
    const raw = JSON.stringify({
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      risks: [{ point: 'A risk.', sourceRefs: 'not-an-array', stackRefs: [] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-ref-shape:risks.sourceRefs']);
  });

  it('names malformed risks stackRefs exactly invalid-ref-shape:risks.stackRefs', () => {
    const raw = JSON.stringify({
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      risks: [{ point: 'A risk.', sourceRefs: [], stackRefs: [1.5] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-ref-shape:risks.stackRefs']);
  });

  it('round-trips opportunities through validation with refs and basis preserved', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      opportunities: [
        { point: 'Hiring surge in engineering.', sourceRefs: [0], stackRefs: [], basis: 'hiring' },
        { point: 'Migrating off a legacy stack.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
      ],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(true);
    expect(result.brief?.opportunities).toHaveLength(2);
    expect(result.brief?.opportunities[0]).toMatchObject({ sourceRefs: [0], basis: 'hiring' });
    expect(result.brief?.opportunities[1]).toMatchObject({ stackRefs: [0], basis: 'stack' });
  });

  it('names malformed opportunities sourceRefs exactly invalid-ref-shape:opportunities.sourceRefs', () => {
    const raw = JSON.stringify({
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      opportunities: [{ point: 'An opening.', sourceRefs: 'not-an-array', stackRefs: [] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-ref-shape:opportunities.sourceRefs']);
  });

  it('names malformed opportunities stackRefs exactly invalid-ref-shape:opportunities.stackRefs', () => {
    const raw = JSON.stringify({
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
      opportunities: [{ point: 'An opening.', sourceRefs: [], stackRefs: [-1] }],
    });
    const result = validateBriefResponse(raw);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.failures).toEqual(['invalid-ref-shape:opportunities.stackRefs']);
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

  it('requests structured output with a Brief-shaped schema derived from BriefSchema', async () => {
    const fetchFn = mockAnthropic([{ text: validText }]);
    const result = await generateBriefWithSignals('key', 'model', signals, [], []);
    // (ii) a structured valid response produces a brief stamped 2.
    expect(result.brief.schemaVersion).toBe(2);

    // (i) the outgoing request carries output_config.format with a
    // json_schema for the Brief shape.
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string) as {
      output_config: { format: { type: string; schema: Record<string, unknown> } };
    };
    expect(body.output_config.format.type).toBe('json_schema');
    const schema = body.output_config.format.schema as {
      properties: Record<string, { items?: { properties: Record<string, unknown> } }>;
      required: string[];
      additionalProperties: boolean;
    };
    // Drift guard: the sent schema's field names are exactly
    // BriefSchema's, at the top level and inside talkingPoints.
    const derived = z.toJSONSchema(BriefSchema) as {
      properties: Record<string, { items?: { properties: Record<string, unknown> } }>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(derived.properties).sort(),
    );
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(BriefSchema.shape).sort(),
    );
    expect(
      Object.keys(schema.properties.talkingPoints.items?.properties ?? {}).sort(),
    ).toEqual(
      Object.keys(derived.properties.talkingPoints.items?.properties ?? {}).sort(),
    );
    expect(schema.required).toEqual(expect.arrayContaining(['overview', 'talkingPoints']));
    // inc-018: the new overview grounding fields arrive in the
    // sent schema by derivation, not hand-editing.
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['overviewStackRefs', 'overviewBasis']),
    );
    // inc-019: the risks section arrives the same way.
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['risks']));
    // inc-020: the opportunities section arrives the same way.
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['opportunities']));
    // API-shape hygiene: objects are closed and no unsupported
    // constraint keywords survive the derivation transform.
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toMatch(
      /"(minLength|maxLength|minItems|maxItems|minimum|maximum|\$schema|default)"/,
    );
  });

  it('still fails a schemaVersion 3 response through validation + retry-once', async () => {
    const bad = JSON.stringify({
      schemaVersion: 3,
      overview: 'Example sells widgets.',
      talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0] }],
    });
    const fetchFn = mockAnthropic([{ text: bad }, { text: bad }]);
    await expect(generateBriefWithSignals('key', 'model', signals, [], [])).rejects.toThrow(
      'invalid-schema-version',
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
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
