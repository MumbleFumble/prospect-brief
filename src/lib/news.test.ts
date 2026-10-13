// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { companyQueryFor, parseGoogleNewsRss } from './news';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Acme - Google News</title>
<item>
<title>Acme raises $100M Series C - TechCrunch</title>
<link>https://news.google.com/articles/abc123</link>
<pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate>
<source url="https://techcrunch.com">TechCrunch</source>
</item>
<item>
<title>Acme launches new product - The Verge</title>
<link>https://news.google.com/articles/def456</link>
<pubDate>Sun, 11 Oct 2026 15:30:00 GMT</pubDate>
<source url="https://theverge.com">The Verge</source>
</item>
<item>
<title>Broken item with no link</title>
<pubDate>Sat, 10 Oct 2026 09:00:00 GMT</pubDate>
</item>
</channel>
</rss>`;

describe('parseGoogleNewsRss', () => {
  it('parses items with title, link, date, source', () => {
    const items = parseGoogleNewsRss(FIXTURE);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Acme raises $100M Series C - TechCrunch');
    expect(items[0].link).toBe('https://news.google.com/articles/abc123');
    expect(items[0].source).toBe('TechCrunch');
    expect(items[0].pubDate).toBe('2026-10-12T10:00:00.000Z');
  });

  it('skips items missing title or link', () => {
    const items = parseGoogleNewsRss(FIXTURE);
    expect(items.every((i) => i.title && i.link)).toBe(true);
  });

  it('respects maxItems', () => {
    expect(parseGoogleNewsRss(FIXTURE, 1)).toHaveLength(1);
  });

  it('throws on invalid XML', () => {
    expect(() => parseGoogleNewsRss('not xml at all <')).toThrow('Invalid RSS XML');
  });

  it('handles missing pubDate gracefully', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>T</title><link>https://x.com/</link></item>
    </channel></rss>`;
    const [item] = parseGoogleNewsRss(xml);
    expect(item.pubDate).toBeNull();
  });
});

describe('companyQueryFor', () => {
  it('prefers og:site_name', () => {
    expect(
      companyQueryFor('https://acme.com/', 'Acme — Home', { 'og:site_name': 'Acme Inc' }),
    ).toBe('Acme Inc');
  });

  it('falls back to title lead', () => {
    expect(companyQueryFor('https://acme.com/', 'Acme — Payments infrastructure', {})).toBe('Acme');
  });

  it('falls back to domain label', () => {
    expect(companyQueryFor('https://www.acme.io/pricing', '', {})).toBe('acme');
  });
});
