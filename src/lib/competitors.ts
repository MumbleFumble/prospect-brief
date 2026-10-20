import type { Detection } from './types';

/**
 * Competitor detection: match the seller's competitor list against the
 * detected tech stack. If a prospect already runs a competitor, the
 * pitch becomes displacement, which the rep needs to know up front.
 */

export interface CompetitorMatch {
  /** The competitor name as the user entered it. */
  competitor: string;
  /** The detection that matched. */
  detection: Detection;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Match competitors against detections. A match occurs when the
 * normalized competitor name equals or is contained in the normalized
 * detection name (or vice versa), e.g. "Segment" matches "Segment",
 * "Google Analytics" matches "Google Analytics 4".
 */
export function findCompetitors(detections: Detection[], competitors: string[]): CompetitorMatch[] {
  const matches: CompetitorMatch[] = [];
  for (const raw of competitors) {
    const c = normalize(raw);
    if (!c) continue;
    for (const d of detections) {
      const dn = normalize(d.name);
      if (dn === c || dn.includes(c) || c.includes(dn)) {
        matches.push({ competitor: raw, detection: d });
        break;
      }
    }
  }
  return matches;
}
