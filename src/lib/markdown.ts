import type { Brief } from './brief';
import type { Detection, NewsItem } from './types';

/**
 * Render a completed brief as Markdown for copy/paste (step 6).
 * Pure function — no DOM or Chrome APIs, easily testable.
 */
export function briefToMarkdown(
  company: string,
  url: string,
  brief: Brief,
  detections: Detection[],
  news: NewsItem[],
): string {
  const lines: string[] = [];
  lines.push(`# Prospect Brief: ${company}`, '');
  lines.push(`Source: ${url}`, '');
  lines.push('## Overview', '');
  lines.push(brief.overview, '');

  lines.push('## Talking Points', '');
  brief.talkingPoints.forEach((t, i) => {
    const refs = t.sourceRefs.map((r) => `[${r + 1}]`).join('');
    const srefs = (t.stackRefs ?? []).map((r) => `[S${r + 1}]`).join('');
    const basis = t.basis && t.basis !== 'news' ? ` _(${t.basis})_` : '';
    const allRefs = [refs, srefs].filter(Boolean).join(' ');
    lines.push(`${i + 1}. ${t.point}${allRefs ? ` ${allRefs}` : ''}${basis}`);
  });
  lines.push('');

  if (detections.length > 0) {
    lines.push('## Likely Tech Stack', '');
    detections.forEach((d, i) => {
      lines.push(`- [S${i + 1}] **${d.name}** (${d.category}, ${d.confidence} confidence)`);
      for (const e of d.evidence) lines.push(`  - \`${e}\``);
    });
    lines.push('');
  }

  if (news.length > 0) {
    lines.push('## Recent News', '');
    news.forEach((n, i) => {
      const date = n.pubDate ? ` — ${n.pubDate.slice(0, 10)}` : '';
      lines.push(`[${i + 1}] [${n.title}](${n.link}) (${n.source ?? 'unknown'}${date})`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
