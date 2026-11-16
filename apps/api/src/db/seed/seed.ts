import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import type { AvailabilityEventType } from 'shared';
import { z } from 'zod';
import {
  AVAILABILITY,
  CATEGORIES,
  DEMO_PASSWORD,
  LISTS,
  PRODUCTS,
  RETIRED_CATEGORY_SLUGS,
  RETIRED_PRODUCT_CODES,
  STORES,
  USERS,
  skuOf,
  type StoreKey,
} from './data.js';

// The demo seed (database.md §9). Runs with its own env, never the API's:
// data goes over the admin connection (bypasses RLS), users through the
// Supabase Auth admin API.
//
// Re-runnable without touching anything that isn't the seed's: global rows
// (stores, catalog) have ids derived from their seed key and are upserted;
// users are created or have their demo password reset; the two demo stores'
// tenant-scoped data (assortment, events, lists) is wiped and rebuilt, so
// event ages are always relative to the latest run.
//
// Product images are set afterwards by `seedImages` (images.ts); `db:seed`
// runs both.
const seedEnvSchema = z.object({
  MIGRATIONS_DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});
export type SeedEnv = z.infer<typeof seedEnvSchema>;

export function parseSeedEnv(raw: NodeJS.ProcessEnv): SeedEnv {
  const result = seedEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid seed environment: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
  }
  // dotenv fills only what the shell left unset, so a variable missed on a one-off prod run would
  // silently pair the prod database with the local Supabase (or the reverse). Both must point the same way.
  const isLocal = (url: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  if (isLocal(result.data.MIGRATIONS_DATABASE_URL) !== isLocal(result.data.SUPABASE_URL)) {
    throw new Error('MIGRATIONS_DATABASE_URL and SUPABASE_URL must target the same environment (both local or both remote)');
  }
  return result.data;
}

