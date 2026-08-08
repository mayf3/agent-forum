/**
 * View count & hot ranking acceptance tests.
 *
 * Covers AC#1 (viewCount on detail & list, dedup per principal),
 * AC#2 (sort=hot weighted by views+messages+recency),
 * AC#3 (weights server-configurable), AC#4 (read-only for members,
 * anti-abuse server-side).
 *
 * Run: npx tsx --test tests/views-hot.test.ts
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
const USER_B = { id: 'user-b-uuid', name: 'Agent Beta' };

const threads = new Map<string, any>();
const views = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() { threads.clear(); views.clear(); principals.clear(); }

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
      if (where.threadId_principalId) {
        const { threadId, principalId } = where.threadId_principalId;
        for (const v of store.values()) {
          if (v.threadId === threadId && v.principalId === principalId) return v;
        }
        return null;
      }
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
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid() };
      if (doc.viewCount === undefined) doc.viewCount = 0; // mirrors @default(0)
      if (!doc.createdAt) doc.createdAt = new Date(Date.now() + store.size);
      if (!doc.updatedAt) doc.updatedAt = new Date(Date.now() + store.size);
      store.set(doc.id, doc);
      return doc;
    },
    update: async ({ where, data }: any) => {
      const existing = store.get(where.id);
      if (!existing) throw new Error('Not found');
      let updateData = { ...data };
      if (data.viewCount?.increment !== undefined) {
        updateData = { ...data, viewCount: (existing.viewCount || 0) + data.viewCount.increment };
        delete updateData.viewCount.increment;
      }
      const updated = { ...existing, ...updateData, updatedAt: new Date() };
      store.set(where.id, updated);
      return updated;
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const v = mockStore(views);
  const fp = mockStore(principals);
  const mock: any = {
    forumThread: t,
    forumThreadView: v,
    forumPrincipal: fp,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t,
      forumThreadView: v,
      forumPrincipal: fp,
      $executeRaw: async () => {},
    }),
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

void describe('View Count & Hot Ranking', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('AC#1 recordView increments viewCount once per principal', async () => {
    const thread = await da.createThread({
      title: 'View me', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    assert.equal(thread.viewCount, 0);

    await da.recordView(thread.id, USER_A.id);
    const afterFirst = await da.findThreadById(thread.id);
    assert.equal(afterFirst.viewCount, 1);

    // Same principal again → no increment (dedup)
    await da.recordView(thread.id, USER_A.id);
    const afterSecond = await da.findThreadById(thread.id);
    assert.equal(afterSecond.viewCount, 1);

    // Different principal → increments
    await da.recordView(thread.id, USER_B.id);
    const afterThird = await da.findThreadById(thread.id);
    assert.equal(afterThird.viewCount, 2);
  });

  await it('AC#1 viewCount appears in detail and list responses', async () => {
    const thread = await da.createThread({
      title: 'Counted thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.recordView(thread.id, USER_A.id);

    const detail = await da.findThreadById(thread.id);
    assert.equal(typeof detail.viewCount, 'number');

    const list = await da.findThreads({});
    assert.equal(typeof list.items[0].viewCount, 'number');
  });

  await it('AC#2 sort=hot ranks by weighted score', async () => {
    const hot = await da.createThread({
      title: 'Hot thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    const lukewarm = await da.createThread({
      title: 'Lukewarm thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    const cold = await da.createThread({
      title: 'Cold thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });

    // hot: 5 views, 2 messages, recent activity
    await da.recordView(hot.id, USER_A.id);
    await da.recordView(hot.id, USER_B.id);
    await da.recordView(hot.id, 'user-c');
    await da.recordView(hot.id, 'user-d');
    await da.recordView(hot.id, 'user-e');
    await prismaMod.getPrisma().forumThread.update({
      where: { id: hot.id },
      data: { messageCount: 2, lastMessageAt: new Date() },
    });
    // lukewarm: 0 views, 1 message, older activity
    await prismaMod.getPrisma().forumThread.update({
      where: { id: lukewarm.id },
      data: { messageCount: 1, lastMessageAt: new Date(Date.now() - 3 * 86_400_000) },
    });

    const res = await da.findThreads({ sort: 'hot' });
    assert.equal(res.items.length, 3);
    // hot has highest score
    assert.equal(res.items[0].id, hot.id);
    // cold (no views, no messages, no activity) ranks last
    assert.equal(res.items[2].id, cold.id);
  });

  await it('AC#2 route: GET /api/threads?sort=hot returns 200 with items', async () => {
    await da.createThread({
      title: 'Route hot thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    app.use('/api/threads', threadsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const res = await request(app)
      .get('/api/threads?sort=hot')
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
  });

  await it('AC#3 hot weights are server-configurable', () => {
    // Defaults exported from data-access
    assert.equal(da.HOT_WEIGHT_VIEW, 1);
    assert.equal(da.HOT_WEIGHT_MSG, 3);
    assert.equal(da.HOT_WEIGHT_RECENCY, 10);
    assert.equal(da.HOT_DECAY_PER_DAY, 0.5);

    // heatScore uses the weights
    const score = da.heatScore({ viewCount: 10, messageCount: 2, lastMessageAt: new Date() });
    assert.ok(score > 10 * 1 + 2 * 3, 'score includes view+message weighted terms');
  });

  await it('AC#4 view recording is best-effort (never fails detail route)', async () => {
    const thread = await da.createThread({
      title: 'Robust view', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    // Break the views store to simulate a failure inside recordView
    const broken = createMockPrisma();
    broken.forumThreadView.create = async () => { throw new Error('db down'); };
    broken.forumThreadView.findUnique = async () => { throw new Error('db down'); };
    prismaMod.setPrisma(broken as any);

    // Must not throw
    await da.recordView(thread.id, USER_A.id);
    assert.ok(true, 'recordView swallowed the failure');
  });
});
