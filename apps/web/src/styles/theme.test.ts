/// <reference types="node" />
// Token smoke test: the theme file carries every DESIGN.md token with DESIGN.md's value,
// and the icon subset list is exactly DESIGN.md §Iconography's inventory.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import icons from './icons.json';

// Plain paths: under jsdom the global URL is not Node's, which some fs calls reject.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url).href);
const read = (path: string) => readFileSync(here(path), 'utf8');

const designMd = read('../../../../doc-ai/design/DESIGN.md');
// Only the token groups (colors … motion) are parsed; the rest of the front matter is prose-like.
const tokenYaml = designMd.slice(designMd.search(/^colors:/m), designMd.search(/^components:/m));
const design = parse(tokenYaml) as Record<string, Record<string, unknown>>;
const css = read('./theme.css');

const darkBlock = css.slice(css.indexOf('@theme static {'), css.indexOf('@layer base {'));
const lightBlock = css.slice(css.indexOf('.repma-light {'));

const normalize = (value: unknown) =>
  String(value)
    .replaceAll('{colors.accent}', 'var(--color-accent)')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function declared(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`\\s${name}:\\s*([^;]+);`));
  return match?.[1] ? normalize(match[1]) : undefined;
}

/** [css variable, expected value] pairs derived from one DESIGN.md token group. */
const pairs = (group: string, prefix: string) =>
  Object.entries(design[group] ?? {}).map(([key, value]) => [`${prefix}${key}`, normalize(value)] as const);

describe('design tokens (theme.css ↔ DESIGN.md)', () => {
  it('parses the DESIGN.md token groups', () => {
    for (const group of ['colors', 'colors-light', 'typography', 'rounded', 'spacing', 'layers', 'motion']) {
      expect(design[group], group).toBeTypeOf('object');
    }
  });

  it.each([
    ['colors', '--color-'],
    ['rounded', '--radius-'],
    ['spacing', '--spacing-'],
    ['layers', '--z-index-'],
  ])('dark/default %s', (group, prefix) => {
    for (const [name, value] of pairs(group, prefix)) expect(declared(darkBlock, name), name).toBe(value);
  });

  it('light theme overrides (.repma-light)', () => {
    for (const [name, value] of pairs('colors-light', '--color-')) expect(declared(lightBlock, name), name).toBe(value);
  });

  it('the brand is one variable: --color-accent appears once as a literal, every tone derives from it', () => {
    expect(css.match(/--color-accent:/g)).toHaveLength(1);
    for (const tone of ['hover', 'active', 'bright', 'soft']) {
      expect(declared(darkBlock, `--color-accent-${tone}`)).toContain('var(--color-accent)');
    }
  });

  it('typography', () => {
    const typography = design.typography as Record<string, unknown>;
    expect(declared(darkBlock, '--font-sans')).toBe(normalize(typography.fontFamily));
    expect(declared(darkBlock, '--font-mono')).toBe(normalize(typography.fontFamilyMono));
    const props = { fontWeight: 'font-weight', lineHeight: 'line-height', letterSpacing: 'letter-spacing' } as const;
    for (const [style, spec] of Object.entries(typography)) {
      if (typeof spec !== 'object' || spec === null) continue;
      const s = spec as Record<string, unknown>;
      expect(declared(darkBlock, `--text-${style}`), style).toBe(normalize(s.fontSize));
      for (const [key, suffix] of Object.entries(props)) {
        if (s[key] !== undefined) expect(declared(darkBlock, `--text-${style}--${suffix}`), `${style} ${key}`).toBe(normalize(s[key]));
      }
    }
  });

  it('motion', () => {
    const motion = design.motion as Record<string, unknown>;
    expect(declared(darkBlock, '--transition-duration-fast')).toBe(normalize(motion.fast));
    expect(declared(darkBlock, '--transition-duration-base')).toBe(normalize(motion.base));
    expect(declared(darkBlock, '--ease-standard')).toBe(normalize(motion.easing));
  });

  it('no shadow tokens exist', () => {
    expect(darkBlock).toContain('--shadow-*: initial;');
    expect(darkBlock).not.toMatch(/--shadow-[a-z0-9]+:/);
  });
});

describe('icon subset', () => {
  it('icons.json is exactly the DESIGN.md §Iconography inventory', () => {
    const section = designMd.slice(designMd.indexOf('### Iconography'), designMd.indexOf('## Shape'));
    const inventory = section
      .split('\n')
      .filter((line) => /^- (Navigation|Chrome|Actions & feedback):/.test(line))
      .flatMap((line) => [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]));
    expect([...icons].sort()).toEqual([...new Set(inventory)].sort());
  });

  it('the generated subset font is present', () => {
    expect(existsSync(here('../assets/fonts/material-symbols-rounded.woff2'))).toBe(true);
  });
});
