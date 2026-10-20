import { describe, expect, it } from 'vitest';
import { briefToMarkdown } from './markdown';
import type { Brief } from './brief';

const BRIEF: Brief = {
  overview: 'Acme builds payments infrastructure.',
  overviewRefs: [0],
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
});
