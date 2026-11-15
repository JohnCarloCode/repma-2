import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { extractAccessToken, readSessionCookie, SESSION_COOKIE, sessionCookieOptions } from './session.js';

function sessionCookie(value: unknown): string {
  return `other=1; ${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify(value))}`;
}

const session = { accessToken: 'cookie-token', refreshToken: 'refresh' };

describe('readSessionCookie', () => {
  it('reads both tokens from the session cookie', () => {
    expect(readSessionCookie(sessionCookie(session))).toEqual(session);
  });

  it('is undefined without a session cookie', () => {
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie('other=1')).toBeUndefined();
  });

  it('is null for a malformed session cookie', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=not-json`)).toBeNull();
    expect(readSessionCookie(sessionCookie({ accessToken: 'x' }))).toBeNull();
  });
});

describe('extractAccessToken (RF-04)', () => {
  it('takes the cookie over the Bearer header', () => {
    expect(extractAccessToken({ cookie: sessionCookie(session), authorization: 'Bearer header-token' })).toBe(
      'cookie-token',
    );
  });

  it('falls back to the Bearer header without a session cookie', () => {
    expect(extractAccessToken({ cookie: 'other=1', authorization: 'Bearer header-token' })).toBe('header-token');
    expect(extractAccessToken({ authorization: 'bearer header-token' })).toBe('header-token');
  });

  it('does not fall back to the header when the session cookie is malformed', () => {
    expect(extractAccessToken({ cookie: `${SESSION_COOKIE}=garbage`, authorization: 'Bearer header-token' })).toBeNull();
  });

  it('is null with no credential or a non-Bearer header', () => {
    expect(extractAccessToken({})).toBeNull();
    expect(extractAccessToken({ authorization: 'Basic abc' })).toBeNull();
    expect(extractAccessToken({ authorization: 'Bearer ' })).toBeNull();
  });
});

describe('sessionCookieOptions (RF-01, RNF-03)', () => {
  async function setCookieHeader(production: boolean): Promise<string> {
    const app = express();
    app.get('/', (_req, res) => {
      res.cookie(SESSION_COOKIE, 'value', sessionCookieOptions(production)).end();
    });
    const res = await request(app).get('/');
    return String(res.headers['set-cookie']);
  }

  it('production: HttpOnly, SameSite=Lax and Secure', async () => {
    const header = await setCookieHeader(true);
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; SameSite=Lax/);
    expect(header).toMatch(/; Secure/);
  });

  it('outside production: not Secure (local dev is plain http)', async () => {
    const header = await setCookieHeader(false);
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; SameSite=Lax/);
    expect(header).not.toMatch(/Secure/);
  });
});
