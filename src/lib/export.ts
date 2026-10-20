import type { SavedBrief } from './saved';

/**
 * Export helpers: CRM note format and CSV.
 * Pure functions — easily testable.
 */

/**
 * Format a brief as a plain-text CRM activity note, suitable for
 * pasting into HubSpot, Salesforce, Pipedrive, etc.
 */
export function briefToCrmNote(s: SavedBrief): string {
  const lines: string[] = [];
  const date = new Date(s.savedAt).toISOString().slice(0, 10);
  lines.push(`Prospect Brief - ${s.company} (${date})`);
  lines.push(`Website: ${s.url}`);
  lines.push('');
  lines.push(`Overview: ${s.brief.overview}`);
  lines.push('');
  if (s.brief.talkingPoints.length > 0) {
    lines.push('Talking points:');
    s.brief.talkingPoints.forEach((t, i) => {
      lines.push(`${i + 1}. [${t.basis}] ${t.point}`);
    });
    lines.push('');
  }
  if (s.detections.length > 0) {
    lines.push(`Tech stack: ${s.detections.map((d) => `${d.name} (${d.confidence})`).join(', ')}`);
  }
  if (s.hiring) {
    lines.push(
      `Hiring: ${s.hiring.totalRoles} open roles (${s.hiring.board}); top: ${s.hiring.departments
        .slice(0, 3)
        .map((d) => `${d.name} (${d.count})`)
        .join(', ')}`,
    );
  }
  if (s.news.length > 0) {
    lines.push(`Latest news: ${s.news[0].title}`);
  }
  return lines.join('\n');
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Export saved briefs as CSV (one row per brief). */
export function savedBriefsToCsv(list: SavedBrief[]): string {
  const header = 'Company,Domain,URL,Date,Overview,Top Talking Point,Open Roles,Tech Stack';
  const rows = list.map((s) =>
    [
      s.company,
      s.domain,
      s.url,
      new Date(s.savedAt).toISOString().slice(0, 10),
      s.brief.overview,
      s.brief.talkingPoints[0]?.point ?? '',
      s.hiring ? String(s.hiring.totalRoles) : '',
      s.detections.map((d) => d.name).join('; '),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...rows].join('\n');
}
