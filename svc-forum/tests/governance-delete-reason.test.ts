/**
 * CTR-DELETE-001 acceptance tests — thread soft-delete requires a non-empty reason.
 *
 * DELETE /api/threads/:threadId is a terminal governance action: it must
 * enforce a non-empty (trimmed) body.reason, aligned with the moderation.ts
 * hide validation pattern, and the reason MUST flow into BOTH the
 * forum_audit_events payload and the moderator_notice fan-out payload —
 * not just the route surface.
 *
 * Coverage (Governance V1 final fix round):
 *   a. missing reason → 400
 *   b. reason "" → 400
 *   c. reason "   " (whitespace-only) → 400
 *   d. valid trimmed reason → 200, status flips to deleted
 *   e. ordinary writer (forum.read+forum.write) → 403
 *   f. caller without forum.write/governance scope → 403
 *   g. moderator succeeds; ForumAuditEvent(thread.soft_delete) keeps
 *      actor/action/target/before/after/reason; notification payload carries reason
 *   h. admin (forum.admin) succeeds
 *   i. repeat DELETE on a deleted thread → 400 (terminal, explicit rejection)
 *
 * Split from governance.test.ts (file-size limit); same helper style.
 * Run: npx tsx --test tests/governance-delete-reason.test.ts
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
  // Must be set before src/config/env.js is imported (same as governance.test.ts).
  process.env.FORUM_OPERATOR_AGENT_IDS = 'forum-ops';
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

// ── Identities ────────────────────────────────────────────────────

const IDS = {
  author:    { sub: '10000000-0000-4000-8000-000000000001', agentId: 'author-agent',    pid: '10000000-0000-4000-8000-0000000000a1' },
  plain:     { sub: '10000000-0000-4000-8000-000000000002', agentId: 'plain-agent',     pid: '10000000-0000-4000-8000-0000000000a2' },
  moderator: { sub: '10000000-0000-4000-8000-000000000003', agentId: 'forum-moderator', pid: '10000000-0000-4000-8000-0000000000a3' },
  admin:     { sub: '10000000-0000-4000-8000-000000000004', agentId: 'forum-admin',     pid: '10000000-0000-4000-8000-0000000000a4' },
  readonly:  { sub: '10000000-0000-4000-8000-000000000007', agentId: 'read-only',       pid: '10000000-0000-4000-8000-0000000000a7' },
};

const SCOPES = {
  plain: 'forum.read forum.write',
  moderator: 'forum.read forum.write forum.moderate',
  admin: 'forum.read forum.write forum.moderate forum.admin',
  readonly: 'forum.read', // no forum.write, no governance scope
};

function tokenFor(who: keyof typeof IDS, scope?: string) {
  const id = IDS[who];
  return _signTestToken({ sub: id.sub, agent_id: id.agentId, client_id: 'mc_test', scope: scope ?? SCOPES.plain });
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

const THREAD_ID = '31111111-1111-4111-a111-111111111111';

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
    id, title: 'Delete-reason target', status: 'open', type: 'discussion',
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
      id: id.pid, authSubject: id.sub, principalType: 'agent',
      agentId: id.agentId, displayName: id.agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }
}

function seedParticipant(threadId: string, who: keyof typeof IDS) {
  const pid = mockUuid();
  participants.set(pid, {
    id: pid, threadId, agentId: IDS[who].pid, agentName: IDS[who].agentId,
    role: 'member', status: 'active', joinedAt: new Date(), leftAt: null,
  });
}

// ── Mock prisma (same shape as governance.test.ts) ────────────────

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
      if (orderBy) {
        const order = Array.isArray(orderBy) ? orderBy : [orderBy];
        items = [...items].sort((a, b) => {
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
      const first = items[0] || null;
      if (first && select) {
        const picked: any = {};
        for (const k of Object.keys(select)) picked[k] = (first as any)[k];
        return picked;
      }
      return first;
    },
    findMany: async ({ where }: any = {}) =>
      Array.from(store.values()).filter((d) => matches(d, where)),
    count: async ({ where }: any = {}) =>
      Array.from(store.values()).filter((d) => matches(d, where)).length,
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.eventId || data.id || mockUuid() };
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
  // ForumAuditEvent's primary key is `eventId` (schema) — mirror it so the
  // notification sourceEventKey (`audit:<eventId>`) matches production shape.
  const auditStore = mockStore(auditLogs);
  const origAuditCreate = auditStore.create;
  auditStore.create = async (args: any) => {
    const doc = await origAuditCreate(args);
    doc.eventId = doc.id;
    return doc;
  };
  const txClient = {
    forumThread: mockStore(threads),
    forumThreadParticipant: mockStore(participants),
    forumThreadMessage: mockStore(messages),
    forumPrincipal: mockStore(principals),
    forumNotificationFact: mockStore(notifications),
    forumAuditEvent: auditStore,
    forumOutcome: mockStore(outcomes),
    forumContextSnapshot: mockStore(snapshots),
  };
  const allStores = [threads, participants, messages, principals, notifications, auditLogs, outcomes, snapshots];
  return {
    ...txClient,
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
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/threads', threadsRouter);
  app.use(errorHandler);
  return app;
}

async function req(app: any, method: string, path: string, token?: string, body?: any) {
  const s = await st();
  let r: any;
  switch (method) {
    case 'DELETE': r = s(app).delete(path); break;
    case 'GET': r = s(app).get(path); break;
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

function notificationRows(): any[] {
  return Array.from(notifications.values());
}

// ── Tests ─────────────────────────────────────────────────────────

void describe('CTR-DELETE-001 — thread soft-delete requires a non-empty reason', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    seedThread();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── a/b/c: reason validation (moderation.ts hide pattern) ──────

  await it('(a) missing reason → 400 (no body, and body without reason)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    // No body at all
    let res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, mod);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'), `error should mention reason, got: ${res.body.error}`);

    // Body present but no reason field
    res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, mod, {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));

    // Neither attempt may mutate state or write audit
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  await it('(b) reason = "" → 400', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('moderator', SCOPES.moderator), { reason: '' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  await it('(c) reason = "   " (whitespace-only) → 400', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('moderator', SCOPES.moderator), { reason: '   ' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  // (non-string reason is rejected too — same typeof guard)
  await it('non-string reason (number) → 400', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('moderator', SCOPES.moderator), { reason: 42 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));
    assert.equal(auditRows().length, 0);
  });

  // ── d: valid trimmed reason soft-deletes ────────────────────────

  await it('(d) valid reason (trimmed) → 200, soft-deleted, audit reason trimmed', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('moderator', SCOPES.moderator), { reason: '  policy violation  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'deleted');
    assert.equal(threads.get(THREAD_ID).status, 'deleted');

    const row = auditRows().find((r) => r.eventType === 'thread.soft_delete');
    assert.ok(row);
    assert.equal(row.payload.reason, 'policy violation'); // trimmed value, not raw
  });

  // ── e/f: actor authority unchanged ──────────────────────────────

  await it('(e) ordinary writer (forum.read+forum.write) → 403, no audit', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('plain', SCOPES.plain), { reason: 'let me in' });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  await it('(f) caller without forum.write/governance scope → 403', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('readonly', SCOPES.readonly), { reason: 'try anyway' });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.equal(threads.get(THREAD_ID).status, 'open');
    assert.equal(auditRows().length, 0);
  });

  // ── g: moderator success + full audit evidence + notification reason ──

  await it('(g) moderator delete: ForumAuditEvent keeps actor/action/target/before/after/reason; notification payload carries reason', async () => {
    const app = await buildApp();
    seedParticipant(THREAD_ID, 'author'); // a real fan-out recipient
    seedParticipant(THREAD_ID, 'moderator'); // actor is excluded from fan-out

    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('moderator', SCOPES.moderator), { reason: 'spam cleanup' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'deleted');

    // ForumAuditEvent(thread.soft_delete) — full evidence shape
    const rows = auditRows().filter((r) => r.eventType === 'thread.soft_delete');
    assert.equal(rows.length, 1, 'exactly one audit event');
    const row = rows[0];
    assert.equal(row.provenance, 'runtime');
    assert.equal(row.agentId, 'forum-moderator');                 // actor
    assert.equal(row.actorPrincipalId, IDS.moderator.pid);        // actor (FK)
    assert.equal(row.eventType, 'thread.soft_delete');            // action
    assert.equal(row.targetType, 'thread');                       // target
    assert.equal(row.targetId, THREAD_ID);                        // target
    assert.equal(row.threadId, THREAD_ID);
    assert.equal(row.payload.fromStatus, 'open');                 // before
    assert.equal(row.payload.toStatus, 'deleted');                // after
    assert.equal(row.payload.reason, 'spam cleanup');             // reason preserved

    // Governance notification fan-out: moderator_notice keyed on the audit
    // event, payload carries the SAME reason (not just the route surface).
    const notes = notificationRows();
    assert.equal(notes.length, 1, 'only the non-actor participant is notified');
    assert.equal(notes[0].recipientPrincipalId, IDS.author.pid);
    assert.equal(notes[0].reason, 'moderator_notice');
    assert.ok(notes[0].sourceEventKey.startsWith('audit:'));
    assert.equal(notes[0].sourceEventKey, `audit:${row.eventId}`); // keyed on the audit event
    assert.ok(notes[0].sourceEventKey.startsWith('audit:'));
    assert.equal(notes[0].payload.action, 'thread.soft_delete');
    assert.equal(notes[0].payload.fromStatus, 'open');
    assert.equal(notes[0].payload.toStatus, 'deleted');
    assert.equal(notes[0].payload.reason, 'spam cleanup');
  });

  // ── h: admin (forum.admin) succeeds ─────────────────────────────

  await it('(h) admin (forum.admin) can soft-delete with a reason', async () => {
    const app = await buildApp();
    const res = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`,
      await tokenFor('admin', SCOPES.admin), { reason: 'admin removal' });
    assert.equal(res.status, 200);
    assert.equal(res.body.thread.status, 'deleted');

    const row = auditRows().find((r) => r.eventType === 'thread.soft_delete');
    assert.ok(row);
    assert.equal(row.agentId, 'forum-admin');
    assert.equal(row.payload.reason, 'admin removal');
  });

  // ── i: deleted is terminal — repeat DELETE is explicitly rejected ──

  await it('(i) repeat DELETE on a deleted thread → 400 (terminal state)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    const first = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, mod, { reason: 'first strike' });
    assert.equal(first.status, 200);

    // Valid reason supplied again — the rejection must come from the state
    // machine, not from a missing body field.
    const second = await req(app, 'DELETE', `/api/threads/${THREAD_ID}`, mod, { reason: 'delete again' });
    assert.equal(second.status, 400);
    assert.ok(
      second.body.error.includes('already deleted'),
      `expected explicit terminal-state error, got: ${second.body.error}`,
    );
    assert.equal(threads.get(THREAD_ID).status, 'deleted'); // unchanged

    // Exactly ONE soft_delete audit event — the rejected repeat wrote nothing.
    assert.equal(auditRows().filter((r) => r.eventType === 'thread.soft_delete').length, 1);
  });
});
