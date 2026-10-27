import { describe, expect, it } from 'vitest';
import { diffSnapshots } from './watch';
import type { SignalSnapshot } from './accounts';

function snap(partial: Partial<SignalSnapshot>): SignalSnapshot {
  return { takenAt: 2000, detections: [], news: [], hiring: null, detectionQuality: 'partial', ...partial };
}

const det = (name: string) => ({
  name,
  category: 'x',
  confidence: 'high' as const,
  evidence: ['e'],
});

describe('diffSnapshots', () => {
  it('detects tech additions and removals', () => {
    const prev = snap({ detections: [det('React'), det('jQuery')] });
    const next = snap({ detections: [det('React'), det('Next.js')] });
    const events = diffSnapshots(prev, next);
    expect(events.map((e) => e.kind)).toEqual(['new-tech', 'removed-tech']);
    expect(events[0].summary).toContain('Next.js');
    expect(events[1].summary).toContain('jQuery');
  });

  it('detects hiring growth, decline and new departments', () => {
    const prev = snap({
      hiring: { board: 'greenhouse', boardToken: 'a', totalRoles: 10, departments: [{ name: 'Sales', count: 5 }], topRoles: [] },
    });
    const next = snap({
      hiring: {
        board: 'greenhouse',
        boardToken: 'a',
        totalRoles: 15,
        departments: [
          { name: 'Sales', count: 6 },
          { name: 'Legal', count: 2 },
        ],
        topRoles: [],
      },
    });
    const events = diffSnapshots(prev, next);
    expect(events.some((e) => e.kind === 'hiring-up' && e.summary.includes('10 → 15'))).toBe(true);
    expect(events.some((e) => e.kind === 'new-department' && e.summary.includes('Legal'))).toBe(true);

    const down = diffSnapshots(next, prev);
    expect(down.some((e) => e.kind === 'hiring-down')).toBe(true);
  });

  it('ignores small hiring changes', () => {
    const prev = snap({
      hiring: { board: 'lever', boardToken: 'a', totalRoles: 10, departments: [], topRoles: [] },
    });
    const next = snap({
      hiring: { board: 'lever', boardToken: 'a', totalRoles: 11, departments: [], topRoles: [] },
    });
    expect(diffSnapshots(prev, next)).toEqual([]);
  });

  it('reports new headlines by link, capped', () => {
    const item = (n: number) => ({ title: `Story ${n}`, link: `https://x/${n}`, pubDate: null, source: null });
    const prev = snap({ news: [item(1)] });
    const next = snap({ news: [item(1), item(2), item(3), item(4), item(5)] });
    const events = diffSnapshots(prev, next).filter((e) => e.kind === 'news');
    expect(events).toHaveLength(3);
    expect(events[0].summary).toContain('Story 2');
  });

  it('reports hiring starting from nothing', () => {
    const next = snap({
      hiring: { board: 'ashby', boardToken: 'a', totalRoles: 6, departments: [], topRoles: [] },
    });
    const events = diffSnapshots(snap({}), next);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('Started hiring');
  });

  it('returns nothing for identical snapshots', () => {
    const s = snap({ detections: [det('React')] });
    expect(diffSnapshots(s, s)).toEqual([]);
  });
});
