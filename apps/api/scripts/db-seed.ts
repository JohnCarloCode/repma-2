import 'dotenv/config';
import { parseSeedEnv, seed } from '../src/db/seed/seed.js';

// Loads the demo dataset (database.md §9; plan.md 1.9). Validates its own env
// (admin DB URL + Supabase service key), never the API's. Re-runnable.
await seed(parseSeedEnv(process.env));
console.log('Demo seed loaded.');
