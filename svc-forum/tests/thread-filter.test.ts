/**
 * Thread filter parameter tests.
 *
 * Tests cover:
 *   - filter=pinned returns only pinned threads
 *   - filter=featured returns only featured threads
 *   - filter=pinned,featured returns intersection
 *   - filter + pinned/featured together → 400
 *   - invalid filter value → 400
 *   - boolean pinned/featured params still work (backward compat)
 *
 * Run: npx tsx --test tests/thread-filter.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

let _jwksCleanup: { url: string; close: () => void };
let _signTestToken: typeof import('./helpers/auth-keys.js').signTestToken;

before(async () => {
  const { startTestJwksServer } = await import('./helpers/jwks-server.js');
  _jwksCleanup = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = _jwksCleanup.url;
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

describe('GET /api/threads filter parameter', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');

  const threads = new Map<string, any>();
  const participants = new Map<string, any>();
  const messages = new Map<string, any>();
  const snapshots = new Map<string, any>();
  const outcomes = new Map<string, any>();

  function mockUuid(): string {
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += h[(Math.random() * 4 | 0) + 8];
      else s += h[(Math.random() * 16) | 0];
    }
    return s;
  }

  function resetDb() {
    threads.clear();
    participants.clear();
    messages.clear();
    snapshots.clear();
    outcomes.clear();
  }

  function mockStore(store: Map<string, any>) {
    return {
      findUnique: async ({ where }: any) => {
        if (where.id) return store.get(where.id) || null;
        if (where.threadId_agentId) {
          const { threadId, agentId } = where.threadId_agentId;
          for (const v of store.values()) {
            if (v.threadId === threadId && v.agentId === agentId) return v;
          }
          return null;
        }
        return null;
      },
      findFirst: async () => null,
      findMany: async ({ where, orderBy, skip, take }: any = {}) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'type') items = items.filter(i => i.type === v);
            if (k === 'pinned' && typeof v === 'boolean') items = items.filter(i => i.pinned === v);
            if (k === 'featured' && typeof v === 'boolean') items = items.filter(i => i.featured === v);
            if (k === 'status') {
              if (typeof v === 'string') items = items.filter(i => i.status === v);
              else if (v?.not) items = items.filter(i => i.status !== v.not);
            }
            if (k === 'AND' && Array.isArray(v)) {
              for (const cond of v) {
                for (const [ck, cv] of Object.entries(cond)) {
                  if (ck === 'pinned' && typeof cv === 'boolean') items = items.filter(i => i.pinned === cv);
                  if (ck === 'featured' && typeof cv === 'boolean') items = items.filter(i => i.featured === cv);
                }
              }
            }
          }
        }
        if (orderBy) {
          const obs = Array.isArray(orderBy) ? orderBy : [orderBy];
          for (const ob of obs) {
            const [field, dir] = Object.entries(ob)[0] as [string, string];
            items.sort((a, b) => {
              const av = a[field]?.getTime?.() ?? (typeof a[field] === 'string' ? new Date(a[field]).getTime() : Number(a[field]) || 0);
              const bv = b[field]?.getTime?.() ?? (typeof b[field] === 'string' ? new Date(b[field]).getTime() : Number(b[field]) || 0);
              return dir === 'desc' ? bv - av : av - bv;
            });
          }
        }
        if (skip) items = items.slice(skip);
        if (take) items = items.slice(0, take);
        return items;
      },
      count: async ({ where }: any = {}) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'pinned' && typeof v === 'boolean') items = items.filter(i => i.pinned === v);
            if (k === 'featured' && typeof v === 'boolean') items = items.filter(i => i.featured === v);
            if (k === 'status') {
              if (typeof v === 'string') items = items.filter(i => i.status === v);
              else if (v?.not) items = items.filter(i => i.status !== v.not);
            }
            if (k === 'AND' && Array.isArray(v)) {
              for (const cond of v) {
                for (const [ck, cv] of Object.entries(cond)) {
                  if (ck === 'pinned' && typeof cv === 'boolean') items = items.filter(i => i.pinned === cv);
                  if (ck === 'featured' && typeof cv === 'boolean') items = items.filter(i => i.featured === cv);
                }
              }
            }
          }
        }
        return items.length;
      },
      create: async ({ data }: any) => {
        const defaults: Record<string, any> = { status: 'open', messageCount: 0, type: 'discussion', createdByType: 'agent', tags: [], mentions: [], pinned: false, featured: false };
        const doc = { ...defaults, ...data, id: data.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        if (!doc.updatedAt) doc.updatedAt = new Date();
        if (!doc.lastMessageAt) doc.lastMessageAt = new Date();
        store.set(doc.id, doc);
        return doc;
      },
      update: async ({ where, data }: any) => {
        const existing = store.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.set(where.id, updated);
        return updated;
      },
      updateMany: async () => ({ count: 0 }),
    };
  }

  function createMockPrisma() {
    return {
      forumThread: mockStore(threads),
      forumThreadParticipant: mockStore(participants),
      forumThreadMessage: mockStore(messages),
      forumContextSnapshot: mockStore(snapshots),
      forumOutcome: mockStore(outcomes),
      forumPrincipal: {
        findUnique: async () => null,
        findFirst: async () => null,
        create: async ({ data }: any) => data,
        update: async ({ data }: any) => data,
      },
      $queryRaw: async () => [{}],
      $transaction: async (fn: (tx: any) => any) => fn({
        forumThread: mockStore(threads),
        forumThreadParticipant: mockStore(participants),
        forumThreadMessage: { ...mockStore(messages), count: async () => 0 },
        forumContextSnapshot: mockStore(snapshots),
        forumOutcome: mockStore(outcomes),
        forumPrincipal: { findUnique: async () => null, create: async ({ data }: any) => data, update: async ({ data }: any) => data },
        $executeRaw: async () => {},
      }),
      $disconnect: async () => {},
    };
  }

  const USER_A = { id: '550e8400-e29b-41d4-a716-446655440010', name: 'Agent Alpha' };

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  async function createApp() {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    return app;
  }

  async function getToken() {
    return _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });
  }

  async function seedThreads() {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;

    // Create 4 threads: plain, pinned, featured, pinned+featured
    const plain = await request(app).post('/api/threads').set('Authorization', `Bearer ${token}`).send({ title: 'Plain Thread' });
    const pinned = await request(app).post('/api/threads').set('Authorization', `Bearer ${token}`).send({ title: 'Pinned Thread' });
    const featured = await request(app).post('/api/threads').set('Authorization', `Bearer ${token}`).send({ title: 'Featured Thread' });
    const both = await request(app).post('/api/threads').set('Authorization', `Bearer ${token}`).send({ title: 'Pinned+Featured Thread' });

    // Set pinned/featured via data-access (simulating moderator action)
    await da.updateThread(pinned.body.thread.id, { pinned: true });
    await da.updateThread(featured.body.thread.id, { featured: true });
    await da.updateThread(both.body.thread.id, { pinned: true, featured: true });

    return { plain, pinned, featured, both };
  }

  // ── 1. filter=pinned returns only pinned threads ──
  await it('filter=pinned returns only pinned threads', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads?filter=pinned')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    const titles = res.body.items.map((t: any) => t.title);
    assert.ok(titles.includes('Pinned Thread'), 'should include Pinned Thread');
    assert.ok(titles.includes('Pinned+Featured Thread'), 'should include Pinned+Featured Thread');
    assert.ok(!titles.includes('Plain Thread'), 'should NOT include Plain Thread');
    assert.ok(!titles.includes('Featured Thread'), 'should NOT include Featured-only Thread');
  });

  // ── 2. filter=featured returns only featured threads ──
  await it('filter=featured returns only featured threads', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads?filter=featured')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    const titles = res.body.items.map((t: any) => t.title);
    assert.ok(titles.includes('Featured Thread'), 'should include Featured Thread');
    assert.ok(titles.includes('Pinned+Featured Thread'), 'should include Pinned+Featured Thread');
    assert.ok(!titles.includes('Plain Thread'), 'should NOT include Plain Thread');
    assert.ok(!titles.includes('Pinned Thread'), 'should NOT include Pinned-only Thread');
  });

  // ── 3. filter=pinned,featured returns intersection ──
  await it('filter=pinned,featured returns only threads that are both', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads?filter=pinned,featured')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    const titles = res.body.items.map((t: any) => t.title);
    assert.deepEqual(titles, ['Pinned+Featured Thread']);
  });

  // ── 4. filter + pinned together → 400 ──
  await it('filter + pinned together returns 400', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;

    const res = await request(app)
      .get('/api/threads?filter=pinned&pinned=true')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('filter'), 'error message should mention filter');
  });

  // ── 5. filter + featured together → 400 ──
  await it('filter + featured together returns 400', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;

    const res = await request(app)
      .get('/api/threads?filter=featured&featured=true')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('filter'), 'error message should mention filter');
  });

  // ── 6. invalid filter value → 400 ──
  await it('invalid filter value returns 400', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;

    const res = await request(app)
      .get('/api/threads?filter=invalid')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('filter'), 'error message should mention filter');
  });

  // ── 7. Boolean pinned=true still works (backward compat) ──
  await it('boolean pinned=true still works without filter', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads?pinned=true')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    const titles = res.body.items.map((t: any) => t.title);
    assert.ok(titles.includes('Pinned Thread'), 'should include Pinned Thread');
    assert.ok(titles.includes('Pinned+Featured Thread'), 'should include Pinned+Featured Thread');
    assert.ok(!titles.includes('Plain Thread'), 'should NOT include Plain Thread');
  });

  // ── 8. No filter/pinned/featured returns all threads ──
  await it('no filter returns all threads', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 4);
  });

  // ── 9. filter=featured,pinned also works (order-independent) ──
  await it('filter=featured,pinned works (order-independent)', async () => {
    const app = await createApp();
    const token = await getToken();
    const request = (await import('supertest')).default;
    await seedThreads();

    const res = await request(app)
      .get('/api/threads?filter=featured,pinned')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    const titles = res.body.items.map((t: any) => t.title);
    assert.deepEqual(titles, ['Pinned+Featured Thread']);
  });
});
