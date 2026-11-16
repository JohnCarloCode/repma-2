import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Plan 9.3 — the web routes of `App.tsx` and the pages index
// (doc-ai/design/pages/README.md) are the same set, and every page the index
// links has its doc (CLAUDE.md: a page's doc exists before the page).
const pagesDir = join(__dirname, '../../../doc-ai/design/pages');
const read = (file: string) => readFileSync(file, 'utf8');

const appRoutes = [...read(join(__dirname, 'App.tsx')).matchAll(/<Route path="([^"]+)"/g)].map(([, path]) => path);
// Index rows: `| \`route\` | Page | Description | Doc |`.
const indexRows = read(join(pagesDir, 'README.md'))
  .split('\n')
  .flatMap((line) => {
    const route = /^\| `([^`]+)` \|/.exec(line)?.[1];
    return route ? [{ route, doc: /\]\(([^)]+\.md)\) \|$/.exec(line)?.[1] }] : [];
  });

describe('web routes vs the pages index', () => {
  it('App.tsx and the index list the same routes', () => {
    expect(appRoutes.length).toBeGreaterThan(0);
    expect([...appRoutes].sort()).toEqual(indexRows.map((row) => row.route).sort());
  });

  it('every linked page doc exists', () => {
    for (const { doc } of indexRows) {
      if (doc) expect(existsSync(join(pagesDir, doc)), doc).toBe(true);
    }
  });
});
