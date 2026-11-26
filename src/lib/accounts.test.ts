import { describe, expect, it } from 'vitest';
import {
  MAX_SNAPSHOTS,
  accountToSavedBrief,
  addTouch,
  applySnapshot,
  emptyAccount,
  exportAccountsJson,
  latestSnapshot,
  markTouchSent,
  migrateSavedBrief,
  parseAccountsImport,
  setNotes,
  setStatus,
  type SignalSnapshot,
  type TouchLogEntry,
} from './accounts';
import { BriefSchema } from './brief';
import type { SavedBrief } from './saved';

const brief = BriefSchema.parse({
  overview: 'A payments company.',
  companySize: null,
  headquarters: null,
  founded: null,
  talkingPoints: [
    { point: 'They use Stripe', whyItMatters: 'Expansion signal', sourceRefs: [], stackRefs: [], basis: 'inference' },
  ],
  risks: [],
  sources: [],
});

function snap(takenAt: number): SignalSnapshot {
  return { takenAt, detections: [], news: [], hiring: null, detectionQuality: 'full' };
}

describe('account records', () => {
  it('creates an empty researching account', () => {
    const a = emptyAccount('stripe.com', 'Stripe', 'https://stripe.com', 1000);
    expect(a.status).toBe('researching');
    expect(a.snapshots).toEqual([]);
    expect(a.brief).toBeNull();
  });

  it('applies snapshots, newest last, capped', () => {
    let a = emptyAccount('x.com', 'X', 'https://x.com', 0);
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) a = applySnapshot(a, snap(i));
    expect(a.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(latestSnapshot(a)?.takenAt).toBe(MAX_SNAPSHOTS + 2);
    expect(a.snapshots[0].takenAt).toBe(3);
  });

  it('attaches a brief with its snapshot timestamp', () => {
    const a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(500), brief);
    expect(a.brief).toBe(brief);
    expect(a.briefGeneratedAt).toBe(500);
  });

  it('keeps the brief when a snapshot arrives without one', () => {
    let a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(100), brief);
    a = applySnapshot(a, snap(200));
    expect(a.brief).toBe(brief);
    expect(a.briefGeneratedAt).toBe(100);
  });

  it('updates status and notes', () => {
    const a = emptyAccount('x.com', 'X', 'https://x.com', 0);
    expect(setStatus(a, 'contacted', 10).status).toBe('contacted');
    expect(setNotes(a, 'Met at conference', 10).notes).toBe('Met at conference');
  });

  it('logs touches and marks them sent', () => {
    const touch: TouchLogEntry = {
      id: 't1',
      kind: 'email',
      persona: null,
      subject: 'Hi',
      body: 'Body',
      signal: 'Hiring',
      createdAt: 100,
      sentAt: null,
    };
    let a = addTouch(emptyAccount('x.com', 'X', 'https://x.com', 0), touch);
    expect(a.touches).toHaveLength(1);
    a = markTouchSent(a, 't1', 200);
    expect(a.touches[0].sentAt).toBe(200);
  });
});

describe('migration', () => {
  const saved: SavedBrief = {
    id: 'stripe.com:1000',
    company: 'Stripe',
    domain: 'stripe.com',
    url: 'https://stripe.com',
    brief,
    detections: [
      { name: 'React', category: 'framework', confidence: 'high', evidence: ['script src'] },
    ],
    news: [],
    hiring: null,
    savedAt: 1000,
  };

  it('converts a saved brief into an account with one snapshot', () => {
    const a = migrateSavedBrief(saved);
    expect(a.domain).toBe('stripe.com');
    expect(a.brief).toBe(brief);
    expect(a.snapshots).toHaveLength(1);
    expect(a.snapshots[0].detections).toHaveLength(1);
    expect(a.createdAt).toBe(1000);
  });

  it('round-trips an account back to a saved brief for export', () => {
    const back = accountToSavedBrief(migrateSavedBrief(saved));
    expect(back?.company).toBe('Stripe');
    expect(back?.detections).toHaveLength(1);
  });

  it('returns null for an account with no brief', () => {
    expect(accountToSavedBrief(emptyAccount('x.com', 'X', 'https://x.com', 0))).toBeNull();
  });
});

describe('export / import', () => {
  it('round-trips accounts through JSON', () => {
    const a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(1), brief);
    const parsed = parseAccountsImport(exportAccountsJson([a]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].domain).toBe('x.com');
  });

  it('rejects foreign files', () => {
    expect(() => parseAccountsImport('{"format":"other","accounts":[]}')).toThrow();
    expect(() => parseAccountsImport('{"format":"prospect-brief-accounts","accounts":[{}]}')).toThrow();
  });

  it('rejects a mixed valid/invalid file whole — named error, no records returned', () => {
    const a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(1), brief);
    const b = emptyAccount('y.com', 'Y', 'https://y.com', 0);
    const file = JSON.stringify({
      format: 'prospect-brief-accounts',
      version: 1,
      accounts: [a, { domain: 42, company: 'Broken' }, b],
    });
    // The throw IS the no-import guarantee: parseAccountsImport
    // returns nothing, and AccountsView parses fully before its
    // putAccount loop, so no write can happen for this file.
    expect(() => parseAccountsImport(file)).toThrowError(
      'invalid-account-record: 1 of 3 records in the import file failed validation (first at index 1). Nothing was imported.',
    );
  });

  it('parses a fully valid multi-record file exactly as before (same records, same order)', () => {
    const a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(1), brief);
    const b = emptyAccount('y.com', 'Y', 'https://y.com', 0);
    const parsed = parseAccountsImport(exportAccountsJson([a, b]));
    expect(parsed.map((r) => r.domain)).toEqual(['x.com', 'y.com']);
    expect(parsed).toEqual([a, b]);
  });

  it('keeps the zero-record error for an empty accounts array', () => {
    expect(() =>
      parseAccountsImport('{"format":"prospect-brief-accounts","accounts":[]}'),
    ).toThrowError('No valid account records in the file.');
  });

  it('round-trips hostile text verbatim through the JSON backup', () => {
    const hostile = emptyAccount('x.com', '<script>alert(1)</script>', 'https://x.com', 0);
    hostile.notes = 'Line one\nLine two, with "quotes" and =formula';
    const parsed = parseAccountsImport(exportAccountsJson([hostile]));
    // JSON.stringify escaping is the whole rule for this surface:
    // hostile strings come back byte-identical, never interpreted.
    expect(parsed).toEqual([hostile]);
    expect(parsed[0].company).toBe('<script>alert(1)</script>');
    expect(parsed[0].notes).toBe('Line one\nLine two, with "quotes" and =formula');
  });

  it('exports a backup containing no API key or settings keys (pinned)', () => {
    const a = applySnapshot(emptyAccount('x.com', 'X', 'https://x.com', 0), snap(1), brief);
    const json = exportAccountsJson([a]);
    // Settings live in settings.ts (chrome.storage.local keys
    // apiKey/model/sellerProfile) and must never leak into a
    // backup file. If the export shape ever grows a settings
    // field, this test must fail.
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('sellerProfile');
    expect(json).not.toContain('"model"');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['accounts', 'format', 'version']);
  });
});
