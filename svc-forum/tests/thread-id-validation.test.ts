/**
 * Thread ID UUID validation and malformed JSON error handling tests.
 *
 * Tests cover:
 *   - isUuid helper (1-4)
 *   - Guarded data-access functions with non-UUID (5-7)
 *   - Route-level non-UUID threadId (8-16)
 *
 * Run: npx tsx --test tests/thread-id-validation.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Test JWKS + deferred signTestToken (standard OAuth RS256) ──────────
// The JWKS server starts (and AUTH_JWKS_URL is set) BEFORE the first import
// of any src module so auth-jwt.ts freezes the test URL at module load.
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

void describe('isUuid validation helper', async () => {
  let isUuid: typeof import('../src/utils/uuid.js').isUuid;

  before(async () => {
    isUuid = (await import('../src/utils/uuid.js')).isUuid;
  });

  await it('1. isUuid(valid UUID) returns true', async () => {
    assert.ok(isUuid('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(isUuid('11111111-1111-4111-8111-111111111111'));
    assert.ok(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  });

  await it('2. isUuid(8-char short id) returns false', async () => {
    assert.ok(!isUuid('550e8400'));
    assert.ok(!isUuid('abc12345'));
  });

  await it('3. isUuid(invalid chars) returns false', async () => {
    assert.ok(!isUuid('not-a-uuid'));
    assert.ok(!isUuid('blog-agent'));
    assert.ok(!isUuid('writing-style-analyst'));
    assert.ok(!isUuid('user-a-uuid'));
    assert.ok(!isUuid('thread-1'));
    assert.ok(!isUuid(''));
    assert.ok(!isUuid(null));
    assert.ok(!isUuid(undefined));
    assert.ok(!isUuid(12345));
  });

  await it('4. isUuid(URL fragment / version-like) returns false', async () => {
    assert.ok(!isUuid('550e8400-e29b-41d4-a716-446655440000/'));
    assert.ok(!isUuid('v1-550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(!isUuid('550e8400-e29b-41d4-a716-446655440000?foo=bar'));
    // g-UUID / CUID-like (too long, wrong format)
    assert.ok(!isUuid('00000000-0000-0000-0000-00000000000g')); // non-hex char
    assert.ok(!isUuid('00000000-0000-0000-0000-00000000000'));  // too short
    assert.ok(!isUuid('00000000-0000-0000-0000-0000000000000')); // too long
  });
});

// ══════════════════════════════════════════════════════════════
//  Guarded data-access functions
// ══════════════════════════════════════════════════════════════

void describe('Guarded data-access functions', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');
  // In-memory store
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

  function mockStore(store: Map<string, any>, name: string) {
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
        if (where.idempotencyKey) {
          for (const v of store.values()) {
            if (v.idempotencyKey === where.idempotencyKey) return v;
          }
          return null;
        }
        return null;
      },
      findFirst: async ({ where, orderBy }: any) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
            if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
            if (k === 'kind' && typeof v === 'object' && v !== null && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
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
        return items[0] || null;
      },
      findMany: async ({ where, orderBy, skip, take }: any = {}) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'runId') items = items.filter(i => i.runId === v);
            if (k === 'type') items = items.filter(i => i.type === v);
            if (k === 'status') items = items.filter(i => i.status === v);
            if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
            if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
            if (k === 'kind' && typeof v === 'object' && v !== null && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
            }
            if (k === 'title' && (v as any)?.contains) {
              const q = (v as any).contains.toLowerCase();
              items = items.filter(i => i.title?.toLowerCase().includes(q));
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
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'participants' && (v as any)?.some) {
              const cond = (v as any).some;
              items = items.filter(item => {
                for (const p of participants.values()) {
                  if (p.threadId === item.id && p.agentId === cond.agentId) return true;
                }
                return false;
              });
            }
          }
        }
        return items.length;
      },
      create: async ({ data }: any) => {
        const defaults: Record<string, any> = { status: 'open', messageCount: 0, type: 'discussion', createdByType: 'agent', tags: [], mentions: [] };
        const doc = { ...defaults, ...data, id: data.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        if (!doc.updatedAt) doc.updatedAt = new Date();
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
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, item] of store) {
          let match = true;
          if (where) {
            for (const [k, v] of Object.entries(where)) {
              if ((item as any)[k] !== v) { match = false; break; }
            }
          }
          if (match) {
            store.set(id, { ...item, ...data, updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },
    };
  }

  function createMockPrisma() {
    const t = mockStore(threads, 'thread');
    const p = mockStore(participants, 'participant');
    const m = mockStore(messages, 'message');
    const s = mockStore(snapshots, 'snapshot');
    const o = mockStore(outcomes, 'outcome');

    return {
      forumThread: t,
      forumThreadParticipant: p,
      forumThreadMessage: m,
      forumContextSnapshot: s,
      forumOutcome: o,
      $queryRaw: async () => [{ 1: 1 }],
      $transaction: async (fn: (tx: any) => any) => fn({
        forumThread: t,
        forumThreadParticipant: p,
        forumThreadMessage: { ...m, count: async ({ where }: any = {}) => { let items = Array.from(messages.values()); if (where?.threadId) items = items.filter(i => i.threadId === where.threadId); if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt); return items.length; } },
        forumContextSnapshot: s,
        forumOutcome: o,
        $executeRaw: async () => {},
      }),
      $disconnect: async () => {},
    };
  }

  const VALID_THREAD_ID = '11111111-1111-4111-8111-111111111111';
  const USER_A = { id: '550e8400-e29b-41d4-a716-446655440010', name: 'Agent Alpha' };
  const INVALID_ID = 'not-a-uuid';

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── 5. findThreadById(nonUuid) returns null ──
  await it('5. findThreadById(invalid id) returns null', async () => {
    const result = await da.findThreadById(INVALID_ID);
    assert.equal(result, null);

    // Also verify valid UUID works (confirm guard is not too aggressive)
    await da.createThread({
      title: 'Valid', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    // All created threads have valid mock UUIDs now
    const allThreads = await da.findThreads({});
    const firstId = allThreads.items[0]?.id;
    assert.ok(firstId, 'thread was created with a valid ID');
    const found = await da.findThreadById(firstId);
    assert.ok(found, 'findThreadById works with valid UUID');
  });

  // ── 6. findMessagesByThreadId(nonUuid) returns [] ──
  await it('6. findMessagesByThreadId(invalid id) returns empty array', async () => {
    const result = await da.findMessagesByThreadId(INVALID_ID);
    assert.deepEqual(result, []);
  });

  // ── 7. Other ByThreadId functions return null/[] for non-UUID ──
  await it('7a. findParticipantsByThreadId(invalid id) returns []', async () => {
    const result = await da.findParticipantsByThreadId(INVALID_ID);
    assert.deepEqual(result, []);
  });

  await it('7b. findSnapshotsByThreadId(invalid id) returns []', async () => {
    const result = await da.findSnapshotsByThreadId(INVALID_ID);
    assert.deepEqual(result, []);
  });

  await it('7c. findOutcomesByThreadId(invalid id) returns []', async () => {
    const result = await da.findOutcomesByThreadId(INVALID_ID);
    assert.deepEqual(result, []);
  });

  await it('7d. findLatestOutcomeByThreadId(invalid id) returns null', async () => {
    const result = await da.findLatestOutcomeByThreadId(INVALID_ID);
    assert.equal(result, null);
  });

  await it('7e. getThreadReviewReadiness(invalid id) returns null', async () => {
    const result = await da.getThreadReviewReadiness(INVALID_ID);
    assert.equal(result, null);
  });

  await it('7f. buildTranscriptMd(invalid id) returns null', async () => {
    const result = await da.buildTranscriptMd(INVALID_ID);
    assert.equal(result, null);
  });

  await it('7g. findParticipant(invalid threadId) returns null', async () => {
    const result = await da.findParticipant(INVALID_ID, USER_A.id);
    assert.equal(result, null);
  });
});

// ══════════════════════════════════════════════════════════════
//  Route-level: invalid threadId returns 404
// ══════════════════════════════════════════════════════════════

void describe('Route-level non-UUID threadId', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');
  let envMod: typeof import('../src/config/env.js');

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

  function mockStore(store: Map<string, any>, name: string) {
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
      findFirst: async ({ where, orderBy }: any) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
            if (k === 'kind' && typeof v === 'object' && v !== null && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
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
        return items[0] || null;
      },
      findMany: async ({ where, orderBy, skip, take }: any = {}) => {
        let items = Array.from(store.values());
        if (where) {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'threadId') items = items.filter(i => i.threadId === v);
            if (k === 'type') items = items.filter(i => i.type === v);
            if (k === 'status') items = items.filter(i => i.status === v);
            if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
            if (k === 'kind' && typeof v === 'object' && v !== null && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
            }
            if (k === 'title' && (v as any)?.contains) {
              const q = (v as any).contains.toLowerCase();
              items = items.filter(i => i.title?.toLowerCase().includes(q));
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
            if (k === 'participants' && (v as any)?.some) {
              const cond = (v as any).some;
              items = items.filter(item => {
                for (const p of participants.values()) {
                  if (p.threadId === item.id && p.agentId === cond.agentId) return true;
                }
                return false;
              });
            }
            if (k === 'type') items = items.filter(i => i.type === v);
            if (k === 'status') items = items.filter(i => i.status === v);
          }
        }
        return items.length;
      },
      create: async ({ data }: any) => {
        const defaults: Record<string, any> = { status: 'open', messageCount: 0, type: 'discussion', createdByType: 'agent', tags: [], mentions: [] };
        const doc = { ...defaults, ...data, id: data.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        if (!doc.updatedAt) doc.updatedAt = new Date();
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
    const t = mockStore(threads, 'thread');
    const p = mockStore(participants, 'participant');
    const m = mockStore(messages, 'message');
    const s = mockStore(snapshots, 'snapshot');
    const o = mockStore(outcomes, 'outcome');
    return {
      forumThread: t,
      forumThreadParticipant: p,
      forumThreadMessage: m,
      forumContextSnapshot: s,
      forumOutcome: o,
      forumPrincipal: {
        findUnique: async ({ where }: any) => {
          if (where.authSubject) return null;
          if (where.agentId) return null;
          return null;
        },
        findFirst: async () => null,
        create: async ({ data }: any) => ({ ...data, id: data.authSubject || 'fp-1', createdAt: new Date(), updatedAt: new Date() }),
        update: async ({ data }: any) => data,
      },
      $queryRaw: async () => [{ 1: 1 }],
      $transaction: async (fn: (tx: any) => any) => fn({
        forumThread: t,
        forumThreadParticipant: p,
        forumThreadMessage: { ...m, count: async ({ where }: any = {}) => { let items = Array.from(messages.values()); if (where?.threadId) items = items.filter(i => i.threadId === where.threadId); if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt); return items.length; } },
        forumContextSnapshot: s,
        forumOutcome: o,
        forumPrincipal: {
          findUnique: async () => null,
          create: async ({ data }: any) => ({ ...data, id: data.authSubject || 'fp-1', createdAt: new Date(), updatedAt: new Date() }),
          update: async ({ data }: any) => data,
        },
        $executeRaw: async () => {},
      }),
      $disconnect: async () => {},
    };
  }

  const USER_A = { id: '550e8400-e29b-41d4-a716-446655440010', name: 'Agent Alpha' };
  const NON_UUID = 'not-a-uuid';

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
    envMod = await import('../src/config/env.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── 8. GET /api/threads/not-a-uuid → 404 ──
  await it('8. GET /api/threads/not-a-uuid returns 404', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .get(`/api/threads/${NON_UUID}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  // ── 9. GET /api/threads/not-a-uuid/messages → 404 ──
  await it('9. GET /api/threads/not-a-uuid/messages returns 404', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .get(`/api/threads/${NON_UUID}/messages`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  // ── 10. GET /api/threads/not-a-uuid/transcript → 404 ──
  await it('10. GET /api/threads/not-a-uuid/transcript returns 404', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .get(`/api/threads/${NON_UUID}/transcript`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  // ── 11. POST /api/threads/not-a-uuid/messages → 404 ──
  await it('11. POST /api/threads/not-a-uuid/messages returns 404', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .post(`/api/threads/${NON_UUID}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'test', kind: 'comment' });
    assert.equal(res.status, 404);
  });

  // ── 12. PATCH /api/threads/not-a-uuid → 404 ──
  await it('12. PATCH /api/threads/not-a-uuid returns 404', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .patch(`/api/threads/${NON_UUID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'updated' });
    assert.equal(res.status, 404);
  });

  // ── 13. Valid UUID thread returns 200 ──
  await it('13. Valid UUID thread returns 200', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    // Create thread first
    const createRes = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Valid Thread', type: 'discussion' });
    assert.equal(createRes.status, 201);
    const threadId = createRes.body.thread.id;

    const res = await request(app)
      .get(`/api/threads/${threadId}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.title, 'Valid Thread');
  });

  // ── 14. Valid UUID messages returns 200 ──
  await it('14. Valid UUID thread messages returns 200', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const createRes = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Messages Test', type: 'discussion' });
    const threadId = createRes.body.thread.id;

    const res = await request(app)
      .get(`/api/threads/${threadId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
  });

  // ── 15. Valid UUID transcript returns 200 ──
  await it('15. Valid UUID thread transcript returns 200', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const createRes = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Transcript Test', type: 'discussion' });
    const threadId = createRes.body.thread.id;

    const res = await request(app)
      .get(`/api/threads/${threadId}/transcript?format=md`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Transcript Test'));
  });

  // ── 16. Malformed JSON body → 400 ──
  await it('16. Malformed JSON body returns 400 without stack/Prisma info', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      // Malformed JSON — supertest needs raw string
      .send('{"title": broken' as any);
    assert.equal(res.status, 400);

    // Must NOT contain stack trace or Prisma metadata
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('stack'), 'response should not include stack');
    assert.ok(!bodyStr.includes('Prisma'), 'response should not include Prisma metadata');
    assert.ok(!bodyStr.includes('Error:'), 'response should not leak error internals');
  });

  // ── 17. Internal SyntaxError → 500 ──
  await it('17. Internal SyntaxError returns 500 not 400', async () => {
    const express = (await import('express')).default;
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());

    // A route that throws a plain SyntaxError internally (not from body-parser)
    app.get('/api/syntax-error', () => {
      throw new SyntaxError('Internal parse failure');
    });

    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .get('/api/syntax-error')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 500, 'internal SyntaxError must return 500');
    assert.equal(res.body.error, 'Internal Server Error');
    // Must not leak the error message
    assert.ok(!JSON.stringify(res.body).includes('Internal parse failure'), 'must not leak error internals');
  });

  // ── 18. Confirm malformed JSON still returns 400 with correct body ──
  await it('18. Malformed JSON returns { error: "Invalid JSON body" }', async () => {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ sub: USER_A.id, agent_id: USER_A.id, client_id: 'mc_test', scope: 'forum.read forum.write' });

    const res = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"title": broken' as any);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid JSON body');
  });
});
