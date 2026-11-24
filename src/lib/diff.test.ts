import { describe, expect, it } from 'vitest';
import type { Brief } from './brief';
import {
  diffAgainstSavedBrief,
  diffBriefs,
  formatBriefChange,
  hasChanges,
  type BriefChange,
  type ItemSection,
} from './diff';

type Basis = Brief['talkingPoints'][number]['basis'];

interface ItemSpec {
  point: string;
  sourceRefs?: number[];
  stackRefs?: number[];
  basis?: Basis;
}

function item(spec: ItemSpec): Brief['talkingPoints'][number] {
  return {
    point: spec.point,
    sourceRefs: spec.sourceRefs ?? [],
    stackRefs: spec.stackRefs ?? [],
    basis: spec.basis ?? 'news',
  };
}

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    schemaVersion: 2,
    overview: 'Acme builds payments infrastructure.',
    overviewRefs: [0],
    overviewStackRefs: [],
    overviewBasis: 'site',
    talkingPoints: [item({ point: 'They raised $100M.', sourceRefs: [0] })],
    risks: [],
    opportunities: [],
    ...overrides,
  };
}

const SECTIONS: ItemSection[] = ['talkingPoints', 'risks', 'opportunities'];

describe('diffBriefs', () => {
  it('identical briefs produce no changes', () => {
    const a = brief({
      risks: [item({ point: 'A risk.', basis: 'inference' })],
      opportunities: [item({ point: 'An opening.' })],
    });
    const b = brief({
      risks: [item({ point: 'A risk.', basis: 'inference' })],
      opportunities: [item({ point: 'An opening.' })],
    });
    expect(diffBriefs(a, b)).toEqual([]);
    expect(hasChanges(diffBriefs(a, b))).toBe(false);
  });

  it('reports an overview-only change as its own entry carrying both texts', () => {
    const changes = diffBriefs(brief(), brief({ overview: 'Acme now also sells fraud tooling.' }));
    expect(changes).toEqual([
      {
        kind: 'overview-changed',
        section: 'overview',
        prevOverview: 'Acme builds payments infrastructure.',
        nextOverview: 'Acme now also sells fraud tooling.',
      },
    ]);
    expect(hasChanges(changes)).toBe(true);
  });

  for (const section of SECTIONS) {
    it(`reports an added item in ${section}`, () => {
      const prev = brief({ [section]: [item({ point: 'Existing.' })] });
      const next = brief({
        [section]: [item({ point: 'Existing.' }), item({ point: 'Brand new.' })],
      });
      expect(diffBriefs(prev, next)).toEqual([{ kind: 'added', section, point: 'Brand new.' }]);
    });

    it(`reports a removed item in ${section}`, () => {
      const prev = brief({
        [section]: [item({ point: 'Existing.' }), item({ point: 'Going away.' })],
      });
      const next = brief({ [section]: [item({ point: 'Existing.' })] });
      expect(diffBriefs(prev, next)).toEqual([{ kind: 'removed', section, point: 'Going away.' }]);
    });

    it(`reports a basis flip in ${section} as changed with fields [basis]`, () => {
      const prev = brief({ [section]: [item({ point: 'Same point.', basis: 'news' })] });
      const next = brief({ [section]: [item({ point: 'Same point.', basis: 'inference' })] });
      expect(diffBriefs(prev, next)).toEqual([
        { kind: 'changed', section, point: 'Same point.', fields: ['basis'] },
      ]);
    });

    it(`reports a refs change in ${section} as changed naming the ref fields`, () => {
      const prev = brief({
        [section]: [item({ point: 'Same point.', sourceRefs: [0], stackRefs: [] })],
      });
      const next = brief({
        [section]: [item({ point: 'Same point.', sourceRefs: [0, 1], stackRefs: [2] })],
      });
      expect(diffBriefs(prev, next)).toEqual([
        { kind: 'changed', section, point: 'Same point.', fields: ['sourceRefs', 'stackRefs'] },
      ]);
    });
  }

  it('counts a point whose text changed as removed+added, not changed', () => {
    const prev = brief({ talkingPoints: [item({ point: 'Old wording.' })] });
    const next = brief({ talkingPoints: [item({ point: 'New wording.' })] });
    expect(diffBriefs(prev, next)).toEqual([
      { kind: 'added', section: 'talkingPoints', point: 'New wording.' },
      { kind: 'removed', section: 'talkingPoints', point: 'Old wording.' },
    ]);
  });

  it('diffs a legacy payload with no risks/opportunities keys against a populated one', () => {
    // Pre-v0.5 stored shape: the two section keys are absent entirely.
    const legacy = {
      schemaVersion: 1,
      overview: 'Acme builds payments infrastructure.',
      overviewRefs: [0],
      overviewStackRefs: [],
      overviewBasis: 'site',
      talkingPoints: [item({ point: 'They raised $100M.', sourceRefs: [0] })],
    } as unknown as Brief;
    const populated = brief({
      risks: [item({ point: 'A risk.', basis: 'inference' })],
      opportunities: [item({ point: 'An opening.' })],
    });
    expect(() => diffBriefs(legacy, populated)).not.toThrow();
    expect(diffBriefs(legacy, populated)).toEqual([
      { kind: 'added', section: 'risks', point: 'A risk.' },
      { kind: 'added', section: 'opportunities', point: 'An opening.' },
    ]);
    // And the reverse direction reports them removed.
    expect(diffBriefs(populated, legacy)).toEqual([
      { kind: 'removed', section: 'risks', point: 'A risk.' },
      { kind: 'removed', section: 'opportunities', point: 'An opening.' },
    ]);
  });

  it('orders a multi-section diff deterministically: overview, sections in order, added/changed (next order) before removed (prev order)', () => {
    const prev = brief({
      overview: 'Old overview.',
      talkingPoints: [
        item({ point: 'TP removed.' }),
        item({ point: 'TP changed.', basis: 'news' }),
        item({ point: 'TP kept.' }),
      ],
      risks: [item({ point: 'Risk removed.', basis: 'inference' })],
      opportunities: [],
    });
    const next = brief({
      overview: 'New overview.',
      talkingPoints: [
        item({ point: 'TP added.' }),
        item({ point: 'TP changed.', basis: 'stack', stackRefs: [0] }),
        item({ point: 'TP kept.' }),
      ],
      risks: [],
      opportunities: [item({ point: 'Opp added.' })],
    });
    expect(diffBriefs(prev, next)).toEqual([
      {
        kind: 'overview-changed',
        section: 'overview',
        prevOverview: 'Old overview.',
        nextOverview: 'New overview.',
      },
      { kind: 'added', section: 'talkingPoints', point: 'TP added.' },
      {
        kind: 'changed',
        section: 'talkingPoints',
        point: 'TP changed.',
        fields: ['stackRefs', 'basis'],
      },
      { kind: 'removed', section: 'talkingPoints', point: 'TP removed.' },
      { kind: 'removed', section: 'risks', point: 'Risk removed.' },
      { kind: 'added', section: 'opportunities', point: 'Opp added.' },
    ]);
    // Same inputs, same output, every time.
    expect(diffBriefs(prev, next)).toEqual(diffBriefs(prev, next));
  });
});

