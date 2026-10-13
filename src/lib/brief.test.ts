import { describe, expect, it } from 'vitest';
import { BriefSchema } from './brief';

describe('BriefSchema', () => {
  it('accepts a valid brief', () => {
    const raw = {
      overview: 'Acme builds payments infrastructure.',
      talkingPoints: [{ point: 'They raised $100M.', sourceRefs: [0] }],
    };
    const parsed = BriefSchema.parse(raw);
    expect(parsed.overview).toContain('Acme');
    expect(parsed.talkingPoints).toHaveLength(1);
  });

  it('rejects missing overview', () => {
    expect(() => BriefSchema.parse({ talkingPoints: [{ point: 'x', sourceRefs: [] }] })).toThrow();
  });

  it('rejects empty talking points', () => {
    expect(() => BriefSchema.parse({ overview: 'x', talkingPoints: [] })).toThrow();
  });

  it('rejects talking point without sourceRefs', () => {
    expect(() => BriefSchema.parse({ overview: 'x', talkingPoints: [{ point: 'x' }] })).toThrow();
  });

  it('rejects non-integer sourceRefs', () => {
    expect(() =>
      BriefSchema.parse({ overview: 'x', talkingPoints: [{ point: 'x', sourceRefs: [1.5] }] }),
    ).toThrow();
  });
});
