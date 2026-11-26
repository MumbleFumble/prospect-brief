import type { AccountRecord } from './accounts';
import { briefSections } from './brief-sections';

/**
 * Saved-brief search (v0.8 step 2). Pure and testable; the
 * AccountsView renders what these functions return.
 *
 * Searchable text per account: the company name, the domain,
 * and the CURRENT brief's text — its overview plus the points
 * of every item section (talking points, risks, opportunities,
 * enumerated via the briefSections display model so legacy
 * payloads are read tolerantly). Deliberately NOT searched
 * (per the step's scope): notes, touches, news headlines,
 * detections, and hiring payloads.
 */
export function accountSearchText(account: AccountRecord): string {
  const parts: string[] = [account.company, account.domain];
  if (account.brief) {
    parts.push(account.brief.overview);
    for (const section of briefSections(account.brief)) {
      for (const item of section.items) parts.push(item.point);
    }
  }
  return parts.join('\n').toLowerCase();
}

/** Split a query into lowercase words; an empty list = no query. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Filter accounts by a query: case-insensitive substring
 * matching with AND semantics — EVERY word of a multi-word
 * query must appear somewhere in the entry's searchable text
 * (different words may match different fields). An
 * empty/whitespace query returns the input unchanged (identity:
 * the same array, in the same order).
 */
export function filterAccounts(accounts: AccountRecord[], query: string): AccountRecord[] {
  const words = queryWords(query);
  if (words.length === 0) return accounts;
  return accounts.filter((account) => {
    const text = accountSearchText(account);
    return words.every((word) => text.includes(word));
  });
}

/**
 * Newest first by the record's updatedAt — the timestamp
 * applySnapshot stamps whenever a brief lands (full generation
 * and per-section regeneration alike), so newest-first here is
 * newest-brief-first in practice, and it is the same field the
 * view's "Recently updated" sort already uses. Non-mutating.
 */
export function sortNewestFirst(accounts: AccountRecord[]): AccountRecord[] {
  return [...accounts].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * What the AccountsView renders: with a query active, the
 * matches ordered newest first (regardless of the view's sort
 * control); with no query, the input unchanged so the existing
 * sort behaviour applies exactly.
 */
export function searchAccounts(accounts: AccountRecord[], query: string): AccountRecord[] {
  if (queryWords(query).length === 0) return accounts;
  return sortNewestFirst(filterAccounts(accounts, query));
}
