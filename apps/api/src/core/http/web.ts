import { join } from 'node:path';
import express, { type Router } from 'express';

// RNF-11 — the API serves the web build from the same origin. Files are
// served as-is; any other GET outside `/api` gets `index.html` so the SPA's
// router handles deep links. `/api` never falls back: unknown API routes
// reach the JSON 404 envelope.
export function serveWeb(distDir: string): Router {
  const router = express.Router();
  const indexHtml = join(distDir, 'index.html');

  router.use((req, _res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next('router');
      return;
    }
    next();
  });

  router.use(
    express.static(distDir, {
      index: false, // `/` goes through the fallback, with its no-cache header
      setHeaders(res, path) {
        // Vite content-hashes everything under assets/: safe to cache forever.
        if (path.startsWith(join(distDir, 'assets'))) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  router.get(/.*/, (_req, res) => {
    // Always revalidated, so a deploy's new asset hashes are picked up.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  return router;
}
