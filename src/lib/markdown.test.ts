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

  it('Markdown source parity (inc-037): item lines carry index labels, the in-document legends resolve them', () => {
    // The stated exception to screen parity: the export does
    // not inline titles per point (the screen does); instead
    // every [n]/[S#] label on an item line resolves in the
    // document's own Recent News / Likely Tech Stack legends,
    // which carry the titles, links and names.
    const md = briefToMarkdown(
      'Acme',
      'https://acme.com/',
      BRIEF,
      [{ name: 'React', category: 'Frontend', confidence: 'high', evidence: ['script src'] }],
      [
        {
          title: 'Acme raises $100M',
          link: 'https://news.example/1',
          source: 'TechDaily',
          pubDate: '2026-11-01T00:00:00Z',
        },
      ],
    );
    expect(md).toContain('1. They raised $100M. [1]');
    expect(md).toContain('## Recent News');
    expect(md).toContain('[1] [Acme raises $100M](https://news.example/1)');
    expect(md).toContain('## Likely Tech Stack');
    expect(md).toContain('- [S1] **React** (Frontend, high confidence)');
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

  it('collapses embedded newlines in brief text so content cannot break out as structure', () => {
    const hostile: Brief = {
      ...BRIEF,
      overview: 'Real overview.\n\n## Injected heading',
      talkingPoints: [
        { point: 'A point.\n- injected list item', sourceRefs: [], stackRefs: [], basis: 'news' },
      ],
    };
    const md = briefToMarkdown('Acme', 'https://acme.com/', hostile, [], []);
    // The hostile text survives as literal text, but no LINE of
    // the export may begin with the injected structure.
    const lines = md.split('\n');
    expect(lines.some((l) => l.startsWith('## Injected heading'))).toBe(false);
    expect(lines.some((l) => l.startsWith('- injected list item'))).toBe(false);
    expect(md).toContain('Real overview. ## Injected heading');
    expect(md).toContain('1. A point. - injected list item');
  });

  it('keeps marker-leading point text contained by the numbered-item prefix', () => {
    const hostile: Brief = {
      ...BRIEF,
      talkingPoints: [
        { point: '# Heading-like', sourceRefs: [], stackRefs: [], basis: 'news' },
        { point: '> Quote-like', sourceRefs: [], stackRefs: [], basis: 'news' },
      ],
    };
    const md = briefToMarkdown('Acme', 'https://acme.com/', hostile, [], []);
    // The '1. ' / '2. ' prefixes keep the markers mid-line, so
    // they render as literal text, not as document structure.
    expect(md).toContain('1. # Heading-like');
    expect(md).toContain('2. > Quote-like');
    expect(md.split('\n').filter((l) => l.startsWith('# Heading-like'))).toHaveLength(0);
  });

  it('escapes brackets in news titles so link syntax cannot break out', () => {
    const md = briefToMarkdown(
      'Acme',
      'https://acme.com/',
      BRIEF,
      [],
      [
        {
          title: 'Big news ](https://evil.example) more',
          link: 'https://news.example/1',
          pubDate: null,
          source: 'TC',
        },
      ],
    );
    expect(md).toContain('[Big news \\](https://evil.example) more](https://news.example/1)');
    // The unescaped breakout — the title closing the link text
    // early and making evil.example the target — must not occur:
    expect(md).not.toContain('[Big news ](https://evil.example)');
  });
});
