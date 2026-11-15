import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 3.3 — RF-20 `POST /availability/:id/events`, the single write path
// of availability (AD-04, RN-05): `availability:flag`, shop-floor limiter,
// tenantContext (+ RLS), `{type}` as the whole payload (RN-06, RF-22), the
// invariant "flag = latest event; no events → available" (RN-07/RF-24),
// strict alternation (RN-14) including under concurrency. Requires the local
// Supabase stack. Both stores are this file's own, so assertions are exact.

// `availability:flag` is held by every role (architecture.md §6): a switch
// narrows the matrix for the employee to prove the route enforces it.
const narrowed = vi.hoisted(() => ({ flag: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.flag && subject.role === 'employee' && permission === 'availability:flag'
        ? false
        : original.hasPermission(subject, permission),
  };
});

const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `flag-test-${randomUUID()}`;
const storeA = randomUUID();
const storeB = randomUUID();
const categoryId = randomUUID();
const productId = randomUUID();
const PRODUCT = `Flag Runner ${randomUUID().slice(0, 8)}`;
const sizes = { s1: randomUUID(), s2: randomUUID(), s3: randomUUID(), s4: randomUUID() };
// Store A: `fresh` (no events), `race` (concurrency), `access` (the access
// suite's target), `walk` (the alternation walk). Store B: `foreign`.
const items = { fresh: randomUUID(), race: randomUUID(), access: randomUUID(), walk: randomUUID(), foreign: randomUUID() };

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  fullName: string;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager' | 'employee' | 'employeeB', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, fullName: 'Flag Admin', id: '', token: '' },
  manager: { role: 'manager', tenantId: storeA, fullName: 'Flag Manager', id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, fullName: 'Flag Employee', id: '', token: '' },
  employeeB: { role: 'employee', tenantId: storeB, fullName: 'Flag Employee B', id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Item not found' } };

function flag(user: Fixture, id: string, body: unknown, tenantHeader?: string) {
  const req = request(app)
    .post(`/api/v1/availability/${id}/events`)
    .set('Authorization', `Bearer ${user.token}`)
    .send(body as object);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

async function state(id: string) {
  const [row] = await admin<{ is_available: boolean }[]>`select is_available from assortment_items where id = ${id}`;
  const events = await admin<{ id: string; type: string; created_by: string | null; tenant_id: string; created_at: Date }[]>`
    select id, type, created_by, tenant_id, created_at from availability_events
    where assortment_item_id = ${id} order by created_at desc, id desc
  `;
  return { isAvailable: row!.is_available, events };
}

// Fires `requests` while an admin transaction holds the item's row lock, and
// releases it only once both are blocked on that lock in Postgres: the two
// flags are then provably in flight together, whatever the HTTP timing. With
// the service's `FOR UPDATE` they queue at the lock and run one after the
// other; without it both would read the same state and both insert.
async function overlapping<T>(id: string, requests: () => Promise<T>[]): Promise<T[]> {
  let pending!: Promise<T[]>;
  await admin.begin(async (sql) => {
    await sql`select 1 from assortment_items where id = ${id} for update`;
    pending = Promise.all(requests());
    for (let waited = 0; ; waited += 20) {
      const [row] = await admin<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where wait_event_type = 'Lock' and usename = 'repma_api'
      `;
      if (row!.waiting >= 2) break;
      if (waited > 3_000) throw new Error('the two flags never queued on the row lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  return pending;
}

beforeAll(async () => {
  await admin`
    insert into tenants (id, name, slug) values
      (${storeA}, 'Flag A', ${`flag-a-${storeA}`}),
      (${storeB}, 'Flag B', ${`flag-b-${storeB}`})
  `;
  await admin`insert into categories (id, name, slug) values (${categoryId}, ${`Flag Cat ${categoryId}`}, ${`flag-${categoryId}`})`;
  await admin`insert into products (id, name, category_id) values (${productId}, ${PRODUCT}, ${categoryId})`;
  for (const [position, sizeId] of Object.values(sizes).entries()) {
    await admin`
      insert into product_sizes (id, product_id, label, sku, position)
      values (${sizeId}, ${productId}, ${String(40 + position)}, ${`FL-${sizeId}`}, ${position})
    `;
  }
  await admin`
    insert into assortment_items (id, tenant_id, size_id) values
      (${items.fresh}, ${storeA}, ${sizes.s1}),
      (${items.race}, ${storeA}, ${sizes.s2}),
      (${items.access}, ${storeA}, ${sizes.s3}),
      (${items.walk}, ${storeA}, ${sizes.s4}),
      (${items.foreign}, ${storeB}, ${sizes.s1})
  `;

  const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  for (const [key, user] of Object.entries(users)) {
    const email = `flag-${key}-${randomUUID()}@repma.test`;
    const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error) throw created.error;
    user.id = created.data.user.id;
    await admin`
      insert into user_profiles (id, email, full_name, role, tenant_id)
      values (${user.id}, ${email}, ${user.fullName}, ${user.role}, ${user.tenantId})
    `;
    const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
    if (session.error) throw session.error;
    user.token = session.data.session.access_token;
  }
});

afterAll(async () => {
  const userIds = Object.values(users)
    .map((user) => user.id)
    .filter(Boolean);
  await admin`delete from availability_events where tenant_id in ${admin([storeA, storeB])}`;
  await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
  await admin`delete from user_profiles where id in ${admin(userIds)}`;
  for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
  await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
  await admin`delete from product_sizes where product_id = ${productId}`;
  await admin`delete from products where id = ${productId}`;
  await admin`delete from categories where id = ${categoryId}`;
  await admin.end();
});

describe('POST /availability/:id/events — access, params and payload', () => {
  it('without a session → 401', async () => {
    const res = await request(app).post(`/api/v1/availability/${items.access}/events`).send({ type: 'out_of_stock' });
    expect(res.status).toBe(401);
  });

  it('enforces availability:flag: a session without it → uniform 403, nothing recorded', async () => {
    narrowed.flag = true;
    try {
      const res = await flag(users.employee, items.access, { type: 'out_of_stock' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    } finally {
      narrowed.flag = false;
    }
    expect((await state(items.access)).events).toEqual([]);
  });

  it.each([
    ['`is_available` alongside the type (RF-22)', { type: 'out_of_stock', is_available: false }, 'is_available'],
    ['`is_available` alone (RF-22)', { is_available: false }, 'is_available'],
    ['an extra payload field (RN-06)', { type: 'out_of_stock', note: 'box empty' }, 'note'],
    ['an unknown type', { type: 'sold_out' }, 'type'],
    ['no type', {}, 'type'],
  ])('rejects %s → 400 VALIDATION_ERROR, nothing recorded', async (_label, body, path) => {
    const res = await flag(users.employee, items.access, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
    expect(await state(items.access)).toEqual({ isAvailable: true, events: [] });
  });

  it('a query parameter → 400 VALIDATION_ERROR (the route takes none)', async () => {
    const res = await request(app)
      .post(`/api/v1/availability/${items.access}/events`)
      .query({ is_available: 'false' })
      .set('Authorization', `Bearer ${users.employee.token}`)
      .send({ type: 'out_of_stock' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'is_available' }] });
  });

  it('a non-uuid id → 400 VALIDATION_ERROR on `id`', async () => {
    const res = await flag(users.employee, 'not-a-uuid', { type: 'out_of_stock' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'id' }] });
  });

  it("an unknown id and another store's item get the same 404 (RN-03), the foreign item untouched", async () => {
    const unknown = await flag(users.employee, randomUUID(), { type: 'out_of_stock' });
    const foreign = await flag(users.employee, items.foreign, { type: 'out_of_stock' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(NOT_FOUND);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(NOT_FOUND);
    expect(await state(items.foreign)).toEqual({ isAvailable: true, events: [] });
  });

  it("another store's X-Tenant-Id → uniform 403", async () => {
    const res = await flag(users.employee, items.foreign, { type: 'out_of_stock' }, storeB);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await flag(users.admin, items.foreign, { type: 'out_of_stock' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_REQUIRED');
  });

  it('is served under the shop-floor limiter (RNF-07)', async () => {
    const res = await flag(users.employee, items.access, { type: 'restock' }); // available already → 409
    expect(res.status).toBe(409);
    expect(res.headers['ratelimit-limit']).toBe('120');
  });
});

describe('POST /availability/:id/events — the invariant (AD-04)', () => {
  it('an item with no events is available, and restocking it is a 409 (RN-07, RN-14)', async () => {
    expect(await state(items.fresh)).toEqual({ isAvailable: true, events: [] });
    const res = await flag(users.employee, items.fresh, { type: 'restock' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'This size is already available' } });
    expect((await state(items.fresh)).events).toEqual([]);
  });

  it('flagging out of stock → 201 with the updated item; event + flag written together, author from the session', async () => {
    const res = await flag(users.employee, items.fresh, { type: 'out_of_stock' });
    expect(res.status).toBe(201);

    const { isAvailable, events } = await state(items.fresh);
    expect(isAvailable).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'out_of_stock', created_by: users.employee.id, tenant_id: storeA });
    expect(res.body).toEqual({
      id: items.fresh,
      sizeId: sizes.s1,
      label: '40',
      sku: `FL-${sizes.s1}`,
      isAvailable: false,
      isActive: true,
      latestEventAt: events[0]!.created_at.toISOString(),
      product: { id: productId, name: PRODUCT, imageUrl: null, categoryName: `Flag Cat ${categoryId}`, isActive: true },
    });

    // The read side agrees: GET /:id reports the new event as the latest.
    const read = await request(app)
      .get(`/api/v1/availability/${items.fresh}`)
      .set('Authorization', `Bearer ${users.employee.token}`);
    expect(read.body).toEqual(res.body);
  });

  it('a second out_of_stock → 409 naming the state; nothing recorded (RN-14)', async () => {
    const res = await flag(users.manager, items.fresh, { type: 'out_of_stock' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'This size is already out of stock' } });
    const { isAvailable, events } = await state(items.fresh);
    expect(isAvailable).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('across an alternating walk the flag always equals the latest event (strictly alternating history)', async () => {
    const walk = ['out_of_stock', 'restock', 'out_of_stock', 'restock', 'out_of_stock'] as const;
    for (const [index, type] of walk.entries()) {
      const actor = index % 2 === 0 ? users.employee : users.manager;
      const res = await flag(actor, items.walk, { type });
      expect(res.status).toBe(201);
      expect(res.body.isAvailable).toBe(type === 'restock');

      const { isAvailable, events } = await state(items.walk);
      expect(events).toHaveLength(index + 1);
      expect(isAvailable).toBe(events[0]!.type === 'restock');
      expect(res.body.latestEventAt).toBe(events[0]!.created_at.toISOString());
    }
    const { events } = await state(items.walk);
    expect(events.map((event) => event.type).reverse()).toEqual([...walk]);
  });

  it('platform_admin flags under the store’s X-Tenant-Id, recorded as its author', async () => {
    const res = await flag(users.admin, items.foreign, { type: 'out_of_stock' }, storeB);
    expect(res.status).toBe(201);
    const { isAvailable, events } = await state(items.foreign);
    expect(isAvailable).toBe(false);
    expect(events).toEqual([expect.objectContaining({ created_by: users.admin.id, tenant_id: storeB })]);
  });

  it('concurrency: two simultaneous same-type flags → one 201, one 409, exactly one event (RN-14)', async () => {
    const responses = await overlapping(items.race, () => [
      flag(users.employee, items.race, { type: 'out_of_stock' }),
      flag(users.manager, items.race, { type: 'out_of_stock' }),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    const { isAvailable, events } = await state(items.race);
    expect(isAvailable).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('concurrency: two simultaneous opposite flags → both recorded in order, flag = the later one', async () => {
    // `race` is out of stock now: a restock and an out_of_stock race. The lock
    // serializes them; whichever order wins, the history alternates and the
    // flag matches the latest event.
    const responses = await overlapping(items.race, () => [
      flag(users.employee, items.race, { type: 'restock' }),
      flag(users.manager, items.race, { type: 'out_of_stock' }),
    ]);
    const { isAvailable, events } = await state(items.race);
    expect(isAvailable).toBe(events[0]!.type === 'restock');
    const types = events.map((event) => event.type);
    for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
    expect(events).toHaveLength(1 + responses.filter((res) => res.status === 201).length);
  });
});
