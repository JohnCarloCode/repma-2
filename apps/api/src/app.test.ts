import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './app.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { createHealthHandler } from './core/health.js';

// Requires the local Supabase stack to be up (`supabase start`) — the real
// app's health route pings the real database.
describe('GET /api/v1/health', () => {
  it('returns 200 with the database reachable', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('health handler (RNF-10)', () => {
  function buildApp(ping: () => Promise<void>) {
    const testApp = express();
    testApp.get('/health', createHealthHandler(ping));
    testApp.use(notFoundHandler);
    testApp.use(errorHandler);
    return testApp;
  }

  it('returns 200 when the ping resolves', async () => {
    const res = await request(buildApp(() => Promise.resolve())).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when the ping fails (broken DB connection)', async () => {
    const res = await request(buildApp(() => Promise.reject(new Error('connection refused')))).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is unreachable' } });
  });
});

describe('404 handler', () => {
  it('returns the error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
