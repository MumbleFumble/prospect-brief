import { describe, expect, it } from 'vitest';
import {
  estimateBatchCost,
  parseDomainList,
  signalsFromHtml,
  batchProgress,
  type BatchState,
} from './batch';

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
    // per brief: 3000/1e6*3 + 900/1e6*15 = 0.009 + 0.0135 = 0.0225
    expect(est.estUsd).toBeCloseTo(0.225, 3);
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
      errors: 1,
      remaining: 2,
      active: true,
    });
  });
});
