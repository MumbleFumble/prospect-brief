import { describe, expect, it } from 'vitest';
import { briefToMarkdown } from './markdown';
import type { Brief } from './brief';

const BRIEF: Brief = {
  schemaVersion: 1,
  overview: 'Acme builds payments infrastructure.',
  overviewRefs: [0],
  overviewStackRefs: [],
  overviewBasis: 'site',
  risks: [],
  opportunities: [],
  talkingPoints: [
    { point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' },
    { point: 'New product launched.', sourceRefs: [], stackRefs: [], basis: 'site' },
  ],
};

describe('briefToMarkdown', () => {
  it('renders all sections', () => {
    const md = briefToMarkdown(
      'Acme',
      'https://acme.com/',
      BRIEF,
      [{ name: 'Stripe', category: 'payments', confidence: 'high', evidence: ['x'] }],
      [
        {
          title: 'Acme raises $100M',
          link: 'https://news.example/1',
          pubDate: '2026-10-12T10:00:00.000Z',
          source: 'TechCrunch',
        },
      ],
    );
    expect(md).toContain('# Prospect Brief: Acme');
    expect(md).toContain('## Overview');
    expect(md).toContain('Acme builds payments infrastructure.');
    expect(md).toContain('1. They raised $100M. [1]');
    expect(md).toContain('**Stripe** (payments, high confidence)');
    expect(md).toContain('[1] [Acme raises $100M](https://news.example/1)');
  });

  it('omits empty stack and news sections', () => {
    const md = briefToMarkdown('Acme', 'https://acme.com/', BRIEF, [], []);
    expect(md).not.toContain('## Likely Tech Stack');
    expect(md).not.toContain('## Recent News');
  });

  it('includes risks and opportunities with refs and basis, in section order', () => {
    const full: Brief = {
      ...BRIEF,
      schemaVersion: 2,
      risks: [
        { point: 'Hiring freeze reported.', sourceRefs: [0], stackRefs: [], basis: 'news' },
        { point: 'Churn risk inferred from reviews.', sourceRefs: [], stackRefs: [], basis: 'inference' },
      ],
      opportunities: [
        { point: 'Expanding into Europe.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
      ],
    };
    const md = briefToMarkdown('Acme', 'https://acme.com/', full, [], []);
    expect(md).toContain('## Risks');
    // basis 'news' is a risk's non-default, so it is shown; the
    // risks default 'inference' stays silent — the talking-points
    // pattern applied per section.
    expect(md).toContain('1. Hiring freeze reported. [1] _(news)_');
    expect(md).toContain('2. Churn risk inferred from reviews.');
    expect(md).not.toContain('_(inference)_');
    expect(md).toContain('## Opportunities');
    expect(md).toContain('1. Expanding into Europe. [S1] _(stack)_');
    // Order: Talking Points, then Risks, then Opportunities.
    expect(md.indexOf('## Talking Points')).toBeLessThan(md.indexOf('## Risks'));
    expect(md.indexOf('## Risks')).toBeLessThan(md.indexOf('## Opportunities'));
  });

  it('omits risks and opportunities headings when the brief carries neither', () => {
    const md = briefToMarkdown('Acme', 'https://acme.com/', BRIEF, [], []);
    expect(md).not.toContain('## Risks');
    expect(md).not.toContain('## Opportunities');
  });
});
