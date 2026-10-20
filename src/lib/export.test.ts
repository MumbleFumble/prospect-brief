import { describe, expect, it } from 'vitest';
import { briefToCrmNote, savedBriefsToCsv } from './export';
import type { SavedBrief } from './saved';

const SAVED: SavedBrief = {
  id: 'acme.com:1',
  company: 'Acme',
  domain: 'acme.com',
  url: 'https://acme.com/',
  brief: {
    overview: 'Acme builds payments infrastructure.',
    overviewRefs: [0],
    talkingPoints: [
      { point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' },
      { point: 'Hiring 20 engineers.', sourceRefs: [], stackRefs: [], basis: 'hiring' },
    ],
  },
  detections: [{ name: 'Stripe', category: 'payments', confidence: 'high', evidence: ['x'] }],
  news: [{ title: 'Acme raises $100M', link: 'https://n/1', pubDate: null, source: 'TC' }],
  hiring: {
    board: 'greenhouse',
    boardToken: 'acme',
    totalRoles: 42,
    departments: [{ name: 'Engineering', count: 20 }],
    topRoles: [],
  },
  savedAt: Date.UTC(2026, 9, 20),
};

describe('briefToCrmNote', () => {
  it('renders a paste-ready CRM note', () => {
    const note = briefToCrmNote(SAVED);
    expect(note).toContain('Prospect Brief - Acme (2026-10-20)');
    expect(note).toContain('Overview: Acme builds payments infrastructure.');
    expect(note).toContain('1. [news] They raised $100M.');
    expect(note).toContain('2. [hiring] Hiring 20 engineers.');
    expect(note).toContain('Tech stack: Stripe (high)');
    expect(note).toContain('Hiring: 42 open roles (greenhouse)');
    expect(note).toContain('Latest news: Acme raises $100M');
  });
});

describe('savedBriefsToCsv', () => {
  it('renders header and one row per brief', () => {
    const csv = savedBriefsToCsv([SAVED]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Company,Domain,URL,Date');
    expect(lines[1]).toContain('Acme,acme.com,https://acme.com/,2026-10-20');
    expect(lines[1]).toContain('42');
    expect(lines[1]).toContain('Stripe');
  });

  it('escapes commas and quotes in fields', () => {
    const tricky: SavedBrief = {
      ...SAVED,
      company: 'Acme, Inc. "The Best"',
      brief: { ...SAVED.brief, overview: 'Has, commas' },
    };
    const csv = savedBriefsToCsv([tricky]);
    expect(csv).toContain('"Acme, Inc. ""The Best"""');
    expect(csv).toContain('"Has, commas"');
  });
});
