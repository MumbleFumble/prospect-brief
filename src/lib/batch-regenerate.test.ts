import { describe, expect, it } from 'vitest';
import type { Brief } from './brief';
import { runBatchRegeneration, type BatchRegenDeps } from './batch-regenerate';
import { BATCH_SECTION_ORDER } from './regenerate';
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
const news: NewsItem[] = [
  { title: 'Example raises $5M', link: 'https://n/1', pubDate: null, source: 'TC' },
];

const EXISTING: Brief = {
  schemaVersion: 2,
  overview: 'Old overview.',
  overviewRefs: [0],
  overviewStackRefs: [],
  overviewBasis: 'site',
  talkingPoints: [{ point: 'Old point.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
  risks: [],
  opportunities: [],
};

const NEW_BRIEF: Brief = {
  ...structuredClone(EXISTING),
  overview: 'New overview.',
  risks: [{ point: 'New risk.', sourceRefs: [], stackRefs: [], basis: 'inference' }],
};

const STOP_REASONS = {
  overview: 'end_turn',
  talkingPoints: 'end_turn',
  risks: 'max_tokens',
  opportunities: 'end_turn',
} as const;

function makeDeps(overrides: Partial<BatchRegenDeps> = {}) {
  const events: string[] = [];
  const persisted: unknown[] = [];
  const deps: BatchRegenDeps = {
    getSettings: async () => ({
      apiKey: 'key',
      model: 'model',
      sellerProfile: { whatYouSell: '', idealCustomer: '', valueProps: [], competitors: [] },
    }),
    regenerateAll: async () => ({ brief: structuredClone(NEW_BRIEF), stopReasons: { ...STOP_REASONS } }),
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

const msg = { brief: EXISTING, signals, detections, news, hiring: null };

describe('runBatchRegeneration (REGENERATE_ALL_SECTIONS handler logic)', () => {
  it('success: returns the batch brief + stopReasons, captures the diff BEFORE persisting, saves exactly once', async () => {
    const { deps, events, persisted } = makeDeps();
    const res = await runBatchRegeneration(msg, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.brief.overview).toBe('New overview.');
    expect(res.stopReasons).toEqual(STOP_REASONS);
    // The diff was captured (the overview/risks changes are in
    // it) and the capture read happened before persistence.
    expect(res.changes?.some((c) => c.section === 'risks')).toBe(true);
    expect(events).toEqual(['listSaved', 'persist']);
    expect(persisted).toHaveLength(1);
    expect((persisted[0] as { brief: Brief }).brief.overview).toBe('New overview.');
    expect((persisted[0] as { domain: string }).domain).toBe('example.com');
  });

  it('failure (middle section): returns the section-named library error verbatim and saves NOTHING', async () => {
    const { deps, events, persisted } = makeDeps({
      regenerateAll: async () => {
        throw new Error(
          "Batch regeneration failed at section 'risks': Invalid section response: invalid-json",
        );
      },
    });
    const res = await runBatchRegeneration(msg, deps);
    expect(res).toEqual({
      ok: false,
      error: "Batch regeneration failed at section 'risks': Invalid section response: invalid-json",
    });
    expect(persisted).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('the stopReasons shape covers every section in the batch order', () => {
    expect(Object.keys(STOP_REASONS)).toEqual(BATCH_SECTION_ORDER);
  });
});
