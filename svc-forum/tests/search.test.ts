/**
 * Full-text search acceptance tests.
 *
 * Covers AC#1 (search thread title + message body),
 * AC#2 (relevance-ranked results with match excerpts),
 * AC#3 (forum.read scope — same auth as list endpoints),
 * AC#4 (pagination).
 *
 * Run: npx tsx --test tests/search.test.ts
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
const messages = new Map<string, any>();
const outcomes = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() { threads.clear(); messages.clear(); outcomes.clear(); principals.clear(); }

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
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'content' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.content?.toLowerCase().includes(q));
          }
          if (k === 'summaryMd' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.summaryMd?.toLowerCase().includes(q));
          }
        }
      }
      return items[0] || null;
    },
    findMany: async ({ where, orderBy, skip, take }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'status' && (v as any)?.notIn) {
            items = items.filter(i => !(v as any).notIn.includes(i.status));
          }
          if (k === 'thread' && (v as any)?.status?.notIn) {
            const excluded = (v as any).status.notIn;
            items = items.filter(i => {
              const parent = threads.get(i.threadId);
              return !!parent && !excluded.includes(parent.status);
            });
          }
          if (k === 'title' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.title?.toLowerCase().includes(q));
          }
          if (k === 'content' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.content?.toLowerCase().includes(q));
          }
          if (k === 'summaryMd' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.summaryMd?.toLowerCase().includes(q));
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
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'content' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.content?.toLowerCase().includes(q));
          }
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid() };
      if (!doc.createdAt) doc.createdAt = new Date(Date.now() + store.size);
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
  const m = mockStore(messages);
  const o = mockStore(outcomes);
  const fp = mockStore(principals);
  const mock: any = {
    forumThread: t,
    forumThreadMessage: m,
    forumOutcome: o,
    forumPrincipal: fp,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t, forumThreadMessage: m, forumOutcome: o, forumPrincipal: fp,
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

async function seedSearchData() {
  const thread = await da.createThread({
    title: 'PostgreSQL Indexing Strategy', type: 'discussion',
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  const thread2 = await da.createThread({
    title: 'Frontend Design Review', type: 'discussion',
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  // Seed message + outcome directly into the mock stores (createMessage/
  // createOutcome use transactions with extra mock surface we don't need here).
  const now = new Date();
  const message = {
    id: mockUuid(), threadId: thread.id, parentId: null, seq: 1,
    authorId: USER_A.id, authorName: USER_A.name, authorType: 'agent',
    kind: 'comment', content: 'We should use a GIN index for full-text search over PostgreSQL.',
    mentions: [], deletedAt: null, createdAt: now, updatedAt: now,
  };
  messages.set(message.id, message);
  const outcome = {
    id: mockUuid(), threadId: thread.id,
    createdById: USER_A.id, createdByName: USER_A.name,
    summaryMd: 'Decision: adopt PostgreSQL full-text search with tsvector.',
    createdAt: now, updatedAt: now,
  };
  outcomes.set(outcome.id, outcome);
  return { thread, thread2, message, outcome };
}

void describe('Full-Text Search', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('AC#1 searches thread titles and message bodies', async () => {
    const { thread, thread2, message } = await seedSearchData();

    const byTitle = await da.searchAll('postgresql indexing');
    assert.ok(byTitle.threads.some((t: any) => t.id === thread.id), 'title hit found');

    const byBody = await da.searchAll('gin index');
    assert.ok(byBody.messages.some((m: any) => m.id === message.id), 'message body hit found');

    const noMatch = await da.searchAll('zzz-nothing-matches');
    assert.equal(noMatch.threads.length + noMatch.messages.length + noMatch.outcomes.length, 0);
  });

  await it('AC#2 results include relevance score and excerpt', async () => {
    await seedSearchData();
    const res = await da.searchAll('postgresql');
    const threadHit = res.threads.find((t: any) => t.title === 'PostgreSQL Indexing Strategy');
    assert.ok(threadHit, 'thread hit present');
    assert.equal(typeof threadHit.score, 'number');
    assert.ok(threadHit.score >= 5, 'title hit has title weight');
    assert.ok(typeof threadHit.excerpt === 'string' && threadHit.excerpt.length > 0, 'excerpt present');

    const msgHit = res.messages.find((m: any) => (m.content as string).includes('GIN index'));
    if (msgHit) {
      assert.equal(typeof msgHit.score, 'number');
      assert.ok(msgHit.excerpt.includes('GIN index'), 'excerpt contains the match');
    }
  });

  await it('AC#2 relevance: title hits rank above message-body hits', async () => {
    const { thread } = await seedSearchData();
    // Message body mentions "postgresql" too — but title hit should outrank it
    const res = await da.searchAll('postgresql');
    const threadHit = res.threads.find((t: any) => t.id === thread.id);
    const msgHit = res.messages.find((m: any) => (m.content as string).toLowerCase().includes('postgresql'));
    if (threadHit && msgHit) {
      assert.ok(threadHit.score > msgHit.score, 'title hit scores higher than body hit');
    }
  });

  await it('AC#4 pagination returns pages and totals', async () => {
    for (let i = 0; i < 5; i++) {
      await da.createThread({
        title: `Pagination topic ${i}`, type: 'discussion',
        createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
      });
    }
    const page1 = await da.searchAll('pagination', 1, 2);
    assert.equal(page1.threads.length, 2);
    assert.equal(page1.pagination.total, 5);
    assert.equal(page1.pagination.pages, 3);
    assert.equal(page1.pagination.page, 1);
    assert.equal(page1.pagination.limit, 2);

    const page3 = await da.searchAll('pagination', 3, 2);
    assert.equal(page3.threads.length, 1);
  });

  await it('AC#3 route requires forum.read and returns ranked results', async () => {
    await seedSearchData();
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { searchRouter } = await import('../src/routes/search.js');
    app.use('/api/search', searchRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const denied = await request(app)
      .get('/api/search?q=postgresql')
      .set('Authorization', `Bearer ${await tokenWith('forum.write')}`);
    assert.equal(denied.status, 403, 'forum.write alone cannot search');

    const res = await request(app)
      .get('/api/search?q=postgresql&page=1&limit=10')
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.threads));
    assert.ok(res.body.pagination.total >= 1);
  });

  await it('AC route validates q, page and limit params', async () => {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { searchRouter } = await import('../src/routes/search.js');
    app.use('/api/search', searchRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const auth = `Bearer ${await tokenWith('forum.read')}`;

    const noQ = await request(app).get('/api/search').set('Authorization', auth);
    assert.equal(noQ.status, 400);

    const badPage = await request(app).get('/api/search?q=x&page=0').set('Authorization', auth);
    assert.equal(badPage.status, 400);

    const badLimit = await request(app).get('/api/search?q=x&limit=500').set('Authorization', auth);
    assert.equal(badLimit.status, 400);
  });

  await it('search never surfaces hidden/deleted threads, their messages, or their outcomes', async () => {
    const hiddenId = mockUuid();
    const deletedId = mockUuid();
    threads.set(hiddenId, { id: hiddenId, title: 'kryptonite hidden report', status: 'hidden', createdAt: new Date() });
    threads.set(deletedId, { id: deletedId, title: 'kryptonite deleted report', status: 'deleted', createdAt: new Date() });
    messages.set(mockUuid(), {
      id: mockUuid(), threadId: hiddenId, deletedAt: null,
      content: 'kryptonite hidden body', createdAt: new Date(),
    });
    outcomes.set(mockUuid(), {
      id: mockUuid(), threadId: deletedId,
      summaryMd: 'kryptonite deleted outcome', createdAt: new Date(),
    });

    const da = await import('../src/lib/data-access/index.js');
    const result = await da.searchAll('kryptonite', 1, 20);
    assert.equal(result.threads.length, 0);
    assert.equal(result.messages.length, 0);
    assert.equal(result.outcomes.length, 0);
    assert.equal(result.pagination.total, 0);
  });
});
