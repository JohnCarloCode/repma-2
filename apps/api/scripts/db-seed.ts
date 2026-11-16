import 'dotenv/config';
import { seedImages } from '../src/db/seed/images.js';
import { parseSeedEnv, seed } from '../src/db/seed/seed.js';

// Loads the demo dataset (database.md §9; plan.md 1.9), product images
// included. Validates its own env (admin DB URL + Supabase service key),
// never the API's. Re-runnable.
const env = parseSeedEnv(process.env);
await seed(env);
await seedImages(env);
console.log('Demo seed loaded.');
