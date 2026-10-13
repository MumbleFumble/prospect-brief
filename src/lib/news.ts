import type { NewsItem } from './types';

/**
 * News provider interface (step 4).
 *
 * Swappable: implement NewsProvider with a different source (e.g. NewsAPI,
 * Bing News) without touching callers. The background uses the default
 * Google News RSS provider (no API key needed).
 */

export interface NewsProvider {
  readonly name: string;
  fetchNews(company: string, maxItems?: number): Promise<NewsItem[]>;
}

/**
 * Parse Google News RSS XML into NewsItems. Pure function — tested
 * with fixture XML, no network needed.
 */
export function parseGoogleNewsRss(xml: string, maxItems = 5): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('Invalid RSS XML');

  const items: NewsItem[] = [];
  const entries = doc.querySelectorAll('item');
  for (const entry of entries) {
    if (items.length >= maxItems) break;
    const text = (sel: string): string | null => {
      const el = entry.querySelector(sel);
      return el?.textContent?.trim() || null;
    };
    const title = text('title');
    const link = text('link');
    if (!title || !link) continue;
    const pubDateRaw = text('pubDate');
    let pubDate: string | null = null;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      if (!isNaN(d.getTime())) pubDate = d.toISOString();
    }
    items.push({ title, link, pubDate, source: text('source') });
  }
  return items;
}

export class GoogleNewsRssProvider implements NewsProvider {
  readonly name = 'google-news-rss';

  async fetchNews(company: string, maxItems = 5): Promise<NewsItem[]> {
    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(company) +
      '&hl=en-US&gl=US&ceid=US:en';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`News fetch failed: HTTP ${res.status}`);
    const xml = await res.text();
    return parseGoogleNewsRss(xml, maxItems);
  }
}

/**
 * Derive a news search query from page signals. Prefers the Open Graph
 * site name, falls back to the <title>, then the domain's first label.
 */
export function companyQueryFor(
  url: string,
  title: string,
  ogTags: Record<string, string>,
): string {
  const siteName = ogTags['og:site_name'];
  if (siteName) return siteName;
  // Title often looks like "Acme — Payments infrastructure"; take the lead.
  const lead = title.split(/[—|–|:]/)[0]?.trim();
  if (lead && lead.length >= 2 && lead.length <= 60) return lead;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0] ?? host;
  } catch {
    return url;
  }
}
