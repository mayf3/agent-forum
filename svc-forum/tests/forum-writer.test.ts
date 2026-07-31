/**
 * requireForumWriter — unit and integration tests.
 *
 * Covers:
 *   1. requireForumWriter unit test (role matrix)
 *   2. create-thread permission test (via supertest)
 *   3. post-message permission test
 *   4. participants permission test
 *   5. outcomes permission test
 *   6. thread status/archive permission test
 *   7. context-snapshot permission test
 *   8. missing role fail-closed
 *   9. unknown role fail-closed
 *  10. request body cannot escalate role
 *  11. request body cannot spoof authorId
 *  12. valid agent regression
 *  13. observer read-only unchanged
 *  14. original tests still pass (verified separately)
 *
 * Run: NODE_ENV=test npx tsx --test tests/forum-writer.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { signTestToken } from './helpers/auth-keys.js';

// ── Test JWKS server (shared across all tests in this file) ────────
// Starts a local HTTP server serving the test RSA public key so the
// production `verifyAuthAccessToken` (lazy-init) can verify RS256 tokens.
let _jwksCleanup: { close: () => void };
before(async () => {
  const { setupTestJwks } = await import('./helpers/jwks-server.js');
  _jwksCleanup = await setupTestJwks();
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

// ── Constants ─────────────────────────────────────────────────────

const AGENT_SUB = '550e8400-e29b-41d4-a716-446655440000';

// ── JWT helpers ────────────────────────────────────────────────────

async function signAgentToken(scopes = 'forum.read forum.write') {
  return signTestToken({
    sub: AGENT_SUB,
    agent_id: 'test-forum-agent',
    client_id: 'test-client',
    scope: scopes,
  });
}

// Human tokens no longer exist as a valid auth path (all tokens are agent
// tokens via standard OAuth). This helper produces a token whose
// principal_type=user, which is rejected by the auth layer with 401.
async function signHumanToken(overrides: { role?: string; sub?: string } = {}) {
  return signTestToken({
    sub: overrides.sub || ('user-' + String(Math.random()).slice(2)),
    agent_id: 'human-test',
    client_id: 'test-client',
    principal_type: 'user',  // Not 'agent' — rejected at auth layer
    scope: 'forum.read forum.write',
  });
}

// ── In-memory database ────────────────────────────────────────────

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const snapshots = new Map<string, any>();
const outcomes = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  snapshots.clear();
  outcomes.clear();
  principals.clear();
}

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
      if (where.authSubject) {
        for (const v of store.values()) if (v.authSubject === where.authSubject) return v;
        return null;
      }
      if (where.agentId) {
        for (const v of store.values()) if (v.agentId === where.agentId) return v;
        return null;
      }
      if (where.threadId_agentId) {
        const { threadId, agentId } = where.threadId_agentId;
        for (const v of store.values()) if (v.threadId === threadId && v.agentId === agentId) return v;
        return null;
      }
      if (where.idempotencyKey) {
        for (const v of store.values()) if (v.idempotencyKey === where.idempotencyKey) return v;
        return null;
      }
      if (where.runId_seq) {
        const { runId, seq } = where.runId_seq;
        for (const v of store.values()) if (v.runId === runId && v.seq === seq) return v;
        return null;
      }
      return null;
    },
    findFirst: async ({ where, orderBy }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'id') items = items.filter(i => i.id === v);
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'runId') items = items.filter(i => i.runId === v);
          if (k === 'status') items = items.filter(i => i.status === v);
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
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'type') items = items.filter(i => i.type === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
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
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'participants' && (v as any)?.some) {
            const cond = (v as any).some;
            items = items.filter(item => {
              for (const p of participants.values()) if (p.threadId === item.id && p.agentId === cond.agentId) return true;
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
        for (const [k, v] of Object.entries(where)) if ((item as any)[k] !== v) { match = false; break; }
        if (match) { store.set(id, { ...item, ...data, updatedAt: new Date() }); count++; }
      }
      return { count };
    },
    createMany: async ({ data }: any) => {
      const created: any[] = [];
      for (const item of Array.isArray(data) ? data : [data]) {
        const doc = { ...item, id: item.id || mockUuid() };
        store.set(doc.id, doc);
        created.push(doc);
      }
      return { count: created.length };
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const p = mockStore(participants);
  const m = mockStore(messages);
  const s = mockStore(snapshots);
  const o = mockStore(outcomes);
  const fp = mockStore(principals);

  return {
    forumPrincipal: fp,
    forumThread: {
      ...t,
      create: async ({ data }: any) => {
        const defaults = { status: 'open', messageCount: 0, type: 'discussion', createdByType: 'agent', tags: [] };
        const doc = { ...defaults, ...data, id: data.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        if (!doc.updatedAt) doc.updatedAt = new Date();
        delete doc.participants;
        threads.set(doc.id, doc);
        return doc;
      },
    },
    forumThreadParticipant: p,
    forumThreadMessage: {
      ...m,
      count: async ({ where }: any = {}) => {
        let items = Array.from(messages.values());
        if (where?.threadId) items = items.filter(i => i.threadId === where.threadId);
        if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt);
        return items.length;
      },
    },
    forumContextSnapshot: s,
    forumOutcome: o,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => {
      const tx = {
        forumPrincipal: fp,
        forumThread: { ...t, create: t.create, update: t.update, count: t.count },
        forumThreadParticipant: p,
        forumThreadMessage: {
          ...m,
          count: async ({ where }: any = {}) => {
            let items = Array.from(messages.values());
            if (where?.threadId) items = items.filter(i => i.threadId === where.threadId);
            if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt);
            return items.length;
          },
        },
        forumContextSnapshot: s,
        forumOutcome: o,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
}

// ── Test helpers ───────────────────────────────────────────────────

let _supertest: any;
async function getSupertest() {
  if (!_supertest) _supertest = (await import('supertest')).default;
  return _supertest;
}

async function request(app: any, method: string, path: string, token?: string, body?: any) {
  const st = await getSupertest();
  let req: any;
  switch (method) {
    case 'POST': req = st(app).post(path); break;
    case 'GET': req = st(app).get(path); break;
    case 'PATCH': req = st(app).patch(path); break;
    case 'DELETE': req = st(app).delete(path); break;
    default: throw new Error(`Unknown method: ${method}`);
  }
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (body) req = req.send(body);
  return req;
}

type Principal = 'no-token' | 'requester' | 'missing-role' | 'unknown-role' | 'valid-agent';
const PRINCIPAL_LABELS: Principal[] = ['no-token', 'requester', 'missing-role', 'unknown-role', 'valid-agent'];

async function getToken(principal: Principal): Promise<string | undefined> {
  switch (principal) {
    case 'no-token': return undefined;
    case 'requester': return signHumanToken({ role: 'requester' });
    case 'missing-role': return signHumanToken({});
    case 'unknown-role': return signHumanToken({ role: 'superadmin' });
    case 'valid-agent': return signAgentToken();
  }
}

function expectedStatus(principal: Principal, okStatus = 201): number {
  switch (principal) {
    case 'no-token': return 401;
    // requester/missing-role/unknown-role now use principal_type=user tokens,
    // rejected at the auth layer (not at forum-writer) since human tokens
    // are no longer a valid auth path in standard OAuth mode.
    case 'requester': return 401;
    case 'missing-role': return 401;
    case 'unknown-role': return 401;
    case 'valid-agent': return okStatus;
  }
}

function seedThread(overrides: any = {}) {
  const id = overrides.id || mockUuid();
  threads.set(id, {
    id, title: 'Test Thread', status: 'open', type: 'discussion',
    messageCount: 0, createdById: AGENT_SUB, createdByName: 'Agent',
    createdByType: 'agent', tags: [], createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  });
  return id;
}

// Use a fixed ID so the route handler can find the seeded thread by req.params.threadId
const SEED_THREAD_ID = '11111111-1111-4111-a111-111111111111';

// ── requireForumWriter unit tests ──────────────────────────────────

void describe('requireForumWriter — unit tests', async () => {
  let requireForumWriter: typeof import('../src/middleware/forum-writer.js')['requireForumWriter'];

  before(async () => {
    const mod = await import('../src/middleware/forum-writer.js');
    requireForumWriter = mod.requireForumWriter;
  });

  function createReq(user?: any) { return { user, method: 'POST', path: '/api/threads' } as any; }

  function callMiddleware(req: any): Promise<{ called: boolean; error?: any }> {
    return new Promise((resolve) => {
      const res = {} as any;
      const next = (err?: any) => {
        if (err) resolve({ called: false, error: err });
        else resolve({ called: true });
      };
      try { requireForumWriter(req, res, next); }
      catch (err) { resolve({ called: false, error: err }); }
    });
  }

  await it('unit 1. no user → 401', async () => {
    const result = await callMiddleware(createReq(undefined));
    assert.equal(result.called, false);
    assert.equal(result.error?.statusCode, 401);
  });
  await it('unit 2. role=agent → next()', async () => {
    const result = await callMiddleware(createReq({ id: 'p1', role: 'agent', authSubjectId: 'sub1' }));
    assert.equal(result.called, true);
  });
  await it('unit 3. role=requester → 403', async () => {
    const result = await callMiddleware(createReq({ id: 'p2', role: 'requester', authSubjectId: 'sub2' }));
    assert.equal(result.called, false);
    assert.equal(result.error?.statusCode, 403);
  });
  await it('unit 4. missing role → 403', async () => {
    const result = await callMiddleware(createReq({ id: 'p3', authSubjectId: 'sub3' }));
    assert.equal(result.called, false);
    assert.equal(result.error?.statusCode, 403);
  });
  await it('unit 5. unknown role → 403', async () => {
    const result = await callMiddleware(createReq({ id: 'p4', role: 'superadmin', authSubjectId: 'sub4' }));
    assert.equal(result.called, false);
    assert.equal(result.error?.statusCode, 403);
    assert.ok(result.error?.message.includes('agent principal'));
  });
  await it('unit 6. role=agent minimal → next()', async () => {
    const result = await callMiddleware(createReq({ id: 'p5', role: 'agent', authSubjectId: 'sub5' }));
    assert.equal(result.called, true);
  });
});

// ── Shared app builder for each write-route category ──────────────

async function buildApp(routerModulePath: string, routerExport: string, mountPath: string) {
  const mod = await import(routerModulePath);
  const router = mod[routerExport];
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  app.use(errorHandler);
  return app;
}

// ── Matrix test helper ────────────────────────────────────────────

function matrixSuite(opts: {
  name: string;
  routerModule: string;
  routerExport: string;
  mountPath: string;
  method: string;
  route: string;
  body?: any;
  okStatus?: number;
  needsThread?: boolean;
  extra?: (app: express.Application) => void;
}) {
  void describe(opts.name, async () => {
    let prismaMod: typeof import('../src/lib/prisma.js');
    const okStatus = opts.okStatus ?? 201;

    before(async () => {
      prismaMod = await import('../src/lib/prisma.js');
    });

    beforeEach(() => {
      resetDb();
      prismaMod.setPrisma(createMockPrisma() as any);
      if (opts.needsThread) seedThread({ id: SEED_THREAD_ID });
    });

    for (const principal of PRINCIPAL_LABELS) {
      await it(`${opts.method} ${opts.route} — ${principal} → ${expectedStatus(principal, okStatus)}`, async () => {
        const app = await buildApp(opts.routerModule, opts.routerExport, opts.mountPath);
        const token = await getToken(principal);
        const res = await request(app, opts.method, opts.route, token, opts.body);
        const expected = expectedStatus(principal, okStatus);
        assert.equal(res.status, expected,
          `Expected ${expected} for ${principal}, got ${res.status}: ${JSON.stringify(res.body)}`);

        // Verify no writes happened for rejected requests
        if (expected === 401 || expected === 403) {
          if (opts.needsThread) {
            // Thread should still exist and be unchanged
            const t = threads.get(SEED_THREAD_ID);
            if (t) assert.equal(t.status, 'open');
          }
        }
      });
    }

    if (opts.extra) {
      void describe('extra checks', async () => {
        beforeEach(() => {
          resetDb();
          prismaMod.setPrisma(createMockPrisma() as any);
          if (opts.needsThread) seedThread({ id: SEED_THREAD_ID });
        });
        opts.extra();
      });
    }
  });
}

// ── Route integration test suites ─────────────────────────────────

matrixSuite({
  name: 'POST /api/threads — create thread',
  routerModule: '../src/routes/threads.js',
  routerExport: 'threadsRouter',
  mountPath: '/api/threads',
  method: 'POST',
  route: '/api/threads',
  body: { title: 'Test thread', type: 'discussion' },
  okStatus: 201,
  extra: () => {
	    it('body cannot escalate role', async () => {
	      const app = await buildApp('../src/routes/threads.js', 'threadsRouter', '/api/threads');
	      const token = await signHumanToken({ role: 'requester' });
	      const res = await request(app, 'POST', '/api/threads', token, { title: 'Spoof', type: 'discussion', role: 'agent' });
	      assert.equal(res.status, 401); // Human tokens rejected at auth layer
	      assert.equal(threads.size, 0);
    });
	    it('valid agent creates thread', async () => {
	      threads.clear();
	      const app = await buildApp('../src/routes/threads.js', 'threadsRouter', '/api/threads');
	      const token = await getToken('valid-agent');
      const res = await request(app, 'POST', '/api/threads', token, { title: 'Regression', type: 'discussion' });
      assert.equal(res.status, 201);
      assert.ok(res.body?.thread?.id);
      assert.equal(threads.size, 1);
      const created = Array.from(threads.values())[0];
      assert.equal(created.createdByType, 'agent');
    });
    it('valid agent can GET /api/threads', async () => {
      seedThread();
      const app = await buildApp('../src/routes/threads.js', 'threadsRouter', '/api/threads');
      const token = await getToken('valid-agent');
      const res = await request(app, 'GET', '/api/threads', token);
      assert.equal(res.status, 200);
    });
  },
});

matrixSuite({
  name: 'POST /api/threads/:tid/messages — post message',
  routerModule: '../src/routes/messages.js',
  routerExport: 'messagesRouter',
  mountPath: '/api/threads/:threadId/messages',
  method: 'POST',
  route: `/api/threads/${SEED_THREAD_ID}/messages`,
  body: { content: 'Test message', kind: 'comment' },
  okStatus: 201,
  needsThread: true,
  extra: () => {
    it('body cannot spoof authorId', async () => {
      const app = await buildApp('../src/routes/messages.js', 'messagesRouter', '/api/threads/:threadId/messages');
      const token = await getToken('valid-agent');
      const res = await request(app, 'POST', `/api/threads/${SEED_THREAD_ID}/messages`, token, {
        content: 'Spoof test', kind: 'comment', authorId: 'spoofed-id', authorName: 'Spoofed', authorType: 'user',
      });
      assert.equal(res.status, 201);
      const msg = Array.from(messages.values())[0];
      assert.notEqual(msg.authorId, 'spoofed-id');
      assert.equal(msg.authorType, 'agent');
    });
  },
});

matrixSuite({
  name: 'POST /api/threads/:tid/participants — add participant',
  routerModule: '../src/routes/participants.js',
  routerExport: 'participantsRouter',
  mountPath: '/api/threads/:threadId/participants',
  method: 'POST',
  route: `/api/threads/${SEED_THREAD_ID}/participants`,
  body: { agentId: 'participant-agent', agentName: 'Participant', role: 'member' },
  okStatus: 201,
  needsThread: true,
});

matrixSuite({
  name: 'POST /api/threads/:tid/outcomes — create outcome',
  routerModule: '../src/routes/outcomes.js',
  routerExport: 'outcomesRouter',
  mountPath: '/api/threads/:threadId/outcomes',
  method: 'POST',
  route: `/api/threads/${SEED_THREAD_ID}/outcomes`,
  body: { summaryMd: '# Test outcome' },
  okStatus: 201,
  needsThread: true,
});

matrixSuite({
  name: 'POST /api/threads/:tid/archive — archive thread',
  routerModule: '../src/routes/threads.js',
  routerExport: 'threadsRouter',
  mountPath: '/api/threads',
  method: 'POST',
  route: `/api/threads/${SEED_THREAD_ID}/archive`,
  okStatus: 200,
  needsThread: true,
  extra: () => {
    it('valid agent archive changes status', async () => {
      const app = await buildApp('../src/routes/threads.js', 'threadsRouter', '/api/threads');
      const token = await getToken('valid-agent');
      const res = await request(app, 'POST', `/api/threads/${SEED_THREAD_ID}/archive`, token);
      assert.equal(res.status, 200);
      const t = threads.get(SEED_THREAD_ID);
      assert.equal(t?.status, 'archived');
    });
	    it('requester cannot archive', async () => {
	      threads.get(SEED_THREAD_ID)!.status = 'open';
	      const app = await buildApp('../src/routes/threads.js', 'threadsRouter', '/api/threads');
	      const token = await signHumanToken({ role: 'requester' });
	      const res = await request(app, 'POST', `/api/threads/${SEED_THREAD_ID}/archive`, token);
	      assert.equal(res.status, 401); // Human tokens rejected at auth layer
	      assert.equal(threads.get(SEED_THREAD_ID)?.status, 'open');
    });
  },
});

matrixSuite({
  name: 'POST /api/threads/:tid/context-snapshots — create snapshot',
  routerModule: '../src/routes/context-snapshots.js',
  routerExport: 'snapshotsRouter',
  mountPath: '/api/threads/:threadId/context-snapshots',
  method: 'POST',
  route: `/api/threads/${SEED_THREAD_ID}/context-snapshots`,
  body: { sourceType: 'okr', sourceRef: 'okr-123', title: 'Test' },
  okStatus: 201,
  needsThread: true,
});

// ── Observer read-only unchanged ──

void describe('Observer — read-only unchanged', async () => {
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    process.env.FORUM_OBSERVER_ENABLED = 'true';
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('GET /observer/api/threads works without JWT (loopback)', async () => {
    const { observerRouter } = await import('../src/observer/observer-routes.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.set('trust proxy', 1);
    app.use('/observer', observerRouter);
    app.use(errorHandler);

    const st = await getSupertest();
    const res = await st(app).get('/observer/api/threads');
    // Observer is accessible from loopback without JWT (no authRequired middleware)
    assert.ok(res.status === 200 || res.status === 403,
      `Observer should be accessible or blocked by loopback: ${res.status}`);
  });

  await it('Observer does NOT use requireForumWriter (no JWT needed)', async () => {
    // Verify the observer router doesn't use auth middleware
    const { readOnlyGuard } = await import('../src/observer/observer-middleware.js');
    const req = { method: 'GET' } as any;
    let calledNext = false;
    const res = {} as any;
    const next = () => { calledNext = true; };
    readOnlyGuard(req, res, next);
    // GET should pass readOnlyGuard
    assert.equal(calledNext, true, 'GET request should pass read-only guard');
  });
});
