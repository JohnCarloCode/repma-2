import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 8.4 — RF-17 `POST /products/:id/image`: multipart, one file in
// the `image` field, ≤5 MB (RNF-06), JPEG/PNG by content (magic bytes), stored
// in the public `product-images` bucket of the real local Storage; the public
// URL lands in `products.image_url`. `catalog:manage`, global, write limiter.
// The CSP lets the browser load those URLs (RNF-04). Requires the local
// Supabase stack with Storage and the bucket from supabase/config.toml.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const bucket = supabase.storage.from('product-images');
const PUBLIC_PREFIX = `${env.SUPABASE_URL}/storage/v1/object/public/product-images/`;

const PASSWORD = `image-upload-${randomUUID()}`;
const token = `iu${randomUUID().slice(0, 8)}`;
const store = { id: randomUUID(), name: `${token} Store`, slug: `${token}-store` };
const category = { id: randomUUID(), name: `${token} Cat`, slug: `${token}-cat` };
const productIds = { main: randomUUID(), other: randomUUID() };

interface Fixture {
  role: 'platform_admin' | 'manager';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: store.id, id: '', token: '' },
};

// Smallest valid-looking payloads: the API checks the signature, not the
// whole image, and Storage stores bytes as given.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')]);
const GIF = Buffer.from('GIF89a-gif-body');
const TEXT = Buffer.from('just some text, not an image');
const FIVE_MB = 5 * 1024 * 1024;

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Product not found' } };
const invalid = (path: string, message: string) => ({
  error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: [{ path, message }] },
});

function upload(id: string, user: Fixture = users.admin) {
  return request(app).post(`/api/v1/products/${id}/image`).set('Authorization', `Bearer ${user.token}`);
}

async function imageUrl(id: string): Promise<string | null> {
  const [row] = await admin`select image_url from products where id = ${id}`;
  return row?.image_url ?? null;
}

async function objectsOf(id: string): Promise<string[]> {
  const { data, error } = await bucket.list(id);
  if (error) throw error;
  return data.map((object) => `${id}/${object.name}`);
}

