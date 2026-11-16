import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// architecture.md §8 — the anon key serves only Supabase Auth's token grants
// (password login, RF-01; refresh, AD-23), never data. A fresh client per
// call: supabase-js keeps the signed-in session inside the client instance,
// and a shared one would hold whichever user logged in last.
export function createAuthClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Service-role client (architecture.md §3.1 point 2): identity and file
// operations only, never data. It keeps no session, so one shared instance is safe.
const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// RF-10/RF-11/RF-12 — Supabase Auth's admin API: creates, updates and deletes
// identities for the users module.
export const authAdmin = serviceClient.auth.admin;

// RF-17 — the public product-image bucket (AD-02). Declared in
// supabase/config.toml locally; created by hand in production (plan Manual 8-A).
export const PRODUCT_IMAGES_BUCKET = 'product-images';
const productImages = () => serviceClient.storage.from(PRODUCT_IMAGES_BUCKET);

// The public URL prefix of every object in the bucket
// (`<SUPABASE_URL>/storage/v1/object/public/product-images/`).
export const productImagesBaseUrl = productImages().getPublicUrl('').data.publicUrl.replace(/\/?$/, '/');

// Stores bytes under `key` (never overwriting) and answers its public URL.
// Objects are immutable (a new key per upload), so they are cached for a year.
export async function putProductImage(key: string, content: Buffer, contentType: string): Promise<string> {
  const { error } = await productImages().upload(key, content, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(`Product image upload failed: ${error.message}`, { cause: error });
  return `${productImagesBaseUrl}${key}`;
}

// Best effort: a failed delete leaves a harmless orphan, never an error.
export async function removeProductImage(key: string): Promise<void> {
  await productImages().remove([key]);
}
