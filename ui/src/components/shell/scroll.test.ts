// The app is a fixed-height shell: only its panes scroll, never the window (change:map-page-scroll). Two guards on
// the cause that broke it: the root clips, and every scroll pane is a containing block, so an absolutely positioned
// descendant (Tailwind's sr-only is one) anchors to its pane and never to the page, where it would stretch the
// document to the pane's whole content height.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return name.endsWith('.tsx') ? [p] : [];
  });
}

describe('the shell never scrolls the window', () => {
  it('clips overflow at the root', () => {
    const css = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
  });

  it('makes every scroll pane a containing block', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      // every class string that scrolls (overflow-auto) must also position (relative)
      for (const m of text.matchAll(/(["'`])([^"'`\n]*\boverflow-auto\b[^"'`\n]*)\1/g)) {
        if (!/\brelative\b/.test(m[2])) offenders.push(`${file.slice(SRC.length + 1)}: ${m[2].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
