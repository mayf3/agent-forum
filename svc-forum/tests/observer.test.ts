/**
 * Observer UI acceptance tests.
 *
 * Tests cover:
 * 1. FORUM_OBSERVER_ENABLED not set → /observer returns 404
 * 2. Non-loopback requests → 403
 * 3. Observer API only supports GET
 * 4. Thread list returns full UUID
 * 5. shortId is display-only
 * 6. Detail/messages/transcript use full UUID
 * 7. Short ID (8 chars) is rejected
 * 8. No write operations
 * 9. HTML content is returned as raw text
 * 10. Empty thread list renders OK
 * 11. Empty messages renders OK
 * 12. API failure returns proper error status
 * 13. New messages appear on re-fetch
 * 14. Specific UUID thread loads correctly
 * 15. HTML is safe (not interpreted)
 * 16. Author name empty handled
 * 17. Unknown kind handled
 * 18. Long content handled
 * 19. Observer page loads
 * 20. Static assets serve
 * 21. Non-GET rejected
 * 22. Loopback check logic
 * 23. Transcript includes Thread ID and authorId
 *
 * Run: NODE_ENV=test npx tsx --test tests/observer.test.ts
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Test data ──

const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };
const USER_B = { id: 'user-b-uuid', name: 'Blog Agent' };

const KNOWN_THREAD_ID = '52423a12-a9d7-45a4-a144-63b15247aee2';

// ── In-memory database ──

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const snapshots = new Map<string, any>();
const outcomes = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  snapshots.clear();
  outcomes.clear();
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

function mockStore(store: Map<string, any>, _name: string) {
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
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
          if (k === 'content' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.content?.toLowerCase().includes(q));
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
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
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
      const defaults: Record<string, any> = {
        status: 'open',
        messageCount: 0,
        type: 'discussion',
        createdByType: 'agent',
        tags: [],
        mentions: [],
      };
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

  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumContextSnapshot: s,
    forumOutcome: o,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => {
      const tx = {
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
        forumContextSnapshot: s,
        forumOutcome: o,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ── Helper to build an app with observer ──

async function buildApp(observerEnabled: boolean) {
  process.env.FORUM_OBSERVER_ENABLED = observerEnabled ? 'true' : 'false';

  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());

  const { observerRouter } = await import('../src/observer/observer-routes.js');

  app.use('/observer', observerRouter);

  const { errorHandler } = await import('../src/middleware/error-handler.js');
  app.use(errorHandler);

  return { app };
}

// ── Test Suite ──

void describe('Forum Observer Tests', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');
  let guardModule: typeof import('../src/observer/observer-middleware.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
    guardModule = await import('../src/observer/observer-middleware.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // Test 1: FORUM_OBSERVER_ENABLED not set → 404
  await it('1. /observer returns 404 when FORUM_OBSERVER_ENABLED is false/missing', async () => {
    const { app } = await buildApp(false);
    const request = (await import('supertest')).default;
    const res = await request(app).get('/observer/');
    assert.equal(res.status, 404);
    assert.equal(res.body?.error, 'Not found');
  });

  // Test 2: Non-loopback → 403 (test the guard function directly)
  await it('2. Non-loopback request is rejected by the loopback check', async () => {
    const { observerGuard } = guardModule;

    // Must enable observer for guard to check loopback
    process.env.FORUM_OBSERVER_ENABLED = 'true';

    // Non-loopback should be rejected
    let statusCode = 0;
    let body: any = null;
    const req: any = {
      ip: '192.168.1.1',
      method: 'GET',
      socket: { remoteAddress: '192.168.1.1' },
    };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return { json: (b: any) => { body = b; } };
      },
    };
    let nextCalled = false;

    observerGuard(req as any, res as any, () => { nextCalled = true; });

    assert.equal(statusCode, 403);
    assert.ok(body?.error?.includes('loopback'));
    assert.equal(nextCalled, false);
  });

  // Test 3: Observer API only supports GET (at the router level)
  await it('3. Observer API rejects non-GET methods at router level', async () => {
    const { readOnlyGuard } = guardModule;

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      let statusCode = 0;
      let body: any = null;
      const req: any = { method };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { json: (b: any) => { body = b; } };
        },
      };
      let nextCalled = false;

      readOnlyGuard(req as any, res as any, () => { nextCalled = true; });

      assert.equal(statusCode, 405, method + ' should return 405');
      assert.ok(body?.error?.includes('read-only'), method + ' error message');
      assert.equal(nextCalled, false, method + ' should not call next');
    }
  });

  // Test 4: Thread list returns full UUID
  await it('4. Thread list returns full UUID and shortId display', async () => {
    const thread = await da.createThread({
      title: 'Test Thread', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.addParticipant({
      threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'creator', status: 'responded',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;
    const res = await request(app).get('/observer/api/threads');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.threads));
    assert.equal(res.body.threads.length, 1);

    const t = res.body.threads[0];
    assert.match(t.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(t.shortId.length, 8);
    assert.equal(t.shortId, thread.id.replace(/-/g, '').slice(0, 8));
    assert.equal(t.title, 'Test Thread');
  });

  // Test 5: shortId is display-only (not used for API requests)
  await it('5. Short ID (8 chars) is rejected for API requests', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/abc12345');
    assert.equal(res.status, 400);
    assert.ok(res.body?.error?.includes('UUID'));
  });

  // Test 6: Detail/messages/transcript use full UUID
  await it('6. Thread detail/messages/transcript use full UUID', async () => {
    const thread = await da.createThread({
      title: 'Detail Test', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.addParticipant({
      threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'creator', status: 'responded',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const detailRes = await request(app).get('/observer/api/threads/' + thread.id);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.thread.id, thread.id);
    assert.equal(detailRes.body.thread.shortId.length, 8);

    const msgRes = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(msgRes.status, 200);
    assert.equal(msgRes.body.threadId, thread.id);

    const transRes = await request(app).get('/observer/api/threads/' + thread.id + '/transcript');
    assert.equal(transRes.status, 200);
    assert.ok(typeof transRes.text === 'string');
  });

  // Test 7: Short ID rejected for all endpoints
  await it('7. Short 8-char ID rejected for detail/messages/transcript', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res1 = await request(app).get('/observer/api/threads/abcd1234');
    assert.equal(res1.status, 400);

    const res2 = await request(app).get('/observer/api/threads/abcd1234/messages');
    assert.equal(res2.status, 400);

    const res3 = await request(app).get('/observer/api/threads/abcd1234/transcript');
    assert.equal(res3.status, 400);
  });

  // Test 8: No write operations
  await it('8. Observer API rejects write methods', async () => {
    const { readOnlyGuard } = guardModule;

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      let statusCode = 0;
      const req: any = { method };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { json: () => {} };
        },
      };
      readOnlyGuard(req as any, res as any, () => {});
      assert.equal(statusCode, 405, method + ' should return 405');
    }
  });

  // Test 9: HTML content in messages
  await it('9. HTML content in messages is returned as raw text (not stripped/executed)', async () => {
    const thread = await da.createThread({
      title: 'XSS Test', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: '<script>alert("xss")</script><b>bold</b>',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    assert.equal(res.body.messages.length, 1);
    // API returns content as-is — client-side textContent handles escaping
    assert.equal(res.body.messages[0].content, '<script>alert("xss")</script><b>bold</b>');
    assert.ok(res.body.messages[0].content.includes('<script>'));
  });

  // Test 10: Empty thread list
  await it('10. Empty thread list returns empty array', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.threads));
    assert.equal(res.body.threads.length, 0);
    assert.equal(res.body.total, 0);
  });

  // Test 11: Empty messages
  await it('11. Thread with no messages returns empty messages array', async () => {
    const thread = await da.createThread({
      title: 'Empty Msg', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
    assert.equal(res.body.messages.length, 0);
    assert.equal(res.body.messageCount, 0);
  });

  // Test 12: API failure returns proper error
  await it('12. Invalid thread ID returns 400, non-existent returns 404', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res1 = await request(app).get('/observer/api/threads/not-a-uuid');
    assert.equal(res1.status, 400);

    const res2 = await request(app).get('/observer/api/threads/52423a12-a9d7-45a4-a144-63b15247aee2');
    assert.equal(res2.status, 404);
  });

  // Test 13: New messages appear on re-fetch
  await it('13. New messages appear after re-fetch', async () => {
    const thread = await da.createThread({
      title: 'Refresh Test', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: 'First message',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res1 = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res1.body.messages.length, 1);

    await da.createMessage({
      threadId: thread.id, authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'challenge', content: 'Second message',
    });

    const res2 = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res2.body.messages.length, 2);
    assert.equal(res2.body.messages[1].content, 'Second message');
    assert.equal(res2.body.messages[1].kind, 'challenge');
  });

  // Test 14: Known UUID thread loads correctly
  await it('14. Known UUID thread loads correctly with all fields', async () => {
    const thread = await da.createThread({
      title: '博客内容 OKR 是否足以保证稳定产出？',
      type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });

    // Manually set the thread ID to the known UUID for test purposes
    threads.set(KNOWN_THREAD_ID, { ...threads.get(thread.id), id: KNOWN_THREAD_ID });
    threads.delete(thread.id);
    const testThreadId = KNOWN_THREAD_ID;

    await da.addParticipant({
      threadId: testThreadId, agentId: USER_A.id, agentName: '博客写作专家',
      role: 'creator', status: 'responded',
    });
    await da.addParticipant({
      threadId: testThreadId, agentId: USER_B.id, agentName: '写作风格分析师',
      role: 'member', status: 'responded',
    });
    await da.createMessage({
      threadId: testThreadId, authorId: USER_A.id, authorName: '博客写作专家',
      authorType: 'agent', kind: 'proposal', content: '我们需要确保博客内容的质量和稳定性。',
    });
    await da.createMessage({
      threadId: testThreadId, authorId: USER_B.id, authorName: '写作风格分析师',
      authorType: 'agent', kind: 'challenge', content: '这个方案缺乏具体的衡量标准。',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const detailRes = await request(app).get('/observer/api/threads/' + testThreadId);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.thread.title, '博客内容 OKR 是否足以保证稳定产出？');
    assert.equal(detailRes.body.thread.messageCount, 2);
    assert.equal(detailRes.body.thread.participants.length, 2);

    const msgRes = await request(app).get('/observer/api/threads/' + testThreadId + '/messages');
    assert.equal(msgRes.status, 200);
    assert.equal(msgRes.body.messages.length, 2);
    assert.equal(msgRes.body.messages[0].authorName, '博客写作专家');
    assert.equal(msgRes.body.messages[0].authorId, USER_A.id, 'authorId must be present in messages');
    assert.equal(msgRes.body.messages[0].kind, 'proposal');
    assert.equal(msgRes.body.messages[0].seq, 1);
    assert.equal(msgRes.body.messages[1].authorName, '写作风格分析师');
    assert.equal(msgRes.body.messages[1].authorId, USER_B.id, 'authorId must be present in messages');
    assert.equal(msgRes.body.messages[1].kind, 'challenge');

    const transRes = await request(app).get('/observer/api/threads/' + testThreadId + '/transcript');
    assert.equal(transRes.status, 200);
    assert.ok(transRes.text.includes('博客内容 OKR'));
    assert.ok(transRes.text.includes('博客写作专家'));
    assert.ok(transRes.text.includes('写作风格分析师'));
    assert.ok(transRes.text.includes('proposal'));
    assert.ok(transRes.text.includes('challenge'));
  });

  // Test 15: HTML escaped/safe (verification that API returns raw content, client handles escaping)
  await it('15. HTML content safety — API returns raw, does not strip', async () => {
    const thread = await da.createThread({
      title: 'HTML Safety', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment',
      content: '<img src=x onerror=alert(1)> <iframe src="javascript:alert(2)">',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    const content = res.body.messages[0].content;
    // API returns raw content — doesn't execute or strip
    assert.ok(content.includes('<img'));
    assert.ok(content.includes('onerror'));
    assert.ok(content.includes('<iframe'));

    // Verify client-side safety: if we render via textContent, script won't execute
    // The test validates the API doesn't sanitize in a way that would break
    // the round-trip; client-side textContent handles the actual escaping
  });

  // Test 16: Empty author name
  await it('16. Message with empty author name is handled', async () => {
    const thread = await da.createThread({
      title: 'Empty Author', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: 'unknown', authorName: '',
      authorType: 'system', kind: 'system', content: 'System message',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages[0].authorName, '');
  });

  // Test 17: Unknown kind
  await it('17. Unknown message kind is handled gracefully', async () => {
    const thread = await da.createThread({
      title: 'Unknown Kind', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'alien_type_xyz', content: 'Test',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    assert.equal(res.body.messages[0].kind, 'alien_type_xyz');
  });

  // Test 18: Long message content
  await it('18. Very long message content is returned correctly', async () => {
    const thread = await da.createThread({
      title: 'Long Content', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    const longContent = 'A'.repeat(10000);
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: longContent,
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/messages');
    assert.equal(res.status, 200);
    assert.equal(res.body.messages[0].content.length, 10000);
  });

  // Test 19: Observer HTML page loads
  await it('19. Observer HTML page loads successfully', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('html'));
    assert.ok(res.text.includes('Forum Observer'));
  });

  // Test 20: Observer static assets
  await it('20. Observer CSS/JS files serve correctly', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const cssRes = await request(app).get('/observer/observer.css');
    assert.equal(cssRes.status, 200);
    assert.ok(cssRes.headers['content-type']?.includes('css'));

    const jsRes = await request(app).get('/observer/observer.js');
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.headers['content-type']?.includes('javascript'));
  });

  // Test 21: Non-GET on /observer/ page returns 405
  await it('21. POST/PUT/PATCH/DELETE to /observer/ returns 405', async () => {
    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await (request(app) as any)[method]('/observer/');
      assert.equal(res.status, 405, method + ' should return 405');
    }
  });

  // Test 22: Loopback check function works correctly
  await it('22. Loopback check accepts 127.0.0.1 and ::1, rejects others', async () => {
    const { observerGuard } = guardModule;

    // Helper to test observerGuard with a given IP
    function testGuard(ip: string): number {
      let statusCode = 0;
      const req: any = {
        ip,
        method: 'GET',
        socket: { remoteAddress: ip },
      };
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return { json: () => {} };
        },
      };
      observerGuard(req as any, res as any, () => {});
      return statusCode;
    }

    // When FORUM_OBSERVER_ENABLED is true (set in buildApp)
    // Test loopback acceptance (guard would pass = no status set = status 0)
    // We can't easily test this in isolation because the guard checks process.env
    // So we reset FORUM_OBSERVER_ENABLED for this test
    process.env.FORUM_OBSERVER_ENABLED = 'true';

    // Loopback IPs should NOT set a status code (pass through)
    // We look at whether the guard called next or set a status

    let nextCalled127 = false;
    let status127 = 0;
    const req127: any = { ip: '127.0.0.1', method: 'GET', socket: { remoteAddress: '127.0.0.1' } };
    const res127: any = { status: (c: number) => { status127 = c; return { json: () => {} }; } };
    observerGuard(req127 as any, res127 as any, () => { nextCalled127 = true; });
    assert.equal(status127, 0, '127.0.0.1 should not trigger error status');
    assert.equal(nextCalled127, true, '127.0.0.1 should call next');

    let nextCalled6 = false;
    let status6 = 0;
    const req6: any = { ip: '::1', method: 'GET', socket: { remoteAddress: '::1' } };
    const res6: any = { status: (c: number) => { status6 = c; return { json: () => {} }; } };
    observerGuard(req6 as any, res6 as any, () => { nextCalled6 = true; });
    assert.equal(status6, 0, '::1 should not trigger error status');
    assert.equal(nextCalled6, true, '::1 should call next');

    let nextCalledFwd = false;
    let statusFwd = 0;
    const reqFwd: any = { ip: '::ffff:127.0.0.1', method: 'GET', socket: { remoteAddress: '::ffff:127.0.0.1' } };
    const resFwd: any = { status: (c: number) => { statusFwd = c; return { json: () => {} }; } };
    observerGuard(reqFwd as any, resFwd as any, () => { nextCalledFwd = true; });
    assert.equal(statusFwd, 0, '::ffff:127.0.0.1 should not trigger error status');
    assert.equal(nextCalledFwd, true, '::ffff:127.0.0.1 should call next');

    // Non-loopback should be rejected
    let nextCalledExt = false;
    let statusExt = 0;
    let bodyExt: any = null;
    const reqExt: any = { ip: '10.0.0.1', method: 'GET', socket: { remoteAddress: '10.0.0.1' } };
    const resExt: any = { status: (c: number) => { statusExt = c; return { json: (b: any) => { bodyExt = b; } }; } };
    observerGuard(reqExt as any, resExt as any, () => { nextCalledExt = true; });
    assert.equal(statusExt, 403, '10.0.0.1 should be rejected');
    assert.ok(bodyExt?.error?.includes('loopback'));
    assert.equal(nextCalledExt, false, 'non-loopback should not call next');
  });

  // Test 23: Transcript includes Thread ID and authorId
  await it('23. Transcript markdown includes Thread ID and authorId', async () => {
    const thread = await da.createThread({
      title: 'Transcript ID Test', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: 'Agent Alpha',
      authorType: 'agent', kind: 'proposal', content: 'First proposal',
    });

    const { app } = await buildApp(true);
    const request = (await import('supertest')).default;

    const res = await request(app).get('/observer/api/threads/' + thread.id + '/transcript');
    assert.equal(res.status, 200);
    // Transcript must include the Thread ID
    assert.ok(res.text.includes('Thread ID:') || res.text.includes(thread.id),
      'transcript must include thread ID');
    // Transcript must include authorId
    assert.ok(res.text.includes('authorId:'), 'transcript must include authorId');
    assert.ok(res.text.includes('Agent Alpha'), 'transcript must include author name');
  });
});
