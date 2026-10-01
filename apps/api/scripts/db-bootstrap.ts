import 'dotenv/config';
import postgres from 'postgres';

// Gives `repma_api` LOGIN + a password, read from an untracked env var —
// never written into a versioned migration (plan.md 1.4). Prod runs the
// equivalent ALTER ROLE by hand from the Supabase dashboard (Manual 1-B).
const adminConnectionString = process.env.MIGRATIONS_DATABASE_URL;
if (!adminConnectionString) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set');
}

const password = process.env.REPMA_API_PASSWORD;
if (!password) {
  throw new Error('REPMA_API_PASSWORD is not set');
}

const sql = postgres(adminConnectionString);

try {
  const escapedPassword = password.replace(/'/g, "''");
  await sql.unsafe(`ALTER ROLE repma_api WITH LOGIN PASSWORD '${escapedPassword}'`);
  console.log('repma_api bootstrapped: LOGIN enabled, password set from REPMA_API_PASSWORD.');
} finally {
  await sql.end();
}
