import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const connectionString = process.env.MIGRATIONS_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    url: connectionString,
  },
});
