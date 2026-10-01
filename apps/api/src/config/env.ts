import 'dotenv/config';
import { z } from 'zod';

// architecture.md §8 — validated with Zod at startup (fail-fast, RNF-12).
// Only runtime vars: the admin/migration connection string is deliberately
// absent (it belongs to migration tooling only — see db/client.ts vs.
// drizzle.config.ts).
const urlString = z.string().refine((value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid URL');

const envSchema = z.object({
  DATABASE_URL: urlString,
  SUPABASE_URL: urlString,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_URLS: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = JSON.stringify(result.error.flatten().fieldErrors);
    throw new Error(`Invalid environment variables: ${issues}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

export const frontendUrls = env.FRONTEND_URLS.split(',')
  .map((url) => url.trim())
  .filter(Boolean);
