import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Privacy-docs pin (inc-027): the privacy policy must keep
 * naming every external destination the code sends data to and
 * every export format the code offers. The enumerations below
 * are derived from the code's fetch call sites and export
 * functions (listed in the inc-027 report); this test fails if
 * a doc edit drops one, or if a named export function disappears
 * from the code. Adding a NEW destination or format still
 * requires updating the enumeration — the test pins the docs to
 * the enumeration, and the helper's negative control below
 * proves the assertions bite.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const policy = read('docs/privacy-policy.md');
const policyHtml = read('privacy/index.html');
const storeListing = read('docs/store-listing.md');

/** External destinations the code sends data to (fetch call sites). */
const DESTINATION_HOSTS = [
  'api.anthropic.com',
  'news.google.com',
  'boards-api.greenhouse.io',
  'api.lever.co',
  'api.ashbyhq.com',
];

/** Export formats the code offers, and the function proving each exists. */
const EXPORT_FORMATS: { term: string; codeFile: string; codeSymbol: string }[] = [
  { term: 'JSON', codeFile: 'src/lib/accounts.ts', codeSymbol: 'exportAccountsJson' },
  { term: 'CSV', codeFile: 'src/lib/export.ts', codeSymbol: 'savedBriefsToCsv' },
  { term: 'Markdown', codeFile: 'src/lib/markdown.ts', codeSymbol: 'briefToMarkdown' },
  { term: 'CRM note', codeFile: 'src/lib/export.ts', codeSymbol: 'briefToCrmNote' },
];

function missingTerms(doc: string, terms: string[]): string[] {
  return terms.filter((t) => !doc.includes(t));
}

describe('privacy policy vs actual data flows', () => {
  it('names every external destination host', () => {
    expect(missingTerms(policy, DESTINATION_HOSTS)).toEqual([]);
    expect(missingTerms(policyHtml, DESTINATION_HOSTS)).toEqual([]);
  });

  it('covers every export format the code offers, on all three doc surfaces', () => {
    const terms = EXPORT_FORMATS.map((f) => f.term);
    expect(missingTerms(policy, terms)).toEqual([]);
    expect(missingTerms(policyHtml, terms)).toEqual([]);
    expect(missingTerms(storeListing, terms)).toEqual([]);
  });

  it('each named export format is backed by a real export function in the code', () => {
    for (const f of EXPORT_FORMATS) {
      expect(read(f.codeFile)).toContain(f.codeSymbol);
    }
  });

  it('states that exports contain no API key or settings', () => {
    expect(policy).toContain('none of them contains your API key');
    expect(policyHtml).toContain('none of them contains your API key');
  });

  it('negative control: the assertions bite on a redacted policy', () => {
    const redacted = policy.replaceAll('api.ashbyhq.com', '').replaceAll('CSV', '');
    expect(missingTerms(redacted, DESTINATION_HOSTS)).toEqual(['api.ashbyhq.com']);
    expect(missingTerms(redacted, EXPORT_FORMATS.map((f) => f.term))).toEqual(['CSV']);
  });
});
