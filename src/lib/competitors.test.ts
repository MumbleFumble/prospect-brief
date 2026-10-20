import { describe, expect, it } from 'vitest';
import { findCompetitors } from './competitors';
import type { Detection } from './types';

const DETECTIONS: Detection[] = [
  { name: 'Segment', category: 'analytics', confidence: 'high', evidence: ['cdn.segment.com'] },
  { name: 'Google Analytics 4', category: 'analytics', confidence: 'high', evidence: ['gtag'] },
  { name: 'Stripe', category: 'payments', confidence: 'medium', evidence: ['js.stripe.com'] },
];

describe('findCompetitors', () => {
  it('matches exact names case-insensitively', () => {
    const m = findCompetitors(DETECTIONS, ['segment']);
    expect(m).toHaveLength(1);
    expect(m[0].detection.name).toBe('Segment');
  });

  it('matches partial names (Google Analytics -> GA4)', () => {
    const m = findCompetitors(DETECTIONS, ['Google Analytics']);
    expect(m).toHaveLength(1);
    expect(m[0].detection.name).toBe('Google Analytics 4');
  });

  it('returns empty when no competitor is detected', () => {
    expect(findCompetitors(DETECTIONS, ['HubSpot', 'Salesforce'])).toEqual([]);
  });

  it('ignores blank competitor entries', () => {
    expect(findCompetitors(DETECTIONS, ['', '  '])).toEqual([]);
  });
});
