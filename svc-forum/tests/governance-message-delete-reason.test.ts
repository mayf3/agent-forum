/**
 * CTR-DELETE-002 acceptance tests — message soft-delete requires a non-empty
 * reason (message side of the delete-reason contract, mirroring the thread
 * side in governance-delete-reason.test.ts). The reason MUST flow into BOTH
 * the forum_audit_events payload (message.soft_delete) and the
 * moderator_notice fan-out payload; the report-handle cascade
 * (PATCH /api/reports/:id, action=delete) must carry the handling moderation
 * reason (note) into the report.handle audit event covering the cascaded
 * message tombstone.
 *
 * Coverage (GOVERNANCE-FINAL-AUDIT-A776CF4-R1 H-2):
 *   a-d. missing / "" / whitespace / non-string reason → 400, no state change
 *   e.   valid reason → 200 + derived recompute + trimmed audit reason
 *   f.   ordinary writer → 403;  g. no write/governance scope → 403
 *   h.   moderator success (audit + notification evidence)
 *   i.   admin (forum.admin) succeeds
 *   j.   repeat DELETE on already-deleted message → 404, one audit event
 *   k.   report cascade: delete without note → 400; with note → audit reason
 *
 * Same helper/mock style as governance-delete-reason.test.ts.
 * Run: npx tsx --test tests/governance-message-delete-reason.test.ts
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
const reports = new Map<string, any>();

const THREAD_ID = '41111111-1111-4111-a111-111111111111';
const MSG_OLD_ID = '42222222-2222-4222-a222-222222222221';
const MSG_NEW_ID = '42222222-2222-4222-a222-222222222222';
const T_OLD = new Date('2026-08-01T00:00:00Z');
const T_NEW = new Date('2026-08-02T00:00:00Z');

function resetDb() {
  threads.clear(); participants.clear(); messages.clear();
  principals.clear(); notifications.clear(); auditLogs.clear();
  reports.clear();
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

/** Thread with two visible messages: derived state = count 2, last = T_NEW. */
function seedThreadWithMessages() {
  threads.set(THREAD_ID, {
    id: THREAD_ID, title: 'Message-delete target', status: 'open', type: 'discussion',
    messageCount: 2, viewCount: 0, pinned: false, featured: false, lastMessageAt: T_NEW,
    createdById: IDS.author.pid, createdByName: 'author-agent', createdByType: 'agent',
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  });
  for (const [id, seq, at, content] of [[MSG_OLD_ID, 1, T_OLD, 'older message'], [MSG_NEW_ID, 2, T_NEW, 'newer message']] as const) {
    messages.set(id, {
      id, threadId: THREAD_ID, parentId: null, seq,
      authorId: IDS.author.pid, authorName: 'author-agent', authorType: 'agent',
      kind: 'comment', content, mentions: [],
      deletedAt: null, createdAt: at, updatedAt: at,
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

function seedMessageReport(reporter: keyof typeof IDS) {
  const id = mockUuid();
  reports.set(id, {
    id, targetType: 'message', targetId: MSG_NEW_ID,
    reporterId: IDS[reporter].pid, reporterName: IDS[reporter].agentId,
    reason: 'violation', note: null, status: 'pending',
    createdAt: new Date(), updatedAt: new Date(),
  });
  return id;
}

// ── Mock prisma (same shape as governance-delete-reason.test.ts) ──

function matches(doc: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === null || typeof v !== 'object') {
      if (doc[k] !== v) return false;
      continue;
    }
    if (Array.isArray(v.in) && !v.in.includes(doc[k])) return false;
    if ('notIn' in v && v.notIn.includes(doc[k])) return false;
    if ('not' in v) {
      if (v.not === null && doc[k] == null) return false;
      if (typeof v.not === 'string' && doc[k] === v.not) return false;
    }
    if (k === 'OR' && Array.isArray(v)) {
      if (!v.some((alt: any) => matches(doc, alt))) return false;
    }
  }
  return true;
}

function mockStore(store: Map<string, any>) {
  return {
    findUnique: async ({ where }: any) => {
      if (where.id) return store.get(where.id) || null;
      for (const key of ['authSubject', 'agentId'] as const) {
        if (where[key]) {
          for (const v of store.values()) if (v[key] === where[key]) return v;
          return null;
        }
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
              const av = a[field] ?? new Date(0);
              const bv = b[field] ?? new Date(0);
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
        for (const k of Object.keys(select)) picked[k] = first[k];
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
        const doc = { readAt: null, ...item, id: item.id || mockUuid() };
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
    forumReport: mockStore(reports),
  };
  const allStores = [threads, participants, messages, principals, notifications, auditLogs, reports];
  return {
    ...txClient,
    $transaction: async (fn: (tx: any) => any) => {
      const saved = allStores.map((store) => new Map(store));
      try {
        return await fn(txClient);
      } catch (err) {
        allStores.forEach((store, i) => {
          store.clear();
          for (const [k, v] of saved[i]) store.set(k, v);
        });
        throw err;
      }
    },
    $disconnect: async () => {},
  };
}

// ── App + request helpers ─────────────────────────────────────────

let _supertest: any;
async function buildApp() {
  const { messagesRouter } = await import('../src/routes/messages.js');
  const { reportsRouter } = await import('../src/routes/reports.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/threads/:threadId/messages', messagesRouter);
  app.use('/api/reports', reportsRouter);
  app.use(errorHandler);
  return app;
}

async function req(app: any, method: string, path: string, token?: string, body?: any) {
  if (!_supertest) _supertest = (await import('supertest')).default;
  let r: any;
  if (method === 'DELETE') r = _supertest(app).delete(path);
  else if (method === 'PATCH') r = _supertest(app).patch(path);
  else throw new Error(`Unknown method: ${method}`);
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

void describe('CTR-DELETE-002 — message soft-delete requires a non-empty reason', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    seedThreadWithMessages();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  const deleteMsg = (app: any, token: string, body?: any, messageId = MSG_NEW_ID) =>
    req(app, 'DELETE', `/api/threads/${THREAD_ID}/messages/${messageId}`, token, body);

  await it('(a) missing reason → 400 (no body, and body without reason)', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    let res = await deleteMsg(app, mod);
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'), `error should mention reason, got: ${res.body.error}`);

    res = await deleteMsg(app, mod, {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'));

    // Neither attempt may mutate state or write audit
    assert.equal(messages.get(MSG_NEW_ID).deletedAt, null);
    assert.equal(threads.get(THREAD_ID).messageCount, 2);
    assert.equal(auditRows().length, 0);
  });

  await it('(b/c/d) empty / whitespace-only / non-string reason → 400, no state change', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);
    for (const reason of ['', '   ', 42]) {
      const res = await deleteMsg(app, mod, { reason });
      assert.equal(res.status, 400, `reason=${JSON.stringify(reason)}`);
      assert.ok(res.body.error.includes('reason'), `error should mention reason, got: ${res.body.error}`);
      assert.equal(messages.get(MSG_NEW_ID).deletedAt, null);
      assert.equal(auditRows().length, 0);
    }
  });

  await it('(e) valid reason → 200, derived state recomputed, audit reason trimmed', async () => {
    const app = await buildApp();
    const res = await deleteMsg(app, await tokenFor('moderator', SCOPES.moderator), { reason: '  spam cleanup  ' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });

    // Tombstone
    assert.ok(messages.get(MSG_NEW_ID).deletedAt instanceof Date);

    // CTR-DELETE-002 derived repair: count/lastMessageAt from VISIBLE messages
    const thread = threads.get(THREAD_ID);
    assert.equal(thread.messageCount, 1);
    assert.equal(thread.lastMessageAt.getTime(), T_OLD.getTime());

    // Audit carries the trimmed reason
    const row = auditRows().find((r) => r.eventType === 'message.soft_delete');
    assert.ok(row);
    assert.equal(row.payload.reason, 'spam cleanup'); // trimmed value, not raw
  });

  await it('(f) ordinary writer (forum.read+forum.write) → 403, no audit', async () => {
    const app = await buildApp();
    const res = await deleteMsg(app, await tokenFor('plain', SCOPES.plain), { reason: 'let me in' });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.equal(messages.get(MSG_NEW_ID).deletedAt, null);
    assert.equal(auditRows().length, 0);
  });

  await it('(g) caller without forum.write/governance scope → 403', async () => {
    const app = await buildApp();
    const res = await deleteMsg(app, await tokenFor('readonly', SCOPES.readonly), { reason: 'try anyway' });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.equal(messages.get(MSG_NEW_ID).deletedAt, null);
    assert.equal(auditRows().length, 0);
  });

  await it('(h) moderator delete: audit keeps actor/target/reason; notification payload carries reason', async () => {
    const app = await buildApp();
    seedParticipant(THREAD_ID, 'author'); // a real fan-out recipient
    seedParticipant(THREAD_ID, 'moderator'); // actor is excluded from fan-out

    const res = await deleteMsg(app, await tokenFor('moderator', SCOPES.moderator), { reason: 'abuse removal' });
    assert.equal(res.status, 200);

    const rows = auditRows().filter((r) => r.eventType === 'message.soft_delete');
    assert.equal(rows.length, 1, 'exactly one audit event');
    const row = rows[0];
    assert.equal(row.provenance, 'runtime');
    assert.equal(row.agentId, 'forum-moderator');                 // actor
    assert.equal(row.actorPrincipalId, IDS.moderator.pid);        // actor (FK)
    assert.equal(row.targetType, 'message');                      // target
    assert.equal(row.targetId, MSG_NEW_ID);                       // target
    assert.equal(row.threadId, THREAD_ID);
    assert.equal(row.payload.reason, 'abuse removal');            // reason preserved

    // moderator_notice fan-out keyed on the audit event, payload carries reason.
    // The fan-out is thread-scoped: messageId is not part of the spec payload.
    const notes = notificationRows();
    assert.equal(notes.length, 1, 'only the non-actor participant is notified');
    assert.equal(notes[0].recipientPrincipalId, IDS.author.pid);
    assert.equal(notes[0].reason, 'moderator_notice');
    assert.equal(notes[0].messageId, null);
    assert.equal(notes[0].sourceEventKey, `audit:${row.eventId}`);
    assert.equal(notes[0].payload.action, 'message.soft_delete');
    assert.equal(notes[0].payload.reason, 'abuse removal');
  });

  await it('(i) admin (forum.admin) can soft-delete a message with a reason', async () => {
    const app = await buildApp();
    const res = await deleteMsg(app, await tokenFor('admin', SCOPES.admin), { reason: 'admin removal' });
    assert.equal(res.status, 200);
    assert.ok(messages.get(MSG_NEW_ID).deletedAt instanceof Date);

    const row = auditRows().find((r) => r.eventType === 'message.soft_delete');
    assert.ok(row);
    assert.equal(row.agentId, 'forum-admin');
    assert.equal(row.payload.reason, 'admin removal');
  });

  await it('(j) repeat DELETE on an already-deleted message → 404, exactly one audit event', async () => {
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    const first = await deleteMsg(app, mod, { reason: 'first strike' });
    assert.equal(first.status, 200);

    // Valid reason supplied again — the rejection must come from the
    // already-deleted lookup (404, same as nonexistent: no existence leak).
    const second = await deleteMsg(app, mod, { reason: 'delete again' });
    assert.equal(second.status, 404);
    assert.ok(second.body.error.includes('Message not found'), `got: ${second.body.error}`);

    // Exactly ONE soft_delete audit event — the rejected repeat wrote nothing.
    assert.equal(auditRows().filter((r) => r.eventType === 'message.soft_delete').length, 1);
  });

  await it('(k1) report action=delete without note → 400 (deletion requires a reason)', async () => {
    const app = await buildApp();
    const reportId = seedMessageReport('plain');

    const res = await req(app, 'PATCH', `/api/reports/${reportId}`,
      await tokenFor('moderator', SCOPES.moderator), { action: 'delete' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('reason'), `error should mention reason, got: ${res.body.error}`);

    // Nothing changed: report pending, message visible, no audit
    assert.equal(reports.get(reportId).status, 'pending');
    assert.equal(messages.get(MSG_NEW_ID).deletedAt, null);
    assert.equal(auditRows().length, 0);
  });

  await it('(k2) report action=delete with note → cascade tombstone; audit reason = note', async () => {
    const app = await buildApp();
    const reportId = seedMessageReport('plain');

    const res = await req(app, 'PATCH', `/api/reports/${reportId}`,
      await tokenFor('moderator', SCOPES.moderator), { action: 'delete', note: '  removed per policy  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.report.status, 'deleted');
    assert.equal(res.body.report.handleNote, '  removed per policy  '); // stored verbatim

    // Cascade: message tombstoned + derived repair in the same transaction
    assert.ok(messages.get(MSG_NEW_ID).deletedAt instanceof Date);
    assert.equal(threads.get(THREAD_ID).messageCount, 1);
    assert.equal(threads.get(THREAD_ID).lastMessageAt.getTime(), T_OLD.getTime());

    // The report.handle audit event — the same event covering the cascaded
    // message soft-delete — carries the trimmed moderation reason.
    const rows = auditRows().filter((r) => r.eventType === 'report.handle');
    assert.equal(rows.length, 1, 'exactly one audit event');
    const row = rows[0];
    assert.equal(row.targetType, 'report');
    assert.equal(row.targetId, reportId);
    assert.equal(row.payload.reason, 'removed per policy'); // trimmed
    assert.equal(row.payload.metadata.reportAction, 'delete');
    assert.equal(row.payload.metadata.reportedTargetId, MSG_NEW_ID);

    // Reporter notice (moderator_notice) keyed on the audit event
    const notes = notificationRows().filter((n) => n.reason === 'moderator_notice');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].recipientPrincipalId, IDS.plain.pid);
    assert.equal(notes[0].sourceEventKey, `audit:${row.eventId}`);
  });
});
