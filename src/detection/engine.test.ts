import { describe, expect, it } from 'vitest';
import { detectTech, groupByCategory } from './engine';
import type { PageSignals } from '../lib/types';

function fakeSignals(overrides: Partial<PageSignals['dom']> = {}, mainWorld = {}): PageSignals {
  return {
    dom: {
      url: 'https://example.com/',
      title: 'Example',
      metaDescription: null,
      generator: null,
      ogTags: {},
      visibleText: '',
      scriptSrcs: [],
      linkHrefs: [],
      cookieNames: [],
      ...overrides,
    },
    mainWorld: {
      reactDevtoolsHook: false,
      nextData: false,
      nuxtData: false,
      shopify: false,
      dataLayer: false,
      googleAnalytics: false,
      intercom: false,
      stripe: false,
      hubspot: false,
      segment: false,
      ...mainWorld,
    },
    collectedAt: 0,
  };
}

describe('detectTech', () => {
  it('detects nothing on an empty page', () => {
    expect(detectTech(fakeSignals(), {})).toEqual([]);
  });

  it('detects Shopify from global + script src (high confidence)', () => {
    const signals = fakeSignals(
      { scriptSrcs: ['https://cdn.shopify.com/s/files/shop.js'] },
      { shopify: true },
    );
    const found = detectTech(signals, {}).filter((d) => d.name === 'Shopify');
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe('medium'); // 2 evidence items
    expect(found[0].evidence.join(' ')).toContain('shopify');
  });

  it('detects Next.js from script src + header + meta (high confidence)', () => {
    const signals = fakeSignals(
      {
        scriptSrcs: ['https://example.com/_next/static/chunks/app.js'],
        generator: 'Next.js 14',
      },
      { nextData: true },
    );
    const found = detectTech(signals, { 'x-powered-by': 'Next.js' }).filter(
      (d) => d.name === 'Next.js',
    );
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe('high');
    expect(found[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('detects Cloudflare from cf-ray header (low confidence, single signal)', () => {
    const found = detectTech(fakeSignals(), { 'cf-ray': 'abc123' }).filter(
      (d) => d.name === 'Cloudflare',
    );
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe('low');
  });

  it('matches headers case-insensitively', () => {
    const found = detectTech(fakeSignals(), { 'CF-RAY': 'abc123' }).filter(
      (d) => d.name === 'Cloudflare',
    );
    expect(found).toHaveLength(1);
  });

  it('detects WordPress from generator meta + wp-content script', () => {
    const signals = fakeSignals({
      generator: 'WordPress 6.4',
      scriptSrcs: ['https://example.com/wp-content/themes/t/style.js'],
    });
    const found = detectTech(signals, {}).filter((d) => d.name === 'WordPress');
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe('medium');
  });

  it('detects Stripe from global only (low confidence)', () => {
    const signals = fakeSignals({}, { stripe: true });
    const found = detectTech(signals, {}).filter((d) => d.name === 'Stripe');
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBe('low');
  });

  it('sorts by category then name', () => {
    const signals = fakeSignals(
      {
        scriptSrcs: [
          'https://cdn.shopify.com/shop.js',
          'https://js.stripe.com/v3/',
          'https://www.googletagmanager.com/gtag/js',
        ],
      },
      { shopify: true, stripe: true, googleAnalytics: true },
    );
    const names = detectTech(signals, {}).map((d) => `${d.category}:${d.name}`);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe('groupByCategory', () => {
  it('groups detections by category', () => {
    const signals = fakeSignals(
      { scriptSrcs: ['https://cdn.shopify.com/s.js', 'https://js.stripe.com/v3/'] },
      { shopify: true, stripe: true },
    );
    const groups = groupByCategory(detectTech(signals, {}));
    expect(groups.get('cms')?.map((d) => d.name)).toContain('Shopify');
    expect(groups.get('payments')?.map((d) => d.name)).toContain('Stripe');
  });
});
