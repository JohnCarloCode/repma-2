import { describe, expect, it } from 'vitest';
import { loginBody } from './auth.js';

describe('loginBody (RF-01, login.md)', () => {
  it('accepts an email and a non-empty password', () => {
    expect(loginBody.parse({ email: 'a@b.co', password: 'x' })).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('uses the login page messages for a bad email and a missing/empty password', () => {
    const messages = (body: unknown) => loginBody.safeParse(body).error?.issues.map((issue) => issue.message);
    expect(messages({ email: 'nope', password: 'x' })).toEqual(['Enter a valid email address']);
    expect(messages({ password: 'x' })).toEqual(['Enter a valid email address']);
    expect(messages({ email: 'a@b.co', password: '' })).toEqual(['Password is required']);
    expect(messages({ email: 'a@b.co' })).toEqual(['Password is required']);
  });
});
