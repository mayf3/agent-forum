/**
 * Notification V1 (materialized) acceptance tests.
 *
 * Covers:
 *   - @agent-id in message CONTENT produces a notification row (mention)
 *   - author self-mention does not notify; unknown content tokens are dropped
 *     (prose-safe); explicit body mentions stay strict (400 on unknown)
 *   - email-like text (user@host) is not a mention
 *   - GET /api/notifications — queryable, recipient always the caller
 *   - POST /api/notifications/:id/read + batch read — read state updatable,
 *     scoped to the recipient (foreign notification → 404)
 *   - lifecycle governance → thread_notice to participants (close)
 *   - hide → moderator_notice to participants
 *   - report handled → moderator_notice to the reporter
 *
 * Run: npx tsx --test tests/notifications-v1.test.ts
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
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

// ── Identities ────────────────────────────────────────────────────

const IDS = {
  author:    { sub: '30000000-0000-4000-8000-000000000001', agentId: 'author-agent',    pid: '30000000-0000-4000-8000-0000000000b1' },
  mentioned: { sub: '30000000-0000-4000-8000-000000000002', agentId: 'reviewer-agent',  pid: '30000000-0000-4000-8000-0000000000b2' },
  other:     { sub: '30000000-0000-4000-8000-000000000003', agentId: 'other-agent',     pid: '30000000-0000-4000-8000-0000000000b3' },
  moderator: { sub: '30000000-0000-4000-8000-000000000004', agentId: 'forum-moderator', pid: '30000000-0000-4000-8000-0000000000b4' },
};

const PLAIN = 'forum.read forum.write';
const MODERATOR = 'forum.read forum.write forum.moderate';

function tokenFor(who: keyof typeof IDS, scope = PLAIN) {
  const id = IDS[who];
  return _signTestToken({ sub: id.sub, agent_id: id.agentId, client_id: 'mc_test', scope });
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

function resetDb() {
  threads.clear(); participants.clear(); messages.clear();
  principals.clear(); notifications.clear(); auditLogs.clear(); reports.clear();
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

function seedWorld() {
  threads.set(THREAD_ID, {
    id: THREAD_ID, title: 'Notification target', status: 'open', type: 'discussion',
    messageCount: 0, viewCount: 0, pinned: false, featured: false,
    createdById: IDS.author.pid, createdByName: 'author-agent', createdByType: 'agent',
    tags: [], createdAt: new Date(), updatedAt: new Date(), lastMessageAt: null,
  });
  for (const key of Object.keys(IDS) as Array<keyof typeof IDS>) {
    const id = IDS[key];
    principals.set(id.pid, {
      id: id.pid, authSubject: id.sub, principalType: 'agent',
      agentId: id.agentId, displayName: id.agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }
  // author participates (creator); reviewer participates (will be mentioned)
  for (const who of ['author', 'mentioned'] as Array<keyof typeof IDS>) {
    const pid = mockUuid();
    participants.set(pid, {
      id: pid, threadId: THREAD_ID, agentId: IDS[who].pid, agentName: IDS[who].agentId,
      role: who === 'author' ? 'creator' : 'member', status: 'active',
      joinedAt: new Date(), leftAt: null,
    });
  }
}

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
      if (where.targetType_targetId_reporterId) {
        const { targetType, targetId, reporterId } = where.targetType_targetId_reporterId;
        for (const v of store.values()) {
          if (v.targetType === targetType && v.targetId === targetId && v.reporterId === reporterId) return v;
        }
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
        // Real Prisma rows materialize nullable columns as null — mirror that
        // so readAt-based unread logic behaves like production.
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
  const r = mockStore(reports);
  return {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumPrincipal: fp,
    forumNotificationFact: n,
    forumAuditEvent: a,
    forumReport: r,
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t,
      forumThreadParticipant: p,
      forumThreadMessage: m,
      forumPrincipal: fp,
      forumNotificationFact: n,
      forumAuditEvent: a,
      forumReport: r,
    }),
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
  const { reportsRouter } = await import('../src/routes/reports.js');
  const { notificationsRouter } = await import('../src/routes/notifications.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/threads', threadsRouter);
  app.use('/api/threads', moderationRouter);
  app.use('/api/threads/:threadId/messages', messagesRouter);
  app.use('/api/reports', reportsRouter);
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
    default: throw new Error(`Unknown method: ${method}`);
  }
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) r = r.send(body);
  return r;
}

let prismaMod: typeof import('../src/lib/prisma.js');

function notifsFor(principalId: string, reason?: string): any[] {
  return Array.from(notifications.values()).filter(
    (n) => n.recipientPrincipalId === principalId && (!reason || n.reason === reason),
  );
}

// ── Tests ─────────────────────────────────────────────────────────

void describe('Notification V1 — mentions (materialized)', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedWorld();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('@agent-id in message content produces a mention notification', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'Please take a look @reviewer-agent — need your review today.',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.message.mentions, ['reviewer-agent']);

    const rows = notifsFor(IDS.mentioned.pid, 'mention');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].threadId, THREAD_ID);
    assert.equal(rows[0].messageId, res.body.message.id);
    assert.equal(rows[0].readAt, null);
    assert.ok(rows[0].createdAt);
    assert.equal(rows[0].payload.authorAgentId, 'author-agent');

    // No notification for the author, no notification for anyone else
    assert.equal(notifsFor(IDS.author.pid).length, 0);
    assert.equal(notifsFor(IDS.other.pid).length, 0);
  });

  await it('self-mention does not notify the author', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'note to self @author-agent',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.message.mentions, ['author-agent']);
    assert.equal(notifsFor(IDS.author.pid).length, 0);
  });

  await it('unknown @token in content is dropped silently (prose-safe)', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'ping @nonexistent-agent later, and mail me at someone@example.com',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.message.mentions, []);
    assert.equal(notifications.size, 0);
  });

  await it('explicit body mentions stay strict — unknown agent → 400', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'hello',
      mentions: ['ghost-agent'],
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('UNKNOWN_MENTION_AGENT'));
    assert.equal(messages.size, 0);
  });

  await it('explicit + content mentions union into one notification per agent', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'cc @reviewer-agent',
      mentions: ['other-agent', 'reviewer-agent'],
    });
    assert.equal(res.status, 201);
    assert.equal(notifsFor(IDS.mentioned.pid).length, 1);
    assert.equal(notifsFor(IDS.other.pid).length, 1);
  });
});

void describe('Notification V1 — query + read state', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(async () => {
    resetDb();
    seedWorld();
    prismaMod.setPrisma(createMockPrisma() as any);
    const app = await buildApp();
    await req(app, 'POST', `/api/threads/${THREAD_ID}/messages`, await tokenFor('author'), {
      content: 'fyi @reviewer-agent and @other-agent',
    });
  });

  await it('GET /api/notifications returns own notifications with unreadCount', async () => {
    const app = await buildApp();
    const res = await req(app, 'GET', '/api/notifications', await tokenFor('mentioned'));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.unreadCount, 1);
    assert.equal(res.body.items[0].type, 'mention');
    assert.equal(res.body.items[0].recipientPrincipalId, IDS.mentioned.pid);
  });

  await it('type filter and unread filter work', async () => {
    const app = await buildApp();
    let res = await req(app, 'GET', '/api/notifications?type=thread_notice', await tokenFor('mentioned'));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);

    res = await req(app, 'GET', '/api/notifications?type=bogus', await tokenFor('mentioned'));
    assert.equal(res.status, 400);

    // mark read, then unread=true excludes it
    const id = notifsFor(IDS.mentioned.pid)[0].id;
    await req(app, 'POST', `/api/notifications/${id}/read`, await tokenFor('mentioned'), {});
    res = await req(app, 'GET', '/api/notifications?unread=true', await tokenFor('mentioned'));
    assert.equal(res.body.total, 0);
    res = await req(app, 'GET', '/api/notifications', await tokenFor('mentioned'));
    assert.equal(res.body.unreadCount, 0);
  });

  await it('mark read is scoped to the recipient — foreign id → 404', async () => {
    const app = await buildApp();
    const id = notifsFor(IDS.mentioned.pid)[0].id;
    const res = await req(app, 'POST', `/api/notifications/${id}/read`, await tokenFor('other'), {});
    assert.equal(res.status, 404);
    assert.equal(notifications.get(id).readAt, null);
  });

  await it('batch read marks only own unread rows (idempotent)', async () => {
    const app = await buildApp();
    const r1 = notifsFor(IDS.mentioned.pid)[0].id;
    const o1 = notifsFor(IDS.other.pid)[0].id;
    const res = await req(app, 'POST', '/api/notifications/read', await tokenFor('mentioned'), {
      ids: [r1, o1],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.updated, 1);
    assert.ok(notifications.get(r1).readAt);
    assert.equal(notifications.get(o1).readAt, null);
  });
});

void describe('Notification V1 — governance + report notices', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedWorld();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('close sends thread_notice to participants (except the actor)', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/close`, await tokenFor('moderator', MODERATOR), {});
    assert.equal(res.status, 200);

    // moderator is not a participant → gets nothing; author + reviewer do
    assert.equal(notifsFor(IDS.author.pid, 'thread_notice').length, 1);
    assert.equal(notifsFor(IDS.mentioned.pid, 'thread_notice').length, 1);
    assert.equal(notifsFor('forum-moderator').length, 0);

    const row = notifsFor(IDS.author.pid, 'thread_notice')[0];
    assert.equal(row.payload.action, 'thread.close');
    assert.equal(row.payload.toStatus, 'closed');
  });

  await it('hide sends moderator_notice to participants', async () => {
    const app = await buildApp();
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/hide`, await tokenFor('moderator', MODERATOR), { reason: 'policy violation' });
    assert.equal(res.status, 200);
    assert.equal(notifsFor(IDS.author.pid, 'moderator_notice').length, 1);
    assert.equal(notifsFor(IDS.mentioned.pid, 'moderator_notice').length, 1);
  });

  await it('report handling notifies the reporter (moderator_notice)', async () => {
    const app = await buildApp();

    // other-agent reports the thread
    const created = await req(app, 'POST', '/api/reports', await tokenFor('other'), {
      targetType: 'thread',
      targetId: THREAD_ID,
      reason: 'spam',
    });
    assert.equal(created.status, 201);
    const reportId = created.body.report.id;

    // moderator handles it
    const res = await req(app, 'PATCH', `/api/reports/${reportId}`, await tokenFor('moderator', MODERATOR), {
      action: 'ignore',
      note: 'not spam',
    });
    assert.equal(res.status, 200);

    const rows = notifsFor(IDS.other.pid, 'moderator_notice');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].threadId, THREAD_ID);
    assert.equal(rows[0].payload.reportAction, 'ignore');

    // The governance action itself is audited
    const audit = Array.from(auditLogs.values()).filter((r) => r.eventType === 'report.handle');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].targetId, reportId);
  });

  // boundary F6: non-numeric / negative pagination fails 400 (never a 500
  // from Prisma, never a negative take reverse window).
  await it('boundary F6: invalid page/limit on /api/notifications → 400', async () => {
    const app = await buildApp();
    const token = await tokenFor('other', PLAIN);
    for (const q of ['?page=abc', '?page=-1', '?limit=0', '?limit=-5', '?limit=101']) {
      const res = await req(app, 'GET', `/api/notifications${q}`, token);
      assert.equal(res.status, 400, q);
    }
    const ok = await req(app, 'GET', '/api/notifications?page=2&limit=10', token);
    assert.equal(ok.status, 200);
  });
});
