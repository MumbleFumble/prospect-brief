import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  BRIEF_MAX_OUTPUT_TOKENS,
  buildPrompt,
  estimateTokens,
  toStructuredOutputSchema,
  type Brief,
} from './brief';
import {
  BATCH_SECTION_ORDER,
  buildSectionPrompt,
  estimateBatchRegeneration,
  estimateSectionRegeneration,
  regenerateAllSections,
  regenerateBriefSection,
  runSectionRegeneration,
  SECTION_JSON_SCHEMAS,
  SECTION_RESPONSE_SCHEMAS,
  validateSectionResponse,
  type BriefSectionKey,
  type SectionRegenDeps,
} from './regenerate';
import type { Detection, NewsItem, PageSignals } from './types';

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

const detections: Detection[] = [
  { name: 'Stripe', category: 'payments', confidence: 'high', evidence: ['js.stripe.com'] },
];
const news: NewsItem[] = [{ title: 'Example raises $5M', link: 'https://n/1', pubDate: null, source: 'TC' }];

const EXISTING: Brief = {
  schemaVersion: 2,
  overview: 'Old overview.',
  overviewRefs: [0],
  overviewStackRefs: [],
  overviewBasis: 'site',
  talkingPoints: [{ point: 'Old point.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
  risks: [{ point: 'Old risk.', sourceRefs: [0], stackRefs: [], basis: 'inference' }],
  opportunities: [{ point: 'Old opening.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
};

const SECTION_RESPONSES: Record<BriefSectionKey, string> = {
  overview: JSON.stringify({
    overview: 'New overview.',
    overviewRefs: [0],
    overviewStackRefs: [0],
    overviewBasis: 'stack',
  }),
  talkingPoints: JSON.stringify({
    talkingPoints: [{ point: 'New point.', sourceRefs: [0], stackRefs: [0], basis: 'stack' }],
  }),
  risks: JSON.stringify({
    risks: [{ point: 'New risk.', sourceRefs: [], stackRefs: [], basis: 'inference' }],
  }),
  opportunities: JSON.stringify({
    opportunities: [{ point: 'New opening.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
  }),
};

function mockAnthropic(responses: Array<{ text: string; stopReason?: string | null }>) {
  const fetchFn = vi.fn(async (_url: string, _init?: { body: string }) => {
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

describe('regenerateBriefSection', () => {
  it.each(['overview', 'talkingPoints', 'risks', 'opportunities'] as BriefSectionKey[])(
    'regenerates only the %s section; the rest is deep-equal and the input is not mutated',
    async (section) => {
      const snapshot = structuredClone(EXISTING);
      mockAnthropic([{ text: SECTION_RESPONSES[section] }]);
      const { brief, stopReason } = await regenerateBriefSection(
        'key',
        'model',
        EXISTING,
        section,
        signals,
        detections,
        news,
      );
      expect(stopReason).toBe('end_turn');
      expect(brief).not.toBe(EXISTING);
      expect(EXISTING).toEqual(snapshot);
      expect(brief.schemaVersion).toBe(2);
      const expected = structuredClone(snapshot);
      Object.assign(expected, JSON.parse(SECTION_RESPONSES[section]));
      // The regenerated section carries the model's values (with
      // schema defaults applied); every other section is the
      // input's, deep-equal.
      expect(brief.overview).toBe(section === 'overview' ? 'New overview.' : snapshot.overview);
      expect(brief.talkingPoints).toEqual(
        section === 'talkingPoints' ? expected.talkingPoints : snapshot.talkingPoints,
      );
      expect(brief.risks).toEqual(section === 'risks' ? expected.risks : snapshot.risks);
      expect(brief.opportunities).toEqual(
        section === 'opportunities' ? expected.opportunities : snapshot.opportunities,
      );
      if (section === 'overview') {
        expect(brief.overviewStackRefs).toEqual([0]);
        expect(brief.overviewBasis).toBe('stack');
      } else {
        expect(brief.overviewRefs).toEqual(snapshot.overviewRefs);
        expect(brief.overviewBasis).toBe(snapshot.overviewBasis);
      }
    },
  );

  it('stamps schemaVersion 2 when regenerating a section of a v1 brief', async () => {
    const v1 = { ...structuredClone(EXISTING), schemaVersion: 1 as const };
    mockAnthropic([{ text: SECTION_RESPONSES.risks }]);
    const { brief } = await regenerateBriefSection('key', 'model', v1, 'risks', signals, detections, news);
    expect(brief.schemaVersion).toBe(2);
    expect(brief.risks[0].point).toBe('New risk.');
    expect(brief.talkingPoints).toEqual(v1.talkingPoints);
  });

  it('sends a section-scoped structured-output schema (only the target section)', async () => {
    const fetchFn = mockAnthropic([{ text: SECTION_RESPONSES.risks }]);
    await regenerateBriefSection('key', 'model', EXISTING, 'risks', signals, detections, news);
    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body ?? '{}');
    const schema = body.output_config.format.schema;
    expect(Object.keys(schema.properties)).toEqual(['risks']);
    expect(schema).toEqual(SECTION_JSON_SCHEMAS.risks);
    // The prompt asks for only that section.
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('Regenerate ONLY the risks section');
  });

  it('throws the named failure on invalid JSON and produces no brief', async () => {
    mockAnthropic([{ text: 'not json' }, { text: 'still not json' }]);
    await expect(
      regenerateBriefSection('key', 'model', EXISTING, 'risks', signals, detections, news),
    ).rejects.toThrow('Invalid section response: invalid-json');
  });

  it('throws the named ref-shape failure for a bad section payload', async () => {
    const bad = JSON.stringify({ risks: [{ point: 'x', sourceRefs: 'nope' }] });
    mockAnthropic([{ text: bad }, { text: bad }]);
    await expect(
      regenerateBriefSection('key', 'model', EXISTING, 'risks', signals, detections, news),
    ).rejects.toThrow('invalid-ref-shape:risks.sourceRefs');
  });

  it('trips the ceiling guard before any fetch on an oversized section prompt', async () => {
    const fatDetections: Detection[] = Array.from({ length: 80 }, (_, i) => ({
      name: `Tech${i}`,
      category: 'tools',
      confidence: 'high' as const,
      evidence: ['e'.repeat(200)],
    }));
    const fetchFn = mockAnthropic([]);
    await expect(
      regenerateBriefSection('key', 'model', EXISTING, 'overview', signals, fatDetections, news),
    ).rejects.toThrow(/^prompt-over-ceiling/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('validateSectionResponse named failures', () => {
  it('names invalid-schema-version when the payload carries a bad one', () => {
    const res = validateSectionResponse(
      'risks',
      JSON.stringify({ schemaVersion: 3, risks: [] }),
    );
    expect(res.valid).toBe(false);
    expect(res.failures).toContain('invalid-schema-version');
  });

  it('names empty-talking-points and missing-source-refs', () => {
    expect(validateSectionResponse('talkingPoints', '{"talkingPoints": []}').failures).toContain(
      'empty-talking-points',
    );
    expect(
      validateSectionResponse('talkingPoints', '{"talkingPoints": [{"point": "x"}]}').failures,
    ).toContain('missing-source-refs');
  });

  it('applies schema defaults to a valid section payload', () => {
    const res = validateSectionResponse(
      'opportunities',
      JSON.stringify({ opportunities: [{ point: 'Opening.', sourceRefs: [1] }] }),
    );
    expect(res.valid).toBe(true);
    expect(res.value).toEqual({
      opportunities: [{ point: 'Opening.', sourceRefs: [1], stackRefs: [], basis: 'news' }],
    });
  });
});

describe('section schema derivation (drift guard)', () => {
  it.each(['overview', 'talkingPoints', 'risks', 'opportunities'] as BriefSectionKey[])(
    '%s: the sent JSON schema equals a fresh derivation from the zod schema',
    (section) => {
      const fresh = toStructuredOutputSchema(z.toJSONSchema(SECTION_RESPONSE_SCHEMAS[section]));
      expect(SECTION_JSON_SCHEMAS[section]).toEqual(fresh);
      const shape = SECTION_RESPONSE_SCHEMAS[section].shape as Record<string, unknown>;
      const properties = (SECTION_JSON_SCHEMAS[section] as { properties: object }).properties;
      expect(Object.keys(properties).sort()).toEqual(Object.keys(shape).sort());
    },
  );
});

describe('section caps flow from BriefSchema (inc-036)', () => {
  it('the section schemas carry the max-8 cap by derivation (picked, not hand-mirrored)', () => {
    const risks = z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.risks) as {
      properties: Record<string, { maxItems?: number }>;
    };
    const opportunities = z.toJSONSchema(SECTION_RESPONSE_SCHEMAS.opportunities) as {
      properties: Record<string, { maxItems?: number }>;
    };
    expect(risks.properties.risks.maxItems).toBe(8);
    expect(opportunities.properties.opportunities.maxItems).toBe(8);
  });

  it('a 9-item section response fails section validation', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ point: `Item ${i}.`, sourceRefs: [] }));
    const result = validateSectionResponse('risks', JSON.stringify({ risks: nine }));
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.startsWith('schema:risks'))).toBe(true);
  });
});

describe('regenerateAllSections (batch regenerate, one brief)', () => {
  it('regenerates all four sections in the fixed order, each from its own response', async () => {
    const snapshot = structuredClone(EXISTING);
    const fetchFn = mockAnthropic([
      { text: SECTION_RESPONSES.overview },
      { text: SECTION_RESPONSES.talkingPoints },
      { text: SECTION_RESPONSES.risks },
      { text: SECTION_RESPONSES.opportunities },
    ]);
    const { brief, stopReasons } = await regenerateAllSections(
      'key',
      'model',
      EXISTING,
      signals,
      detections,
      news,
    );
    // Every section's replacement comes from its own response;
    // no section retains its input value.
    expect(brief.overview).toBe('New overview.');
    expect(brief.talkingPoints[0].point).toBe('New point.');
    expect(brief.risks[0].point).toBe('New risk.');
    expect(brief.opportunities[0].point).toBe('New opening.');
    expect(brief.schemaVersion).toBe(2);
    expect(stopReasons).toEqual({
      overview: 'end_turn',
      talkingPoints: 'end_turn',
      risks: 'end_turn',
      opportunities: 'end_turn',
    });
    // The requests went out in BATCH_SECTION_ORDER.
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const prompts = fetchFn.mock.calls.map(
      (c) => (JSON.parse((c[1] as { body: string }).body) as { messages: Array<{ content: string }> }).messages[0].content,
    );
    expect(prompts[0]).toContain('Regenerate ONLY the overview (with its overviewRefs');
    expect(prompts[1]).toContain('Regenerate ONLY the talking points section');
    expect(prompts[2]).toContain('Regenerate ONLY the risks section');
    expect(prompts[3]).toContain('Regenerate ONLY the opportunities section');
    expect(BATCH_SECTION_ORDER).toEqual(['overview', 'talkingPoints', 'risks', 'opportunities']);
    // The input was not mutated.
    expect(EXISTING).toEqual(snapshot);
  });

  it('a failure in a middle section names that section, produces no brief, and does not mutate the input', async () => {
    const snapshot = structuredClone(EXISTING);
    mockAnthropic([
      { text: SECTION_RESPONSES.overview },
      { text: SECTION_RESPONSES.talkingPoints },
      { text: 'not json' },
      { text: 'not json' }, // the section's one retry
    ]);
    await expect(
      regenerateAllSections('key', 'model', EXISTING, signals, detections, news),
    ).rejects.toThrow("Batch regeneration failed at section 'risks': Invalid section response: invalid-json");
    expect(EXISTING).toEqual(snapshot);
  });

  it('prompt-over-ceiling in a section produces no brief and no API call', async () => {
    const fatDetections: Detection[] = Array.from({ length: 80 }, (_, i) => ({
      name: `Tech${i}`,
      category: 'tools',
      confidence: 'high' as const,
      evidence: ['e'.repeat(200)],
    }));
    const fetchFn = mockAnthropic([]);
    await expect(
      regenerateAllSections('key', 'model', EXISTING, signals, fatDetections, news),
    ).rejects.toThrow(/Batch regeneration failed at section 'overview': prompt-over-ceiling/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('the batch estimate is exactly the sum of the four per-section estimates', () => {
    const sum = BATCH_SECTION_ORDER.reduce(
      (acc, section) => acc + estimateSectionRegeneration(section, signals, detections, news),
      0,
    );
    expect(estimateBatchRegeneration(signals, detections, news)).toBe(sum);
    expect(estimateBatchRegeneration(signals, detections, news)).toBeGreaterThan(0);
  });
});

describe('runSectionRegeneration (REGENERATE_SECTION handler logic)', () => {
  const NEW_BRIEF: Brief = {
    ...structuredClone(EXISTING),
    risks: [{ point: 'New risk.', sourceRefs: [], stackRefs: [], basis: 'inference' }],
  };

  function makeDeps(overrides: Partial<SectionRegenDeps> = {}) {
    const events: string[] = [];
    const persisted: unknown[] = [];
    const deps: SectionRegenDeps = {
      getSettings: async () => ({
        apiKey: 'key',
        model: 'model',
        sellerProfile: { whatYouSell: '', idealCustomer: '', valueProps: [], competitors: [] },
      }),
      regenerate: async () => ({ brief: structuredClone(NEW_BRIEF), stopReason: 'end_turn' }),
      listSaved: async () => {
        events.push('listSaved');
        return [
          {
            id: 'example.com:1',
            company: 'Example',
            domain: 'example.com',
            url: 'https://example.com/',
            brief: structuredClone(EXISTING),
            detections: [],
            news: [],
            hiring: null,
            savedAt: 1,
          },
        ];
      },
      persist: async (entry) => {
        events.push('persist');
        persisted.push(entry);
      },
      ...overrides,
    };
    return { deps, events, persisted };
  }

  const msg = {
    brief: EXISTING,
    section: 'risks' as const,
    signals,
    detections,
    news,
    hiring: null,
  };

  it('success: returns the new brief, captures the diff BEFORE persisting, persists the new brief', async () => {
    const { deps, events, persisted } = makeDeps();
    const res = await runSectionRegeneration(msg, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only the target section changed in the returned brief.
    expect(res.brief.risks[0].point).toBe('New risk.');
    expect(res.brief.talkingPoints).toEqual(EXISTING.talkingPoints);
    expect(res.brief.overview).toBe(EXISTING.overview);
    // The diff was captured (the risks change is in it) and the
    // capture read happened before persistence replaced the entry.
    expect(res.changes?.some((c) => c.section === 'risks')).toBe(true);
    expect(events).toEqual(['listSaved', 'persist']);
    expect(persisted).toHaveLength(1);
    expect((persisted[0] as { brief: Brief }).brief.risks[0].point).toBe('New risk.');
    expect((persisted[0] as { domain: string }).domain).toBe('example.com');
  });

  it('failure: returns the named error and persists NOTHING (no diff capture either)', async () => {
    const { deps, events, persisted } = makeDeps({
      regenerate: async () => {
        throw new Error('Invalid section response: invalid-json');
      },
    });
    const res = await runSectionRegeneration(msg, deps);
    expect(res).toEqual({ ok: false, error: 'Invalid section response: invalid-json' });
    expect(persisted).toHaveLength(0);
    expect(events).toEqual([]);
  });
});

describe('cost discipline', () => {
  it('a maximal section prompt estimates strictly below the full-brief estimate', () => {
    const fatDetections: Detection[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Tech${i}`,
      category: 'tools',
      confidence: 'high' as const,
      evidence: ['e'.repeat(100)],
    }));
    const fullEstimate = estimateTokens(buildPrompt(signals, fatDetections, news, null)) + BRIEF_MAX_OUTPUT_TOKENS;
    for (const section of ['overview', 'talkingPoints', 'risks', 'opportunities'] as BriefSectionKey[]) {
      const sectionEstimate = estimateSectionRegeneration(section, signals, fatDetections, news);
      expect(sectionEstimate).toBeLessThan(fullEstimate);
      // And the section prompt itself is the smaller text.
      expect(buildSectionPrompt(section, signals, fatDetections, news).length).toBeLessThan(
        buildPrompt(signals, fatDetections, news, null).length,
      );
    }
  });
});
