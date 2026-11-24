/**
 * Brief-level diff (v0.6 step 1): compare two Brief payloads
 * section by section and return a deterministic, structured list
 * of changes. Pure function — no storage, no API, no UI. This is
 * the engine the watch diff view renders; watch.ts's
 * diffSnapshots is a different diff (signal snapshots) and is not
 * used here.
 *
 * Item identity within a section is the item's `point` text: a
 * point only in next is 'added', only in prev is 'removed', and a
 * surviving point whose basis or refs changed is 'changed' with
 * the changed fields named. A point whose TEXT changed is
 * removed+added — no fuzzy matching.
 */
import type { Brief } from './brief';

export type ItemSection = 'talkingPoints' | 'risks' | 'opportunities';

/** Item fields a 'changed' entry can name, in declaration order. */
export type ItemChangeField = 'sourceRefs' | 'stackRefs' | 'basis';

export type BriefChange =
  | {
      kind: 'overview-changed';
      section: 'overview';
      /** Both texts are carried so the diff view can render the
       * change from this entry alone. */
      prevOverview: string;
      nextOverview: string;
    }
  | { kind: 'added'; section: ItemSection; point: string }
  | { kind: 'removed'; section: ItemSection; point: string }
  | { kind: 'changed'; section: ItemSection; point: string; fields: ItemChangeField[] };

type BriefItem = Brief['talkingPoints'][number];

const SECTION_ORDER: ItemSection[] = ['talkingPoints', 'risks', 'opportunities'];

function sameRefs(a: number[], b: number[]): boolean {
  // Order-sensitive: refs are index lists into the prompt's
  // arrays, so a reorder is a real change to what grounds the item.
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function changedFields(prev: BriefItem, next: BriefItem): ItemChangeField[] {
  const fields: ItemChangeField[] = [];
  if (!sameRefs(prev.sourceRefs, next.sourceRefs)) fields.push('sourceRefs');
  if (!sameRefs(prev.stackRefs, next.stackRefs)) fields.push('stackRefs');
  if (prev.basis !== next.basis) fields.push('basis');
  return fields;
}

function diffSection(
  section: ItemSection,
  prevItems: BriefItem[] | undefined,
  nextItems: BriefItem[] | undefined,
  out: BriefChange[],
): void {
  // Legacy tolerance: pre-v0.5 stored payloads may lack the
  // risks/opportunities keys entirely — diff as empty sections.
  const prevList = prevItems ?? [];
  const nextList = nextItems ?? [];
  const prevByPoint = new Map(prevList.map((item) => [item.point, item]));
  const nextPoints = new Set(nextList.map((item) => item.point));
  // Added/changed first, in next-array order…
  for (const item of nextList) {
    const before = prevByPoint.get(item.point);
    if (!before) {
      out.push({ kind: 'added', section, point: item.point });
    } else {
      const fields = changedFields(before, item);
      if (fields.length > 0) out.push({ kind: 'changed', section, point: item.point, fields });
    }
  }
  // …then removed, in prev-array order.
  for (const item of prevList) {
    if (!nextPoints.has(item.point)) {
      out.push({ kind: 'removed', section, point: item.point });
    }
  }
}

/**
 * Compare two briefs. Ordering is deterministic: the overview
 * entry first (when the overview text differs), then sections in
 * the order talkingPoints, risks, opportunities; within a
 * section, added/changed entries in next-array order followed by
 * removed entries in prev-array order. Identical briefs produce
 * an empty list.
 */
export function diffBriefs(prev: Brief, next: Brief): BriefChange[] {
  const changes: BriefChange[] = [];
  if (prev.overview !== next.overview) {
    changes.push({
      kind: 'overview-changed',
      section: 'overview',
      prevOverview: prev.overview,
      nextOverview: next.overview,
    });
  }
  for (const section of SECTION_ORDER) {
    diffSection(section, prev[section], next[section], changes);
  }
  return changes;
}

/** Convenience for callers that only need the boolean. */
export function hasChanges(changes: BriefChange[]): boolean {
  return changes.length > 0;
}
