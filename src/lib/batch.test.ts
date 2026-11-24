import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateBatchCost,
  parseDomainList,
  signalsFromHtml,
  batchProgress,
  batchStatusForOutcome,
  classifyBatchGeneration,
  createBatchState,
  runBatchQueue,
  type BatchQueueDeps,
  type BatchState,
} from './batch';
import { generateBriefWithSignals, type BriefGeneration } from './brief';
import { summarizeBatchRuns, type RunRecord } from './runs';
import type { RunOutcome } from './run-outcome';
import type { PageSignals } from './types';

describe('parseDomainList', () => {
  it('parses newline, comma and space separated domains', () => {
    expect(parseDomainList('stripe.com\nlinear.app, notion.so vercel.com')).toEqual([
      'stripe.com',
      'linear.app',
      'notion.so',
      'vercel.com',
    ]);
  });

  it('strips protocols, www, paths and ports, and dedupes', () => {
    expect(
      parseDomainList('https://www.Stripe.com/pricing\nstripe.com\nhttp://airbnb.com:8080/x'),
    ).toEqual(['stripe.com', 'airbnb.com']);
  });

  it('rejects non-domains', () => {
    expect(parseDomainList('hello world\nnot a domain\nfoo\nok.com')).toEqual(['ok.com']);
  });

  it('handles CSV-ish first-column content', () => {
    expect(parseDomainList('Company,Domain\nAcme,acme.com\nBeta,beta.io')).toEqual([
      'acme.com',
      'beta.io',
    ]);
  });
});

describe('signalsFromHtml', () => {
  const html = `<!doctype html><html><head>
    <title>Acme &amp; Co</title>
    <meta name="description" content="Acme makes widgets">
    <meta property="og:site_name" content="Acme">
    <script src="https://cdn.acme.com/app.js"></script>
    <script src="//cdn.segment.com/analytics.js"></script>
    <link rel="stylesheet" href="https://cdn.acme.com/app.css">
    <link rel="canonical" href="https://acme.com/">
  </head><body><h1>Welcome to Acme</h1><script>var x = 1;</script><p>We hire via boards.greenhouse.io/acme</p></body></html>`;

  it('extracts title, meta, scripts and links', () => {
    const s = signalsFromHtml('acme.com', html);
    expect(s.dom.title).toBe('Acme & Co');
    expect(s.dom.metaDescription).toBe('Acme makes widgets');
    expect(s.dom.ogTags['og:site_name']).toBe('Acme');
    expect(s.dom.scriptSrcs).toContain('https://cdn.acme.com/app.js');
    expect(s.dom.scriptSrcs).toContain('https://cdn.segment.com/analytics.js');
    expect(s.dom.linkHrefs).toContain('https://acme.com/');
    expect(s.dom.url).toBe('https://acme.com/');
  });

  it('produces visible text without script content and marks partial via mainWorld null', () => {
    const s = signalsFromHtml('acme.com', html);
    expect(s.dom.visibleText).toContain('Welcome to Acme');
    expect(s.dom.visibleText).not.toContain('var x');
    expect(s.mainWorld).toBeNull();
  });
});

describe('estimateBatchCost', () => {
  it('estimates sonnet pricing by default model', () => {
    const est = estimateBatchCost(10, 'claude-sonnet-4-5');
    // per brief: 3000/1e6*3 + 1000/1e6*15 = 0.009 + 0.015 = 0.024
    expect(est.estUsd).toBeCloseTo(0.24, 3);
    expect(est.lowUsd).toBeLessThan(est.estUsd);
    expect(est.highUsd).toBeGreaterThan(est.estUsd);
    expect(est.pricingKnown).toBe(true);
  });

  it('flags unknown models but still estimates', () => {
    const est = estimateBatchCost(5, 'some-future-model');
    expect(est.pricingKnown).toBe(false);
    expect(est.estUsd).toBeGreaterThan(0);
  });
});

describe('batchProgress', () => {
  it('counts statuses', () => {
    const state: BatchState = {
      createdAt: 0,
      heartbeat: 0,
      items: [
        { domain: 'a.com', status: 'done' },
        { domain: 'b.com', status: 'error' },
        { domain: 'c.com', status: 'queued' },
        { domain: 'd.com', status: 'running' },
        { domain: 'e.com', status: 'cancelled' },
      ],
    };
    expect(batchProgress(state)).toEqual({
      total: 5,
      done: 1,
      partial: 0,
      errors: 1,
      remaining: 2,
      active: true,
    });
  });

  it('reports exact counts for a mixed batch: success + partial + failure', () => {
    const state: BatchState = {
      createdAt: 0,
      heartbeat: 0,
      items: [
        {
          domain: 'ok.com',
          status: 'done',
          outcome: { status: 'ok', reason: 'success', detail: 'Brief passed all run checks.' },
        },
        {
          domain: 'cut.com',
          status: 'partial',
          outcome: {
            status: 'partial',
            reason: 'max-tokens',
            detail: 'Generation stopped at max_tokens.',
          },
        },
        {
          domain: 'bad.com',
          status: 'error',
          error: 'Failed to fetch',
          outcome: { status: 'failed', reason: 'network-error', detail: 'Failed to fetch' },
        },
      ],
    };
    expect(batchProgress(state)).toEqual({
      total: 3,
      done: 1,
      partial: 1,
      errors: 1,
      remaining: 0,
      active: false,
    });
  });
});

