/**
 * Tag filtering acceptance tests.
 *
 * Covers AC#1 (list endpoint tag=<name> filter, multi-tag AND/OR combos),
 * AC#2 (tag thread-count stats), AC#3 (case-insensitive tag names),
 * AC#4 (tag + sort combination).
 *
 * Run: npx tsx --test tests/tags.test.ts
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

const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };

const threads = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() { threads.clear(); principals.clear(); }

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

function mockStore(store: Map<string, any>) {
  return {
    findUnique: async ({ where }: any) => {
      if (where.id) return store.get(where.id) || null;
      if (where.authSubject_principalType) {
        const { authSubject, principalType } = where.authSubject_principalType;
        for (const v of store.values()) {
          if (v.authSubject === authSubject && v.principalType === principalType) return v;
        }
        return null;
      }
      return null;
    },
    findFirst: async ({ where }: any) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'status') {
            if (typeof v === 'string') items = items.filter(i => i.status === v);
            else if (v?.not) items = items.filter(i => i.status !== v.not);
          }
          if (k === 'tags' && v && typeof v === 'object') {
            if (Array.isArray(v.hasEvery)) {
              items = items.filter(i => v.hasEvery.every((t: string) => (i.tags || []).includes(t)));
            }
            if (Array.isArray(v.hasSome)) {
              items = items.filter(i => v.hasSome.some((t: string) => (i.tags || []).includes(t)));
            }
          }
        }
      }
      return items[0] || null;
    },
    findMany: async ({ where, orderBy, skip, take }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'status') {
            if (typeof v === 'string') items = items.filter(i => i.status === v);
            else if (v?.not) items = items.filter(i => i.status !== v.not);
          }
          if (k === 'tags' && v && typeof v === 'object') {
            if (Array.isArray(v.hasEvery)) {
              items = items.filter(i => v.hasEvery.every((t: string) => (i.tags || []).includes(t)));
            }
            if (Array.isArray(v.hasSome)) {
              items = items.filter(i => v.hasSome.some((t: string) => (i.tags || []).includes(t)));
            }
          }
          if (k === 'OR' && Array.isArray(v)) {
            items = items.filter(item =>
              v.some((c: any) => {
                if (c.title?.contains) return item.title?.toLowerCase().includes(c.title.contains.toLowerCase());
                return false;
              })
            );
          }
        }
      }
      if (orderBy) {
        const obs = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const ob of obs) {
          const [field, dir] = Object.entries(ob)[0] as [string, string];
          items.sort((a, b) => {
            const av = a[field]?.getTime?.() ?? (typeof a[field] === 'string' ? new Date(a[field]).getTime() : 0);
            const bv = b[field]?.getTime?.() ?? (typeof b[field] === 'string' ? new Date(b[field]).getTime() : 0);
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
          if (k === 'status') {
            if (typeof v === 'string') items = items.filter(i => i.status === v);
            else if (v?.not) items = items.filter(i => i.status !== v.not);
          }
          if (k === 'tags' && v && typeof v === 'object') {
            if (Array.isArray(v.hasEvery)) {
              items = items.filter(i => v.hasEvery.every((t: string) => (i.tags || []).includes(t)));
            }
            if (Array.isArray(v.hasSome)) {
              items = items.filter(i => v.hasSome.some((t: string) => (i.tags || []).includes(t)));
            }
          }
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid() };
      if (!doc.createdAt) doc.createdAt = new Date(Date.now() + store.size); // ensure strictly increasing for sort tests
      if (!doc.updatedAt) doc.updatedAt = new Date(Date.now() + store.size);
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
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const fp = mockStore(principals);
  const mock: any = {
    forumThread: t,
    forumPrincipal: fp,
    // getTagStats uses $queryRaw (unnest + group by) — simulate aggregation.
    $queryRaw: async (strings: TemplateStringsArray, ..._args: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('unnest(tags)')) {
        const counts = new Map<string, number>();
        for (const th of threads.values()) {
          if (th.status === 'deleted') continue;
          for (const tag of th.tags || []) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
          }
        }
        return Array.from(counts.entries())
          .map(([tag, count]) => ({ tag, count: BigInt(count) }))
          .sort((a, b) => Number(b.count) - Number(a.count) || a.tag.localeCompare(b.tag));
      }
      return [];
    },
    $transaction: async (fn: (tx: any) => any) => fn({ forumThread: t, forumPrincipal: fp, $executeRaw: async () => {} }),
    $disconnect: async () => {},
  };
  return mock;
}

function tokenWith(scope: string) {
  return _signTestToken({
    sub: '550e8400-e29b-41d4-a716-446655440099',
    agent_id: 'test-agent',
    client_id: 'mc_test',
    scope,
  });
}

let da: typeof import('../src/lib/data-access.js');
let prismaMod: typeof import('../src/lib/prisma.js');

async function seedThreads() {
  const t1 = await da.createThread({
    title: 'Bug in login flow', type: 'discussion',
    tags: ['bug', 'backend'],
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  const t2 = await da.createThread({
    title: 'Feature: dark mode', type: 'discussion',
    tags: ['feature', 'frontend'],
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  const t3 = await da.createThread({
    title: 'Bug + Feature combined', type: 'discussion',
    tags: ['bug', 'feature'],
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  return { t1, t2, t3 };
}

void describe('Tag Filtering', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('AC#1 tag=<name> filters threads containing that tag', async () => {
    const { t1, t2, t3 } = await seedThreads();
    const res = await da.findThreads({ tagsAnd: ['bug'] });
    const ids = res.items.map((i: any) => i.id).sort();
    assert.deepEqual(ids, [t1.id, t3.id].sort());
    assert.equal(res.total, 2);
  });

  await it('AC#1 multiple tag params = AND (thread must contain all)', async () => {
    const { t1, t2, t3 } = await seedThreads();
    const res = await da.findThreads({ tagsAnd: ['bug', 'feature'] });
    const ids = res.items.map((i: any) => i.id);
    assert.deepEqual(ids, [t3.id]);
    assert.equal(res.total, 1);
  });

  await it('AC#1 comma-separated tag values = OR (contains at least one)', async () => {
    const { t1, t2, t3 } = await seedThreads();
    const res = await da.findThreads({ tagsOr: ['backend', 'frontend'] });
    const ids = res.items.map((i: any) => i.id).sort();
    assert.deepEqual(ids, [t1.id, t2.id].sort());
    assert.equal(res.total, 2);
  });

  await it('AC#2 tag stats return count per tag', async () => {
    await seedThreads();
    const stats = await da.getTagStats(10);
    const byTag = Object.fromEntries(stats.map(s => [s.tag, s.count]));
    assert.equal(byTag['bug'], 2);
    assert.equal(byTag['feature'], 2);
    assert.equal(byTag['backend'], 1);
    assert.equal(byTag['frontend'], 1);
  });

  await it('AC#3 tag names are case-insensitive (stored lowercased, query any case)', async () => {
    const { t1 } = await seedThreads();
    // Stored tags are normalized toLowerCase by createThread
    const created = await da.findThreadById(t1.id);
    assert.ok(created.tags.includes('bug'));

    const resUpper = await da.findThreads({ tagsAnd: ['BUG'] });
    assert.equal(resUpper.total, 2);
    const resMixed = await da.findThreads({ tagsAnd: ['Bug'] });
    assert.equal(resMixed.total, 2);
  });

  await it('AC#4 tag filter combines with sort param', async () => {
    const { t1, t3 } = await seedThreads();
    // Sort by latest (createdAt desc): t3 created after t1
    const res = await da.findThreads({ tagsAnd: ['bug'], sort: 'latest' });
    assert.equal(res.total, 2);
    assert.equal(res.items[0].id, t3.id);
    assert.equal(res.items[1].id, t1.id);
  });

  await it('AC#1 route: GET /api/threads?tag=bug filters; tag=bug&tag=feature = AND', async () => {
    const { t1, t2, t3 } = await seedThreads();
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    app.use('/api/threads', threadsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const auth = `Bearer ${await tokenWith('forum.read')}`;

    const single = await request(app).get('/api/threads?tag=bug').set('Authorization', auth);
    assert.equal(single.status, 200);
    assert.equal(single.body.total, 2);

    const and = await request(app).get('/api/threads?tag=bug&tag=feature').set('Authorization', auth);
    assert.equal(and.status, 200);
    assert.equal(and.body.total, 1);
    assert.equal(and.body.items[0].id, t3.id);

    const or = await request(app).get('/api/threads?tag=backend,frontend').set('Authorization', auth);
    assert.equal(or.status, 200);
    assert.equal(or.body.total, 2);
  });

  await it('AC#2 route: GET /api/tags/stats returns tag counts', async () => {
    await seedThreads();
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { tagsRouter } = await import('../src/routes/tags.js');
    app.use('/api/tags', tagsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const res = await request(app)
      .get('/api/tags/stats')
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.tags));
    const byTag = Object.fromEntries(res.body.tags.map((s: any) => [s.tag, Number(s.count)]));
    assert.equal(byTag['bug'], 2);
    assert.equal(byTag['feature'], 2);
  });
});
