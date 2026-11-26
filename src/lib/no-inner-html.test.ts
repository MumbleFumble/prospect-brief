import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Print/render safety pin (inc-028): brief text reaches the
 * screen and the printed page only through React rendering,
 * which escapes text by construction — as long as no code
 * bypasses it with innerHTML / dangerouslySetInnerHTML /
 * document.write / insertAdjacentHTML. This test scans every
 * non-test source file and fails if any such sink appears.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

const SINKS = ['innerHTML', 'dangerouslySetInnerHTML', 'document.write', 'insertAdjacentHTML'];

describe('no HTML injection sinks in non-test src', () => {
  it('no source file uses innerHTML-style sinks (print and UI render via React)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      for (const sink of SINKS) {
        if (text.includes(sink)) offenders.push(`${file}: ${sink}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
