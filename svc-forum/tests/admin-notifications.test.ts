/**
 * Admin global unread-notification aggregation — acceptance tests.
 *
 * Covers: GET /api/admin/notifications/unread scope enforcement (403 without
 * forum.moderate, 401 without token, 400 on invalid reason/since), and the
 * data-access aggregation: reuse of findMyNotifications (mention/watch,
 * mention-wins, own-messages excluded), pagination completeness (no
 * truncation), since filter, single-agent mode, thread-level grouping.
 *
 * Run: npx tsx --test tests/admin-notifications.test.ts
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

// ── Identity fixtures ─────────────────────────────────────────────
// mentions[] → business agent_id; participant.agentId / message.authorId
// → ForumPrincipal.id (UUID)

const PRINCIPAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRINCIPAL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_A = 'agent-alpha';
const AGENT_B = 'agent-beta';

// ── In-memory database (awareness-style mock) ─────────────────────
const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  principals.clear();
}

function seedPrincipals() {
  const mk = (id: string, agentId: string) => {
    const doc = {
      id, authSubject: `${agentId}-sub`, agentId, principalType: 'agent',
      displayName: agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    };
    principals.set(id, doc);
  };
  mk(PRINCIPAL_A, AGENT_A);
  mk(PRINCIPAL_B, AGENT_B);
}

function seedThread(id: string, title: string) {
  threads.set(id, {
    id, title, status: 'open', type: 'discussion',
    messageCount: 0, lastMessageAt: null, pinned: false, featured: false,
  });
}

function seedParticipant(principalId: string, threadId: string, joinedAt: Date, lastReadAt: Date | null = null) {
  participants.set(`p-${principalId}-${threadId}`, {
    id: `p-${principalId}-${threadId}`, threadId, agentId: principalId,
    agentName: principalId === PRINCIPAL_A ? AGENT_A : AGENT_B,
    role: 'member', status: 'active', lastReadAt, joinedAt, leftAt: null,
  });
}

function seedMessage(id: string, threadId: string, authorId: string, createdAt: Date, mentions: string[] = []) {
  messages.set(id, {
    id, threadId, seq: messages.size + 1, authorId, authorName: 'author',
    authorType: 'agent', kind: 'comment', content: 'content', mentions,
    attachments: null, metadata: null, editedAt: null, deletedAt: null, createdAt,
  });
}

function toMs(v: any): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function matchValue(actual: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('not' in cond) return actual !== cond.not;
    if ('gt' in cond) return toMs(actual) > toMs(cond.gt);
    if ('gte' in cond) return toMs(actual) >= toMs(cond.gte);
    if ('lt' in cond) return toMs(actual) < toMs(cond.lt);
    if ('lte' in cond) return toMs(actual) <= toMs(cond.lte);
    if ('in' in cond) return cond.in.includes(actual);
    if ('contains' in cond) return String(actual).toLowerCase().includes(String(cond.contains).toLowerCase());
  }
  return actual === cond;
}

function matchMentions(arr: string[], cond: any): boolean {
  if (cond && typeof cond === 'object') {
    if ('has' in cond) return arr.includes(cond.has);
    if ('hasSome' in cond) return cond.hasSome.some((x: string) => arr.includes(x));
    if ('hasEvery' in cond) return cond.hasEvery.every((x: string) => arr.includes(x));
  }
  return false;
}

function matchClause(item: any, clause: any): boolean {
  return applyWhere([item], clause).length > 0;
}

function applyWhere(items: any[], where: any): any[] {
  if (!where) return items;
  let out = items;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR' && Array.isArray(v)) {
      out = out.filter((item) => v.some((c: any) => matchClause(item, c)));
      continue;
    }
    if (k === 'NOT') {
      out = out.filter((item) => !matchClause(item, v));
      continue;
    }
    if (k === 'threadId') { out = out.filter((i) => matchValue(i.threadId, v)); continue; }
    if (k === 'id') { out = out.filter((i) => matchValue(i.id, v)); continue; }
    if (k === 'type') { out = out.filter((i) => matchValue(i.type, v)); continue; }
    if (k === 'status') { out = out.filter((i) => matchValue(i.status, v)); continue; }
    if (k === 'agentId') { out = out.filter((i) => matchValue(i.agentId, v)); continue; }
    if (k === 'deletedAt' && v === null) { out = out.filter((i) => !i.deletedAt); continue; }
    if (k === 'leftAt' && v === null) { out = out.filter((i) => !i.leftAt); continue; }
    if (k === 'authorId') { out = out.filter((i) => matchValue(i.authorId, v)); continue; }
    if (k === 'mentions') { out = out.filter((i) => matchMentions(i.mentions || [], v)); continue; }
    if (k === 'createdAt') { out = out.filter((i) => matchValue(i.createdAt, v)); continue; }
    if (k === 'thread') { out = out.filter((i) => matchClause(threads.get(i.threadId) || {}, v)); continue; }
  }
  return out;
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
        for (const v of store.values()) {
          if (v.authSubject === where.authSubject) return v;
        }
        return null;
      }
      if (where.agentId) {
        for (const v of store.values()) {
          if (v.agentId === where.agentId) return v;
        }
        return null;
      }
      return null;
    },
    findMany: async ({ where, orderBy, skip, take, include }: any = {}) => {
      let items = applyWhere(Array.from(store.values()), where);
      if (include?.thread?.select) {
        items = items.map((i) => {
          const t = threads.get(i.threadId);
          const out: any = {};
          for (const k of Object.keys(include.thread.select)) out[k] = t ? t[k] : undefined;
          return { ...i, thread: out };
        });
      }
      if (skip) items = items.slice(skip);
      if (take) items = items.slice(0, take);
      return items;
    },
    count: async ({ where }: any = {}) => applyWhere(Array.from(store.values()), where).length,
    create: async ({ data }: any) => {
      const doc = {
        ...data,
        id: data.id || mockUuid(),
        createdAt: data.createdAt || new Date(),
        updatedAt: data.updatedAt || new Date(),
      };
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
  const p = mockStore(participants);
  const m = mockStore(messages);
  const fp = mockStore(principals);
  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumPrincipal: fp,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t,
      forumThreadParticipant: p,
      forumThreadMessage: m,
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
    agent_id: 'moderator-agent',
    client_id: 'mc_moderator',
    scope,
  });
}

// ── Test app (admin router only) ─────────────────────────────────
async function buildApp() {
  const express = (await import('express')).default;
  const { adminRouter } = await import('../src/routes/admin.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

let da: typeof import('../src/lib/data-access.js');
let prismaMod: typeof import('../src/lib/prisma.js');

void describe('Admin unread notifications', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── Route layer: scope enforcement + validation ──
  await it('GET /api/admin/notifications/unread requires forum.moderate (401 without token)', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/admin/notifications/unread');
    assert.equal(res.status, 401);
  });

  await it('403 for a plain forum.read token (no forum.moderate)', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/admin/notifications/unread')
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.ok(res.body.error.includes('forum.moderate'));
  });

  await it('403 for a forum.read + forum.write token (no forum.moderate)', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/admin/notifications/unread')
      .set('Authorization', `Bearer ${await tokenWith('forum.read forum.write')}`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
    assert.ok(res.body.error.includes('forum.moderate'));
  });

  await it('200 with forum.moderate — empty result shape on empty DB', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/admin/notifications/unread')
      .set('Authorization', `Bearer ${await tokenWith('forum.read forum.moderate')}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { total: 0, items: [] });
  });

  await it('400 on invalid reason / invalid since', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const auth = `Bearer ${await tokenWith('forum.read forum.moderate')}`;
    const badReason = await request(app).get('/api/admin/notifications/unread?reason=bogus').set('Authorization', auth);
    assert.equal(badReason.status, 400);
    assert.ok(badReason.body.error.includes('reason'));
    const badSince = await request(app).get('/api/admin/notifications/unread?since=not-a-date').set('Authorization', auth);
    assert.equal(badSince.status, 400);
    assert.ok(badSince.body.error.includes('since'));
  });

  await it('200 with forum.moderate — aggregated result over seeded data', async () => {
    const t1 = '00000000-0000-4000-8000-000000000001';
    const t2 = '00000000-0000-4000-8000-000000000002';
    seedThread(t1, 'Thread One');
    seedThread(t2, 'Thread Two');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_A, t1, t0);
    seedParticipant(PRINCIPAL_B, t2, t0);
    // A is mentioned in t1; B has a watch-only update in t2
    seedMessage('m-1', t1, PRINCIPAL_B, new Date('2026-08-09T10:00:00.000Z'), [AGENT_A]);
    seedMessage('m-2', t2, PRINCIPAL_A, new Date('2026-08-09T11:00:00.000Z'));

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/admin/notifications/unread')
      .set('Authorization', `Bearer ${await tokenWith('forum.read forum.moderate')}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    const [first, second] = res.body.items;
    // most recent activity first → B (11:00) before A (10:00)
    assert.equal(first.agentId, AGENT_B);
    assert.equal(first.agentName, AGENT_B);
    assert.equal(first.unreadCount, 1);
    assert.equal(first.threads[0].threadId, t2);
    assert.equal(first.threads[0].title, 'Thread Two');
    assert.equal(first.threads[0].reason, 'watch');
    assert.equal(first.threads[0].unread, true);
    assert.equal(second.agentId, AGENT_A);
    assert.equal(second.threads[0].reason, 'mention');
    assert.equal(second.threads[0].threadId, t1);
  });

  // ── Data-access layer ──
  await it('mention wins when a thread has both mention and watch unread messages', async () => {
    const t1 = '00000000-0000-4000-8000-000000000011';
    seedThread(t1, 'Mixed Thread');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_B, t1, t0);
    seedMessage('m-1', t1, PRINCIPAL_A, new Date('2026-08-09T08:00:00.000Z'));
    seedMessage('m-2', t1, PRINCIPAL_A, new Date('2026-08-09T09:00:00.000Z'), [AGENT_B]);
    const res = await da.findAllUnreadNotifications({});
    assert.equal(res.total, 1);
    const item = res.items[0];
    assert.equal(item.agentId, AGENT_B);
    assert.equal(item.unreadCount, 1);
    assert.equal(item.threads[0].reason, 'mention');
    assert.equal(item.threads[0].lastMessageAt.toISOString(), '2026-08-09T09:00:00.000Z');
  });

  await it('own messages are not counted as unread', async () => {
    const t1 = '00000000-0000-4000-8000-000000000012';
    seedThread(t1, 'Self Thread');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_A, t1, t0);
    seedMessage('m-1', t1, PRINCIPAL_A, new Date('2026-08-09T09:00:00.000Z'));
    const res = await da.findAllUnreadNotifications({});
    assert.equal(res.total, 0);
  });

  await it('since filter keeps only notifications after the cutoff', async () => {
    const t1 = '00000000-0000-4000-8000-000000000013';
    seedThread(t1, 'Since Thread');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_B, t1, t0);
    seedMessage('m-old', t1, PRINCIPAL_A, new Date('2026-08-09T05:00:00.000Z'));
    seedMessage('m-new', t1, PRINCIPAL_A, new Date('2026-08-09T12:00:00.000Z'));
    const res = await da.findAllUnreadNotifications({ since: new Date('2026-08-09T10:00:00.000Z') });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].threads[0].lastMessageAt.toISOString(), '2026-08-09T12:00:00.000Z');
  });

  await it('agentId single-agent mode returns only that agent', async () => {
    const t1 = '00000000-0000-4000-8000-000000000014';
    const t2 = '00000000-0000-4000-8000-000000000015';
    seedThread(t1, 'A Thread');
    seedThread(t2, 'B Thread');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_A, t1, t0);
    seedParticipant(PRINCIPAL_B, t2, t0);
    seedMessage('m-1', t1, PRINCIPAL_B, new Date('2026-08-09T09:00:00.000Z'), [AGENT_A]);
    seedMessage('m-2', t2, PRINCIPAL_A, new Date('2026-08-09T09:30:00.000Z'), [AGENT_B]);
    const res = await da.findAllUnreadNotifications({ agentId: AGENT_B });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].agentId, AGENT_B);
    assert.equal(res.items[0].threads[0].threadId, t2);
  });

  await it('pagination completeness — 120 unread messages are fully aggregated (no truncation)', async () => {
    const t1 = '00000000-0000-4000-8000-000000000016';
    seedThread(t1, 'Bulk Thread');
    const t0 = new Date('2026-08-09T00:00:00.000Z');
    seedParticipant(PRINCIPAL_B, t1, t0);
    const base = new Date('2026-08-09T08:00:00.000Z');
    for (let i = 0; i < 120; i++) {
      seedMessage(`m-bulk-${i}`, t1, PRINCIPAL_A, new Date(base.getTime() + i * 60_000));
    }
    const res = await da.findAllUnreadNotifications({});
    assert.equal(res.total, 1);
    const item = res.items[0];
    assert.equal(item.agentId, AGENT_B);
    // One thread → unreadCount is thread count, not message count
    assert.equal(item.unreadCount, 1);
    // latest of all 120 messages (would differ if page 2 was never fetched)
    assert.equal(item.threads[0].lastMessageAt.toISOString(), '2026-08-09T09:59:00.000Z');
    // reason watch (no mentions anywhere in the bulk)
    assert.equal(item.threads[0].reason, 'watch');
  });

  await it('empty when no participants exist', async () => {
    const res = await da.findAllUnreadNotifications({});
    assert.equal(res.total, 0);
    assert.deepEqual(res.items, []);
  });
});
