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
  buildSectionPrompt,
  estimateSectionRegeneration,
  regenerateBriefSection,
  SECTION_JSON_SCHEMAS,
  SECTION_RESPONSE_SCHEMAS,
  validateSectionResponse,
  type BriefSectionKey,
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