describe('product image upload (RF-17)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store.id}, ${store.name}, ${store.slug})`;
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${category.slug})`;
    for (const [key, id] of Object.entries(productIds)) {
      await admin`insert into products (id, name, category_id) values (${id}, ${`${token} ${key}`}, ${category.id})`;
      await admin`insert into product_sizes (product_id, label, sku) values (${id}, 'One size', ${`${token}-${key}`})`;
    }
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `image-upload-${key}-${randomUUID()}@repma.test`;
      const result = await supabase.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Image upload ${key}`}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const objects = (await Promise.all(Object.values(productIds).map(objectsOf))).flat();
    if (objects.length > 0) await bucket.remove(objects);
    const ids = Object.values(users)
      .map((user) => user.id)
      .filter(Boolean);
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await supabase.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store.id}`;
    await admin`delete from product_sizes where product_id in ${admin(Object.values(productIds))}`;
    await admin`delete from products where id in ${admin(Object.values(productIds))}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app)
        .post(`/api/v1/products/${productIds.other}/image`)
        .attach('image', PNG, 'a.png');
      expect(res.status).toBe(401);
    });

    it('manager (no catalog:manage) → 403, nothing stored', async () => {
      const res = await upload(productIds.other, users.manager).attach('image', PNG, 'a.png');
      expect(res.status).toBe(403);
      expect(await imageUrl(productIds.other)).toBeNull();
      expect(await objectsOf(productIds.other)).toEqual([]);
    });

    it('the CSP lets the browser load images from the Storage origin (RNF-04)', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.headers['content-security-policy']).toContain(
        `img-src 'self' ${new URL(env.SUPABASE_URL).origin}`,
      );
    });
  });

  describe('upload and replacement', () => {
    let firstUrl = '';

    it('PNG → 200 Product, URL persisted, object publicly fetchable, write limiter', async () => {
      const res = await upload(productIds.main).attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' });
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('30');
      expect(res.body).toMatchObject({
        id: productIds.main,
        name: `${token} main`,
        categoryId: category.id,
        isActive: true,
        sizes: [expect.objectContaining({ label: 'One size' })],
      });
      firstUrl = res.body.imageUrl;
      expect(firstUrl).toMatch(new RegExp(`^${PUBLIC_PREFIX}${productIds.main}/[0-9a-f-]{36}\\.png$`));
      expect(await imageUrl(productIds.main)).toBe(firstUrl);

      const object = await fetch(firstUrl);
      expect(object.status).toBe(200);
      expect(object.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await object.arrayBuffer())).toEqual(PNG);
    });

    it('replacement → new URL (cache-busting key), previous object deleted', async () => {
      const res = await upload(productIds.main).attach('image', JPEG, 'new.jpg');
      expect(res.status).toBe(200);
      expect(res.body.imageUrl).toMatch(new RegExp(`^${PUBLIC_PREFIX}${productIds.main}/[0-9a-f-]{36}\\.jpg$`));
      expect(res.body.imageUrl).not.toBe(firstUrl);
      expect(await imageUrl(productIds.main)).toBe(res.body.imageUrl);

      const object = await fetch(res.body.imageUrl);
      expect(object.status).toBe(200);
      expect(object.headers.get('content-type')).toBe('image/jpeg');
      expect(await objectsOf(productIds.main)).toEqual([res.body.imageUrl.slice(PUBLIC_PREFIX.length)]);
      expect((await fetch(firstUrl)).ok).toBe(false);
    });

    it('the type comes from the content, not the declared mimetype or name', async () => {
      const res = await upload(productIds.other).attach('image', PNG, { filename: 'x.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(res.body.imageUrl).toMatch(/\.png$/);
      expect((await fetch(res.body.imageUrl)).headers.get('content-type')).toBe('image/png');
    });
  });

  describe('rejections (nothing stored, URL unchanged)', () => {
    it('a file over 5 MB → 413', async () => {
      const before = await imageUrl(productIds.main);
      const big = Buffer.concat([PNG, Buffer.alloc(FIVE_MB)]);
      const res = await upload(productIds.main).attach('image', big, 'big.png');
      expect(res.status).toBe(413);
      expect(res.body).toEqual({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'The image cannot exceed 5 MB',
          details: [{ path: 'image', message: 'The image cannot exceed 5 MB' }],
        },
      });
      expect(await imageUrl(productIds.main)).toBe(before);
      expect(await objectsOf(productIds.main)).toHaveLength(1);
    });

    it('exactly 5 MB is accepted', async () => {
      const res = await upload(productIds.main).attach('image', Buffer.concat([PNG, Buffer.alloc(FIVE_MB - PNG.length)]), 'max.png');
      expect(res.status).toBe(200);
    });

    it.each([
      ['text renamed .png', TEXT, 'fake.png', 'image/png'],
      ['a GIF', GIF, 'anim.gif', 'image/gif'],
      ['an empty file', Buffer.alloc(0), 'empty.png', 'image/png'],
    ])('%s → 400 on image', async (_label, content, filename, contentType) => {
      const before = await imageUrl(productIds.main);
      const res = await upload(productIds.main).attach('image', content, { filename, contentType });
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid('image', 'The image must be a JPEG or PNG file'));
      expect(await imageUrl(productIds.main)).toBe(before);
    });

    it('no file (multipart without it, or a JSON body) → 400 on image', async () => {
      const multipart = await upload(productIds.main).field('note', 'x');
      expect(multipart.status).toBe(400);
      expect(multipart.body.error.code).toBe('VALIDATION_ERROR');

      const json = await upload(productIds.main).send({ imageUrl: 'https://evil.example/x.png' });
      expect(json.status).toBe(400);
      expect(json.body).toEqual(invalid('image', 'Select an image to upload'));
    });

    it('a file under another field name, or a second file → 400', async () => {
      const wrongField = await upload(productIds.main).attach('photo', PNG, 'a.png');
      expect(wrongField.status).toBe(400);
      expect(wrongField.body).toEqual(invalid('photo', 'Unknown field'));

      const two = await upload(productIds.main).attach('image', PNG, 'a.png').attach('image', PNG, 'b.png');
      expect(two.status).toBe(400);
      expect(two.body).toEqual(invalid('image', 'Upload a single image'));
    });

    it('unknown product → 404, nothing stored', async () => {
      const id = randomUUID();
      const res = await upload(id).attach('image', PNG, 'a.png');
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
      expect(await objectsOf(id)).toEqual([]);
    });

    it('malformed id or any query param → 400', async () => {
      expect((await upload('not-a-uuid').attach('image', PNG, 'a.png')).status).toBe(400);
      const query = await request(app)
        .post(`/api/v1/products/${productIds.main}/image?x=1`)
        .set('Authorization', `Bearer ${users.admin.token}`)
        .attach('image', PNG, 'a.png');
      expect(query.status).toBe(400);
    });
  });
});
