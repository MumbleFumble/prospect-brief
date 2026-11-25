/**
 * The brief's item sections as a display model (inc-025): the
 * single source both the sidepanel brief view and the Markdown
 * export render from, so screen and export can never drift —
 * same sections, same order, same omission rule. A section
 * appears only when it carries items; legacy payloads missing
 * the risks/opportunities keys (pre-v0.5 stored shape) are read
 * as empty and omitted, exactly as if the arrays were empty.
 */
import type { Brief } from './brief';

export type BriefItem = Brief['talkingPoints'][number];
type Basis = BriefItem['basis'];

export interface BriefSectionModel {
  key: 'talkingPoints' | 'risks' | 'opportunities';
  items: BriefItem[];
  /**
   * The section's schema-default basis. Both surfaces show a
   * basis tag only for non-default values (the talking-points
   * pattern: 'news' is silent there; risks default to
   * 'inference', opportunities to 'news').
   */
  defaultBasis: Basis;
}

export function briefSections(brief: Brief): BriefSectionModel[] {
  const sections: BriefSectionModel[] = [
    { key: 'talkingPoints', items: brief.talkingPoints ?? [], defaultBasis: 'news' },
    { key: 'risks', items: brief.risks ?? [], defaultBasis: 'inference' },
    { key: 'opportunities', items: brief.opportunities ?? [], defaultBasis: 'news' },
  ];
  return sections.filter((s) => s.items.length > 0);
}
