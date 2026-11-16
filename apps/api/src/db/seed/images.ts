import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { PRODUCTS } from './data.js';
import { seedId, type SeedEnv } from './seed.js';

// The seed's product images (database.md §9): one generated photo per seed
// product, committed under `./images/<code>.webp` (800px WebP), uploaded to the
// public bucket under `seed/<code>.webp` and set as that product's `image_url`
// — matched by its stable seed id, so no other product is touched.
//
// Idempotent: uploads upsert the same keys, the update rewrites the same URLs
// and any other object under `seed/` (a retired seed image) is removed.
// Objects live under `seed/`, never under a product's own folder, so an
// image replaced from the UI never deletes them (architecture.md §7,
// `POST /products/:id/image`).

// Same bucket as `PRODUCT_IMAGES_BUCKET` in lib/supabase.ts, which can't be
// imported here: it validates the API's env, and this runs with the seed's.
export const SEED_IMAGES_BUCKET = 'product-images';
export const seedImageKey = (code: string) => `seed/${code}.webp`;

export async function seedImages(env: SeedEnv): Promise<void> {
  const bucket = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).storage.from(SEED_IMAGES_BUCKET);
  const sql = postgres(env.MIGRATIONS_DATABASE_URL, { onnotice: () => {} });

  try {
    for (const { code } of PRODUCTS) {
      const key = seedImageKey(code);
      const content = await readFile(new URL(`./images/${code}.webp`, import.meta.url));
      // Upsert keeps the key stable across runs, so a short cache lets a
      // regenerated image reach browsers within a day.
      const { error } = await bucket.upload(key, content, { contentType: 'image/webp', cacheControl: '86400', upsert: true });
      if (error) throw new Error(`Uploading ${key}: ${error.message}`, { cause: error });

      const url = bucket.getPublicUrl(key).data.publicUrl;
      await sql`update products set image_url = ${url} where id = ${seedId(`product:${code}`)}`;
    }

    const current = new Set(PRODUCTS.map((p) => seedImageKey(p.code)));
    const { data: objects, error } = await bucket.list('seed', { limit: 1000 });
    if (error) throw new Error(`Listing seed/: ${error.message}`, { cause: error });
    const stale = objects.map((o) => `seed/${o.name}`).filter((key) => !current.has(key));
    if (stale.length > 0) {
      const { error: removeError } = await bucket.remove(stale);
      if (removeError) throw new Error(`Removing ${stale.join(', ')}: ${removeError.message}`, { cause: removeError });
    }
  } finally {
    await sql.end();
  }
}