describe('diffAgainstSavedBrief', () => {
  const savedEntry = (domain: string, b: Brief) => ({ domain, brief: b });

  it('returns null when the domain has no saved brief (first generation)', async () => {
    const listSaved = async () => [savedEntry('other.com', brief())];
    await expect(diffAgainstSavedBrief('acme.com', brief(), listSaved)).resolves.toBeNull();
    const emptySource = async () => [] as { domain: string; brief: Brief }[];
    await expect(diffAgainstSavedBrief('acme.com', brief(), emptySource)).resolves.toBeNull();
  });

  it('diffs the fresh brief against the saved entry for the domain', async () => {
    const prev = brief();
    const next = brief({
      overview: 'A new overview.',
      risks: [item({ point: 'A risk.', basis: 'inference' })],
    });
    const listSaved = async () => [savedEntry('other.com', brief()), savedEntry('acme.com', prev)];
    const changes = await diffAgainstSavedBrief('acme.com', next, listSaved);
    expect(changes).toEqual(diffBriefs(prev, next));
    expect(changes).toHaveLength(2);
  });

  it('returns an empty list when the fresh brief is identical to the saved one', async () => {
    const listSaved = async () => [savedEntry('acme.com', brief())];
    await expect(diffAgainstSavedBrief('acme.com', brief(), listSaved)).resolves.toEqual([]);
  });
});

describe('formatBriefChange', () => {
  it('formats an overview change', () => {
    const change: BriefChange = {
      kind: 'overview-changed',
      section: 'overview',
      prevOverview: 'Old.',
      nextOverview: 'New.',
    };
    expect(formatBriefChange(change)).toBe('Overview changed');
  });

  it('formats added and removed with the section label and point text', () => {
    expect(formatBriefChange({ kind: 'added', section: 'risks', point: 'A risk.' })).toBe(
      'Added (Risks): A risk.',
    );
    expect(
      formatBriefChange({ kind: 'removed', section: 'talkingPoints', point: 'Old point.' }),
    ).toBe('Removed (Talking points): Old point.');
    expect(formatBriefChange({ kind: 'added', section: 'opportunities', point: 'An opening.' })).toBe(
      'Added (Opportunities): An opening.',
    );
  });

  it('formats changed with each field subset named', () => {
    const base = { kind: 'changed', section: 'talkingPoints', point: 'Same point.' } as const;
    expect(formatBriefChange({ ...base, fields: ['basis'] })).toBe(
      'Changed (Talking points): Same point. — basis changed',
    );
    expect(formatBriefChange({ ...base, fields: ['sourceRefs'] })).toBe(
      'Changed (Talking points): Same point. — source refs changed',
    );
    expect(formatBriefChange({ ...base, fields: ['stackRefs'] })).toBe(
      'Changed (Talking points): Same point. — stack refs changed',
    );
    expect(formatBriefChange({ ...base, fields: ['sourceRefs', 'stackRefs', 'basis'] })).toBe(
      'Changed (Talking points): Same point. — source refs, stack refs, basis changed',
    );
  });
});
