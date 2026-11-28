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
import type { Detection, NewsItem } from './types';

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

/* ------------------------------------------------------------------ */
/* Visible sources (inc-037)                                           */
/* ------------------------------------------------------------------ */

/**
 * One ref resolved against the data the panel actually holds
 * at render time. A ref that resolves carries the headline
 * title / detection name (and the headline link); a ref that
 * resolves to NOTHING in the available data is still returned,
 * with an honest index label ("Headline 3", "Detection 1") —
 * refs are never silently dropped and titles are never
 * invented.
 */
export interface ResolvedRef {
  kind: 'news' | 'tech';
  /** Zero-based index into the run's news/detections arrays. */
  index: number;
  /** Headline title / detection name, or the honest index label. */
  label: string;
  /** The headline link when resolved; null otherwise. */
  link: string | null;
  resolved: boolean;
}

export function resolveSourceRefs(refs: number[], news: NewsItem[]): ResolvedRef[] {
  return refs.map((index) => {
    const item = news[index];
    return item
      ? { kind: 'news' as const, index, label: item.title, link: item.link, resolved: true }
      : { kind: 'news' as const, index, label: `Headline ${index + 1}`, link: null, resolved: false };
  });
}

export function resolveStackRefs(refs: number[], detections: Detection[]): ResolvedRef[] {
  return refs.map((index) => {
    const detection = detections[index];
    return detection
      ? { kind: 'tech' as const, index, label: detection.name, link: null, resolved: true }
      : {
          kind: 'tech' as const,
          index,
          label: `Detection ${index + 1}`,
          link: null,
          resolved: false,
        };
  });
}

/** A brief item's sources, resolved: headlines and tech, each in ref order. */
export function itemSources(
  item: BriefItem,
  news: NewsItem[],
  detections: Detection[],
): { news: ResolvedRef[]; tech: ResolvedRef[] } {
  return {
    news: resolveSourceRefs(item.sourceRefs ?? [], news),
    tech: resolveStackRefs(item.stackRefs ?? [], detections),
  };
}
