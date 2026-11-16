import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { CATEGORIES, PRODUCTS } from './data.js';
import { seedId, type SeedEnv } from './seed.js';

// The seed's product images (database.md §9): one generated glyph per
// category, committed under `./images/<category-slug>.png`, uploaded to the
// public bucket under `seed/<category-slug>.png` and set as the `image_url` of
// every seed product of that category — matched by their stable seed ids, so
// no other product is touched.
//
// Idempotent: uploads upsert the same keys and the update rewrites the same
// URLs. Objects live under `seed/`, never under a product's own folder, so an
// image replaced from the UI never deletes them (architecture.md §7,
// `POST /products/:id/image`).

// Same bucket as `PRODUCT_IMAGES_BUCKET` in lib/supabase.ts, which can't be
// imported here: it validates the API's env, and this runs with the seed's.
export const SEED_IMAGES_BUCKET = 'product-images';
export const seedImageKey = (categorySlug: string) => `seed/${categorySlug}.png`;

export async function seedImages(env: SeedEnv): Promise<void> {
  const bucket = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).storage.from(SEED_IMAGES_BUCKET);
  const sql = postgres(env.MIGRATIONS_DATABASE_URL, { onnotice: () => {} });

  try {
    for (const { slug } of CATEGORIES) {
      const key = seedImageKey(slug);
      const content = await readFile(new URL(`./images/${slug}.png`, import.meta.url));
      // Upsert keeps the key stable across runs, so a short cache lets a
      // regenerated image reach browsers within a day.
      const { error } = await bucket.upload(key, content, { contentType: 'image/png', cacheControl: '86400', upsert: true });
      if (error) throw new Error(`Uploading ${key}: ${error.message}`, { cause: error });

      const url = bucket.getPublicUrl(key).data.publicUrl;
      const ids = PRODUCTS.filter((p) => p.category === slug).map((p) => seedId(`product:${p.code}`));
      if (ids.length > 0) await sql`update products set image_url = ${url} where id in ${sql(ids)}`;
    }
  } finally {
    await sql.end();
  }
}
