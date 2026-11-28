/**
 * The brief's item sections as a display model (inc-025): the
 * single source both the sidepanel brief view and the Markdown
 * export render from — same sections, same order. Two views of
 * it (inc-035): briefSectionsForDisplay carries every section
 * including empty ones (the screen, so each section can host
 * its regenerate control); briefSections filters to non-empty
 * (the Markdown export's content model). Legacy payloads
 * missing the risks/opportunities keys (pre-v0.5 stored shape)
 * are read as empty.
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

/**
 * All three item sections in display order, INCLUDING empty
 * ones (inc-035). The brief view renders from this so an empty
 * risks/opportunities section still gets its block — and with
 * it the per-section regenerate control (inc-032) that lets the
 * user fill just that section. Talking points are included on
 * the same terms: the schema requires at least one, so an empty
 * talking-points block can only occur for an unvalidated legacy
 * payload, and it is covered the same way if it ever does.
 */
export function briefSectionsForDisplay(brief: Brief): BriefSectionModel[] {
  return [
    { key: 'talkingPoints', items: brief.talkingPoints ?? [], defaultBasis: 'news' },
    { key: 'risks', items: brief.risks ?? [], defaultBasis: 'inference' },
    { key: 'opportunities', items: brief.opportunities ?? [], defaultBasis: 'news' },
  ];
}

/**
 * The content sections only (non-empty), in display order.
 * This remains the Markdown export's model: an exported
 * document lists findings, and an empty section has none to
 * list — the on-screen empty block exists to host a control,
 * which has no export analogue.
 */
export function briefSections(brief: Brief): BriefSectionModel[] {
  return briefSectionsForDisplay(brief).filter((s) => s.items.length > 0);
}
