/// <reference types="node" />
// DESIGN.md §Accessibility — text ≥ 4.5:1 and UI strokes ≥ 3:1, computed (WCAG 2 relative
// luminance) from theme.css for every text/background pair the UI uses, in both themes.
// Accent tones are resolved through their color-mix() (oklab), so changing the brand
// accent re-verifies everything here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];
interface Color {
  rgb: RGB;
  alpha: number;
}

const css = readFileSync(join(__dirname, 'theme.css'), 'utf8');
const darkBlock = css.slice(css.indexOf('@theme static {'), css.indexOf('@layer base {'));
const lightBlock = css.slice(css.indexOf('.repma-light {'));

const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]));

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (c: number) => Math.min(1, Math.max(0, c));

function toOklab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as RGB;
  const [l, m, s] = [
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  ].map(Math.cbrt) as RGB;
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(fromLinear(c))) as RGB;
}

function resolver(vars: Record<string, string>) {
  const resolve = (value: string): Color => {
    const ref = /^var\(--color-([a-z-]+)\)$/.exec(value);
    if (ref) return resolve(vars[ref[1]!]!);
    if (value === 'white') return { rgb: [1, 1, 1], alpha: 1 };
    if (value === 'black') return { rgb: [0, 0, 0], alpha: 1 };
    const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
    if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB, alpha: 1 };
    const mix = /^color-mix\(in oklab, (var\([^)]+\)) (\d+)%, (white|black|transparent)\)$/.exec(value);
    if (mix) {
      const base = resolve(mix[1]!);
      const p = Number(mix[2]) / 100;
      // Mixing with `transparent` keeps the color and scales its alpha (premultiplied).
      if (mix[3] === 'transparent') return { rgb: base.rgb, alpha: p };
      const [a, b] = [toOklab(base.rgb), toOklab(resolve(mix[3]!).rgb)];
      return { rgb: fromOklab(a.map((c, i) => c * p + b[i]! * (1 - p)) as RGB), alpha: 1 };
    }
    throw new Error(`Unsupported color value: ${value}`);
  };
  return (name: string) => resolve(`var(--color-${name})`);
}

/** A translucent color composited over an opaque one (sRGB, as browsers do). */
const over = (top: Color, bottom: Color): Color => ({
  rgb: top.rgb.map((c, i) => c * top.alpha + bottom.rgb[i]! * (1 - top.alpha)) as RGB,
  alpha: 1,
});

const luminance = ({ rgb }: Color) => {
  const [r, g, b] = rgb.map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a: Color, b: Color) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background] — `accent-soft` is translucent and always sits on `surface`.
const SURFACES = ['canvas', 'surface', 'surface-hover', 'surface-raised'];
const TEXT_PAIRS: Array<[string, string]> = [
  ...SURFACES.flatMap((bg) => ['text', 'text-secondary', 'accent-bright'].map((fg) => [fg, bg] as [string, string])),
  ['text', 'accent-soft'], // selected nav item, selected size tile
  ['accent-bright', 'accent-soft'], // user menu initial
  ['on-accent', 'accent'], // primary button, wordmark tile
  ['on-accent', 'accent-hover'], // hovered primary button; filter band "Clear"
  ['on-accent', 'accent-active'],
  ['on-alert', 'alert'], // danger button
  // Form errors, alert boxes, the escalated aging figure (table rows hover to surface-hover).
  ...['canvas', 'surface', 'surface-hover', 'alert-soft'].map((bg) => ['alert', bg] as [string, string]),
  ['live', 'live-soft'], // status badges
  ['warning', 'warning-soft'],
  ['info', 'info-soft'],
];
// The focus ring on every background a focusable control sits on: accent-bright, except on
// the filter band (an accent-hover fill), whose `--focus-ring` is on-accent.
const STROKE_PAIRS: Array<[string, string]> = [
  ...SURFACES.map((bg) => ['accent-bright', bg] as [string, string]),
  ['on-accent', 'accent-hover'],
];

describe.each([
  ['dark', declarations(darkBlock)],
  ['light', { ...declarations(darkBlock), ...declarations(lightBlock) }],
])('contrast — %s theme', (_, vars) => {
  const color = resolver(vars);
  const background = (name: string) => (name === 'accent-soft' ? over(color(name), color('surface')) : color(name));

  it.each(TEXT_PAIRS)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(ratio(color(fg), background(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STROKE_PAIRS)('stroke %s on %s ≥ 3:1', (fg, bg) => {
    expect(ratio(color(fg), background(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    const color = resolver({ white: '#ffffff', black: '#000000', grey: '#767676' });
    expect(ratio(color('white'), color('black'))).toBeCloseTo(21, 5);
    expect(ratio(color('grey'), color('white'))).toBeCloseTo(4.54, 2);
  });

  it('converts to oklab per the CSS Color 4 reference (red = oklab(0.628 0.2249 0.1258)) and back', () => {
    const [L, a, b] = toOklab([1, 0, 0]);
    expect(L).toBeCloseTo(0.628, 3);
    expect(a).toBeCloseTo(0.2249, 3);
    expect(b).toBeCloseTo(0.1258, 3);
    expect(fromOklab([L, a, b]).map((c) => Math.round(c * 255))).toEqual([255, 0, 0]);
  });
});
