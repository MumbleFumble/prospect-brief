import { describe, expect, it } from 'vitest';
import type { Brief } from './brief';
import { briefSections } from './brief-sections';

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    schemaVersion: 2,
    overview: 'Acme builds payments infrastructure.',
    overviewRefs: [0],
    overviewStackRefs: [],
    overviewBasis: 'site',
    talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
    risks: [],
    opportunities: [],
    ...overrides,
  };
}

const FULL = brief({
  risks: [{ point: 'Hiring freeze reported.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
  opportunities: [{ point: 'Expanding into Europe.', sourceRefs: [], stackRefs: [0], basis: 'news' }],
});

describe('briefSections', () => {
  it('returns all three sections in display order with their items and default bases', () => {
    const sections = briefSections(FULL);
    expect(sections.map((s) => s.key)).toEqual(['talkingPoints', 'risks', 'opportunities']);
    expect(sections[0].defaultBasis).toBe('news');
    expect(sections[1].defaultBasis).toBe('inference');
    expect(sections[2].defaultBasis).toBe('news');
    expect(sections[1].items[0].point).toBe('Hiring freeze reported.');
    expect(sections[2].items[0].point).toBe('Expanding into Europe.');
  });

  it('omits empty sections — a brief with neither risks nor opportunities yields only talking points', () => {
    expect(briefSections(brief()).map((s) => s.key)).toEqual(['talkingPoints']);
  });

  it('treats a legacy payload with no risks/opportunities keys as empty sections', () => {
    const legacy = {
      schemaVersion: 1,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [],
      overviewStackRefs: [],
      overviewBasis: 'site',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
    } as unknown as Brief;
    expect(() => briefSections(legacy)).not.toThrow();
    expect(briefSections(legacy).map((s) => s.key)).toEqual(['talkingPoints']);
  });

  it('keeps a populated section even when the others are empty', () => {
    const only = brief({
      talkingPoints: [],
      risks: [{ point: 'Only a risk.', sourceRefs: [], stackRefs: [], basis: 'inference' }],
    });
    expect(briefSections(only).map((s) => s.key)).toEqual(['risks']);
  });
});
