import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, icpKeywords, scoreAccount } from './scoring';
import { applySnapshot, emptyAccount, setStatus, type SignalSnapshot } from './accounts';
import { BriefSchema } from './brief';
import type { SellerProfile } from './settings';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 86_400_000;

const brief = BriefSchema.parse({
  overview: 'A fintech platform for mid-market finance teams.',
  companySize: '201-500 employees',
  headquarters: null,
  founded: null,
  talkingPoints: [
    { point: 'p', whyItMatters: 'w', sourceRefs: [], stackRefs: [], basis: 'inference' },
  ],
  risks: [],
  sources: [],
});

const profile: SellerProfile = {
  whatYouSell: 'Revenue analytics',
  idealCustomer: 'Mid-market fintech companies',
  valueProps: [],
  competitors: ['Salesforce'],
};

function snap(partial: Partial<SignalSnapshot>): SignalSnapshot {
  return {
    takenAt: NOW - DAY,
    detections: [],
    news: [],
    hiring: null,
    detectionQuality: 'full',
    ...partial,
  };
}

describe('scoreAccount', () => {
  it('scores competitor, hiring and fresh news with a breakdown', () => {
    const account = applySnapshot(
      emptyAccount('acme.com', 'Acme', 'https://acme.com', NOW - 30 * DAY),
      snap({
        detections: [
          { name: 'Salesforce', category: 'crm', confidence: 'high', evidence: ['script'] },
        ],
        hiring: { board: 'greenhouse', boardToken: 'acme', totalRoles: 12, departments: [], topRoles: [] },
        news: [{ title: 'Acme raises', link: 'https://x', pubDate: new Date(NOW - 2 * DAY).toUTCString(), source: null }],
      }),
      brief,
    );
    const score = scoreAccount(account, profile, DEFAULT_WEIGHTS, NOW);
    const labels = score.components.map((c) => c.label).join(' | ');
    expect(labels).toContain('Competitor in use: Salesforce');
    expect(labels).toContain('Hiring volume');
    expect(labels).toContain('News within');
    // 3 competitor + 1 hiring + 2 volume + 2 fresh + 2 ICP keywords = 10
    expect(score.total).toBe(10);
  });

  it('rewards hiring growth across snapshots', () => {
    let account = applySnapshot(
      emptyAccount('a.com', 'A', 'https://a.com', NOW - 20 * DAY),
      snap({ hiring: { board: 'lever', boardToken: 'a', totalRoles: 4, departments: [], topRoles: [] } }),
    );
    account = applySnapshot(
      account,
      snap({ hiring: { board: 'lever', boardToken: 'a', totalRoles: 9, departments: [], topRoles: [] } }),
    );
    const score = scoreAccount(account, null, DEFAULT_WEIGHTS, NOW);
    expect(score.components.some((c) => c.label.includes('Hiring grew by 5'))).toBe(true);
  });

  it('penalizes stale news', () => {
    const account = applySnapshot(
      emptyAccount('a.com', 'A', 'https://a.com', NOW - 200 * DAY),
      snap({
        news: [{ title: 'Old', link: 'https://x', pubDate: new Date(NOW - 120 * DAY).toUTCString(), source: null }],
      }),
    );
    const score = scoreAccount(account, null, DEFAULT_WEIGHTS, NOW);
    expect(score.total).toBe(-1);
  });

  it('zeroes disqualified accounts', () => {
    const account = setStatus(
      applySnapshot(emptyAccount('a.com', 'A', 'https://a.com', NOW), snap({})),
      'disqualified',
      NOW,
    );
    expect(scoreAccount(account, profile, DEFAULT_WEIGHTS, NOW).total).toBe(0);
  });

  it('handles unresearched accounts', () => {
    const score = scoreAccount(emptyAccount('a.com', 'A', 'https://a.com', NOW), null, DEFAULT_WEIGHTS, NOW);
    expect(score.total).toBe(0);
    expect(score.components[0].label).toContain('Not researched');
  });
});

describe('helpers', () => {
  it('extracts ICP keywords without stopwords', () => {
    const kws = icpKeywords('Mid-market fintech companies that need revenue tools');
    expect(kws).toContain('fintech');
    expect(kws).not.toContain('companies');
    expect(kws).not.toContain('that');
  });


});
