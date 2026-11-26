import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Manifest permission pin (inc-030): the release build's built
 * manifest was diffed field-by-field against the v0.4.0 built
 * manifest and found IDENTICAL in every field. This test pins
 * the source of that manifest — the exact permissions and
 * host_permissions arrays in wxt.config.ts — so any future
 * drift (an added OR removed permission or host pattern) fails
 * the suite and forces a deliberate, reviewed change here.
 * WXT stamps this config into the built manifest (inc-014).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = readFileSync(join(root, 'wxt.config.ts'), 'utf8');

function extractArray(source: string, key: string): string[] {
  const match = source.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${key} array not found in wxt.config.ts`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const EXPECTED_PERMISSIONS = [
  'activeTab',
  'alarms',
  'scripting',
  'sidePanel',
  'storage',
  'tabs',
  'unlimitedStorage',
  'webRequest',
];

const EXPECTED_HOST_PERMISSIONS = [
  '<all_urls>',
  'https://api.anthropic.com/*',
  'https://news.google.com/*',
];

describe('wxt.config.ts manifest permissions (pinned to the v0.4.0 built manifest)', () => {
  it('requests exactly the v0.4.0 permissions, in order', () => {
    expect(extractArray(config, 'permissions')).toEqual(EXPECTED_PERMISSIONS);
  });

  it('requests exactly the v0.4.0 host_permissions, in order', () => {
    expect(extractArray(config, 'host_permissions')).toEqual(EXPECTED_HOST_PERMISSIONS);
  });

  it('declares no optional_permissions (none existed in v0.4.0)', () => {
    expect(config).not.toContain('optional_permissions');
  });
});
