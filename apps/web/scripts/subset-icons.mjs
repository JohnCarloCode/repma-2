/* global URL, fetch, Buffer, console */
// Material Symbols Rounded subset pipeline (DESIGN.md §Iconography).
// Downloads a woff2 holding ONLY the glyphs in src/styles/icons.json, with the one product-wide
// configuration baked in (opsz 20, wght 400, FILL 0, GRAD 0), and writes it next to the other
// self-hosted fonts. Adding an icon = add it to DESIGN.md + icons.json, then `npm run icons -w web`
// and commit the regenerated font. Needs network only when run; builds never fetch anything.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const names = JSON.parse(await readFile(new URL('src/styles/icons.json', root), 'utf8'));
const sorted = [...new Set(names)].sort(); // the API requires alphabetical order

const cssUrl =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,400,0,0' +
  `&icon_names=${sorted.join(',')}&display=block`;
// A modern browser UA makes the API answer with woff2.
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const css = await (await fetch(cssUrl, { headers: { 'User-Agent': ua } })).text();
const fontUrl = css.match(/src:\s*url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!fontUrl) throw new Error(`No woff2 URL in the Google Fonts response:\n${css}`);

const res = await fetch(fontUrl);
if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
const out = new URL('src/assets/fonts/material-symbols-rounded.woff2', root);
await writeFile(out, Buffer.from(await res.arrayBuffer()));
console.log(`${sorted.length} icons → ${out.pathname}`);
