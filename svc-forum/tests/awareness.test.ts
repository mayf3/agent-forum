/**
 * Discussion Awareness V1 — acceptance tests.
 *
 * Covers: mention validation (unknown → 400, no write), message transaction
 * atomicity, timestamp ordering (joinedAt < createdAt strict), autowatch
 * concurrency, unread rule (max(joinedAt, lastReadAt ?? joinedAt)), derived
 * notifications (mention/watch, dedup, database-side filtering + total),
 * self-service watch/read APIs, and the legacy-review-flow guardrails.
 *
 * Uses setPrisma() with an in-memory mock (same pattern as forum.test.ts),
 * plus the shared JWKS server + signTestToken for the HTTP layer.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Test JWKS + deferred signTestToken (standard OAuth RS256) ──────────
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

// ── Identity fixtures (two coordinate systems) ─────────────────────────
// mentions[]   → business agent_id (e.g. 'agent-alpha')
// participant.agentId / message.authorId → ForumPrincipal.id (UUID)

const SUB_A = '11111111-1111-4111-8111-111111111111';
const SUB_B = '22222222-2222-4222-8222-222222222222';
const SUB_C = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRINCIPAL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRINCIPAL_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AGENT_A = 'agent-alpha';
const AGENT_B = 'agent-beta';
const AGENT_C = 'agent-gamma';
const GHOST = 'ghost-agent';

// ── In-memory database ─────────────────────────────────────────────────

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
  const mk = (id: string, sub: string, agentId: string) => {
    const doc = {
      id, authSubject: sub, agentId, principalType: 'agent',
      displayName: agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    };
    principals.set(id, doc);
    principals.set(sub, doc); // allow lookup by authSubject too
  };
  mk(PRINCIPAL_A, SUB_A, AGENT_A);
  mk(PRINCIPAL_B, SUB_B, AGENT_B);
  mk(PRINCIPAL_C, SUB_C, AGENT_C);
}

// Monotonic clock: mock rows created in the same wall-clock millisecond still
// get strictly increasing timestamps (real Prisma/PG timestamps are
// millisecond-precision too, but the mock would otherwise be non-deterministic).
let _mockClock = 0;
function nextTime(): Date {
  const now = Date.now();
  _mockClock = Math.max(_mockClock + 1, now);
  return new Date(_mockClock);
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

/** Filter a store by a Prisma-like where clause (subset used by the feature). */
function applyWhere(items: any[], where: any, stores: { threads: Map<string, any> }): any[] {
  if (!where) return items;
  let out = items;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR' && Array.isArray(v)) {
      out = out.filter((item) => v.some((c: any) => matchClause(item, c, stores)));
      continue;
    }
    if (k === 'NOT') {
      out = out.filter((item) => !matchClause(item, v, stores));
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
    if (k === 'thread') { out = out.filter((i) => matchClause(stores.threads.get(i.threadId) || {}, v, stores)); continue; }
  }
  return out;
}

function matchValue(actual: any, cond: any): boolean {
  // Operator object (gt/lt/not/in/contains) applies to Date values too —
  // created_at/joined_at/last_read_at are Date columns.
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('not' in cond) return actual !== cond.not;
    if ('notIn' in cond) return !cond.notIn.includes(actual);
    if ('gt' in cond) return toMs(actual) > toMs(cond.gt);
    if ('gte' in cond) return toMs(actual) >= toMs(cond.gte);
    if ('lt' in cond) return toMs(actual) < toMs(cond.lt);
    if ('lte' in cond) return toMs(actual) <= toMs(cond.lte);
    if ('in' in cond) return cond.in.includes(actual);
    if ('contains' in cond) return String(actual).toLowerCase().includes(String(cond.contains).toLowerCase());
  }
  return actual === cond;
}

function toMs(v: any): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function matchMentions(arr: string[], cond: any): boolean {
  if (cond && typeof cond === 'object') {
    if ('has' in cond) return arr.includes(cond.has);
    if ('hasSome' in cond) return cond.hasSome.some((x: string) => arr.includes(x));
    if ('hasEvery' in cond) return cond.hasEvery.every((x: string) => arr.includes(x));
    if ('isEmpty' in cond) return cond.isEmpty ? arr.length === 0 : arr.length > 0;
  }
  return false;
}

function matchClause(item: any, clause: any, stores: { threads: Map<string, any> }): boolean {
  return applyWhere([item], clause, stores).length > 0;
}

