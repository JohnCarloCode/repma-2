import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import subset from './icons.json';

// The icon font is a subset (scripts/subset-icons.mjs, DESIGN.md §Iconography): a name missing from
// icons.json renders as its raw ligature text. Collect every name the source uses and require it there.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function usedIcons(code: string): string[] {
  const names: string[] = [];
  // `icon="x"`, `icon: 'x'`, `icon={cond ? 'x' : 'y'}`
  for (const [, expr] of code.matchAll(/\bicon(?:=|:\s*)(\{[^}\n]*\}|'[^']*'|"[^"]*")/g))
    for (const [, name] of expr!.matchAll(/['"]([a-z0-9_]+)['"]/g)) names.push(name!);
  // <span className="icon …">name</span>
  for (const [, name] of code.matchAll(/className=["{`][^>]*\bicon\b[^>]*>\s*([a-z0-9_]+)\s*</g)) names.push(name!);
  return names;
}

describe('icon font subset', () => {
  it('every icon name used in the source is in icons.json', () => {
    const used = new Set(sources(join(__dirname, '..')).flatMap((file) => usedIcons(readFileSync(file, 'utf8'))));
    expect(used.size).toBeGreaterThan(20); // the scan itself works
    expect([...used].filter((name) => !subset.includes(name)).sort()).toEqual([]);
  });
});
