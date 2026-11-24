import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Print-contract pin (inc-024): print rendering cannot be
 * exercised in a real print preview from the test suite, so the
 * @media print block in style.css is pinned by content — if a
 * rule the printed brief depends on is removed or renamed, this
 * test fails instead of the print view silently regressing.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8');
const printBlock = css.slice(css.indexOf('@media print'));

describe('sidepanel print stylesheet', () => {
  it('has an @media print block with @page margins', () => {
    expect(css).toContain('@media print');
    expect(printBlock).toContain('@page');
    expect(printBlock).toMatch(/@page\s*\{[^}]*margin:/);
  });

  it('hides screen-only chrome: .no-print and all buttons', () => {
    expect(printBlock).toMatch(/\.no-print\s*\{[^}]*display:\s*none\s*!important/);
    expect(printBlock).toMatch(/button\s*\{[^}]*display:\s*none\s*!important/);
  });

  it('protects headings and list items from awkward page splits', () => {
    expect(printBlock).toContain('break-after: avoid');
    expect(printBlock).toContain('break-inside: avoid');
  });

  it('is print-safe: white background, black text, no ink-heavy badge/pre backgrounds', () => {
    expect(printBlock).toMatch(/body\s*\{[^}]*background:\s*#fff/);
    expect(printBlock).toMatch(/body\s*\{[^}]*color:\s*#000/);
    expect(printBlock).toMatch(/\.badge,\s*pre\s*\{[^}]*background:\s*transparent\s*!important/);
  });

  it('retains URL expansion for http source links only', () => {
    expect(printBlock).toContain("a[href^='http']::after");
    expect(printBlock).toContain('attr(href)');
    expect(printBlock).not.toContain("a[href^='#']::after");
  });
});
