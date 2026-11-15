import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../errors.js';
import { serveWeb } from './web.js';

// RNF-11 — against a fixture build, so the suite never depends on whether
// `apps/web/dist` exists (CI runs the tests before the build).
let distDir: string;
let app: express.Express;

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'repma-web-'));
  mkdirSync(join(distDir, 'assets'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(distDir, 'assets', 'index-abc123.js'), 'console.log(1);');
  writeFileSync(join(distDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  app = express();
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(serveWeb(distDir));
  app.use(notFoundHandler);
  app.use(errorHandler);
});

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true });
});

describe('serveWeb (RNF-11)', () => {
  it('serves index.html at the root, never cached', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for a deep link (SPA routing)', async () => {
    const res = await request(app).get('/availability/123');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with a long-lived immutable cache', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves other static files without the immutable cache', async () => {
    const res = await request(app).get('/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).not.toMatch(/immutable/);
  });

  it('leaves API routes to the API', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body).toEqual({ status: 'ok' });
  });

  it.each(['/api', '/api/v1/nope', '/api/anything'])('keeps the JSON 404 envelope for unknown %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not fall back for non-GET requests', async () => {
    const res = await request(app).post('/activity');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
