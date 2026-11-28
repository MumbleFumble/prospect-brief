import { describe, expect, it } from 'vitest';
import type { Brief } from './brief';
import {
  briefSections,
  briefSectionsForDisplay,
  itemSources,
  resolveSourceRefs,
  resolveStackRefs,
} from './brief-sections';
import type { Detection, NewsItem } from './types';

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

describe('briefSectionsForDisplay (inc-035: empty sections keep their block)', () => {
  it('an empty risks section is present in the display model with no items', () => {
    const sections = briefSectionsForDisplay(brief());
    const risks = sections.find((s) => s.key === 'risks');
    expect(risks).toBeDefined();
    expect(risks?.items).toEqual([]);
    expect(risks?.defaultBasis).toBe('inference');
  });

  it('an empty opportunities section is present in the display model with no items', () => {
    const sections = briefSectionsForDisplay(brief());
    const opportunities = sections.find((s) => s.key === 'opportunities');
    expect(opportunities).toBeDefined();
    expect(opportunities?.items).toEqual([]);
    expect(opportunities?.defaultBasis).toBe('news');
  });

  it('all three sections are always present, in display order', () => {
    expect(briefSectionsForDisplay(brief()).map((s) => s.key)).toEqual([
      'talkingPoints',
      'risks',
      'opportunities',
    ]);
    // Even a legacy payload missing the newer keys gets all
    // three blocks (the missing sections read as empty).
    const legacy = {
      schemaVersion: 1,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [],
      overviewStackRefs: [],
      overviewBasis: 'site',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
    } as unknown as Brief;
    expect(briefSectionsForDisplay(legacy).map((s) => s.key)).toEqual([
      'talkingPoints',
      'risks',
      'opportunities',
    ]);
  });

  it('non-empty sections are carried unchanged (same items, same bases as briefSections)', () => {
    const display = briefSectionsForDisplay(FULL);
    expect(display).toEqual(briefSections(FULL));
    expect(display[1].items[0].point).toBe('Hiring freeze reported.');
    expect(display[2].items[0].point).toBe('Expanding into Europe.');
  });
});

describe('visible sources (inc-037)', () => {
  const NEWS: NewsItem[] = [
    { title: 'Acme raises $100M', link: 'https://news.example/1', source: 'TechDaily', pubDate: null },
    { title: 'Acme expands into Europe', link: 'https://news.example/2', source: null, pubDate: null },
  ];
  const DETECTIONS: Detection[] = [
    { name: 'React', category: 'Frontend', confidence: 'high', evidence: [] },
  ];

  it('a resolved sourceRef carries the headline title and link', () => {
    expect(resolveSourceRefs([1], NEWS)).toEqual([
      { kind: 'news', index: 1, label: 'Acme expands into Europe', link: 'https://news.example/2', resolved: true },
    ]);
  });

  it('an unresolvable sourceRef is shown as an honest index label, never dropped', () => {
    expect(resolveSourceRefs([5], NEWS)).toEqual([
      { kind: 'news', index: 5, label: 'Headline 6', link: null, resolved: false },
    ]);
  });

  it('a resolved stackRef carries the detection name; an unresolvable one an index label', () => {
    expect(resolveStackRefs([0], DETECTIONS)).toEqual([
      { kind: 'tech', index: 0, label: 'React', link: null, resolved: true },
    ]);
    expect(resolveStackRefs([3], DETECTIONS)).toEqual([
      { kind: 'tech', index: 3, label: 'Detection 4', link: null, resolved: false },
    ]);
  });

  it('itemSources resolves both ref kinds in ref order', () => {
    const item = { point: 'P.', sourceRefs: [0, 9], stackRefs: [0, 2], basis: 'news' as const };
    const sources = itemSources(item, NEWS, DETECTIONS);
    expect(sources.news.map((s) => s.label)).toEqual(['Acme raises $100M', 'Headline 10']);
    expect(sources.tech.map((s) => s.label)).toEqual(['React', 'Detection 3']);
  });

  it('a point with empty refs resolves to no sources (renders no source line)', () => {
    const item = { point: 'P.', sourceRefs: [], stackRefs: [], basis: 'news' as const };
    expect(itemSources(item, NEWS, DETECTIONS)).toEqual({ news: [], tech: [] });
  });

  it('the overview refs resolve through the same functions', () => {
    // The overview renders resolveSourceRefs(overviewRefs) and
    // resolveStackRefs(overviewStackRefs) — the same resolvers
    // the item sections use, no overview-specific logic.
    expect(resolveSourceRefs(FULL.overviewRefs, NEWS)[0].label).toBe('Acme raises $100M');
    expect(resolveStackRefs(FULL.overviewStackRefs, DETECTIONS)).toEqual([]);
    expect(resolveStackRefs([0], DETECTIONS)[0].label).toBe('React');
  });
});
