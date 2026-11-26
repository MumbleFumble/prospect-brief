import { describe, expect, it } from 'vitest';
import {
  isEditableTarget,
  shortcutFor,
  type ShortcutContext,
  type ShortcutEventEssentials,
} from './shortcuts';

function ev(overrides: Partial<ShortcutEventEssentials> = {}): ShortcutEventEssentials {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    targetEditable: false,
    ...overrides,
  };
}

const BRIEF: ShortcutContext = { view: 'current', briefDisplayed: true };
const NO_BRIEF: ShortcutContext = { view: 'current', briefDisplayed: false };
const ACCOUNTS: ShortcutContext = { view: 'accounts', briefDisplayed: true };
const TODAY: ShortcutContext = { view: 'today', briefDisplayed: false };

const PINNED: Array<[string, string]> = [
  ['/', 'focus-search'],
  ['1', 'tab-brief'],
  ['2', 'tab-signals'],
  ['3', 'tab-outreach'],
  ['r', 'regenerate'],
  ['c', 'copy-markdown'],
  ['p', 'print'],
];

describe('shortcutFor — the pinned set', () => {
  it('maps each pinned key to its action with a brief displayed', () => {
    for (const [key, action] of PINNED) {
      expect(shortcutFor(ev({ key }), BRIEF)).toBe(action);
    }
  });

  it('/ maps to focus-search in EVERY view (the wiring switches views if needed)', () => {
    expect(shortcutFor(ev({ key: '/' }), BRIEF)).toBe('focus-search');
    expect(shortcutFor(ev({ key: '/' }), NO_BRIEF)).toBe('focus-search');
    expect(shortcutFor(ev({ key: '/' }), ACCOUNTS)).toBe('focus-search');
    expect(shortcutFor(ev({ key: '/' }), TODAY)).toBe('focus-search');
  });

  it('brief actions return none when no brief is displayed', () => {
    for (const key of ['1', '2', '3', 'r', 'c', 'p']) {
      expect(shortcutFor(ev({ key }), NO_BRIEF)).toBeNull();
    }
  });

  it('brief actions return none outside the current-page view', () => {
    for (const key of ['1', '2', '3', 'r', 'c', 'p']) {
      expect(shortcutFor(ev({ key }), ACCOUNTS)).toBeNull();
      expect(shortcutFor(ev({ key }), TODAY)).toBeNull();
    }
  });

  it('unmapped keys return none (incl. shifted variants — keys match exactly)', () => {
    for (const key of ['x', 'R', 'C', 'P', '?', 'Enter', 'Escape', '0', '4', ' ']) {
      expect(shortcutFor(ev({ key }), BRIEF)).toBeNull();
    }
  });
});

describe('shortcutFor — safety suppression', () => {
  it('every pinned key is suppressed while typing (editable target)', () => {
    for (const [key] of PINNED) {
      expect(shortcutFor(ev({ key, targetEditable: true }), BRIEF)).toBeNull();
      expect(shortcutFor(ev({ key, targetEditable: true }), ACCOUNTS)).toBeNull();
    }
  });

  it('every pinned key is suppressed with Ctrl, Meta, or Alt held', () => {
    for (const [key] of PINNED) {
      expect(shortcutFor(ev({ key, ctrlKey: true }), BRIEF)).toBeNull();
      expect(shortcutFor(ev({ key, metaKey: true }), BRIEF)).toBeNull();
      expect(shortcutFor(ev({ key, altKey: true }), BRIEF)).toBeNull();
    }
  });

  it('key auto-repeat never retriggers an action', () => {
    for (const [key] of PINNED) {
      expect(shortcutFor(ev({ key, repeat: true }), BRIEF)).toBeNull();
    }
  });
});

describe('isEditableTarget', () => {
  it('inputs, textareas, selects, and contentEditable are editable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('ordinary elements and missing targets are not editable', () => {
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});
