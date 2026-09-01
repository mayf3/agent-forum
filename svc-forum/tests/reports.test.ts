/**
 * Report entry (moderation queue) acceptance tests.
 *
 * Covers AC#1 (report thread/message with required reason + optional note),
 * AC#2 (reports land in moderator-visible queue), AC#3 (same reporter on same
 * target counts once — duplicates rejected), AC#4 (handling ignore/warn/delete
 * leaves a queryable status trace; delete cascades to soft-delete).
 *
 * Run: npx tsx --test tests/reports.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

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

const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };
const USER_B = { id: 'user-b-uuid', name: 'Agent Beta' };

// ── In-memory database (mirrors tests/forum.test.ts mock) ──

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const reports = new Map<string, any>();
const principals = new Map<string, any>();
const auditLogs = new Map<string, any>();
const notifications = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  reports.clear();
  principals.clear();
  auditLogs.clear();
  notifications.clear();
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
      if (where.targetType_targetId_reporterId) {
        const { targetType, targetId, reporterId } = where.targetType_targetId_reporterId;
        for (const v of store.values()) {
          if (v.targetType === targetType && v.targetId === targetId && v.reporterId === reporterId) return v;
        }
        return null;
      }
      return null;
    },
    findFirst: async ({ where }: any) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'targetType') items = items.filter(i => i.targetType === v);
          if (k === 'targetId') items = items.filter(i => i.targetId === v);
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
        }
      }
      return items[0] || null;
    },
    findMany: async ({ where, skip, take }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'targetType') items = items.filter(i => i.targetType === v);
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
        }
      }
      items.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
      if (skip) items = items.slice(skip);
      if (take) items = items.slice(0, take);
      return items;
    },
    count: async ({ where }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'targetType') items = items.filter(i => i.targetType === v);
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid() };
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
    createMany: async ({ data }: any) => {
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        const doc = { readAt: null, ...item, id: item.id || mockUuid() };
        if (!doc.createdAt) doc.createdAt = new Date();
        store.set(doc.id, doc);
      }
      return { count: list.length };
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const p = mockStore(participants);
  const m = mockStore(messages);
  const r = mockStore(reports);
  const fp = mockStore(principals);
  const al = mockStore(auditLogs);
  const n = mockStore(notifications);
  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumReport: r,
    forumPrincipal: fp,
    forumAuditEvent: al,
    forumNotificationFact: n,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t,
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
      forumReport: r,
      forumPrincipal: fp,
      forumAuditEvent: al,
      forumNotificationFact: n,
      $executeRaw: async () => {},
    }),
    $disconnect: async () => {},
  };
  return mock;
}

// ── Helpers ──

async function seedTargets() {
  const thread = await da.createThread({
    title: 'Reportable Thread',
    type: 'discussion',
    createdById: USER_A.id,
    createdByName: USER_A.name,
    createdByType: 'agent',
  });
  const message = await da.createMessage({
    threadId: thread.id,
    authorId: USER_A.id,
    authorName: USER_A.name,
    authorType: 'agent',
    kind: 'comment',
    content: 'This message violates policy',
  });
  return { thread, message };
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

// ── Tests ──

void describe('Report Entry (Moderation Queue)', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── AC#1: submit report (reason required, note optional) ──
  await it('AC#1 creates a report with required reason and optional note', async () => {
    const { thread } = await seedTargets();

    const report = await da.createReport({
      targetType: 'thread',
      targetId: thread.id,
      reporterId: USER_B.id,
      reporterName: USER_B.name,
      reason: 'spam',
      note: 'Repeated promotional content',
    });

    assert.ok(report.id);
    assert.equal(report.targetType, 'thread');
    assert.equal(report.targetId, thread.id);
    assert.equal(report.reason, 'spam');
    assert.equal(report.note, 'Repeated promotional content');
    assert.equal(report.status, 'pending');
  });

  await it('AC#1 rejects missing/invalid reason', async () => {
    const { message } = await seedTargets();
    await assert.rejects(
      da.createReport({
        targetType: 'message',
        targetId: message.id,
        reporterId: USER_B.id,
        reporterName: USER_B.name,
        reason: '',
      }),
      (err: any) => err.statusCode === 400 && /reason/.test(err.message),
    );

    await assert.rejects(
      da.createReport({
        targetType: 'message',
        targetId: message.id,
        reporterId: USER_B.id,
        reporterName: USER_B.name,
        reason: 'not-a-valid-reason',
      }),
      (err: any) => err.statusCode === 400 && /reason/.test(err.message),
    );
  });

  await it('AC#1 rejects reports on non-existent or deleted targets', async () => {
    const { thread } = await seedTargets();
    await assert.rejects(
      da.createReport({
        targetType: 'thread',
        targetId: mockUuid(),
        reporterId: USER_B.id,
        reporterName: USER_B.name,
        reason: 'spam',
      }),
      (err: any) => err.statusCode === 404,
    );

    // Mark the target deleted directly in the mock store — the standalone
    // `softDeleteThread` data-access writer no longer exists (removed per
    // DEC-GOV-003; deletion goes only through the audited governance path).
    threads.get(thread.id)!.status = 'deleted';
    await assert.rejects(
      da.createReport({
        targetType: 'thread',
        targetId: thread.id,
        reporterId: USER_B.id,
        reporterName: USER_B.name,
        reason: 'spam',
      }),
      (err: any) => err.statusCode === 400,
    );
  });

  // ── AC#3: same reporter on same target counts once ──
  await it('AC#3 duplicate report from same reporter returns 409 ALREADY_REPORTED', async () => {
    const { message } = await seedTargets();

    const first = await da.createReport({
      targetType: 'message',
      targetId: message.id,
      reporterId: USER_B.id,
      reporterName: USER_B.name,
      reason: 'abuse',
    });
    assert.ok(first.id);

    await assert.rejects(
      da.createReport({
        targetType: 'message',
        targetId: message.id,
        reporterId: USER_B.id,
        reporterName: USER_B.name,
        reason: 'abuse',
        note: 'duplicate attempt',
      }),
      (err: any) => err.statusCode === 409 && /ALREADY_REPORTED/.test(err.message),
    );

    // A DIFFERENT reporter may still report the same target
    const second = await da.createReport({
      targetType: 'message',
      targetId: message.id,
      reporterId: USER_A.id,
      reporterName: USER_A.name,
      reason: 'violation',
    });
    assert.ok(second.id);
  });

  // ── AC#2: moderator-visible queue ──
  await it('AC#2 reports appear in the queue with filters and pagination', async () => {
    const { thread, message } = await seedTargets();
    await da.createReport({
      targetType: 'thread', targetId: thread.id,
      reporterId: USER_B.id, reporterName: USER_B.name, reason: 'spam',
    });
    await da.createReport({
      targetType: 'message', targetId: message.id,
      reporterId: USER_A.id, reporterName: USER_A.name, reason: 'abuse',
    });

    const all = await da.findReports({});
    assert.equal(all.total, 2);
    assert.equal(all.items.length, 2);

    const byStatus = await da.findReports({ status: 'pending' });
    assert.equal(byStatus.total, 2);

    const byType = await da.findReports({ targetType: 'message' });
    assert.equal(byType.total, 1);
    assert.equal(byType.items[0].targetId, message.id);
  });

  // ── AC#4: handling leaves queryable trace; delete cascades ──
  // (through the audited governance route PATCH /api/reports/:id — the
  // unguarded data-layer handleReport helper was removed per DEC-GOV-003)
  async function buildReportsApp() {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { reportsRouter } = await import('../src/routes/reports.js');
    app.use('/api/reports', reportsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    return app;
  }

  await it('AC#4 ignore/warn leaves status trace queryable by id', async () => {
    const { thread } = await seedTargets();
    const report = await da.createReport({
      targetType: 'thread', targetId: thread.id,
      reporterId: USER_B.id, reporterName: USER_B.name, reason: 'off_topic',
    });

    const app = await buildReportsApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .patch(`/api/reports/${report.id}`)
      .set('Authorization', `Bearer ${await tokenWith('forum.write forum.moderate')}`)
      .send({ action: 'warn', note: 'First warning issued' });
    assert.equal(res.status, 200);
    assert.equal(res.body.report.status, 'warned');
    assert.ok(res.body.report.handledById);
    assert.ok(res.body.report.handledAt);

    const fetched = await da.findReportById(report.id);
    assert.equal(fetched!.status, 'warned');
    assert.equal(fetched!.handleNote, 'First warning issued');

    // Already-handled reports cannot be re-handled (409)
    const again = await request(app)
      .patch(`/api/reports/${report.id}`)
      .set('Authorization', `Bearer ${await tokenWith('forum.write forum.moderate')}`)
      .send({ action: 'delete', note: 'delete attempt' });
    assert.equal(again.status, 409);
  });

  await it('AC#4 delete action cascades to soft-delete the reported content', async () => {
    const { message } = await seedTargets();
    const report = await da.createReport({
      targetType: 'message', targetId: message.id,
      reporterId: USER_B.id, reporterName: USER_B.name, reason: 'violation',
    });

    const app = await buildReportsApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .patch(`/api/reports/${report.id}`)
      .set('Authorization', `Bearer ${await tokenWith('forum.write forum.moderate')}`)
      .send({ action: 'delete', note: 'Removed per policy' });
    assert.equal(res.status, 200);
    assert.equal(res.body.report.status, 'deleted');

    // Report trace is preserved
    const fetched = await da.findReportById(report.id);
    assert.equal(fetched!.status, 'deleted');

    // Target message is soft-deleted (no longer visible in normal queries)
    const visible = await da.findMessagesByThreadId(message.threadId);
    assert.ok(!visible.some((m: any) => m.id === message.id), 'deleted message hidden');
  });

  // ── Route-level: scope enforcement ──
  await it('POST /api/reports requires forum.write and returns 201', async () => {
    const { message } = await seedTargets();
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { reportsRouter } = await import('../src/routes/reports.js');
    app.use('/api/reports', reportsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${await tokenWith('forum.write')}`)
      .send({ targetType: 'message', targetId: message.id, reason: 'spam', note: 'route test' });
    assert.equal(res.status, 201, 'report created');
    assert.equal(res.body.report.reason, 'spam');
    assert.equal(res.body.report.status, 'pending');
  });

  await it('GET /api/reports requires forum.moderate (403 for plain writers)', async () => {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { reportsRouter } = await import('../src/routes/reports.js');
    app.use('/api/reports', reportsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const denied = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${await tokenWith('forum.write')}`);
    assert.equal(denied.status, 403, 'plain writer cannot see queue');

    const allowed = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${await tokenWith('forum.write forum.moderate')}`);
    assert.equal(allowed.status, 200, 'moderator can see queue');
    assert.ok(Array.isArray(allowed.body.items));
  });

  await it('PATCH /api/reports/:id requires forum.moderate and handles report', async () => {
    const { thread } = await seedTargets();
    const report = await da.createReport({
      targetType: 'thread', targetId: thread.id,
      reporterId: USER_B.id, reporterName: USER_B.name, reason: 'other',
    });

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { reportsRouter } = await import('../src/routes/reports.js');
    app.use('/api/reports', reportsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const denied = await request(app)
      .patch(`/api/reports/${report.id}`)
      .set('Authorization', `Bearer ${await tokenWith('forum.write')}`)
      .send({ action: 'ignore' });
    assert.equal(denied.status, 403, 'plain writer cannot handle reports');

    const handled = await request(app)
      .patch(`/api/reports/${report.id}`)
      .set('Authorization', `Bearer ${await tokenWith('forum.write forum.moderate')}`)
      .send({ action: 'ignore', note: 'No action needed' });
    assert.equal(handled.status, 200);
    assert.equal(handled.body.report.status, 'ignored');
    assert.equal(handled.body.report.handleNote, 'No action needed');
  });
});
