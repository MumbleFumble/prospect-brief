import type { Brief } from './brief';
import { briefSections, type BriefItem } from './brief-sections';
import type { Detection, NewsItem } from './types';

const SECTION_HEADING: Record<string, string> = {
  talkingPoints: 'Talking Points',
  risks: 'Risks',
  opportunities: 'Opportunities',
};

function itemLine(item: BriefItem, index: number, defaultBasis: BriefItem['basis']): string {
  const refs = item.sourceRefs.map((r) => `[${r + 1}]`).join('');
  const srefs = (item.stackRefs ?? []).map((r) => `[S${r + 1}]`).join('');
  const basis = item.basis && item.basis !== defaultBasis ? ` _(${item.basis})_` : '';
  const allRefs = [refs, srefs].filter(Boolean).join(' ');
  return `${index + 1}. ${item.point}${allRefs ? ` ${allRefs}` : ''}${basis}`;
}

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

  // Item sections come from the shared display model
  // (brief-sections.ts) — the same sections, order and omission
  // rule the sidepanel brief view renders.
  for (const section of briefSections(brief)) {
    lines.push(`## ${SECTION_HEADING[section.key]}`, '');
    section.items.forEach((item, i) => {
      lines.push(itemLine(item, i, section.defaultBasis));
    });
    lines.push('');
  }

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
