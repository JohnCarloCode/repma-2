import 'dotenv/config';
import { seedImages } from '../src/db/seed/images.js';
import { parseSeedEnv } from '../src/db/seed/seed.js';

// Uploads the seed's product images and points the seed products at them
// (database.md §9), without touching anything else — the one-time production
// step of plan Manual 8-A (`db:seed` already runs it locally and in CI).
// Same env as db:seed, validated here. Idempotent.
await seedImages(parseSeedEnv(process.env));
console.log('Seed images uploaded.');
