import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  PORT: '3000',
  FRONTEND_URLS: 'http://localhost:5173,http://localhost:4173',
  NODE_ENV: 'test',
};

describe('parseEnv (RNF-12 fail-fast)', () => {
  it('parses a complete, valid environment', () => {
    const env = parseEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('throws a clear error when a required variable is missing', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow(/Invalid environment variables/);
  });

  it('throws when a URL-shaped variable is not a valid URL', () => {
    expect(() => parseEnv({ ...validEnv, SUPABASE_URL: 'not-a-url' })).toThrow(/Invalid environment variables/);
  });

  it('defaults PORT and NODE_ENV when omitted', () => {
    const { PORT: _PORT, NODE_ENV: _NODE_ENV, ...rest } = validEnv;
    const env = parseEnv(rest);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });
});