describe('classifyBatchGeneration', () => {
  const brief = {
    schemaVersion: 2 as const,
    overview: 'Acme sells widgets.',
    overviewRefs: [0],
    overviewStackRefs: [],
    overviewBasis: 'site' as const,
    risks: [],
    opportunities: [],
    talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0], stackRefs: [], basis: 'news' as const }],
  };

  function generation(stopReason: string | null, schemaValid = true): BriefGeneration {
    return {
      brief,
      stopReason,
      validation: schemaValid
        ? { valid: true, brief, failures: [] }
        : { valid: false, brief: null, failures: ['empty-talking-points'] },
    };
  }

  it('classifies a max_tokens batch item as partial with the max-tokens reason', () => {
    const outcome = classifyBatchGeneration(generation('max_tokens'), 1);
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('max-tokens');
    expect(batchStatusForOutcome(outcome)).toBe('partial');
  });

  it('keeps an end_turn + valid schema generation a success', () => {
    const outcome = classifyBatchGeneration(generation('end_turn'), 1);
    expect(outcome).toEqual({
      status: 'ok',
      reason: 'success',
      detail: 'Brief produced, complete, and fully grounded.',
    });
    expect(batchStatusForOutcome(outcome)).toBe('done');
  });

  it('keeps a schema-invalid generation on its failure classification', () => {
    const outcome = classifyBatchGeneration(generation('end_turn', false), 1);
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('schema-invalid');
    expect(batchStatusForOutcome(outcome)).toBe('error');
  });

  it('feeds a REAL generateBriefWithSignals result: max_tokens arrives as partial', async () => {
    const text = JSON.stringify({
      overview: 'Example sells widgets.',
      overviewRefs: [0],
      talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0] }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text }],
          stop_reason: 'max_tokens',
        }),
        text: async () => '',
      })),
    );
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
    const gen = await generateBriefWithSignals('key', 'model', signals, [], []);
    expect(gen.stopReason).toBe('max_tokens');
    expect(gen.validation.valid).toBe(true);
    const outcome = classifyBatchGeneration(gen, 0);
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('max-tokens');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe('runBatchQueue (resumable batch queue)', () => {
  const okOutcome: RunOutcome = {
    status: 'ok',
    reason: 'success',
    detail: 'Brief produced, complete, and fully grounded.',
  };
  const partialOutcome: RunOutcome = {
    status: 'partial',
    reason: 'max-tokens',
    detail: 'Generation stopped at max_tokens.',
  };
  const DOMAINS = ['a.com', 'b.com', 'c.com', 'd.com'];

  /**
   * In-memory durable stores + a counting research fake. The stores
   * outlive any single engine run, exactly like chrome.storage and
   * the runs store outlive the service worker.
   */
  function makeHarness() {
    let stored: BatchState | null = null;
    let tick = 0;
    const records: Array<{
      domain: string;
      outcome: RunOutcome;
      finishedAt: number;
      batchId: string | null;
    }> = [];
    const researchCalls = new Map<string, number>();
    let saveCount = 0;
    let crashOnSave: number | null = null;

    const research = async (domain: string): Promise<RunOutcome> => {
      researchCalls.set(domain, (researchCalls.get(domain) ?? 0) + 1);
      if (domain === 'b.com') return partialOutcome;
      if (domain === 'c.com') throw new Error('Failed to fetch');
      return okOutcome;
    };

    const deps = (): BatchQueueDeps => ({
      // Deep copies both ways: chrome.storage serializes, so a state
      // mutation only becomes durable when its save actually lands.
      loadState: async () => (stored ? structuredClone(stored) : null),
      saveState: async (s) => {
        saveCount += 1;
        if (crashOnSave !== null && saveCount === crashOnSave) {
          throw new Error('worker died');
        }
        stored = structuredClone(s);
      },
      clearState: async () => {
        stored = null;
      },
      research,
      record: async (domain, outcome, finishedAt, batchId) => {
        records.push({ domain, outcome, finishedAt, batchId });
      },
      findRecordedOutcome: async (batchId, domain) => {
        const match = records.find((r) => r.batchId === batchId && r.domain === domain);
        return match ? { outcome: match.outcome, finishedAt: match.finishedAt } : null;
      },
      now: () => ++tick,
    });

    return {
      deps,
      records,
      researchCalls,
      get stored() {
        return stored;
      },
      startBatch() {
        stored = createBatchState(DOMAINS, 0);
      },
      /** Make the Nth saveState call throw, simulating worker death. */
      crashOnSaveNumber(n: number) {
        crashOnSave = n;
      },
      /** Start a batch over the given domains (default: the standard four). */
      startBatchOf(domains: string[]) {
        stored = createBatchState(domains, 0);
      },
    };
  }

  function outcomeCounts(records: Array<{ outcome: RunOutcome }>) {
    return {
      ok: records.filter((r) => r.outcome.status === 'ok').length,
      partial: records.filter((r) => r.outcome.status === 'partial').length,
      failed: records.filter((r) => r.outcome.status === 'failed').length,
    };
  }

  it('runs a batch to completion and leaves no resumable state', async () => {
    const h = makeHarness();
    h.startBatch();
    await runBatchQueue(h.deps());

    expect(h.stored).toBeNull();
    for (const d of DOMAINS) expect(h.researchCalls.get(d)).toBe(1);
    expect(outcomeCounts(h.records)).toEqual({ ok: 2, partial: 1, failed: 1 });

    // A completed batch never "resumes": re-entering is a no-op.
    await runBatchQueue(h.deps());
    for (const d of DOMAINS) expect(h.researchCalls.get(d)).toBe(1);
    expect(h.records).toHaveLength(4);
  });

  it('resumes after interruption without re-researching finished items', async () => {
    // Control: an uninterrupted run's final counts.
    const control = makeHarness();
    control.startBatch();
    await runBatchQueue(control.deps());
    const controlCounts = outcomeCounts(control.records);
    expect(controlCounts).toEqual({ ok: 2, partial: 1, failed: 1 });

    // Interrupted run: saves are a.com running(1), a.com final(2),
    // b.com running(3), b.com final(4). Crashing save 4 means b.com
    // finished and was RECORDED, but the state write never landed —
    // the durable state still shows b.com 'running'.
    const h = makeHarness();
    h.startBatch();
    h.crashOnSaveNumber(4);
    await expect(runBatchQueue(h.deps())).rejects.toThrow('worker died');
    expect(h.researchCalls.get('a.com')).toBe(1);
    expect(h.researchCalls.get('b.com')).toBe(1);
    expect(h.stored?.items.find((i) => i.domain === 'b.com')?.status).toBe('running');
    expect(h.records.map((r) => r.domain)).toEqual(['a.com', 'b.com']);

    // Resume through the production engine with fresh in-memory
    // wiring over the SAME durable stores (a new worker's view).
    await runBatchQueue(h.deps());

    // Finished items were NOT re-researched; the remainder ran once.
    for (const d of DOMAINS) expect(h.researchCalls.get(d)).toBe(1);
    // No item lost or duplicated in the durable record, and the
    // final counts match the uninterrupted run exactly.
    expect(h.records.map((r) => r.domain).sort()).toEqual([...DOMAINS].sort());
    expect(outcomeCounts(h.records)).toEqual(controlCounts);
    // And the completed batch leaves no resumable state.
    expect(h.stored).toBeNull();
  });

  it('a failing record never breaks the batch', async () => {
    const h = makeHarness();
    h.startBatch();
    const deps = h.deps();
    deps.record = async () => {
      throw new Error('runs store unavailable');
    };
    await runBatchQueue(deps);
    for (const d of DOMAINS) expect(h.researchCalls.get(d)).toBe(1);
    expect(h.stored).toBeNull();
  });

  it('retry researches exactly the partial+failed domains and no ok domain', async () => {
    const h = makeHarness();
    h.startBatch();
    await runBatchQueue(h.deps());
    expect(h.stored).toBeNull();

    // Derive the retry set from the recorded outcomes, exactly as
    // the summary UI does (production summarizeBatchRuns).
    const asRecords: RunRecord[] = h.records.map((r, i) => ({
      id: `run-${i}`,
      domain: r.domain,
      outcome: r.outcome,
      finishedAt: r.finishedAt,
      batchId: r.batchId,
    }));
    const summary = summarizeBatchRuns(asRecords);
    expect(summary?.ok).toBe(2);
    expect(summary?.partial).toBe(1);
    expect(summary?.failed).toBe(1);
    expect([...(summary?.retryDomains ?? [])].sort()).toEqual(['b.com', 'c.com']);

    // Retry: a NEW batch over exactly the retry domains, run through
    // the same production engine.
    const callsBefore = new Map(h.researchCalls);
    h.startBatchOf(summary?.retryDomains ?? []);
    await runBatchQueue(h.deps());

    expect(h.researchCalls.get('b.com')).toBe((callsBefore.get('b.com') ?? 0) + 1);
    expect(h.researchCalls.get('c.com')).toBe((callsBefore.get('c.com') ?? 0) + 1);
    expect(h.researchCalls.get('a.com')).toBe(callsBefore.get('a.com'));
    expect(h.researchCalls.get('d.com')).toBe(callsBefore.get('d.com'));
    expect(h.stored).toBeNull();
  });

  it('a fully cancelled batch drains and leaves no resumable state', async () => {
    const h = makeHarness();
    h.startBatch();
    const state = h.stored;
    if (!state) throw new Error('expected a started batch');
    for (const item of state.items) item.status = 'cancelled';
    await runBatchQueue(h.deps());
    expect(h.stored).toBeNull();
    expect(h.researchCalls.size).toBe(0);
  });
});
