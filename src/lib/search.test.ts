import { describe, expect, it } from 'vitest';
import { emptyAccount, type AccountRecord } from './accounts';
import type { Brief } from './brief';
import { filterAccounts, searchAccounts, sortNewestFirst } from './search';

function briefWith(overrides: Partial<Brief>): Brief {
  return {
    schemaVersion: 2,
    overview: 'Default overview.',
    overviewRefs: [],
    overviewStackRefs: [],
    overviewBasis: 'site',
    talkingPoints: [{ point: 'Default point.', sourceRefs: [], stackRefs: [], basis: 'news' }],
    risks: [],
    opportunities: [],
    ...overrides,
  };
}

function account(domain: string, company: string, brief: Brief | null, updatedAt: number) {
  const a = emptyAccount(domain, company, `https://${domain}/`, updatedAt);
  a.brief = brief;
  a.briefGeneratedAt = brief ? updatedAt : null;
  return a;
}

const ACCOUNTS: AccountRecord[] = [
  account(
    'acme.com',
    'Acme Corp',
    briefWith({
      overview: 'Acme builds payments infrastructure for marketplaces.',
      talkingPoints: [{ point: 'They raised $100M in March.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
      risks: [{ point: 'Hiring freeze reported.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
      opportunities: [
        { point: 'Expanding into Europe.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
      ],
    }),
    1000,
  ),
  account(
    'globex.io',
    'Globex',
    briefWith({
      overview: 'Globex sells logistics software.',
      talkingPoints: [{ point: 'New CEO appointed.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
    }),
    3000,
  ),
  account('initech.com', 'Initech', null, 2000),
];

describe('filterAccounts', () => {
  it('matches the company name case-insensitively', () => {
    expect(filterAccounts(ACCOUNTS, 'ACME').map((a) => a.domain)).toEqual(['acme.com']);
    expect(filterAccounts(ACCOUNTS, 'globex').map((a) => a.domain)).toEqual(['globex.io']);
  });

  it('matches the domain', () => {
    expect(filterAccounts(ACCOUNTS, 'initech.com').map((a) => a.domain)).toEqual(['initech.com']);
    expect(filterAccounts(ACCOUNTS, 'IO').map((a) => a.domain)).toEqual(['globex.io']);
  });

  it('matches overview text', () => {
    expect(filterAccounts(ACCOUNTS, 'logistics').map((a) => a.domain)).toEqual(['globex.io']);
    expect(filterAccounts(ACCOUNTS, 'payments infrastructure').map((a) => a.domain)).toEqual([
      'acme.com',
    ]);
  });

  it('matches section points — talking points, risks, and opportunities', () => {
    expect(filterAccounts(ACCOUNTS, 'raised $100m').map((a) => a.domain)).toEqual(['acme.com']);
    expect(filterAccounts(ACCOUNTS, 'hiring freeze').map((a) => a.domain)).toEqual(['acme.com']);
    expect(filterAccounts(ACCOUNTS, 'expanding into europe').map((a) => a.domain)).toEqual([
      'acme.com',
    ]);
    expect(filterAccounts(ACCOUNTS, 'new ceo').map((a) => a.domain)).toEqual(['globex.io']);
  });

  it('multi-word queries use AND semantics across fields', () => {
    // 'acme' matches the company, 'freeze' matches a risk point:
    // different words may land in different fields of one entry.
    expect(filterAccounts(ACCOUNTS, 'acme freeze').map((a) => a.domain)).toEqual(['acme.com']);
    // Both words exist in the corpus but never in one entry:
    expect(filterAccounts(ACCOUNTS, 'acme logistics')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterAccounts(ACCOUNTS, 'nonexistent')).toEqual([]);
  });

  it('an empty or whitespace query is the identity (same array, same order)', () => {
    expect(filterAccounts(ACCOUNTS, '')).toBe(ACCOUNTS);
    expect(filterAccounts(ACCOUNTS, '   ')).toBe(ACCOUNTS);
  });

  it('does not search notes or other out-of-scope fields', () => {
    const withNote = structuredClone(ACCOUNTS);
    withNote[2].notes = 'Ask about the payments roadmap';
    expect(filterAccounts(withNote, 'payments roadmap')).toEqual([]);
  });
});

describe('searchAccounts ordering', () => {
  it('with a query active, matches come back newest first by updatedAt', () => {
    // 'e' appears in every entry's text; input order is
    // acme(1000), globex(3000), initech(2000) — newest first
    // must be globex, initech, acme.
    expect(searchAccounts(ACCOUNTS, 'e').map((a) => a.domain)).toEqual([
      'globex.io',
      'initech.com',
      'acme.com',
    ]);
  });

  it('sortNewestFirst does not mutate its input', () => {
    const input = [...ACCOUNTS];
    sortNewestFirst(input);
    expect(input.map((a) => a.domain)).toEqual(['acme.com', 'globex.io', 'initech.com']);
  });

  it('with no query, searchAccounts is the identity (existing sort behaviour preserved)', () => {
    expect(searchAccounts(ACCOUNTS, '')).toBe(ACCOUNTS);
    expect(searchAccounts(ACCOUNTS, '  ')).toBe(ACCOUNTS);
  });
});