function applyOrderBy(items: any[], orderBy: any): any[] {
  if (!orderBy) return items;
  const obs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...items].sort((a, b) => {
    for (const ob of obs) {
      for (const [field, dir] of Object.entries(ob)) {
        let av: number;
        let bv: number;
        if (field === 'lastMessageAt' && typeof dir === 'object') {
          av = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
          bv = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
        } else {
          av = toMs(a[field]);
          bv = toMs(b[field]);
        }
        const desc = dir === 'desc' || (dir && typeof dir === 'object' && dir.sort === 'desc');
        const cmp = av - bv;
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function mockStore(store: Map<string, any>, stores: { threads: Map<string, any> }) {
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
      if (where.authSubject) return store.get(where.authSubject) || null;
      if (where.agentId) {
        for (const v of store.values()) {
          if (v.agentId === where.agentId) return v;
        }
        return null;
      }
      return null;
    },
    findFirst: async ({ where, orderBy, select }: any) => {
      let items = applyWhere(Array.from(store.values()), where, stores);
      items = applyOrderBy(items, orderBy);
      const found = items[0] || null;
      if (found && select) {
        const out: any = {};
        for (const k of Object.keys(select)) out[k] = found[k];
        return out;
      }
      return found;
    },
    findMany: async ({ where, orderBy, skip, take, include }: any = {}) => {
      let items = applyWhere(Array.from(store.values()), where, stores);
      items = applyOrderBy(items, orderBy);
      if (include?.thread?.select) {
        items = items.map((i) => ({
          ...i,
          thread: (() => {
            const t = stores.threads.get(i.threadId);
            if (!t) return { id: i.threadId, title: '' };
            const out: any = {};
            for (const k of Object.keys(include.thread.select)) out[k] = t[k];
            return out;
          })(),
        }));
      }
      if (skip) items = items.slice(skip);
      if (take) items = items.slice(0, take);
      return items;
    },
    count: async ({ where }: any = {}) => applyWhere(Array.from(store.values()), where, stores).length,
    create: async ({ data }: any) => {
      // Simulate the threadId_agentId unique constraint (concurrent autowatch)
      if (store === participants) {
        for (const v of store.values()) {
          if (v.threadId === data.threadId && v.agentId === data.agentId) {
            const err = new Error('Unique constraint failed') as any;
            err.code = 'P2002';
            throw err;
          }
        }
      }
      const doc = { ...data, id: data.id || mockUuid() };
      if (!doc.createdAt) doc.createdAt = nextTime();
      if (!doc.updatedAt) doc.updatedAt = new Date();
      // Schema defaults the mock does not otherwise provide
      if (store === threads) {
        if (doc.status === undefined) doc.status = 'open';
        if (doc.messageCount === undefined) doc.messageCount = 0;
        if (doc.lastMessageAt === undefined) doc.lastMessageAt = null;
        if (doc.pinned === undefined) doc.pinned = false;
        if (doc.featured === undefined) doc.featured = false;
      }
      if (store === participants) {
        if (doc.leftAt === undefined) doc.leftAt = null;
        if (doc.lastReadAt === undefined) doc.lastReadAt = null;
        if (!doc.joinedAt) doc.joinedAt = nextTime();
      }
      if (store === messages) {
        if (doc.mentions === undefined) doc.mentions = [];
        if (doc.deletedAt === undefined) doc.deletedAt = null;
      }
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

// ── Tx failure injection (P2002 / P2034 retry tests) ───────────────────

let txFailure: { code: string; remaining: number } | null = null;
function injectTxFailure(code: string, times = 1) {
  txFailure = { code, remaining: times };
}

function createMockPrisma() {
  const stores = { threads };
  const t = mockStore(threads, stores);
  const p = mockStore(participants, stores);
  const m = mockStore(messages, stores);
  const fp = mockStore(principals, stores);

  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumPrincipal: fp,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => {
      if (txFailure && txFailure.remaining > 0) {
        txFailure.remaining -= 1;
        const err = new Error(`mock ${txFailure.code} failure`) as any;
        err.code = txFailure.code;
        throw err;
      }
      const tx = {
        forumThread: t,
        forumThreadParticipant: p,
        forumThreadMessage: m,
        forumPrincipal: fp,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ══════════════════════════════════════════════════════════════════════
//  data-access layer — transaction, timestamps, autowatch, unread rule
// ══════════════════════════════════════════════════════════════════════

void describe('awareness — data-access layer', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    txFailure = null;
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  async function seedThread(createdBy = PRINCIPAL_A, title = 'Awareness Thread') {
    return da.createThread({
      title, type: 'discussion',
      createdById: createdBy, createdByName: AGENT_A, createdByType: 'agent',
    });
  }

  await it('1. joinedAt/createdAt same-millisecond old-bug reproduction: equal timestamps are NOT notified', async () => {
    const thread = await seedThread();
    const T = new Date();
    // Old-bug data: participant.joinedAt == message.createdAt (no explicit t1 fix)
    participants.set('p-old', {
      id: 'p-old', threadId: thread.id, agentId: PRINCIPAL_B, agentName: AGENT_B,
      joinedAt: T, leftAt: null, lastReadAt: null, role: 'member', status: 'active',
    });
    messages.set('m-old', {
      id: 'm-old', threadId: thread.id, seq: 1, authorId: PRINCIPAL_A,
      authorName: AGENT_A, authorType: 'agent', kind: 'comment',
      content: 'old msg', mentions: [AGENT_B], deletedAt: null, createdAt: T,
    });
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 0, 'strict > must exclude equal createdAt (old bug reproduced)');
  });

  await it('2. fix: first mention appears immediately — message.createdAt STRICTLY > joinedAt', async () => {
    const thread = await seedThread();
    const created = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'hi @beta',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    const watched = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.ok(watched, 'B autowatched');
    assert.equal(watched.role, 'member');
    assert.equal(watched.status, 'active');
    assert.equal(watched.leftAt, null);
    assert.ok(
      created.createdAt.getTime() > watched.joinedAt.getTime(),
      `createdAt(${created.createdAt.getTime()}) must be > joinedAt(${watched.joinedAt.getTime()})`,
    );
    // And the notification query sees it
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].reason, 'mention');
    assert.equal(res.items[0].messageId, created.id);
  });

  await it('3. rapid successive messages have strictly increasing createdAt', async () => {
    const thread = await seedThread();
    const m1 = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'one',
    });
    const m2 = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'two',
    });
    assert.ok(m2.createdAt.getTime() > m1.createdAt.getTime(), 'createdAt must strictly increase');
  });

  await it('4. unread rule: messages before joinedAt are never unread (strict >)', async () => {
    const thread = await seedThread();
    const before = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'pre-watch',
    });
    // B watches after the first message exists
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    const after = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'post-watch',
    });
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 1, 'only the post-watch message is unread');
    assert.equal(res.items[0].messageId, after.id);
    assert.ok(before.createdAt.getTime() <= res.items[0].createdAt.getTime());
  });

  await it('5. unwatch → messages in gap invisible; rejoin resets baseline (no history flood)', async () => {
    const thread = await seedThread();
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    await da.unwatchThread(thread.id, PRINCIPAL_B);           // leftAt = now
    const gap = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'during gap',
    });
    let res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 0, 'unwatched → no updates, even for gap message');

    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);   // rejoin
    res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 0, 'gap message must NOT become unread after rejoin');

    const after = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'after rejoin',
    });
    res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].messageId, after.id);
  });

  await it('6. rejoin keeps stale lastReadAt — rule still correct via max(joinedAt, …)', async () => {
    const thread = await seedThread();
    const m1 = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'm1',
    });
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    await da.markThreadRead(thread.id, PRINCIPAL_B);          // lastReadAt = m1.createdAt (STALE later)
    await da.unwatchThread(thread.id, PRINCIPAL_B);
    const gap = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'gap',
    });
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);    // rejoin: joinedAt reset, lastReadAt kept
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    // unreadSince = max(newJoinedAt, lastReadAt ?? newJoinedAt) = max(now, m1) = now
    // → neither m1 nor gap are unread (they predate the new joinedAt)
    assert.equal(res.total, 0, 'stale lastReadAt must not resurrect pre-rejoin history');
    const p = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.ok(p.lastReadAt, 'lastReadAt is kept (not cleared) on rejoin');
  });

  await it('7. markRead advances lastReadAt to visible latest createdAt, not serverNow', async () => {
    const thread = await seedThread();
    const m1 = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'm1',
    });
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    const updated = await da.markThreadRead(thread.id, PRINCIPAL_B);
    assert.equal(updated.lastReadAt.getTime(), m1.createdAt.getTime(), 'Read State = visible latest createdAt');
    // New message after read → unread again
    const m2 = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'm2',
    });
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].messageId, m2.id);
  });

  await it('8. concurrent autowatch does not create duplicate participants', async () => {
    const thread = await seedThread();
    await Promise.all([
      da.createMessage({
        threadId: thread.id, authorId: PRINCIPAL_B, authorName: AGENT_B,
        authorType: 'agent', kind: 'comment', content: 'c1',
      }),
      da.createMessage({
        threadId: thread.id, authorId: PRINCIPAL_B, authorName: AGENT_B,
        authorType: 'agent', kind: 'comment', content: 'c2',
      }),
    ]);
    const list = await da.findParticipantsByThreadId(thread.id);
    const mine = list.filter((p) => p.agentId === PRINCIPAL_B);
    assert.equal(mine.length, 1, 'unique threadId_agentId must yield a single participant');
  });

  await it('9. P2002 tx failure retried → transaction completes atomically', async () => {
    const thread = await seedThread();
    injectTxFailure('P2002', 1);
    const created = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_B, authorName: AGENT_B,
      authorType: 'agent', kind: 'comment', content: 'retried',
    });
    assert.ok(created.id, 'message created after retry');
    const msgs = await da.findMessagesByThreadId(thread.id);
    assert.equal(msgs.length, 1, 'exactly one message after retry (no partial writes)');
    const updated = await da.findThreadById(thread.id);
    assert.equal(updated!.messageCount, 1);
    const watched = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.ok(watched, 'author autowatch applied in the retried transaction');
  });

  await it('10. P2034 tx failure retried → transaction completes atomically', async () => {
    const thread = await seedThread();
    injectTxFailure('P2034', 2);
    const created = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'serialized',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    assert.ok(created.id);
    const watched = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.ok(watched, 'mention autowatch applied after retries');
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].reason, 'mention');
  });

  await it('11. own messages never notified (mention and watch)', async () => {
    const thread = await seedThread();
    await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_B, authorName: AGENT_B,
      authorType: 'agent', kind: 'comment', content: 'self mention',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    const res = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(res.total, 0, 'self-authored messages excluded');
  });

  await it('12. mention/watch dedup: one message, one notification, reason=mention', async () => {
    const thread = await seedThread();
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    const m = await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'both',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    const all = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B });
    assert.equal(all.total, 1, 'single result for dual-hit message');
    assert.equal(all.items[0].reason, 'mention', 'mention wins');
    const watchOnly = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B, reason: 'watch' });
    assert.equal(watchOnly.total, 0, 'mention-hit message excluded from watch');
    const mentionOnly = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B, reason: 'mention' });
    assert.equal(mentionOnly.total, 1);
  });

  await it('13. pagination: total uses the same filtered set as items', async () => {
    const thread = await seedThread();
    await da.watchThread(thread.id, PRINCIPAL_B, AGENT_B);
    for (let i = 0; i < 5; i++) {
      await da.createMessage({
        threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
        authorType: 'agent', kind: 'comment', content: `m${i}`,
      });
    }
    const page1 = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B, page: 1, limit: 2 });
    assert.equal(page1.total, 5, 'total counts the full filtered set');
    assert.equal(page1.items.length, 2);
    const page3 = await da.findMyNotifications({ principalId: PRINCIPAL_B, agentId: AGENT_B, page: 3, limit: 2 });
    assert.equal(page3.total, 5);
    assert.equal(page3.items.length, 1);
    // Stable ordering: createdAt desc, id desc
    assert.ok(page1.items[0].createdAt.getTime() >= page1.items[1].createdAt.getTime());
  });

  await it('14. autowatch never overwrites review fields (role/status/reviewWaived*)', async () => {
    const thread = await seedThread();
    participants.set('p-review', {
      id: 'p-review', threadId: thread.id, agentId: PRINCIPAL_B, agentName: AGENT_B,
      joinedAt: new Date(), leftAt: null, lastReadAt: null,
      role: 'required_reviewer', status: 'invited',
      reviewWaivedAt: new Date(), reviewWaivedById: PRINCIPAL_A,
      reviewWaiverReason: 'signed off',
    });
    await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'notify reviewer',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    const p = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.equal(p.role, 'required_reviewer');
    assert.equal(p.status, 'invited');
    assert.ok(p.reviewWaivedAt);
    assert.ok(p.reviewWaiverReason);
    // Active participant re-mentioned → strict no-op: joinedAt unchanged
    const joinedBefore = p.joinedAt.getTime();
    await da.createMessage({
      threadId: thread.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 'notify again',
      mentions: [AGENT_B],
      mentionPrincipals: [{ agentId: AGENT_B, principalId: PRINCIPAL_B, displayName: AGENT_B }],
    });
    const p2 = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.equal(p2.joinedAt.getTime(), joinedBefore, 'active participant joinedAt is untouched');
    assert.equal(p2.role, 'required_reviewer');
  });

  await it('15. watchThread/unwatchThread/markThreadRead use server identity (no client agentId)', async () => {
    const thread = await seedThread();
    const watched = await da.watchThread(thread.id, PRINCIPAL_C, AGENT_C);
    assert.equal(watched.agentId, PRINCIPAL_C);
    assert.equal(watched.leftAt, null);
    // idempotent re-watch
    const again = await da.watchThread(thread.id, PRINCIPAL_C, AGENT_C);
    assert.equal(again.agentId, PRINCIPAL_C);
    // unwatch
    const unwatched = await da.unwatchThread(thread.id, PRINCIPAL_C);
    assert.ok(unwatched.leftAt);
    // idempotent unwatch
    const againUn = await da.unwatchThread(thread.id, PRINCIPAL_C);
    assert.ok(againUn.leftAt);
    // mark read requires a participant → 404 for non-watcher
    await assert.rejects(() => da.markThreadRead(thread.id, PRINCIPAL_A), (e: any) => e.statusCode === 404);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  HTTP layer — routes, self-service APIs, end-to-end flows
// ══════════════════════════════════════════════════════════════════════

void describe('awareness — HTTP layer', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    txFailure = null;
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  async function buildApp() {
    const express = (await import('express')).default;
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { meRouter } = await import('../src/routes/me.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use('/api/me', meRouter);
    app.use(errorHandler);
    return app;
  }

  function signTokenA() {
    return _signTestToken({ sub: SUB_A, agent_id: AGENT_A, client_id: 'mc_test', scope: 'forum.read forum.write' });
  }

  function signTokenB() {
    return _signTestToken({ sub: SUB_B, agent_id: AGENT_B, client_id: 'mc_test', scope: 'forum.read forum.write' });
  }

  async function seedThreadForHttp(createdBy = PRINCIPAL_A) {
    return da.createThread({
      title: 'HTTP Thread', type: 'discussion',
      createdById: createdBy, createdByName: AGENT_A, createdByType: 'agent',
    });
  }

  await it('H1. unknown mention → 400 UNKNOWN_MENTION_AGENT, message NOT persisted', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const token = await signTokenA();

    const res = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'hello ghost', kind: 'comment', mentions: [GHOST] });

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('UNKNOWN_MENTION_AGENT'), res.body.error);
    assert.ok(res.body.error.includes(`unknownAgentIds=[${GHOST}]`), res.body.error);

    // Message not persisted; thread untouched
    const msgs = await da.findMessagesByThreadId(thread.id);
    assert.equal(msgs.length, 0, 'no message row');
    const updated = await da.findThreadById(thread.id);
    assert.equal(updated!.messageCount, 0, 'messageCount unchanged');
  });

  await it('H2. POST message with mentions → 201, mentionee autowatched, mention visible', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const tokenA = await signTokenA();

    const res = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'ping @beta', kind: 'comment', mentions: [AGENT_B] });
    assert.equal(res.status, 201);

    const watched = await da.findParticipant(thread.id, PRINCIPAL_B);
    assert.ok(watched, 'mentionee autowatched');
    assert.equal(watched.role, 'member');
    assert.equal(watched.status, 'active');

    const tokenB = await signTokenB();
    const notif = await request(app)
      .get('/api/me/notifications')
      .set('Authorization', `Bearer ${tokenB}`);
    assert.equal(notif.status, 200);
    assert.equal(notif.body.total, 1);
    assert.equal(notif.body.items[0].reason, 'mention');
    assert.equal(notif.body.items[0].threadId, thread.id);
  });

  await it('H3. notifications reason filter + total + mark-read closes both kinds', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const tokenA = await signTokenA();
    const tokenB = await signTokenB();

    // A posts: (1) mention to B, (2) plain reply
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'm1', kind: 'comment', mentions: [AGENT_B] });
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'm2', kind: 'comment' });

    const all = await request(app).get('/api/me/notifications').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(all.body.total, 2);
    assert.deepEqual(all.body.items.map((i: any) => i.reason).sort(), ['mention', 'watch']);

    const mentions = await request(app).get('/api/me/notifications?reason=mention').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(mentions.body.total, 1);
    assert.equal(mentions.body.items[0].reason, 'mention');

    const watches = await request(app).get('/api/me/notifications?reason=watch').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(watches.body.total, 1);
    assert.equal(watches.body.items[0].reason, 'watch');

    const bad = await request(app).get('/api/me/notifications?reason=bogus').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bad.status, 400);

    // Mark read → both kinds disappear
    const read = await request(app)
      .put(`/api/threads/${thread.id}/read`)
      .set('Authorization', `Bearer ${tokenB}`);
    assert.equal(read.status, 200);
    const after = await request(app).get('/api/me/notifications').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(after.body.total, 0, 'read closes mention AND watch');
  });

  await it('H4. self-service watch/unwatch/read ignore client-submitted agentId', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const tokenB = await signTokenB();

    const watch = await request(app)
      .put(`/api/threads/${thread.id}/watch`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ agentId: GHOST, participantId: 'forged' }); // must be ignored
    assert.equal(watch.status, 200);
    assert.equal(watch.body.participant.agentId, PRINCIPAL_B, 'identity comes from token, not body');

    const msgs = await da.findMessagesByThreadId(thread.id);
    const tokenA = await signTokenA();
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'update for B', kind: 'comment' });

    const before = await request(app).get('/api/me/notifications').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(before.body.total, 1);

    const read = await request(app)
      .put(`/api/threads/${thread.id}/read`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ agentId: GHOST });
    assert.equal(read.status, 200);
    assert.equal(read.body.participant.agentId, PRINCIPAL_B);

    const unwatch = await request(app)
      .delete(`/api/threads/${thread.id}/watch`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ agentId: GHOST });
    assert.equal(unwatch.status, 200);
    assert.ok(unwatch.body.participant.leftAt);

    const after = await request(app).get('/api/me/notifications').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(after.body.total, 0, 'read took effect');
  });

  await it('H5. thread list sort=latest / recently-updated / invalid', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const tokenA = await signTokenA();

    const t1 = await seedThreadForHttp();
    const t2 = await seedThreadForHttp(PRINCIPAL_A);
    // t2 gets a newer message → recently-updated puts t2 first; latest keeps createdAt order
    await da.createMessage({
      threadId: t1.id, authorId: PRINCIPAL_A, authorName: AGENT_A,
      authorType: 'agent', kind: 'comment', content: 't1 msg',
    });

    const latest = await request(app).get('/api/threads?sort=latest').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(latest.status, 200);
    assert.equal(latest.body.items[0].id, t2.id, 'latest → newest createdAt first');
    assert.equal(latest.body.total, 2);

    const recent = await request(app).get('/api/threads?sort=recently-updated').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(recent.body.items[0].id, t1.id, 'recently-updated → newest lastMessageAt first');

    const def = await request(app).get('/api/threads').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(def.body.items[0].id, t1.id, 'default keeps recently-updated behavior');

    const bad = await request(app).get('/api/threads?sort=bogus').set('Authorization', `Bearer ${tokenA}`);
    assert.equal(bad.status, 400);
  });

  await it('H6. end-to-end: unwatch during gap → rejoin via mention → only new mention unread', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const tokenA = await signTokenA();
    const tokenB = await signTokenB();

    // B watches, then unwatches
    await request(app).put(`/api/threads/${thread.id}/watch`).set('Authorization', `Bearer ${tokenB}`);
    await request(app).delete(`/api/threads/${thread.id}/watch`).set('Authorization', `Bearer ${tokenB}`);

    // gap messages (A replies while B is unwatched)
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'gap1', kind: 'comment' });
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'gap2', kind: 'comment' });

    // B gets re-mentioned → autowatch rejoin
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'welcome back', kind: 'comment', mentions: [AGENT_B] });

    const res = await request(app).get('/api/me/notifications').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(res.body.total, 1, 'only the re-mention is unread');
    assert.equal(res.body.items[0].reason, 'mention');
    assert.equal(res.body.items[0].content, 'welcome back');
  });

  await it('H7. POST message with duplicate/invalid mentions is normalized or rejected', async () => {
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const thread = await seedThreadForHttp();
    const tokenA = await signTokenA();

    const dup = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'dup', kind: 'comment', mentions: [AGENT_B, AGENT_B] });
    assert.equal(dup.status, 201);
    assert.deepEqual(dup.body.message.mentions, [AGENT_B], 'duplicates collapsed');

    const bad = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'bad', kind: 'comment', mentions: ['UPPER case!'] });
    assert.equal(bad.status, 400, 'invalid mention format rejected');

    const notArr = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'bad2', kind: 'comment', mentions: 'agent-beta' });
    assert.equal(notArr.status, 400, 'non-array mentions rejected');
  });
});
