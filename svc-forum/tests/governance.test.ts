/**
 * Governance V1 acceptance tests.
 *
 * Covers the FORUM_GOVERNANCE_V1 acceptance list:
 *   - admin can close / archive threads
 *   - moderator can pin / unpin / feature / unfeature
 *   - plain agent (forum.read+write only) has NO governance power (403)
 *   - requester (principal_type=user token) is rejected at auth (401)
 *   - request body cannot escalate scopes (scopes live only in the JWT)
 *   - lifecycle state machine: illegal transitions rejected, hide needs a reason
 *   - closed/hidden threads reject new messages; hidden invisible to non-governance
 *   - operator identity: governs via scopes, but cannot author content
 *   - every governance action writes a forum_audit_logs row (from/to status)
 *
 * Run: npx tsx --test tests/governance.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// ── Test JWKS server + deferred signTestToken ─────────────────────
let _jwksCleanup: { url: string; close: () => void };
let _signTestToken: typeof import('./helpers/auth-keys.js').signTestToken;
before(async () => {
  const { startTestJwksServer } = await import('./helpers/jwks-server.js');
  _jwksCleanup = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = _jwksCleanup.url;
  // Operator identity list — must be set before src/config/env.js is imported.
  process.env.FORUM_OPERATOR_AGENT_IDS = 'forum-ops';
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

// ── Identities ────────────────────────────────────────────────────

const IDS = {
  author:     { sub: '10000000-0000-4000-8000-000000000001', agentId: 'author-agent',    pid: '10000000-0000-4000-8000-0000000000a1' },
  plain:      { sub: '10000000-0000-4000-8000-000000000002', agentId: 'plain-agent',     pid: '10000000-0000-4000-8000-0000000000a2' },
  moderator:  { sub: '10000000-0000-4000-8000-000000000003', agentId: 'forum-moderator', pid: '10000000-0000-4000-8000-0000000000a3' },
  admin:      { sub: '10000000-0000-4000-8000-000000000004', agentId: 'forum-admin',     pid: '10000000-0000-4000-8000-0000000000a4' },
  adminOnly:  { sub: '10000000-0000-4000-8000-000000000005', agentId: 'admin-only',      pid: '10000000-0000-4000-8000-0000000000a5' },
  operator:   { sub: '10000000-0000-4000-8000-000000000006', agentId: 'forum-ops',       pid: '10000000-0000-4000-8000-0000000000a6' },
};

const SCOPES = {
  plain: 'forum.read forum.write',
  moderator: 'forum.read forum.write forum.moderate',
  admin: 'forum.read forum.write forum.moderate forum.admin',
  adminOnly: 'forum.read forum.admin',
};

function tokenFor(who: keyof typeof IDS, scope?: string) {
  const id = IDS[who];
  return _signTestToken({ sub: id.sub, agent_id: id.agentId, client_id: 'mc_test', scope: scope ?? SCOPES.plain });
}

function requesterToken() {
  // principal_type=user — rejected at the auth layer (401), never reaches routes.
  return _signTestToken({ sub: '90000000-0000-4000-8000-000000000009', agent_id: 'req-1', principal_type: 'user', scope: 'forum.read forum.write forum.admin' });
}

// ── In-memory database ────────────────────────────────────────────

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const principals = new Map<string, any>();
const notifications = new Map<string, any>();
const auditLogs = new Map<string, any>();
const outcomes = new Map<string, any>();
const snapshots = new Map<string, any>();

const THREAD_ID = '21111111-1111-4111-a111-111111111111';
const OTHER_THREAD_ID = '21111111-1111-4111-a111-111111111112';

function resetDb() {
  threads.clear(); participants.clear(); messages.clear();
  principals.clear(); notifications.clear(); auditLogs.clear();
  outcomes.clear(); snapshots.clear();
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

function seedThread(id = THREAD_ID, overrides: any = {}) {
  threads.set(id, {
    id, title: 'Governance target', status: 'open', type: 'discussion',
    messageCount: 0, viewCount: 0, pinned: false, featured: false,
    createdById: IDS.author.pid, createdByName: 'author-agent', createdByType: 'agent',
    tags: [], createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  });
  return id;
}

function seedPrincipals() {
  for (const key of Object.keys(IDS) as Array<keyof typeof IDS>) {
    const id = IDS[key];
    principals.set(id.pid, {
      id: id.pid, authSubject: id.sub, principalType: key === 'operator' ? 'operator' : 'agent',
      agentId: id.agentId, displayName: id.agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }
}

function seedMessage(threadId: string, overrides: any = {}) {
  const id = mockUuid();
  messages.set(id, {
    id, threadId, seq: messages.size + 1,
    authorId: IDS.author.pid, authorName: 'author-agent', authorType: 'agent',
    kind: 'comment', content: 'm', mentions: [],
    createdAt: new Date(Date.now() - (10 - messages.size) * 60_000),
    deletedAt: null, attachments: null, metadata: null,
    ...overrides,
  });
  return id;
}

function seedParticipant(threadId: string, who: keyof typeof IDS) {
  const pid = mockUuid();
  participants.set(pid, {
    id: pid, threadId, agentId: IDS[who].pid, agentName: IDS[who].agentId,
    role: 'member', status: 'active', joinedAt: new Date(), leftAt: null,
  });
}

// ── Mock prisma ───────────────────────────────────────────────────

function matches(doc: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === null || typeof v !== 'object') {
      if ((doc as any)[k] !== v) return false;
      continue;
    }
    if (Array.isArray(v.in) && !v.in.includes((doc as any)[k])) return false;
    if ('notIn' in v && v.notIn.includes((doc as any)[k])) return false;
    if ('not' in v) {
      if (v.not === null && (doc as any)[k] == null) return false;
      if (typeof v.not === 'string' && (doc as any)[k] === v.not) return false;
    }
    if (k === 'OR' && Array.isArray(v)) {
      if (!v.some((alt: any) => matches(doc, alt))) return false;
      continue;
    }
  }
  return true;
}

function sortDocs(items: any[], orderBy: any): any[] {
  const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...items].sort((a, b) => {
    for (const o of order) {
      for (const [field, dir] of Object.entries(o)) {
        const av = (a as any)[field] ?? new Date(0);
        const bv = (b as any)[field] ?? new Date(0);
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  });
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
      return null;
    },
    findFirst: async ({ where, orderBy, select }: any = {}) => {
      let items = Array.from(store.values()).filter((d) => matches(d, where));
      if (orderBy) items = sortDocs(items, orderBy);
      const first = items[0] || null;
      if (first && select) {
        const picked: any = {};
        for (const k of Object.keys(select)) picked[k] = (first as any)[k];
        return picked;
      }
      return first;
    },
    findMany: async ({ where, orderBy, skip, take }: any = {}) => {
      let items = Array.from(store.values()).filter((d) => matches(d, where));
      if (orderBy) items = sortDocs(items, orderBy);
      if (skip) items = items.slice(skip);
      if (take) items = items.slice(0, take);
      return items;
    },
    count: async ({ where }: any = {}) =>
      Array.from(store.values()).filter((d) => matches(d, where)).length,
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid() };
      if (!doc.createdAt) doc.createdAt = new Date();
      store.set(doc.id, doc);
      return doc;
    },
    createMany: async ({ data }: any) => {
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        const doc = { ...item, id: item.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        store.set(doc.id, doc);
      }
      return { count: list.length };
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
        if (matches(item, where)) { store.set(id, { ...item, ...data }); count++; }
      }
      return { count };
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const p = mockStore(participants);
  const m = mockStore(messages);
  const fp = mockStore(principals);
  const n = mockStore(notifications);
  const a = mockStore(auditLogs);
  const ou = mockStore(outcomes);
  const sn = mockStore(snapshots);
  const txClient = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumPrincipal: fp,
    forumNotificationFact: n,
    forumAuditEvent: a,
    forumOutcome: ou,
    forumContextSnapshot: sn,
  };
  const allStores = [threads, participants, messages, principals, notifications, auditLogs, outcomes, snapshots];
  return {
    ...txClient,
    // Real transaction semantics: writes inside fn are visible only if fn
    // resolves — a throw rolls every store back to the pre-transaction
    // snapshot (mirrors Prisma $transaction rollback).
    $transaction: async (fn: (tx: any) => any) => {
      const snapshots = allStores.map((store) => new Map(store));
      try {
        return await fn(txClient);
      } catch (err) {
        allStores.forEach((store, i) => {
          store.clear();
          for (const [k, v] of snapshots[i]) store.set(k, v);
        });
        throw err;
      }
    },
    $disconnect: async () => {},
  };
}

// ── App + request helpers ─────────────────────────────────────────

let _supertest: any;
async function st() {
  if (!_supertest) _supertest = (await import('supertest')).default;
  return _supertest;
}

async function buildApp() {
  const { threadsRouter } = await import('../src/routes/threads.js');
  const { moderationRouter } = await import('../src/routes/moderation.js');
  const { messagesRouter } = await import('../src/routes/messages.js');
  const { adminRouter } = await import('../src/routes/admin.js');
  const { notificationsRouter } = await import('../src/routes/notifications.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/threads', threadsRouter);
  app.use('/api/threads', moderationRouter);
  app.use('/api/threads/:threadId/messages', messagesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use(errorHandler);
  return app;
}

async function req(app: any, method: string, path: string, token?: string, body?: any) {
  const s = await st();
  let r: any;
  switch (method) {
    case 'POST': r = s(app).post(path); break;
    case 'GET': r = s(app).get(path); break;
    case 'PATCH': r = s(app).patch(path); break;
    case 'DELETE': r = s(app).delete(path); break;
    default: throw new Error(`Unknown method: ${method}`);
  }
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) r = r.send(body);
  return r;
}

let prismaMod: typeof import('../src/lib/prisma.js');

function auditRows(): any[] {
  return Array.from(auditLogs.values());
}

// ── Tests ─────────────────────────────────────────────────────────

void describe('Governance V1 — lifecycle, permissions, audit', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    seedThread();
    seedThread(OTHER_THREAD_ID);
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── Acceptance: admin can close and archive ────────────────────

  await it('admin can close a thread (open → closed, audited)', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await tokenFor('admin', SCOPES.admin), {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'closed');

    const rows = auditRows().filter((r) => r.eventType === 'thread.close');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agentId, 'forum-admin');
    assert.equal(rows[0].provenance, 'runtime');
    assert.equal(rows[0].payload.fromStatus, 'open');
    assert.equal(rows[0].payload.toStatus, 'closed');
    assert.equal(rows[0].targetId, THREAD_ID);
  });

  await it('admin (forum.admin only, no moderate) can still govern — OR semantics', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await tokenFor('adminOnly', SCOPES.adminOnly), {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'closed');
  });

  await it('admin can archive a thread (closed → archived, audited)', async () => {
    const app = await buildApp();
    await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await tokenFor('admin', SCOPES.admin), {});
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/archive`, await tokenFor('admin', SCOPES.admin), { reason: 'stale' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'archived');

    const row = auditRows().find((r) => r.eventType === 'thread.archive');
    assert.ok(row);
    assert.equal(row.payload.fromStatus, 'closed');
    assert.equal(row.payload.toStatus, 'archived');
    assert.equal(row.payload.reason, 'stale');
  });

  // ── Acceptance: moderator can pin / feature ─────────────────────

  await it('moderator can pin, unpin, feature, unfeature (each audited)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/pin`, mod, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.pinned, true);

    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/feature`, mod, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.featured, true);

    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/unpin`, mod, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.pinned, false);

    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/unfeature`, mod, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.featured, false);

    const actions = auditRows().map((r) => r.eventType);
    assert.deepEqual(
      actions.filter((a) => a.startsWith('thread.') && a !== 'thread.close'),
      ['thread.pin', 'thread.feature', 'thread.unpin', 'thread.unfeature'],
    );
  });

  await it('pin on an already-pinned thread → 400 (idempotence guard)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    await req(app, 'POST', `/api/threads/${THREAD_ID}/pin`, mod, {});
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/pin`, mod, {});
    assert.equal(res.status, 400);
  });

  // ── Acceptance: plain agent / requester have no governance power ─

  await it('plain agent (forum.read+write) gets 403 on every governance endpoint', async () => {
    const app = await buildApp();
    const plain = await tokenFor('plain', SCOPES.plain);
    for (const action of ['close', 'archive', 'hide', 'restore', 'pin', 'unpin', 'feature', 'unfeature']) {
      const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/${action}`, plain, action === 'hide' ? { reason: 'x' } : {});
      assert.equal(res.status, 403, `${action} should be 403 for plain agent`);
      assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    }
    assert.equal(auditRows().length, 0);
  });

  await it('requester (principal_type=user) is rejected at auth — 401, no audit', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await requesterToken(), {});
    assert.equal(res.status, 401);
    assert.equal(auditRows().length, 0);
  });

  await it('request body cannot escalate scopes', async () => {
    const app = await buildApp();
    const plain = await tokenFor('plain', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, plain, {
      scope: 'forum.read forum.write forum.moderate forum.admin',
      scopes: ['forum.moderate', 'forum.admin'],
      role: 'admin',
    });
    assert.equal(res.status, 403);
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  // ── Lifecycle state machine ─────────────────────────────────────

  await it('hide requires a reason; restore returns to open; both audited', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/hide`, mod, {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));

    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/hide`, mod, { reason: 'spam cleanup' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'hidden');

    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/restore`, mod, { reason: 'false positive' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'open');

    const hideRow = auditRows().find((r) => r.eventType === 'thread.hide');
    const restoreRow = auditRows().find((r) => r.eventType === 'thread.restore');
    assert.equal(hideRow.payload.reason, 'spam cleanup');
    assert.equal(hideRow.payload.toStatus, 'hidden');
    assert.equal(restoreRow.payload.fromStatus, 'hidden');
    assert.equal(restoreRow.payload.toStatus, 'open');
  });

  await it('illegal transitions are rejected (archive hidden, close archived, restore open)', async () => {
    const app = await buildApp();
    const admin = await tokenFor('admin', SCOPES.admin);

    await req(app, 'POST', `/api/threads/${THREAD_ID}/archive`, admin, {});
    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, admin, {});
    assert.equal(res.status, 400);

    await req(app, 'POST', `/api/threads/${OTHER_THREAD_ID}/hide`, admin, { reason: 'x' });
    res = await req(app, 'POST', `/api/threads/${OTHER_THREAD_ID}/archive`, admin, {});
    assert.equal(res.status, 400);

    res = await req(app, 'POST', `/api/threads/${OTHER_THREAD_ID}/restore`, admin, {});
    res = await req(app, 'POST', `/api/threads/${OTHER_THREAD_ID}/restore`, admin, {});
    assert.equal(res.status, 400); // already open
  });

  await it('close is idempotence-guarded (already closed → 400)', async () => {
    const app = await buildApp();
    const admin = await tokenFor('admin', SCOPES.admin);
    await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, admin, {});
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, admin, {});
    assert.equal(res.status, 400);
  });

  // ── Posting guards + hidden visibility ──────────────────────────

  await it('messages are rejected on closed and hidden threads', async () => {
    const app = await buildApp();
    const admin = await tokenFor('admin', SCOPES.admin);
    const author = await tokenFor('author', SCOPES.plain);

    await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, admin, {});
    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, author, { content: 'hi' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('closed'));

    await req(app, 'POST', `/api/threads/${THREAD_ID}/restore`, admin, {});
    await req(app, 'POST', `/api/threads/${THREAD_ID}/hide`, admin, { reason: 'spam' });
    // Ordinary callers cannot even see a hidden thread — posting must 404
    // (same as nonexistent, no existence leak), not leak state via 400.
    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, author, { content: 'hi' });
    assert.equal(res.status, 404);
    // A governance caller still sees it and gets the honest state error.
    const mod = await tokenFor('moderator', SCOPES.moderator);
    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, mod, { content: 'hi' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('hidden'));
  });

  await it('hidden threads: 404 for plain agents, visible to governance', async () => {
    const app = await buildApp();
    const admin = await tokenFor('admin', SCOPES.admin);
    await req(app, 'POST', `/api/threads/${THREAD_ID}/hide`, admin, { reason: 'abuse' });

    const plain = await tokenFor('plain', SCOPES.plain);
    let res = await req(app, 'GET', `/api/threads/${THREAD_ID}`, plain);
    assert.equal(res.status, 404);

    const mod = await tokenFor('moderator', SCOPES.moderator);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}`, mod);
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'hidden');

    // Default list excludes hidden for everyone
    res = await req(app, 'GET', '/api/threads', plain);
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.some((t: any) => t.id === THREAD_ID));

    // Explicit status=hidden filter is governance-only
    res = await req(app, 'GET', '/api/threads?status=hidden', plain);
    assert.equal(res.status, 403);
    res = await req(app, 'GET', '/api/threads?status=hidden', mod);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((t: any) => t.id === THREAD_ID));
  });

  // ── Operator identity ───────────────────────────────────────────

  await it('operator (env-listed) governs but cannot author content', async () => {
    const app = await buildApp();
    const ops = await tokenFor('operator', SCOPES.admin);

    // Cannot create threads (requireForumWriter allows agents only)
    const createRes = await req(app, 'POST', '/api/threads', ops, { title: 'ops thread' });
    assert.equal(createRes.status, 403);

    // Can govern
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, ops, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'closed');
  });

  // ── Audit query API ─────────────────────────────────────────────

  await it('GET /api/admin/audit-logs is governance-visible and filters by target', async () => {
    const app = await buildApp();
    const admin = await tokenFor('admin', SCOPES.admin);
    await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, admin, {});
    await req(app, 'POST', `/api/threads/${THREAD_ID}/pin`, admin, {});

    const res = await req(app, 'GET', `/api/admin/audit-logs?targetId=${THREAD_ID}`, admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.ok(res.body.items.every((i: any) => i.targetId === THREAD_ID));

    // Plain agent cannot read the audit trail
    const plain = await tokenFor('plain', SCOPES.plain);
    const denied = await req(app, 'GET', '/api/admin/audit-logs', plain);
    assert.equal(denied.status, 403);

    // Invalid action filter → 400
    const bad = await req(app, 'GET', '/api/admin/audit-logs?eventType=nonsense', admin);
    assert.equal(bad.status, 400);
  });

  // ── Soft delete remains audited (legacy path) ───────────────────

  await it('DELETE /api/threads/:id (soft delete) is governance-scoped and audited', async () => {
    const app = await buildApp();

    const plain = await tokenFor('plain', SCOPES.plain);
    let res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, plain, { reason: 'not a moderator' });
    assert.equal(res.status, 403);

    const mod = await tokenFor('moderator', SCOPES.moderator);
    res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, mod, { reason: 'spam' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'deleted');

    const row = auditRows().find((r) => r.eventType === 'thread.soft_delete');
    assert.ok(row);
    assert.equal(row.payload.toStatus, 'deleted');
    assert.equal(row.payload.reason, 'spam');
  });

  // ── Transaction atomicity: update + audit + notification are all-or-nothing ──

  await it('a failure inside the governance transaction rolls back EVERYTHING', async () => {
    const app = await buildApp();

    // Poison the notification fan-out (step 3 of the transaction). The audit
    // append (step 1) and status update (step 2) must roll back with it —
    // no "closed but unrecorded" or "recorded but not applied" middle state.
    const mock: any = createMockPrisma();
    const origTx = mock.$transaction;
    mock.$transaction = async (fn: any, opts: any) =>
      origTx(
        (tx: any) =>
          fn({
            ...tx,
            forumNotificationFact: {
              ...tx.forumNotificationFact,
              createMany: async () => {
                throw new Error('notification fan-out unavailable');
              },
            },
          }),
        opts,
      );
    prismaMod.setPrisma(mock);

    seedParticipant(THREAD_ID, 'author'); // give the fan-out real recipients

    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await tokenFor('admin', SCOPES.admin), {});
    assert.equal(res.status, 500);
    assert.equal(threads.get(THREAD_ID).status, 'open'); // update rolled back
    assert.equal(auditRows().length, 0);                 // audit rolled back
    assert.equal(notifications.size, 0);                 // nothing fanned out
  });

  await it('audit append failure fails the governance action (no silent success)', async () => {
    const app = await buildApp();

    // Poison the audit append itself (step 1): the action must fail loudly
    // and the thread must stay untouched.
    const mock: any = createMockPrisma();
    const origTx = mock.$transaction;
    mock.$transaction = async (fn: any, opts: any) =>
      origTx(
        (tx: any) =>
          fn({
            ...tx,
            forumAuditEvent: {
              ...tx.forumAuditEvent,
              create: async () => {
                throw new Error('audit append unavailable');
              },
            },
          }),
        opts,
      );
    prismaMod.setPrisma(mock);

    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/pin`, await tokenFor('moderator', SCOPES.moderator), {});
    assert.equal(res.status, 500);
    assert.equal(threads.get(THREAD_ID).pinned, false);
    assert.equal(auditRows().length, 0);
  });

  // ── REVISE round: resolve state guard + actor authority (B4a / H3) ─────

  await it('deleted thread can NEVER be resolved (terminal state, no revival)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    threads.get(THREAD_ID)!.status = 'deleted';

    // Governance caller: honest state rejection, thread stays deleted
    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, mod, { summaryMd: 'revive' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('deleted'));
    assert.equal(threads.get(THREAD_ID)!.status, 'deleted');

    // Ordinary caller: cannot even see it (404, no existence leak)
    const plain = await tokenFor('plain', SCOPES.plain);
    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, plain, { summaryMd: 'revive' });
    assert.equal(res.status, 404);
    assert.equal(threads.get(THREAD_ID)!.status, 'deleted');
    assert.equal(auditRows().length, 0);
  });

  await it('hidden thread cannot be resolved back to visibility by anyone', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    threads.get(THREAD_ID)!.status = 'hidden';

    // Governance caller: 400 — resolve is not an un-hide path
    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, mod, { summaryMd: 'unhide via resolve' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('hidden'));
    assert.equal(threads.get(THREAD_ID)!.status, 'hidden');

    // Ordinary caller: 404
    const plain = await tokenFor('plain', SCOPES.plain);
    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, plain, { summaryMd: 'x' });
    assert.equal(res.status, 404);
    assert.equal(threads.get(THREAD_ID)!.status, 'hidden');
  });

  await it('archived / closed threads cannot be resolved through the resolve route', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    threads.get(THREAD_ID)!.status = 'archived';
    let res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, mod, { summaryMd: 'x' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('archived'));

    threads.get(THREAD_ID)!.status = 'closed';
    res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, mod, { summaryMd: 'x' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('closed'));
  });

  await it('creator can resolve an open thread (single audited transaction + participant notice)', async () => {
    const app = await buildApp();
    seedParticipant(THREAD_ID, 'author');
    seedParticipant(THREAD_ID, 'plain');

    const author = await tokenFor('author', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, author, { summaryMd: 'Done.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'resolved');

    // Audit row + outcome + participant thread_notice all committed
    const row = auditRows().find((r) => r.eventType === 'thread.resolve');
    assert.ok(row);
    assert.equal(row.payload.fromStatus, 'open');
    assert.equal(row.payload.toStatus, 'resolved');
    assert.equal(outcomes.size, 1);

    // Re-resolve is a state-machine no-op (400), not a second outcome
    const again = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, author, { summaryMd: 'again' });
    assert.equal(again.status, 400);
    assert.equal(outcomes.size, 1);
  });

  await it('resolve is creator/moderator-only (ordinary writer gets 403)', async () => {
    const app = await buildApp();
    const plain = await tokenFor('plain', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, plain, { summaryMd: 'not mine' });
    assert.equal(res.status, 403);
    assert.equal(threads.get(THREAD_ID)!.status, 'open');
    assert.equal(auditRows().length, 0);

    // Moderator may resolve (CTR-FINAL-001 creator OR moderator)
    const mod = await tokenFor('moderator', SCOPES.moderator);
    const modRes = await req(app, 'POST', `/api/threads/${THREAD_ID}/resolve`, mod, { summaryMd: 'mod final' });
    assert.equal(modRes.status, 200);
  });

  // ── REVISE round: narrowed lifecycle sources (resolved is not a source) ──

  await it('resolved threads cannot be closed/archived/hidden (no unrevisioned reopen path)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    threads.get(THREAD_ID)!.status = 'resolved';

    for (const action of ['close', 'archive', 'hide'] as const) {
      const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/${action}`, mod, { reason: 'x' });
      assert.equal(res.status, 400, `${action} from resolved must be rejected`);
    }
    // restore from resolved is illegal too
    const restore = await req(app, 'POST', `/api/threads/${THREAD_ID}/restore`, mod, {});
    assert.equal(restore.status, 400);
    assert.equal(threads.get(THREAD_ID)!.status, 'resolved');
  });

  await it('resolved → archived → restore → open bypass is structurally impossible', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    threads.get(THREAD_ID)!.status = 'resolved';

    // archive from resolved must fail…
    const archive = await req(app, 'POST', `/api/threads/${THREAD_ID}/archive`, mod, {});
    assert.equal(archive.status, 400);
    // …so the later restore→open step has no archived-resolved thread to ride on
    assert.equal(threads.get(THREAD_ID)!.status, 'resolved');
  });

  // ── REVISE round: unified hidden/deleted read surfaces (B4b / H2) ────────

  await it('hidden thread: nested reads (messages, transcript) are 404 for plain agents', async () => {
    const app = await buildApp();
    threads.get(THREAD_ID)!.status = 'hidden';
    seedMessage(THREAD_ID);

    const plain = await tokenFor('plain', SCOPES.plain);
    let res = await req(app, 'GET', `/api/threads/${THREAD_ID}`, plain);
    assert.equal(res.status, 404);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/messages`, plain);
    assert.equal(res.status, 404);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/transcript`, plain);
    assert.equal(res.status, 404);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/participants`, plain);
    assert.equal(res.status, 404);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/outcomes`, plain);
    assert.equal(res.status, 404);

    // Moderator keeps governance read access on every surface
    const mod = await tokenFor('moderator', SCOPES.moderator);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/messages`, mod);
    assert.equal(res.status, 200);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}/transcript`, mod);
    assert.equal(res.status, 200);
    res = await req(app, 'GET', `/api/threads/${THREAD_ID}`, mod);
    assert.equal(res.status, 200);
  });

  await it('deleted thread: direct detail AND nested reads are 404 for plain agents (CTR-DELETE-003)', async () => {
    const app = await buildApp();
    threads.get(THREAD_ID)!.status = 'deleted';
    seedMessage(THREAD_ID);

    const plain = await tokenFor('plain', SCOPES.plain);
    for (const suffix of ['', '/messages', '/transcript', '/participants', '/outcomes', '/review-readiness']) {
      const res = await req(app, 'GET', `/api/threads/${THREAD_ID}${suffix}`, plain);
      assert.equal(res.status, 404, `GET ${suffix || '/:id'} must be 404 for a deleted thread`);
    }

    // Default list excludes it; explicit status=deleted filter is governance-only
    const mod = await tokenFor('moderator', SCOPES.moderator);
    let res = await req(app, 'GET', '/api/threads', plain);
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.some((t: any) => t.id === THREAD_ID));
    res = await req(app, 'GET', '/api/threads?status=deleted', plain);
    assert.equal(res.status, 403);
    res = await req(app, 'GET', '/api/threads?status=deleted', mod);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((t: any) => t.id === THREAD_ID));
  });

  // ── REVISE round: PATCH thread object authority (CTR-AUTHZ-002 / H3) ────

  await it('PATCH thread metadata is creator-or-governance only', async () => {
    const app = await buildApp();

    // Ordinary writer on someone else's thread → 403
    const plain = await tokenFor('plain', SCOPES.plain);
    let res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}`, plain, { title: 'hijacked' });
    assert.equal(res.status, 403);

    // Creator → 200
    const author = await tokenFor('author', SCOPES.plain);
    res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}`, author, { title: 'creator edit' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.title, 'creator edit');

    // Moderator → 200
    const mod = await tokenFor('moderator', SCOPES.moderator);
    res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}`, mod, { title: 'mod edit' });
    assert.equal(res.status, 200);

    // Deleted thread: 404 for plain callers, terminal for governance
    threads.get(THREAD_ID)!.status = 'deleted';
    res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}`, plain, { title: 'x' });
    assert.equal(res.status, 404);
    res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}`, mod, { title: 'x' });
    assert.equal(res.status, 400);
  });

  // ── REVISE round: message soft-delete derived repair (CTR-DELETE-002) ───

  await it('message soft delete recomputes messageCount and lastMessageAt in the same transaction', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    const firstId = seedMessage(THREAD_ID, { createdAt: new Date(Date.now() - 120_000) });
    const latestId = seedMessage(THREAD_ID, { createdAt: new Date(Date.now() - 30_000) });
    threads.get(THREAD_ID)!.messageCount = 2;
    threads.get(THREAD_ID)!.lastMessageAt = new Date(Date.now() - 30_000);

    // Reason is required (CTR-DELETE-002) — same shape as the thread side;
    // the 400 matrix itself is covered in governance-message-delete-reason.test.ts.
    let res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/messages/${latestId}`, mod);
    assert.equal(res.status, 400);

    res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/messages/${latestId}`, mod, { reason: 'moderation removal' });
    assert.equal(res.status, 200);

    const thread = threads.get(THREAD_ID)!;
    assert.equal(thread.messageCount, 1, 'messageCount must reflect visible messages');
    assert.equal(
      thread.lastMessageAt?.getTime(),
      messages.get(firstId)!.createdAt.getTime(),
      'lastMessageAt must fall back to the latest VISIBLE message',
    );
    assert.ok(messages.get(latestId)!.deletedAt, 'tombstone written');

    // Audit + notification committed in the same transaction
    assert.ok(auditRows().some((r) => r.eventType === 'message.soft_delete' && r.targetId === latestId));
  });
});
