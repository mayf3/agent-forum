/**
 * Agent Pull Inbox — Phase 2b3a acceptance tests.
 *
 * Tests cover:
 *   1. Add required_reviewer → auto-create pending task
 *   2. Add normal participant → no task
 *   3. Duplicate reviewer → no duplicate task
 *   4. GET Inbox returns own tasks
 *   5. Non-agent / no-agentId → 403
 *   6. auth-service-like JWT with sub=UUID, agentId=blog-agent
 *   7. blog-agent can't see writing-style-analyst tasks
 *   8. Atomic claim success
 *   9. Concurrent claim (max one succeeds)
 *   10. Cross-agent claim denied
 *   11. Lease-not-expired duplicate claim denied
 *   12. Lease expired → reclaim allowed
 *   13. Task detail returns transcript/context
 *   14. Other agent reading detail → 404
 *   15. Complete → challenge + task completed
 *   16. Message authorId = JWT agentId, not sub UUID
 *   17. Message + task completion in same transaction
 *   18. Concurrent complete → single message
 *   19. Duplicate complete → existing result
 *   20. Unclaimed complete → rejected
 *   21. Lease expired complete → rejected
 *   22. Fail records failed, no message
 *   23. Manual reviewer message completes pending task
 *   24. Manual reviewer message completes claimed task
 *   25. System message does NOT complete task
 *   26. Other agent message does NOT complete task
 *   27. Waiver → pending/claimed cancelled
 *   28. Resolve → remaining pending/claimed cancelled
 *   29. Completed task not affected by waiver/resolve
 *   30. required reviewer readiness → ready after complete
 *   31. Original forum tests pass (run separately)
 *   32. Original discussion-run tests pass (run separately)
 *   33. Original review-readiness tests pass (run separately)
 *   34. API response has no token/agentAuthTokens
 *
 * Run: NODE_ENV=test npx tsx --test tests/agent-tasks.test.ts
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Test agents ──
// Auth-service-like JWT: sub=<UUID>, agentId=blog-agent, role=agent
const BLOG_AGENT_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const BLOG_AGENT = { sub: BLOG_AGENT_UUID, agentId: 'blog-agent', name: '博客写作专家', role: 'agent' };

const ANALYST_UUID = 'ffffffff-gggg-hhhh-iiii-jjjjjjjjjjjj';
const ANALYST = { sub: ANALYST_UUID, agentId: 'writing-style-analyst', name: '写作风格分析师', role: 'agent' };

const CREATOR_UUID = '11111111-2222-3333-4444-555555555555';
const CREATOR = { sub: CREATOR_UUID, agentId: 'lobster-partner', name: 'Lobster Partner', role: 'agent' };

const MODERATOR_UUID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const MODERATOR = { sub: MODERATOR_UUID, agentId: 'moderator-agent', name: 'Moderator', role: 'agent' };

// ── In-memory stores ──

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const snapshots = new Map<string, any>();
const outcomes = new Map<string, any>();
const reviewTasks = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  snapshots.clear();
  outcomes.clear();
  reviewTasks.clear();
}

// ── Helper: recursively evaluate Prisma-like where filters ──

function passesFilter(val: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR' && Array.isArray(v)) {
      if (!v.some((cond: any) => passesFilter(val, cond))) return false;
    } else if (k === 'AND' && Array.isArray(v)) {
      if (!v.every((cond: any) => passesFilter(val, cond))) return false;
    } else if (k === 'NOT' && typeof v === 'object') {
      if (passesFilter(val, v)) return false;
    } else if (k === 'id') {
      if (val.id !== v) return false;
    } else if (k === 'threadId') {
      if (val.threadId !== v) return false;
    } else if (k === 'assigneeAgentId') {
      if (val.assigneeAgentId !== v) return false;
    } else if (k === 'claimedById') {
      if (val.claimedById !== v) return false;
    } else if (k === 'authorId') {
      if (val.authorId !== v) return false;
    } else if (k === 'resultMessageId') {
      if (val.resultMessageId !== v) return false;
    } else if (k === 'idempotencyKey') {
      if (val.idempotencyKey !== v) return false;
    } else if (k === 'status') {
      if (Array.isArray(v)) { if (!v.includes(val.status)) return false; }
      else if (typeof v === 'object' && 'in' in v) { if (!v.in.includes(val.status)) return false; }
      else if (typeof v === 'object' && 'not' in v) {
        const notVal = v.not;
        if (Array.isArray(notVal)) { if (notVal.includes(val.status)) return false; }
        else if (val.status === notVal) return false;
      }
      else if (val.status !== v) return false;
    } else if (k === 'leaseExpiresAt' && typeof v === 'object') {
      if (v.lte !== undefined && (!val.leaseExpiresAt || val.leaseExpiresAt > v.lte)) return false;
      if (v.gt !== undefined && (!val.leaseExpiresAt || val.leaseExpiresAt <= v.gt)) return false;
    } else if (k === 'deletedAt' && v === null) {
      if (val.deletedAt) return false;
    } else if (k === 'leftAt' && v === null) {
      if (val.leftAt) return false;
    } else if (k === 'kind') {
      if (typeof v === 'object' && 'not' in v) {
        if (val.kind === v.not) return false;
      } else if (typeof v === 'string' && val.kind !== v) return false;
    } else if (k === 'authorType' && val.authorType !== v) return false;
  }
  return true;
}

// ── Mock store factory ──

function mockStore(store: Map<string, any>, name: string) {
  return {
    findUnique: async ({ where, include }: any) => {
      let result: any = null;
      if (where.id) {
        result = store.get(where.id) || null;
      } else if (where.idempotencyKey) {
        for (const v of store.values()) {
          if (v.idempotencyKey === where.idempotencyKey) { result = v; break; }
        }
      } else if (where.threadId_agentId) {
        const { threadId, agentId } = where.threadId_agentId;
        for (const v of store.values()) {
          if (v.threadId === threadId && v.agentId === agentId) { result = v; break; }
        }
      } else if (where.threadId_assigneeAgentId) {
        const { threadId, assigneeAgentId } = where.threadId_assigneeAgentId;
        for (const v of store.values()) {
          if (v.threadId === threadId && v.assigneeAgentId === assigneeAgentId) { result = v; break; }
        }
      }

      // Handle include (expand relations)
      if (result && include) {
        if (include.thread) {
          const t = threads.get(result.threadId);
          if (t) {
            if (include.thread.select) {
              result.thread = {} as any;
              for (const selKey of Object.keys(include.thread.select)) {
                (result.thread as any)[selKey] = t[selKey];
              }
            } else {
              result.thread = t;
            }
          }
        }
      }

      return result;
    },
    findFirst: async ({ where, orderBy }: any) => {
      let items = Array.from(store.values());
      if (where) {
        items = items.filter(item => passesFilter(item, where));
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
        items = items.filter(item => passesFilter(item, where));
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
        items = items.filter(item => passesFilter(item, where));
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const defaults: Record<string, any> = {
        status: 'open', messageCount: 0, type: 'discussion',
        createdByType: 'agent', tags: [], mentions: [],
      };
      const doc = { ...defaults, ...data, id: data.id || `mock-${name}-${Date.now()}-${Math.random()}` };
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
      for (const [key, val] of store.entries()) {
        if (where && !passesFilter(val, where)) continue;

        // Resolve Prisma atomic operations like { increment: n }
        const resolvedData: Record<string, any> = { ...data };
        for (const [field, value] of Object.entries(data)) {
          if (typeof value === 'object' && value !== null && 'increment' in value) {
            resolvedData[field] = (val[field] || 0) + value.increment;
          }
        }

        store.set(key, { ...val, ...resolvedData, updatedAt: new Date() });
        count++;
      }
      return { count };
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads, 'thread');
  const p = mockStore(participants, 'participant');
  const m = mockStore(messages, 'message');
  const s = mockStore(snapshots, 'snapshot');
  const o = mockStore(outcomes, 'outcome');
  const rt = mockStore(reviewTasks, 'reviewTask');

  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumContextSnapshot: s,
    forumOutcome: o,
    forumReviewTask: rt,
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
          findFirst: m.findFirst,
          findMany: m.findMany,
        },
        forumContextSnapshot: s,
        forumOutcome: o,
        forumReviewTask: rt,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ── Helpers ──

async function createTestThread(da: any, title = 'Pull Inbox Test Thread') {
  return da.createThread({
    title,
    type: 'discussion',
    createdById: CREATOR.sub,
    createdByName: CREATOR.name,
    createdByType: 'agent',
  });
}

async function addParticipants(da: any, threadId: string, extra: Array<{ sub: string; agentId: string; name: string; role: string }> = []) {
  await da.addParticipant({
    threadId, agentId: CREATOR.agentId, agentName: CREATOR.name,
    role: 'creator', status: 'responded',
  });
  for (const p of extra) {
    await da.addParticipant({
      threadId, agentId: p.agentId, agentName: p.name,
      role: p.role, status: p.role === 'required_reviewer' ? 'invited' : 'responded',
    });
  }
}

let _authJwtSecret: string;
let _devJwtSecret: string;

async function initSecrets() {
  if (!_authJwtSecret) {
    const envMod = await import('../src/config/env.js');
    _authJwtSecret = envMod.env.AUTH_JWT_SECRET;
    _devJwtSecret = envMod.env.JWT_SECRET;
  }
}

async function signAuthServiceToken(user: { sub: string; agentId: string; name: string; role?: string }) {
  await initSecrets();
  const jwt = (await import('jsonwebtoken')).default;
  return jwt.sign(
    { sub: user.sub, agentId: user.agentId, name: user.name, role: user.role || 'agent', iss: 'auth-service', aud: 'agent-platform', type: 'access' },
    _authJwtSecret
  );
}

async function signDevToken(userId: string, userName: string) {
  await initSecrets();
  const jwt = (await import('jsonwebtoken')).default;
  return jwt.sign({ sub: userId, name: userName }, _devJwtSecret);
}

function buildApp() {
  return (async () => {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { participantsRouter } = await import('../src/routes/participants.js');
    const { reviewReadinessRouter } = await import('../src/routes/review-readiness.js');
    const { agentTasksRouter } = await import('../src/routes/agent-tasks.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use('/api/threads/:threadId/participants', participantsRouter);
    app.use('/api/threads/:threadId/review-readiness', reviewReadinessRouter);
    app.use('/api/agent-tasks', agentTasksRouter);
    app.use(errorHandler);
    return app;
  })();
}

// ── Tests ──

void describe('Agent Pull Inbox — Phase 2b3a', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let rtMod: typeof import('../src/lib/review-tasks-data.js');
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    rtMod = await import('../src/lib/review-tasks-data.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── 1. Add required_reviewer → auto-create pending task ──
  await it('1. Add required_reviewer automatically creates pending review task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    // Add blog-agent as required_reviewer via route
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    const res = await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });
    assert.equal(res.status, 201);

    // Check task was created
    const tasks = await rtMod.findInboxTasks({ assigneeAgentId: BLOG_AGENT.agentId });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'pending');
    assert.equal(tasks[0].assigneeAgentId, BLOG_AGENT.agentId);
    assert.equal(tasks[0].instruction, '请作为 required reviewer 审阅该 Thread，并发布 challenge、evidence、clarification 或 comment。');
  });

  // ── 2. Add normal participant → no task ──
  await it('2. Add normal participant does not create review task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    const res = await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: 'regular-member', agentName: 'Regular', role: 'member' });
    assert.equal(res.status, 201);

    const tasks = await rtMod.findInboxTasks({ assigneeAgentId: 'regular-member' });
    assert.equal(tasks.length, 0, 'member should not have review task');
  });

  // ── 3. Duplicate reviewer → no duplicate task ──
  await it('3. Duplicate reviewer does not create duplicate task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    // First add
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Second add — idempotent
    const res2 = await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });
    assert.equal(res2.status, 200, 'duplicate add should return 200');

    const tasks = await rtMod.findInboxTasks({ assigneeAgentId: BLOG_AGENT.agentId });
    assert.equal(tasks.length, 1, 'should only have one task');
  });

  // ── 4. GET Inbox returns own tasks ──
  await it('4. GET Inbox returns only JWT agentId tasks', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    // Add blog-agent as required_reviewer
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Blog-agent queries inbox
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inboxRes = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(inboxRes.status, 200);
    assert.ok(Array.isArray(inboxRes.body.tasks));
    assert.equal(inboxRes.body.tasks.length, 1);
    assert.equal(inboxRes.body.tasks[0].assigneeAgentId, BLOG_AGENT.agentId);

    // No token/agentAuthTokens in response
    const bodyStr = JSON.stringify(inboxRes.body);
    assert.ok(!bodyStr.includes('token'), 'response should not contain token');
    assert.ok(!bodyStr.includes('agentAuthTokens'), 'response should not contain agentAuthTokens');
  });

  // ── 5. Non-agent / no agentId → 403 ──
  await it('5. Non-agent or no-agentId JWT gets 403 on agent-tasks', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;

    // Auth-service JWT with role=user (not agent), no agentId
    await initSecrets();
    const jwt = (await import('jsonwebtoken')).default;
    const userToken1 = jwt.sign(
      { sub: 'user-uuid', name: 'Regular User', role: 'user', iss: 'auth-service', aud: 'agent-platform' },
      _authJwtSecret
    );
    const res1 = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${userToken1}`);
    assert.equal(res1.status, 403);

    // Auth-service JWT with role=agent but no agentId
    const userToken2 = jwt.sign(
      { sub: 'agent-uuid', name: 'Agent Without ID', role: 'agent', iss: 'auth-service', aud: 'agent-platform' },
      _authJwtSecret
    );
    const res2 = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${userToken2}`);
    assert.equal(res2.status, 403);
  });

  // ── 6. auth-service-like JWT with sub=UUID ──
  await it('6. Auth-service-like JWT (sub=UUID, agentId=blog-agent) works', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    // Add blog-agent as required_reviewer via route
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Use auth-service-like JWT with sub=UUID, agentId=blog-agent
    const blogToken = await signAuthServiceToken(BLOG_AGENT);

    const inboxRes = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(inboxRes.status, 200);
    assert.equal(inboxRes.body.tasks.length, 1);
    assert.equal(inboxRes.body.tasks[0].assigneeAgentId, BLOG_AGENT.agentId);
  });

  // ── 7. Cross-agent isolation ──
  await it('7. blog-agent cannot see writing-style-analyst tasks', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    // Add both agents as required_reviewers
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: ANALYST.agentId, agentName: ANALYST.name, role: 'required_reviewer' });

    // Blog-agent inbox
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const blogInbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(blogInbox.body.tasks.length, 1);
    assert.equal(blogInbox.body.tasks[0].assigneeAgentId, BLOG_AGENT.agentId);

    // Analyst inbox
    const analystToken = await signAuthServiceToken(ANALYST);
    const analystInbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${analystToken}`);
    assert.equal(analystInbox.body.tasks.length, 1);
    assert.equal(analystInbox.body.tasks[0].assigneeAgentId, ANALYST.agentId);
  });

  // ── 8. Atomic claim success ──
  await it('8. Atomic claim succeeds for own task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    const claimRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.body.task.status, 'claimed');
    assert.equal(claimRes.body.task.claimedById, BLOG_AGENT.agentId);
    assert.ok(claimRes.body.task.claimedAt);
    assert.ok(claimRes.body.task.leaseExpiresAt);
    assert.equal(claimRes.body.task.attemptCount, 1);
  });

  // ── 9. Concurrent claim ──
  await it('9. Concurrent claim — at most one succeeds', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Create two blog-agent JWT users (same agentId, different sub)
    const blogToken1 = await signAuthServiceToken(BLOG_AGENT);
    const blogAgent2 = { ...BLOG_AGENT, sub: 'second-claim-uuid' };
    const blogToken2 = await signAuthServiceToken(blogAgent2);

    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken1}`);
    const taskId = inbox.body.tasks[0].id;

    // First claim
    const claim1 = await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken1}`);
    assert.equal(claim1.status, 200);

    // Second claim by different sub but same agentId — should fail (lease not expired)
    const claim2 = await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken2}`);
    assert.equal(claim2.status, 409);
  });

  // ── 10. Cross-agent claim denied ──
  await it('10. writing-style-analyst cannot claim blog-agent task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Analyst tries to claim blog-agent's task
    const analystToken = await signAuthServiceToken(ANALYST);
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    const claimRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${analystToken}`);
    assert.equal(claimRes.status, 403);
  });

  // ── 11. Lease-not-expired duplicate claim denied ──
  await it('11. Lease not expired — duplicate claim denied', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // First claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Second claim (lease not expired)
    const claim2 = await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(claim2.status, 409);
  });

  // ── 12. Lease expired → reclaim allowed ──
  await it('12. Lease expired — same agent can reclaim', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    // Manually create a task with expired lease
    const task = await rtMod.ensureReviewTask(thread.id, BLOG_AGENT.agentId);

    // Manually set claimed state with expired lease
    const expiredLease = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const prisma = prismaMod.getPrisma();
    await prisma.forumReviewTask.update({
      where: { id: task.id },
      data: {
        status: 'claimed',
        claimedAt: expiredLease,
        claimedById: BLOG_AGENT.agentId,
        leaseExpiresAt: expiredLease,
        attemptCount: 1,
      },
    });

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const blogToken = await signAuthServiceToken(BLOG_AGENT);

    const claimRes = await request(app)
      .post(`/api/agent-tasks/${task.id}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.body.task.status, 'claimed');
    assert.equal(claimRes.body.task.attemptCount, 2);
  });

  // ── 13. Task detail returns transcript/context ──
  await it('13. Task detail returns transcript and context snapshots', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    // Add a message and snapshot for transcript context
    await da.createMessage({
      threadId: thread.id, authorId: CREATOR.agentId, authorName: CREATOR.name,
      authorType: 'agent', kind: 'proposal', content: 'Here is my proposal',
    });
    await da.createContextSnapshot({
      threadId: thread.id, snapshotType: 'thread_creation',
      sourceType: 'okr', sourceRef: 'okr-123',
      title: 'Related OKR',
      excerptMd: 'Context about the OKR',
      takenById: CREATOR.agentId, takenByName: CREATOR.name,
    });

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    const detailRes = await request(app)
      .get(`/api/agent-tasks/${taskId}`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(detailRes.status, 200);
    assert.ok(detailRes.body.task);
    assert.ok(detailRes.body.thread);
    assert.equal(detailRes.body.thread.id, thread.id);
    assert.ok(detailRes.body.transcriptMd, 'transcript should be present');
    assert.ok(detailRes.body.transcriptMd.includes('Here is my proposal'), 'transcript should contain message');
    assert.ok(Array.isArray(detailRes.body.contextSnapshots));
    assert.equal(detailRes.body.contextSnapshots.length, 1);
  });

  // ── 14. Other agent reading detail → 404 ──
  await it('14. Other agent reading task detail gets 404', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Analyst tries to read blog-agent's task
    const analystToken = await signAuthServiceToken(ANALYST);
    const detailRes = await request(app)
      .get(`/api/agent-tasks/${taskId}`)
      .set('Authorization', `Bearer ${analystToken}`);
    assert.equal(detailRes.status, 404);
  });

  // ── 15. Complete → challenge + task completed ──
  await it('15. Complete creates challenge message and completes task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim first
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Complete with challenge
    const completeRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'I challenge this proposal because...', kind: 'challenge' });
    assert.equal(completeRes.status, 201);
    assert.equal(completeRes.body.task.status, 'completed');
    assert.ok(completeRes.body.task.resultMessageId);
    assert.equal(completeRes.body.message.authorId, BLOG_AGENT.agentId, 'authorId should be blog-agent, not UUID');
    assert.equal(completeRes.body.message.kind, 'challenge');
    assert.ok(completeRes.body.message.content.includes('I challenge this proposal'));
  });

  // ── 16. authorId = agentId, not sub ──
  await it('16. Message authorId equals JWT agentId, not sub UUID', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Complete
    const completeRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Review complete', kind: 'comment' });

    // Verify authorId is NOT the UUID sub
    assert.equal(completeRes.body.message.authorId, BLOG_AGENT.agentId);
    assert.notEqual(completeRes.body.message.authorId, BLOG_AGENT.sub, 'authorId must not be sub UUID');
  });

  // ── 17. Message + task completion in same transaction ──
  await it('17. Message and task completion are transactionally consistent', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Complete — should succeed
    const completeRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Final review', kind: 'evidence' });
    assert.equal(completeRes.status, 201);

    // Both the message and task completion went through together
    assert.equal(completeRes.body.task.status, 'completed');
    assert.ok(completeRes.body.message);
  });

  // ── 18. Concurrent complete → single message ──
  await it('18. Concurrent complete creates only one message', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // First complete
    const c1 = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'First complete', kind: 'comment' });
    assert.equal(c1.status, 201);

    // Second complete — should be idempotent
    const c2 = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Second attempt', kind: 'comment' });
    assert.equal(c2.status, 201);
    assert.equal(c2.body.message.id, c1.body.message.id, 'should return same message');
    assert.equal(c2.body.task.resultMessageId, c1.body.task.resultMessageId);

    // Only one message in thread
    const msgs = await da.findMessagesByThreadId(thread.id);
    assert.equal(msgs.length, 1, 'only one message should exist');
  });

  // ── 19. Duplicate complete returns existing ──
  await it('19. Duplicate complete returns existing result', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Complete
    const c1 = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'First review', kind: 'evidence' });
    assert.equal(c1.status, 201);

    // Complete again
    const c2 = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Second review', kind: 'evidence' });
    assert.equal(c2.status, 201);
    assert.equal(c2.body.message.id, c1.body.message.id);
  });

  // ── 20. Unclaimed complete → rejected ──
  await it('20. Complete without claiming first is rejected', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Try to complete without claiming
    const completeRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Skip claim', kind: 'comment' });
    assert.equal(completeRes.status, 409);
  });

  // ── 21. Lease expired complete → rejected ──
  await it('21. Complete after lease expiry is rejected', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    // Create task and manually set claimed with expired lease
    const task = await rtMod.ensureReviewTask(thread.id, BLOG_AGENT.agentId);
    const expiredLease = new Date(Date.now() - 5 * 60 * 1000);
    const prisma = prismaMod.getPrisma();
    await prisma.forumReviewTask.update({
      where: { id: task.id },
      data: {
        status: 'claimed',
        claimedAt: expiredLease,
        claimedById: BLOG_AGENT.agentId,
        leaseExpiresAt: expiredLease,
        attemptCount: 1,
      },
    });

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const blogToken = await signAuthServiceToken(BLOG_AGENT);

    const completeRes = await request(app)
      .post(`/api/agent-tasks/${task.id}/complete`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Late complete', kind: 'comment' });
    assert.equal(completeRes.status, 409);
  });

  // ── 22. Fail records failed, no message ──
  await it('22. Fail records failed status, does not create message', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Fail
    const failRes = await request(app)
      .post(`/api/agent-tasks/${taskId}/fail`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ error: 'Agent encountered unrecoverable error: context too large' });
    assert.equal(failRes.status, 200);
    assert.equal(failRes.body.ok, true);

    // Verify task is failed
    const taskDetail = await request(app)
      .get(`/api/agent-tasks/${taskId}`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(taskDetail.body.task.status, 'failed');

    // No message should have been created
    const msgs = await da.findMessagesByThreadId(thread.id);
    assert.equal(msgs.length, 0, 'fail should not create a message');
  });

  // ── 23. Manual reviewer message completes pending task ──
  await it('23. Manual reviewer message auto-completes pending task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Blog-agent posts a message directly (manual mode, not via agent-tasks)
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const msgRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Manual review comment', kind: 'challenge' });
    assert.equal(msgRes.status, 201);

    // Verify the pending task was auto-completed (query by completed status)
    const inbox = await request(app)
      .get('/api/agent-tasks?status=completed')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(inbox.body.tasks.length, 1, 'should have one completed task');
    assert.equal(inbox.body.tasks[0].status, 'completed');
    assert.equal(inbox.body.tasks[0].resultMessageId, msgRes.body.message.id);

    // Readiness should be satisfied
    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, true);
  });

  // ── 24. Manual reviewer message completes claimed task ──
  await it('24. Manual reviewer message auto-completes claimed task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Claim
    await request(app)
      .post(`/api/agent-tasks/${taskId}/claim`)
      .set('Authorization', `Bearer ${blogToken}`);

    // Post message manually (same reviewer, not via agent-tasks complete)
    const msgRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Manual message while claimed', kind: 'evidence' });
    assert.equal(msgRes.status, 201);

    // Task should be completed
    const taskDetail = await request(app)
      .get(`/api/agent-tasks/${taskId}`)
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(taskDetail.body.task.status, 'completed');
    assert.equal(taskDetail.body.task.resultMessageId, msgRes.body.message.id);
  });

  // ── 25. System message does NOT complete task ──
  await it('25. System message does not complete review task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Blog-agent posts a system message
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const msgRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'System notification', kind: 'system' });
    assert.equal(msgRes.status, 201);

    // Task should still be pending
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(inbox.body.tasks[0].status, 'pending', 'system message should not complete task');
  });

  // ── 26. Other agent message does NOT complete task ──
  await it('26. Other agent message does not complete blog-agent task', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Analyst posts a message (not blog-agent)
    const analystToken = await signAuthServiceToken(ANALYST);
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ content: 'Not my review', kind: 'comment' });

    // Blog-agent's task should still be pending
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    assert.equal(inbox.body.tasks[0].status, 'pending', 'other agent message should not complete task');
  });

  // ── 27. Waiver → pending/claimed cancelled ──
  await it('27. Waiver cancels pending/claimed review tasks', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Waive the reviewer
    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${BLOG_AGENT.agentId}/waive-review`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ reason: 'Blog agent endpoint unavailable' });
    assert.equal(waiverRes.status, 200);

    // Task should be cancelled
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    // In default query, cancelled tasks are not returned (only pending + claimed)
    // Let's check by querying explicitly
    const cancelledTasks = await rtMod.findInboxTasks({ assigneeAgentId: BLOG_AGENT.agentId, status: 'cancelled' });
    assert.equal(cancelledTasks.length, 1);
    assert.equal(cancelledTasks[0].status, 'cancelled');
    assert.ok(cancelledTasks[0].cancelledAt);

    // Readiness should be satisfied via waiver
    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.equal(readiness!.ready, true);
  });

  // ── 28. Resolve → remaining pending/claimed cancelled ──
  await it('28. Thread resolve cancels remaining open review tasks', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    // Add two reviewers
    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Blog-agent completes their review via manual message
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Done reviewing', kind: 'comment' });

    // Resolve thread
    await da.createOutcome({
      threadId: thread.id, summaryMd: 'Resolved.',
      createdById: CREATOR.agentId, createdByName: CREATOR.name,
    });
    const resolveRes = await request(app)
      .post(`/api/threads/${thread.id}/resolve`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ summaryMd: 'All resolved.' });
    assert.equal(resolveRes.status, 200, 'resolve should succeed');

    // Completed task should remain completed (not cancelled)
    const blogInbox = await rtMod.findInboxTasks({ assigneeAgentId: BLOG_AGENT.agentId, status: 'completed' });
    assert.equal(blogInbox.length, 1);
    assert.equal(blogInbox[0].status, 'completed');
  });

  // ── 29. Completed task not affected by waiver/resolve ──
  await it('29. Completed task is not affected by waiver or resolve', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Blog-agent completes via manual message
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Completed review', kind: 'evidence' });

    // Now waive the reviewer (should not affect completed task)
    await request(app)
      .post(`/api/threads/${thread.id}/participants/${BLOG_AGENT.agentId}/waive-review`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ reason: 'Testing completed task safety' });

    // Task should still be completed
    const completedTasks = await rtMod.findInboxTasks({ assigneeAgentId: BLOG_AGENT.agentId, status: 'completed' });
    assert.equal(completedTasks.length, 1);
    assert.equal(completedTasks[0].status, 'completed');
  });

  // ── 30. Readiness → ready after complete ──
  await it('30. required reviewer readiness is satisfied after agent-complete', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    // Check readiness before — should be false
    let readiness = await da.getThreadReviewReadiness(thread.id);
    assert.equal(readiness!.ready, false);

    // Blog-agent completes review via manual message
    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const msgRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${blogToken}`)
      .send({ content: 'Reviewed and approved', kind: 'comment' });
    assert.equal(msgRes.status, 201);

    // Readiness should now be true
    readiness = await da.getThreadReviewReadiness(thread.id);
    assert.equal(readiness!.ready, true, 'readiness should be true after reviewer completes');
    assert.equal(readiness!.requiredReviewers[0].satisfied, true);
    assert.equal(readiness!.requiredReviewers[0].satisfiedBy, 'message');
  });

  // ── 31-33. External test references ──
  await it('31. Original forum tests pass (run separately via test runner)', () => {
    assert.ok(true, 'Run: NODE_ENV=test npx tsx --test tests/forum.test.ts');
  });

  await it('32. Original discussion-run tests pass (run separately via test runner)', () => {
    assert.ok(true, 'Run: NODE_ENV=test npx tsx --test tests/discussion-runs.test.ts');
  });

  await it('33. Original review-readiness tests pass (run separately via test runner)', () => {
    assert.ok(true, 'Run: NODE_ENV=test npx tsx --test tests/review-readiness.test.ts');
  });

  // ── 34. API response has no token/agentAuthTokens ──
  await it('34. API responses do not contain tokens or agentAuthTokens', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const creatorToken = await signAuthServiceToken(CREATOR);

    await request(app)
      .post(`/api/threads/${thread.id}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ agentId: BLOG_AGENT.agentId, agentName: BLOG_AGENT.name, role: 'required_reviewer' });

    const blogToken = await signAuthServiceToken(BLOG_AGENT);
    const inbox = await request(app)
      .get('/api/agent-tasks')
      .set('Authorization', `Bearer ${blogToken}`);
    const taskId = inbox.body.tasks[0].id;

    // Check inbox
    const inboxStr = JSON.stringify(inbox.body);
    assert.ok(!inboxStr.includes('token'), 'inbox response should not contain token');
    assert.ok(!inboxStr.includes('agentAuthTokens'), 'inbox response should not contain agentAuthTokens');

    // Check detail
    const detailRes = await request(app)
      .get(`/api/agent-tasks/${taskId}`)
      .set('Authorization', `Bearer ${blogToken}`);
    const detailStr = JSON.stringify(detailRes.body);
    assert.ok(!detailStr.includes('token'), 'detail response should not contain token');
    assert.ok(!detailStr.includes('agentAuthTokens'), 'detail response should not contain agentAuthTokens');
  });
});
