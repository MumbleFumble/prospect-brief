import { describe, expect, it } from 'vitest';
import { suggestPersonas, STANDARD_PERSONAS } from './personas';
import { buildSequencePrompt, parseSequence, sequenceToTouches } from './sequences';
import { BriefSchema } from './brief';
import type { HiringSignals } from './hiring';

const hiring: HiringSignals = {
  board: 'greenhouse',
  boardToken: 'acme',
  totalRoles: 20,
  departments: [
    { name: 'Sales', count: 8 },
    { name: 'Engineering', count: 7 },
    { name: 'Customer Success', count: 5 },
  ],
  topRoles: [],
};

describe('suggestPersonas', () => {
  it('maps hiring departments to personas', () => {
    expect(suggestPersonas(hiring)).toEqual([
      'VP Sales',
      'CTO / VP Engineering',
      'Head of Customer Success',
    ]);
  });

  it('returns nothing without hiring data', () => {
    expect(suggestPersonas(null)).toEqual([]);
  });

  it('standard list is non-empty', () => {
    expect(STANDARD_PERSONAS.length).toBeGreaterThan(5);
  });
});

const brief = BriefSchema.parse({
  overview: 'A fintech platform.',
  talkingPoints: [
    { point: 'Raised Series C', whyItMatters: 'Budget', sourceRefs: [0], stackRefs: [], basis: 'news' },
  ],
});

describe('sequences', () => {
  it('prompt carries persona, cadence and the different-signal rule', () => {
    const prompt = buildSequencePrompt('Acme', 'VP Sales', brief, [], [], hiring, null);
    expect(prompt).toContain('VP Sales');
    expect(prompt).toContain('DIFFERENT signal');
    expect(prompt).toContain('dayOffset 4, linkedin');
    expect(prompt).toContain('NEVER write "just following up"');
  });

  it('parses a valid sequence and rejects malformed ones', () => {
    const raw = JSON.stringify({
      persona: 'VP Sales',
      touches: [
        { dayOffset: 1, kind: 'email', subject: 'S', body: 'B1', signal: 'Series C' },
        { dayOffset: 4, kind: 'linkedin', subject: null, body: 'B2', signal: 'Hiring' },
        { dayOffset: 9, kind: 'email', subject: 'S3', body: 'B3', signal: 'Stack' },
      ],
    });
    const seq = parseSequence(`noise ${raw} tail`);
    expect(seq.touches).toHaveLength(3);
    expect(() => parseSequence('{"persona":"x","touches":[]}')).toThrow();
  });

  it('converts to scheduled touch log entries', () => {
    const now = 1_000_000;
    const touches = sequenceToTouches(
      {
        persona: 'VP Sales',
        touches: [
          { dayOffset: 1, kind: 'email', subject: 'S', body: 'B1', signal: 'A' },
          { dayOffset: 4, kind: 'linkedin', subject: null, body: 'B2', signal: 'B' },
          { dayOffset: 9, kind: 'email', subject: 'S3', body: 'B3', signal: 'C' },
        ],
      },
      now,
    );
    expect(touches[0].scheduledFor).toBe(now);
    expect(touches[1].scheduledFor).toBe(now + 3 * 86_400_000);
    expect(touches[2].scheduledFor).toBe(now + 8 * 86_400_000);
    expect(touches.every((t) => t.sentAt === null && t.persona === 'VP Sales')).toBe(true);
  });
});
