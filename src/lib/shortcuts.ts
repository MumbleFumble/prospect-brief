/**
 * Keyboard shortcuts for the side panel (v0.8 step 3) — the
 * pure mapping layer. The React wiring is a thin keydown
 * listener over shortcutFor(); every decision lives here so it
 * is unit-testable.
 *
 * HARD CONSTRAINT (inc-030): no chrome `commands`, no manifest
 * change — these are in-page listeners only.
 *
 * The pinned set (single keys, no modifiers):
 *   /  focus the "Search saved briefs" input (any view; the
 *      wiring switches to the Accounts view first if needed)
 *   1/2/3  switch the brief tabs Brief / Signals / Outreach
 *   r  Regenerate brief        c  Copy as Markdown
 *   p  Print / Save as PDF     (1/2/3/r/c/p need a brief shown)
 *
 * Safety: nothing fires while typing (editable target), nothing
 * fires with Ctrl/Meta/Alt held (browser/OS chords are left
 * alone), and key auto-repeat never retriggers an action. Keys
 * are matched exactly as KeyboardEvent.key reports them, so
 * shifted variants ('R', '?') do not fire — '/' itself fires
 * however the layout produces it, since e.key is '/' then.
 */
export type ShortcutAction =
  | 'focus-search'
  | 'tab-brief'
  | 'tab-signals'
  | 'tab-outreach'
  | 'regenerate'
  | 'copy-markdown'
  | 'print';

export interface ShortcutEventEssentials {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Key auto-repeat (the key is being held down). */
  repeat: boolean;
  /** The event target is an input/textarea/select/contentEditable. */
  targetEditable: boolean;
}

export interface ShortcutContext {
  view: 'current' | 'accounts' | 'today';
  /** A brief is displayed (the brief view's brief status is ready). */
  briefDisplayed: boolean;
}

/** Minimal shape of an event target, for testable editable detection. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export function isEditableTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function shortcutFor(
  event: ShortcutEventEssentials,
  context: ShortcutContext,
): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.targetEditable) return null;
  if (event.repeat) return null;

  if (event.key === '/') return 'focus-search';

  // Everything below acts on the displayed brief, which only
  // exists in the current-page view.
  if (context.view !== 'current' || !context.briefDisplayed) return null;
  switch (event.key) {
    case '1':
      return 'tab-brief';
    case '2':
      return 'tab-signals';
    case '3':
      return 'tab-outreach';
    case 'r':
      return 'regenerate';
    case 'c':
      return 'copy-markdown';
    case 'p':
      return 'print';
    default:
      return null;
  }
}