// A stable uuid for a seed key, so re-runs upsert the same rows.
export function seedId(key: string): string {
  const h = createHash('sha256').update(`repma-seed:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const storeId = (store: StoreKey) => seedId(`tenant:${store}`);

export async function seed(env: SeedEnv): Promise<void> {
  const sql = postgres(env.MIGRATIONS_DATABASE_URL, { onnotice: () => {} });
  const auth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;

  try {
    // Stores first: profiles reference them.
    for (const [key, store] of Object.entries(STORES) as [StoreKey, (typeof STORES)[StoreKey]][]) {
      await sql`
        insert into tenants (id, name, slug) values (${storeId(key)}, ${store.name}, ${store.slug})
        on conflict (id) do update set name = excluded.name, slug = excluded.slug, is_active = true
      `;
    }

    // Users: Auth identity first (admin API), then the profile.
    const userIds = new Map<string, string>();
    for (const user of USERS) {
      const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${user.email}`;
      let id = existing?.id;
      if (id) {
        const { error } = await auth.updateUserById(id, { password: DEMO_PASSWORD, email_confirm: true });
        if (error) throw new Error(`Updating ${user.email}: ${error.message}`);
      } else {
        const { data, error } = await auth.createUser({ email: user.email, password: DEMO_PASSWORD, email_confirm: true });
        if (error) throw new Error(`Creating ${user.email}: ${error.message}`);
        id = data.user.id;
      }
      const tenantId = user.store ? storeId(user.store) : null;
      await sql`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${id}, ${user.email}, ${user.fullName}, ${user.role}, ${tenantId})
        on conflict (id) do update set
          full_name = excluded.full_name, role = excluded.role, tenant_id = excluded.tenant_id, is_active = true
      `;
      userIds.set(user.email, id);
    }

    await sql.begin(async (tx) => {
      // Global catalog.
      // Display order (RF-45): the seed categories first, in data order; any other keeps its place after them.
      const categoryRows = CATEGORIES.map((c, position) => ({ id: seedId(`category:${c.slug}`), position, ...c }));
      await tx`
        insert into categories ${tx(categoryRows, 'id', 'name', 'slug', 'description', 'position')}
        on conflict (id) do update set
          name = excluded.name, slug = excluded.slug, description = excluded.description, position = excluded.position
      `;
      await tx`
        update categories c set position = ${CATEGORIES.length} + o.rn - 1
        from (
          select id, row_number() over (order by position, name, id) as rn from categories
          where id not in ${tx(categoryRows.map((c) => c.id))}
        ) o
        where c.id = o.id
      `;

      const productRows = PRODUCTS.map((p) => ({
        id: seedId(`product:${p.code}`),
        name: p.name,
        category_id: seedId(`category:${p.category}`),
        description: p.description,
      }));
      await tx`
        insert into products ${tx(productRows, 'id', 'name', 'category_id', 'description')}
        on conflict (id) do update set
          name = excluded.name, category_id = excluded.category_id, description = excluded.description,
          is_active = true
      `;

      const sizeRows = PRODUCTS.flatMap((p) =>
        p.sizes.map((label, position) => ({
          id: seedId(`size:${skuOf(p.code, label)}`),
          product_id: seedId(`product:${p.code}`),
          label,
          sku: skuOf(p.code, label),
          position,
          stores: p.stores, // not a column: drives the assortments below
        })),
      );
      await tx`
        insert into product_sizes ${tx(sizeRows, 'id', 'product_id', 'label', 'sku', 'position')}
        on conflict (id) do update set label = excluded.label, sku = excluded.sku, position = excluded.position, is_active = true
      `;
      const sizeIdBySku = new Map(sizeRows.map((s) => [s.sku, s.id]));

      // Per store: wipe and rebuild assortment, events and lists.
      for (const store of Object.keys(STORES) as StoreKey[]) {
        const tenantId = storeId(store);
        await tx`delete from replenishment_lists where tenant_id = ${tenantId}`; // cascades to lines
        await tx`delete from availability_events where tenant_id = ${tenantId}`;
        await tx`delete from assortment_items where tenant_id = ${tenantId}`;

        const manager = userIds.get(`manager.${store}@repma.demo`)!;
        const authors = [manager, userIds.get(`employee.${store}@repma.demo`)!];
        const sizeIdOf = (sku: string) => {
          const id = sizeIdBySku.get(sku);
          if (!id) throw new Error(`Seed data references unknown SKU ${sku}`);
          return id;
        };

        const assortmentRows = sizeRows
          .filter((s) => s.stores.includes(store))
          .map((s) => ({ tenant_id: tenantId, size_id: s.id }));
        const items: { id: string; size_id: string }[] = await tx`
          insert into assortment_items ${tx(assortmentRows, 'tenant_id', 'size_id')} returning id, size_id
        `;
        const itemIdBySizeId = new Map(items.map((i) => [i.size_id, i.id]));
        const itemIdOf = (sku: string) => {
          const id = itemIdBySizeId.get(sizeIdOf(sku));
          if (!id) throw new Error(`Seed data references ${sku}, which is not in ${store}'s assortment`);
          return id;
        };

        // Events alternate out_of_stock/restock (RN-14); the flag is set to
        // the state implied by the latest one (database.md §4.7 invariant).
        for (const { sku, hoursAgo } of AVAILABILITY[store]) {
          const itemId = itemIdOf(sku);
          const events = hoursAgo.map((hours, i) => ({
            tenant_id: tenantId,
            assortment_item_id: itemId,
            type: (i % 2 === 0 ? 'out_of_stock' : 'restock') satisfies AvailabilityEventType,
            created_by: authors[i % 2]!,
            created_at: new Date(Date.now() - hours * 3_600_000),
          }));
          await tx`insert into availability_events ${tx(events, 'tenant_id', 'assortment_item_id', 'type', 'created_by', 'created_at')}`;
          await tx`update assortment_items set is_available = ${hoursAgo.length % 2 === 0} where id = ${itemId}`;
        }

        for (const list of LISTS[store]) {
          const createdAt = new Date(Date.now() - list.daysAgo * 86_400_000);
          const [row]: { id: string }[] = await tx`
            insert into replenishment_lists (tenant_id, name, status, notes, created_by, created_at, updated_at)
            values (${tenantId}, ${list.name}, ${list.status}, ${list.notes}, ${manager}, ${createdAt}, ${createdAt})
            returning id
          `;
          if (list.lines.length === 0) continue;
          const lines = list.lines.map((line) => {
            itemIdOf(line.sku); // RN-12: only sizes in the store's assortment
            return {
              tenant_id: tenantId,
              list_id: row!.id,
              size_id: sizeIdOf(line.sku),
              quantity_requested: line.quantity,
              is_done: line.done,
            };
          });
          await tx`
            insert into replenishment_list_items ${tx(lines, 'tenant_id', 'list_id', 'size_id', 'quantity_requested', 'is_done')}
          `;
        }
      }

      // The retired demo catalog (data.ts): the demo stores no longer carry it, so its rows go
      // wherever no other store does (FKs are restrict); the rest is soft-deleted like the UI would.
      const retiredIds = RETIRED_PRODUCT_CODES.map((code) => seedId(`product:${code}`));
      await tx`
        delete from product_sizes s where s.product_id in ${tx(retiredIds)}
          and not exists (select 1 from assortment_items a where a.size_id = s.id)
      `;
      await tx`
        delete from products p where p.id in ${tx(retiredIds)}
          and not exists (select 1 from product_sizes s where s.product_id = p.id)
      `;
      await tx`update product_sizes set is_active = false where product_id in ${tx(retiredIds)}`;
      await tx`update products set is_active = false, image_url = null where id in ${tx(retiredIds)}`; // its seed image is gone
      const retiredCategoryIds = RETIRED_CATEGORY_SLUGS.map((slug) => seedId(`category:${slug}`));
      await tx`
        delete from categories c where c.id in ${tx(retiredCategoryIds)}
          and not exists (select 1 from products p where p.category_id = c.id)
      `;
    });
  } finally {
    await sql.end();
  }
}
