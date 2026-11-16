import { describe, expect, it } from 'vitest';
import { parseSeedEnv } from './seed.js';

const local = {
  MIGRATIONS_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'local-key',
};

describe('parseSeedEnv', () => {
  it('accepts a fully local (or fully remote) target', () => {
    expect(parseSeedEnv(local).SUPABASE_URL).toBe(local.SUPABASE_URL);
    expect(() =>
      parseSeedEnv({
        ...local,
        MIGRATIONS_DATABASE_URL: 'postgresql://postgres.ref:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres',
        SUPABASE_URL: 'https://ref.supabase.co',
      }),
    ).not.toThrow();
  });

  it('refuses a database and a Supabase project on different sides (a variable missed in the shell falls back to .env)', () => {
    expect(() =>
      parseSeedEnv({ ...local, MIGRATIONS_DATABASE_URL: 'postgresql://postgres.ref:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres' }),
    ).toThrow(/same environment/);
    expect(() => parseSeedEnv({ ...local, SUPABASE_URL: 'https://ref.supabase.co' })).toThrow(/same environment/);
  });
});
