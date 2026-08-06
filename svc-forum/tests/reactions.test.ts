/**
 * Message reactions acceptance tests.
 *
 * Covers AC#1 (add/remove reaction, same agent counts once per message),
 * AC#2 (list & detail return reactions summary: emoji + count + deduped
 * principals), AC#3 (reaction change surfaces in my-updates), AC#4 (reuses
 * existing forum.read/forum.write scopes).
 *
 * Run: npx tsx --test tests/reactions.test.ts
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
const USER_B = { id: 'user-b-uuid', name: 'Agent Beta' };
const USER_C = { id: 'user-c-uuid', name: 'Agent Gamma' };

const threads = new Map<string, any>();
const messages = new Map<string, any>();
const reactions = new Map<string, any>();
const participants = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() {
  threads.clear(); messages.clear(); reactions.clear();
  participants.clear(); principals.clear();
  mockClock = Date.now();
}

// Monotonic clock so records created later always have a later createdAt
// (mirrors real DB timestamp ordering within the same millisecond).
let mockClock = Date.now();

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
      if (where.messageId_principalId_emoji) {
        const { messageId, principalId, emoji } = where.messageId_principalId_emoji;
        for (const v of store.values()) {
          if (v.messageId === messageId && v.principalId === principalId && v.emoji === emoji) return v;
        }
        return null;
      }
      if (where.authSubject) {
        for (const v of store.values()) {
          if (v.authSubject === where.authSubject) return v;
        }
        return null;
      }
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
          if (k === 'id') items = items.filter(i => i.id === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'agentId') items = items.filter(i => i.agentId === v);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
        }
      }
      return items[0] || null;
    },
    findMany: async ({ where, orderBy, skip, take, include }: any = {}) => {
      let items = Array.from(store.values());
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'messageId') items = items.filter(i => i.messageId === v);
          if (k === 'agentId') items = items.filter(i => i.agentId === v);
          if (k === 'authorId') items = items.filter(i => i.authorId === v);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'reactions' && v?.some) {
            items = items.filter(i => {
              const rs = Array.from(reactions.values()).filter((r: any) =>
                r.messageId === i.id && r.createdAt > v.some.createdAt.gt);
              return rs.length > 0;
            });
          }
          if (k === 'OR' && Array.isArray(v)) {
            items = items.filter(item =>
              v.some((c: any) => {
                if (c.threadId && item.threadId !== c.threadId) return false;
                if (c.authorId && item.authorId !== c.authorId) return false;
                if (c.reactions?.some) {
                  const rs = Array.from(reactions.values()).filter((r: any) =>
                    r.messageId === item.id && r.createdAt > c.reactions.some.createdAt.gt);
                  return rs.length > 0;
                }
                return true;
              })
            );
          }
        }
      }
      if (include?.reactions && items.length) {
        items = items.map(i => ({
          ...i,
          reactions: Array.from(reactions.values())
            .filter((r: any) => r.messageId === i.id)
            .sort((a: any, b: any) => a.createdAt - b.createdAt),
        }));
      }
      if (include?.thread && items.length) {
        items = items.map(i => ({
          ...i,
          thread: { id: i.threadId, title: threads.get(i.threadId)?.title || '?' },
        }));
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
          if (k === 'agentId') items = items.filter(i => i.agentId === v);
          if (k === 'authorId') items = items.filter(i => i.authorId === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
          if (k === 'reactions' && v?.some) {
            items = items.filter(i => Array.from(reactions.values()).some((r: any) =>
              r.messageId === i.id && r.createdAt > v.some.createdAt.gt));
          }
          if (k === 'OR' && Array.isArray(v)) {
            items = items.filter(item =>
              v.some((c: any) => {
                if (c.threadId && item.threadId !== c.threadId) return false;
                if (c.authorId && item.authorId !== c.authorId) return false;
                if (c.reactions?.some) return Array.from(reactions.values()).some((r: any) =>
                  r.messageId === item.id && r.createdAt > c.reactions.some.createdAt.gt);
                return true;
              })
            );
          }
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      mockClock += 1;
      const doc = { ...data, id: data.id || mockUuid() };
      if (!doc.createdAt) doc.createdAt = new Date(mockClock);
      if (!doc.updatedAt) doc.updatedAt = new Date(mockClock);
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
    delete: async ({ where }: any) => {
      const existing = store.get(where.id);
      if (!existing) throw new Error('Not found');
      store.delete(where.id);
      return existing;
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads);
  const m = mockStore(messages);
  const r = mockStore(reactions);
  const p = mockStore(participants);
  const fp = mockStore(principals);
  const mock: any = {
    forumThread: t,
    forumThreadMessage: m,
    forumReaction: r,
    forumThreadParticipant: p,
    forumPrincipal: fp,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: t, forumThreadMessage: m, forumReaction: r,
      forumThreadParticipant: p, forumPrincipal: fp,
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

async function seedThreadAndMessage() {
  const thread = await da.createThread({
    title: 'Reaction thread', type: 'discussion',
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  const now = new Date();
  const message = {
    id: mockUuid(), threadId: thread.id, parentId: null, seq: 1,
    authorId: USER_A.id, authorName: USER_A.name, authorType: 'agent',
    kind: 'comment', content: 'React to me!', mentions: [],
    deletedAt: null, createdAt: now, updatedAt: now,
  };
  messages.set(message.id, message);
  // A is a participant (watching) — needed for notification derivation
  participants.set(mockUuid(), {
    id: mockUuid(), threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
    role: 'member', status: 'active', joinedAt: now, leftAt: null, lastReadAt: now,
  });
  return { thread, message };
}

void describe('Message Reactions', async () => {
  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('AC#1 add + remove reaction; same agent + emoji counts once (409)', async () => {
    const { message } = await seedThreadAndMessage();

    const added = await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
    });
    assert.ok(added.id);
    assert.equal(added.emoji, '👍');

    // Duplicate same agent + emoji → 409
    await assert.rejects(
      da.addReaction({
        messageId: message.id, threadId: message.threadId,
        principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
      }),
      (err: any) => err.statusCode === 409 && /ALREADY_REACTED/.test(err.message),
    );

    // Different emoji by same agent → OK
    const second = await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '❤️',
    });
    assert.ok(second.id);

    // Remove
    const removed = await da.removeReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, emoji: '👍',
    });
    assert.equal(removed.removed, true);

    // Remove again → 404
    await assert.rejects(
      da.removeReaction({
        messageId: message.id, threadId: message.threadId,
        principalId: USER_B.id, emoji: '👍',
      }),
      (err: any) => err.statusCode === 404,
    );
  });

  await it('AC#1 different agents may react to the same message', async () => {
    const { message } = await seedThreadAndMessage();
    await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
    });
    const c = await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_C.id, principalName: USER_C.name, emoji: '👍',
    });
    assert.ok(c.id);
  });

  await it('AC#2 getReactionsForMessage returns emoji + count + deduped principals', async () => {
    const { message } = await seedThreadAndMessage();
    await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
    });
    await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_C.id, principalName: USER_C.name, emoji: '👍',
    });
    await da.addReaction({
      messageId: message.id, threadId: message.threadId,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '🚀',
    });

    const summary = await da.getReactionsForMessage(message.id);
    assert.equal(summary.length, 2);
    const thumbs = summary.find(s => s.emoji === '👍')!;
    assert.equal(thumbs.count, 2);
    assert.deepEqual(thumbs.principals.map(p => p.id).sort(), [USER_B.id, USER_C.id].sort());
  });

  await it('AC#2 message list includes reactions summary', async () => {
    const { thread, message } = await seedThreadAndMessage();
    await da.addReaction({
      messageId: message.id, threadId: thread.id,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
    });
    const list = await da.findMessagesByThreadId(thread.id);
    const hit = list.find((m: any) => m.id === message.id);
    assert.ok(hit, 'message present');
    assert.ok(Array.isArray(hit.reactions), 'reactions included');
    assert.equal(hit.reactions.length, 1);
    assert.equal(hit.reactions[0].emoji, '👍');
  });

  await it('AC#3 reaction change surfaces in my-updates (reason=reaction)', async () => {
    const { thread, message } = await seedThreadAndMessage();
    // B reacts to A's message; the reaction is created AFTER A's baseline
    await da.addReaction({
      messageId: message.id, threadId: thread.id,
      principalId: USER_B.id, principalName: USER_B.name, emoji: '👍',
    });

    const notifs = await da.findMyNotifications({
      principalId: USER_A.id, agentId: USER_A.id, reason: 'reaction',
    });
    assert.equal(notifs.total, 1);
    assert.equal(notifs.items[0].reason, 'reaction');
    assert.equal(notifs.items[0].messageId, message.id);
  });

  await it('AC#4 route: POST/DELETE need forum.write, GET needs forum.read', async () => {
    const { thread, message } = await seedThreadAndMessage();
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { reactionsRouter } = await import('../src/routes/reactions.js');
    app.use('/api/threads/:threadId/messages/:messageId/reactions', reactionsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;

    const base = `/api/threads/${thread.id}/messages/${message.id}/reactions`;

    // GET with forum.read → 200
    const read = await request(app)
      .get(base)
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`);
    assert.equal(read.status, 200);
    assert.ok(Array.isArray(read.body.reactions));

    // POST without forum.write → 403
    const denied = await request(app)
      .post(base)
      .set('Authorization', `Bearer ${await tokenWith('forum.read')}`)
      .send({ emoji: '👍' });
    assert.equal(denied.status, 403);

    // POST with forum.write → 201
    const created = await request(app)
      .post(base)
      .set('Authorization', `Bearer ${await tokenWith('forum.read forum.write')}`)
      .send({ emoji: '👍' });
    assert.equal(created.status, 201);
    assert.equal(created.body.reaction.emoji, '👍');

    // DELETE with forum.write → 200
    const deleted = await request(app)
      .delete(base)
      .set('Authorization', `Bearer ${await tokenWith('forum.read forum.write')}`)
      .send({ emoji: '👍' });
    assert.equal(deleted.status, 200);
  });
});
