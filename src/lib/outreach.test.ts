import { describe, expect, it } from 'vitest';
import { OutreachSchema, buildOutreachPrompt } from './outreach';
import type { Brief } from './brief';

const BRIEF: Brief = {
  overview: 'Acme builds payments infrastructure for online stores.',
  overviewRefs: [0],
  talkingPoints: [
    { point: 'They raised $100M.', sourceRefs: [0], stackRefs: [], basis: 'news' },
    { point: 'They are hiring 20 engineers.', sourceRefs: [], stackRefs: [], basis: 'hiring' },
  ],
};

describe('OutreachSchema', () => {
  it('accepts a valid draft', () => {
    const parsed = OutreachSchema.parse({
      signal: 'Series C raise',
      emailSubject: 'Congrats on the raise',
      emailBody: 'Saw the news. We help teams like yours. Worth a chat?',
      linkedInNote: 'Saw the raise news - congrats.',
    });
    expect(parsed.signal).toBe('Series C raise');
  });

  it('rejects LinkedIn notes over 300 chars', () => {
    expect(() =>
      OutreachSchema.parse({
        signal: 'x',
        emailSubject: 'x',
        emailBody: 'x',
        linkedInNote: 'x'.repeat(301),
      }),
    ).toThrow();
  });
});

describe('buildOutreachPrompt', () => {
  it('includes brief, hiring, and seller context', () => {
    const prompt = buildOutreachPrompt(
      'Acme',
      BRIEF,
      [{ name: 'Stripe', category: 'payments', confidence: 'high', evidence: ['x'] }],
      [{ title: 'Acme raises $100M', link: 'https://n/1', pubDate: null, source: 'TC' }],
      {
        board: 'greenhouse',
        boardToken: 'acme',
        totalRoles: 42,
        departments: [{ name: 'Engineering', count: 20 }],
        topRoles: [],
      },
      { whatYouSell: 'Payments analytics', idealCustomer: 'Fintechs', valueProps: ['See churn'] },
    );
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('42 open roles');
    expect(prompt).toContain('Payments analytics');
    expect(prompt).toContain('strongest signal');
  });

  it('handles missing seller and hiring gracefully', () => {
    const prompt = buildOutreachPrompt('Acme', BRIEF, [], [], null, null);
    expect(prompt).toContain('has not specified');
    expect(prompt).toContain('(none found)');
  });
});
