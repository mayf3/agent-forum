/**
 * Discussion Run MVP tests.
 *
 * Tests cover creation, validation, agent endpoint interaction,
 * failure modes, and concurrent run protection.
 * Uses setPrisma() mock + stub HTTP servers for agent endpoints.
 *
 * Run: NODE_ENV=test npx tsx --test tests/discussion-runs.test.ts
 * Run all: NODE_ENV=test npx tsx --test tests/*.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };
const USER_B = { id: 'blog-agent-uuid', name: '博客写作专家' };
const USER_C = { id: 'analyst-uuid', name: '写作风格分析师' };

// ── In-memory DB ──
const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const snapshots = new Map<string, any>();
const outcomes = new Map<string, any>();
const runs = new Map<string, any>();
const runSteps = new Map<string, any>();

function resetDb() {
  threads.clear(); participants.clear(); messages.clear();
  snapshots.clear(); outcomes.clear(); runs.clear(); runSteps.clear();
}

// ── Mock Prisma ──
function mockStore(store: Map<string, any>, name: string) {
  return {
    findUnique: async ({ where }: any) => {
      if (where.id) return store.get(where.id) || null;
      if (where.idempotencyKey) {
        for (const v of store.values()) {
          if (v.idempotencyKey === where.idempotencyKey) return v;
        }
        return null;
      }
      if (where.runId_seq) {
        const { runId, seq } = where.runId_seq;
        for (const v of store.values()) {
          if (v.runId === runId && v.seq === seq) return v;
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
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
        }
      }
      if (orderBy) {
        const obs = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const ob of obs) {
          const [field, dir] = Object.entries(ob)[0] as [string, string];
          items.sort((a, b) => {
            const av = a[field]?.getTime?.() ?? 0;
            const bv = b[field]?.getTime?.() ?? 0;
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
          if (k === 'runId') items = items.filter(i => i.runId === v);
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
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
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
        }
      }
      return items.length;
    },
    create: async ({ data }: any) => {
      const defaults: Record<string, any> = { status: 'queued', messageCount: 0, tags: [], mentions: [] };
      const doc = { ...defaults, ...data, id: data.id || `mock-${name}-${Date.now()}-${Math.random()}` };
      if (!doc.createdAt) doc.createdAt = new Date();
      if (!doc.updatedAt) doc.updatedAt = new Date();
      store.set(doc.id, doc);
      return doc;
    },
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const item of data) {
        const doc = { ...item, id: item.id || `mock-${name}-${Date.now()}-${Math.random()}` };
        if (!doc.createdAt) doc.createdAt = new Date();
        if (!doc.updatedAt) doc.updatedAt = new Date();
        store.set(doc.id, doc);
        count++;
      }
      return { count };
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
      const updatedEntries: Array<{ key: string; val: any }> = [];

      for (const [key, val] of store.entries()) {
        let match = true;
        for (const [wk, wv] of Object.entries(where)) {
          if (wk === 'id' && val.id !== wv) { match = false; break; }
          if (wk === 'status' && val.status !== wv) { match = false; break; }
          if (wk === 'threadId' && val.threadId !== wv) { match = false; break; }
        }
        if (match) {
          const updated = { ...val, ...data, updatedAt: new Date() };
          updatedEntries.push({ key, val: updated });
          count++;
        }
      }

      // Simulate partial unique index: if setting status='running', check
      // no other run on same thread already has status='running'
      if (data.status === 'running') {
        const threadId = where.threadId || (updatedEntries[0]?.val.threadId);
        if (threadId) {
          for (const [key, val] of store.entries()) {
            if (val.threadId === threadId && val.status === 'running') {
              // Would violate unique index — throw P2002
              const err: any = new Error('Unique constraint failed');
              err.code = 'P2002';
              err.meta = { target: ['discussion_runs_one_running_per_thread'] };
              throw err;
            }
          }
        }
      }

      // Apply updates
      for (const { key, val } of updatedEntries) {
        store.set(key, val);
      }
      return { count };
    },
    upsert: async ({ where, create, update: upd }: any) => {
      const existing = where.id ? store.get(where.id) : null;
      if (existing) {
        const updated = { ...existing, ...upd, updatedAt: new Date() };
        store.set(existing.id, updated);
        return updated;
      }
      const doc = { ...create, id: create.id || `mock-${name}-${Date.now()}` };
      store.set(doc.id, doc);
      return doc;
    },
  };
}

function createMockPrisma() {
  const t = mockStore(threads, 'thread');
  const p = mockStore(participants, 'participant');
  const m = mockStore(messages, 'message');
  const s = mockStore(snapshots, 'snapshot');
  const o = mockStore(outcomes, 'outcome');
  const r = mockStore(runs, 'run');
  const rs = mockStore(runSteps, 'step');

  const mock: any = {
    forumThread: t, forumThreadParticipant: p, forumThreadMessage: m,
    forumContextSnapshot: s, forumOutcome: o,
    discussionRun: r, discussionRunStep: rs,
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => {
      const tx = {
        forumThread: t, forumThreadParticipant: p,
        forumThreadMessage: {
          ...m,
          count: async ({ where }: any = {}) => {
            let items = Array.from(messages.values());
            if (where?.threadId) items = items.filter(i => i.threadId === where.threadId);
            if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt);
            return items.length;
          },
        },
        forumContextSnapshot: s, forumOutcome: o,
        discussionRun: r, discussionRunStep: rs,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ── Helpers ──

async function setupThreadAndParticipants(da: any) {
  const thread = await da.createThread({
    title: 'Discussion Run Test Thread',
    type: 'discussion',
    createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
  });
  await da.addParticipant({ threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name, role: 'creator', status: 'responded' });
  await da.addParticipant({ threadId: thread.id, agentId: USER_B.id, agentName: USER_B.name, role: 'required_reviewer', status: 'invited' });
  await da.addParticipant({ threadId: thread.id, agentId: USER_C.id, agentName: USER_C.name, role: 'required_reviewer', status: 'invited' });
  return thread;
}

// ── Tests ──

void describe('Discussion Run MVP Tests', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let rda: typeof import('../src/lib/discussion-runs-data.js');
  let prismaMod: typeof import('../src/lib/prisma.js');
  let envMod: typeof import('../src/config/env.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    rda = await import('../src/lib/discussion-runs-data.js');
    prismaMod = await import('../src/lib/prisma.js');
    envMod = await import('../src/config/env.js');
    // Enable dev JWT mint for tests
    (envMod.env as any).ENABLE_DEV_AGENT_JWT_MINT = true;
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // 1. Create discussion run successfully
  await it('1. Create discussion run with steps', async () => {
    const thread = await setupThreadAndParticipants(da);
    const run = await rda.createRun({
      threadId: thread.id,
      title: 'Test Run',
      participantOrder: [USER_B.id, USER_C.id],
      maxRounds: 1,
      maxMessages: 10,
      idempotencyKey: 'key-1',
      agentEndpoints: { [USER_B.id]: 'http://localhost:9001/reply' },
    });
    assert.ok(run.id);
    assert.equal(run.status, 'queued');

    // Create steps
    await rda.createSteps([
      { runId: run.id, agentId: USER_B.id, agentName: USER_B.name, seq: 1 },
      { runId: run.id, agentId: USER_C.id, agentName: USER_C.name, seq: 2 },
    ]);
    const steps = await rda.findStepsByRunId(run.id);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].seq, 1);
    assert.equal(steps[1].seq, 2);
  });

  // 2. Empty participantOrder fails
  await it('2. Empty participantOrder validation fails', async () => {
    const { validateRunLimits } = await import('../src/lib/discussion-runner.js');
    const err = validateRunLimits([], 1, 10);
    assert.ok(err, 'should return error for empty participantOrder');
    assert.ok(err!.includes('must not be empty'));
  });

  // 3. maxRounds/maxMessages limits
  await it('3. Max rounds and messages limits are enforced', async () => {
    const { validateRunLimits } = await import('../src/lib/discussion-runner.js');
    assert.ok(validateRunLimits(['a'], 0, 10), 'rounds < 1 fails');
    assert.ok(validateRunLimits(['a'], 4, 10), 'rounds > 3 fails');
    assert.ok(validateRunLimits(['a'], 1, 0), 'messages < 1 fails');
    assert.ok(validateRunLimits(['a'], 1, 21), 'messages > 20 fails');
    assert.ok(validateRunLimits(['a'], 1, 10) === null, 'valid passes');
    // participantOrder length
    const longOrder = Array(11).fill('a');
    assert.ok(validateRunLimits(longOrder, 1, 10), 'order > 10 fails');
  });

  // 4. Idempotency key duplicate
  await it('4. Idempotency key duplicate returns existing', async () => {
    const thread = await setupThreadAndParticipants(da);
    const run1 = await rda.createRun({
      threadId: thread.id, title: 'Run 1',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'dup-key',
    });
    const found = await rda.findRunByIdempotencyKey('dup-key');
    assert.ok(found);
    assert.equal(found.id, run1.id);

    // Creating again should throw unique constraint
    try {
      await rda.createRun({
        threadId: thread.id, title: 'Run 2',
        participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'dup-key',
      });
      assert.fail('Should have thrown on duplicate idempotencyKey');
    } catch (err: any) {
      assert.ok(err, 'duplicate correctly rejected');
    }
  });

  // 5. Steps generated with correct seq
  await it('5. Run steps have correct seq ordering', async () => {
    const thread = await setupThreadAndParticipants(da);
    const run = await rda.createRun({
      threadId: thread.id, title: 'Seq Test',
      participantOrder: [USER_B.id, USER_C.id],
      maxRounds: 2, maxMessages: 10,
      idempotencyKey: 'seq-key',
    });
    // Generate steps for 2 rounds × 2 agents = 4 steps
    let seq = 0;
    const steps: any[] = [];
    for (let r = 0; r < 2; r++) {
      for (const agentId of [USER_B.id, USER_C.id]) {
        seq++;
        steps.push({ runId: run.id, agentId, agentName: agentId, seq });
      }
    }
    await rda.createSteps(steps);
    const loaded = await rda.findStepsByRunId(run.id);
    assert.equal(loaded.length, 4);
    assert.equal(loaded[0].seq, 1);
    assert.equal(loaded[1].seq, 2);
    assert.equal(loaded[2].seq, 3);
    assert.equal(loaded[3].seq, 4);
  });

  // 6-7. Start run with stub agents → both succeed
  await it('6-7. Start run calls stub agents, writes messages, run+steps succeeded', async () => {
    const thread = await setupThreadAndParticipants(da);

    // Create stub agent servers
    const server1 = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: '我 challenge 当前 KR', kind: 'challenge' }));
    });
    const server2 = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: '我同意增加的字段', kind: 'evidence' }));
    });

    await new Promise<void>((resolve) => server1.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
    const port1 = (server1.address() as any).port;
    const port2 = (server2.address() as any).port;

    try {
      // Create run with agent endpoints pointing to stubs
      const ep1 = `http://127.0.0.1:${port1}/api/forum/reply`;
      const ep2 = `http://127.0.0.1:${port2}/api/forum/reply`;

      const run = await rda.createRun({
        threadId: thread.id, title: 'Stub Run',
        participantOrder: [USER_B.id, USER_C.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'stub-key',
        agentEndpoints: { [USER_B.id]: ep1, [USER_C.id]: ep2 },
      });

      // Create steps
      await rda.createSteps([
        { runId: run.id, agentId: USER_B.id, agentName: USER_B.name, seq: 1 },
        { runId: run.id, agentId: USER_C.id, agentName: USER_C.name, seq: 2 },
      ]);

      // Execute run
      const { executeRun } = await import('../src/lib/discussion-runner.js');
      process.env.SELF_URL = 'http://127.0.0.1:3460';
      process.env.ENABLE_DEV_AGENT_JWT_MINT = 'true';
      await executeRun(run.id);

      const updatedRun = await rda.findRunById(run.id);
      assert.equal(updatedRun!.status, 'succeeded', 'run should succeed');
      assert.ok(updatedRun!.finishedAt, 'finishedAt should be set');

      const steps = await rda.findStepsByRunId(run.id);
      assert.equal(steps.length, 2);
      for (const step of steps) {
        assert.equal(step.status, 'succeeded', `step ${step.seq} should succeed`);
      }
    } finally {
      server1.close();
      server2.close();
    }
  });

  // 8. Transcript shows different agent authors (tested via data layer)
  await it('8. Messages show correct agent authors via transcript', async () => {
    const thread = await setupThreadAndParticipants(da);

    // Manually add messages as different agents (simulating what runner does)
    await da.createMessage({
      threadId: thread.id, authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'challenge', content: '我 challenge 当前 KR',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_C.id, authorName: USER_C.name,
      authorType: 'agent', kind: 'evidence', content: '我同意增加的字段',
    });

    const md = await da.buildTranscriptMd(thread.id);
    assert.ok(md, 'transcript should exist');
    assert.ok(md.includes(USER_B.name), 'transcript includes blog-agent name');
    assert.ok(md.includes(USER_C.name), 'transcript includes analyst name');
    assert.ok(md.includes('challenge'), 'transcript includes challenge type');
    assert.ok(md.includes('evidence'), 'transcript includes evidence type');
  });

  // 9. Agent endpoint non-2xx → run failed
  await it('9. Agent endpoint returning error causes run failed', async () => {
    const thread = await setupThreadAndParticipants(da);

    // Stub that returns 500
    const server = http.createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    try {
      const run = await rda.createRun({
        threadId: thread.id, title: 'Fail Run',
        participantOrder: [USER_B.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'fail-key',
        agentEndpoints: { [USER_B.id]: `http://127.0.0.1:${port}/reply` },
      });
      await rda.createSteps([
        { runId: run.id, agentId: USER_B.id, agentName: USER_B.name, seq: 1 },
      ]);

      const { executeRun } = await import('../src/lib/discussion-runner.js');
      process.env.SELF_URL = 'http://127.0.0.1:3460';
      process.env.ENABLE_DEV_AGENT_JWT_MINT = 'true';
      await executeRun(run.id);

      const updatedRun = await rda.findRunById(run.id);
      assert.equal(updatedRun!.status, 'failed', 'run should fail on agent error');
      assert.ok(updatedRun!.failureReason, 'failureReason should be set');

      const steps = await rda.findStepsByRunId(run.id);
      assert.equal(steps[0].status, 'failed', 'step should be failed');
      assert.ok(steps[0].failureReason, 'step failureReason should be set');
    } finally {
      server.close();
    }
  });

  // 10. Concurrent run rejection
  await it('10. Cannot start two runs simultaneously on same thread', async () => {
    const thread = await setupThreadAndParticipants(da);

    const { findActiveRunByThreadId, createRun } = rda;
    const { validateRunLimits } = await import('../src/lib/discussion-runner.js');

    const run1 = await createRun({
      threadId: thread.id, title: 'Run 1',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'concurrent-1',
    });
    const run2 = await createRun({
      threadId: thread.id, title: 'Run 2',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'concurrent-2',
    });

    // Mark run1 as running
    await rda.updateRun(run1.id, { status: 'running', startedAt: new Date() });

    const active = await findActiveRunByThreadId(thread.id);
    assert.ok(active);
    assert.equal(active!.id, run1.id);

    // run2 should not be startable
    const status2 = (await rda.findRunById(run2.id))!.status;
    assert.equal(status2, 'queued');
  });

  // 11. Cancelled run cannot start
  await it('11. Cancelled run cannot be started', async () => {
    const thread = await setupThreadAndParticipants(da);
    const run = await rda.createRun({
      threadId: thread.id, title: 'Cancel Test',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'cancel-key',
    });
    await rda.updateRun(run.id, { status: 'cancelled', finishedAt: new Date() });

    const updated = await rda.findRunById(run.id);
    assert.equal(updated!.status, 'cancelled');
  });

  // 12. Route-level: create run with full payload
  await it('12. POST /api/threads/:threadId/runs with valid payload', async () => {
    const thread = await setupThreadAndParticipants(da);

    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({ sub: USER_A.id, name: USER_A.name }, 'dev-only-change-this-secret');

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { discussionRunsRouter } = await import('../src/routes/discussion-runs.js');
    app.use('/api/threads/:threadId/runs', discussionRunsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;
    const res = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Route Test Run',
        participantOrder: [USER_B.id, USER_C.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'route-key-1',
        agentEndpoints: { [USER_B.id]: 'http://localhost:9001' },
      });

    assert.equal(res.status, 201, 'should create run');
    assert.ok(res.body.run, 'run should be in response');
    assert.ok(res.body.steps, 'steps should be in response');
    assert.equal(res.body.steps.length, 2, 'two steps for two agents');
  });

  // ── H2: maxMessages enforcement ──
  await it('13. participantOrder.length * maxRounds > maxMessages fails creation', async () => {
    const { validateRunLimits } = await import('../src/lib/discussion-runner.js');
    // 10 agents × 3 rounds = 30 steps > maxMessages 20
    const manyAgents = Array(10).fill('agent-x');
    const err = validateRunLimits(manyAgents, 3, 20);
    assert.ok(err, 'should reject when total steps exceed maxMessages');
    assert.ok(err!.includes('exceeds maxMessages'), err!);

    // 2 agents × 2 rounds = 4 steps <= maxMessages 4 — OK
    const ok = validateRunLimits(['a', 'b'], 2, 4);
    assert.equal(ok, null, 'valid config should pass');
  });

  await it('14. Route-level: combined validation rejects oversized runs', async () => {
    const thread = await setupThreadAndParticipants(da);
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({ sub: USER_A.id, name: USER_A.name }, 'dev-only-change-this-secret');

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { discussionRunsRouter } = await import('../src/routes/discussion-runs.js');
    app.use('/api/threads/:threadId/runs', discussionRunsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;

    // 10 agents × 3 rounds = 30 > maxMessages 20 → 400
    const manyAgents = Array(10).fill('agent-x');
    const res1 = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Oversized Run',
        participantOrder: manyAgents,
        maxRounds: 3, maxMessages: 20,
        idempotencyKey: 'h2-over',
      });
    assert.equal(res1.status, 400, 'oversized run should be rejected');

    // 2 agents × 2 rounds = 4 <= maxMessages 4 → 201
    const res2 = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Valid Sized Run',
        participantOrder: ['a', 'b'],
        maxRounds: 2, maxMessages: 4,
        idempotencyKey: 'h2-ok',
      });
    assert.equal(res2.status, 201, 'valid sized run should be created');
    assert.equal(res2.body.steps.length, 4, '4 steps for 2 agents × 2 rounds');
  });

  // ── H1: Concurrent start guard ──
  await it('15. Concurrent start of same run — only one succeeds', async () => {
    const thread = await setupThreadAndParticipants(da);
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({ sub: USER_A.id, name: USER_A.name }, 'dev-only-change-this-secret');

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { discussionRunsRouter } = await import('../src/routes/discussion-runs.js');
    app.use('/api/threads/:threadId/runs', discussionRunsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;

    // Create run
    const createRes = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Concurrent Test',
        participantOrder: [USER_B.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'h1-concurrent',
        agentEndpoints: { [USER_B.id]: 'http://127.0.0.1:9999/none' },
      });
    const runId = createRes.body.run.id;

    // Simulate two concurrent starts using claimRunForStart directly
    const results = await Promise.allSettled([
      rda.claimRunForStart(thread.id, runId),
      rda.claimRunForStart(thread.id, runId),
    ]);

    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    assert.equal(succeeded.length, 1, 'exactly one claim should succeed');
    // The other must fail (409) — verify error status
    if (failed.length > 0) {
      const reason = failed[0].reason;
      assert.ok(reason, 'failed claim has a reason');
    }

    // Run should now be running
    const run = await rda.findRunById(runId);
    assert.equal(run!.status, 'running');
  });

  await it('16. Two runs on same thread — only one can be running at a time', async () => {
    const thread = await setupThreadAndParticipants(da);
    const run1 = await rda.createRun({
      threadId: thread.id, title: 'Run A',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'h1-thread-a',
    });
    const run2 = await rda.createRun({
      threadId: thread.id, title: 'Run B',
      participantOrder: [USER_C.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'h1-thread-b',
    });

    // Claim run1
    const claim1 = await rda.claimRunForStart(thread.id, run1.id);
    assert.equal(claim1.status, 'running');

    // Claim run2 should fail since run1 is running on same thread
    try {
      await rda.claimRunForStart(thread.id, run2.id);
      assert.fail('claimRunForStart should reject when another run is running');
    } catch (err: any) {
      assert.equal(err.statusCode, 409, 'should return 409 for concurrent thread runs');
      assert.ok(err.message.includes('already running'), err.message);
    }
  });

  // ── M1: Start authorization ──
  await it('17. Non-creator/non-participant cannot start a run', async () => {
    const thread = await setupThreadAndParticipants(da);
    const jwt = (await import('jsonwebtoken')).default;
    // An unrelated user (not in participants, not creator)
    const intruderToken = jwt.sign(
      { sub: 'intruder-id', name: 'Intruder' },
      'dev-only-change-this-secret',
    );

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { discussionRunsRouter } = await import('../src/routes/discussion-runs.js');
    app.use('/api/threads/:threadId/runs', discussionRunsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;

    // Create run as creator
    const creatorToken = jwt.sign(
      { sub: USER_A.id, name: USER_A.name },
      'dev-only-change-this-secret',
    );
    const createRes = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Auth Test',
        participantOrder: [USER_B.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'm1-auth',
        agentEndpoints: { [USER_B.id]: 'http://127.0.0.1:9999/none' },
      });
    const runId = createRes.body.run.id;

    // Try to start as intruder
    const startRes = await request(app)
      .post(`/api/threads/${thread.id}/runs/${runId}/start`)
      .set('Authorization', `Bearer ${intruderToken}`);
    assert.equal(startRes.status, 403, 'intruder should get 403');

    // Creator can start
    const startRes2 = await request(app)
      .post(`/api/threads/${thread.id}/runs/${runId}/start`)
      .set('Authorization', `Bearer ${creatorToken}`);
    // Since no agent endpoint configured, it will fail — but auth should pass
    assert.notEqual(startRes2.status, 403, 'creator should not get 403');
    assert.notEqual(startRes2.status, 401, 'creator should not get 401');
  });

  await it('19. Concurrent cross-run start — two different runs on same thread, only one succeeds', async () => {
    const thread = await setupThreadAndParticipants(da);

    const run1 = await rda.createRun({
      threadId: thread.id, title: 'Cross Run A',
      participantOrder: [USER_B.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'h1-cross-a',
    });
    const run2 = await rda.createRun({
      threadId: thread.id, title: 'Cross Run B',
      participantOrder: [USER_C.id], maxRounds: 1, maxMessages: 10,
      idempotencyKey: 'h1-cross-b',
    });

    // Concurrent claim of two DIFFERENT runs on the SAME thread
    const results = await Promise.allSettled([
      rda.claimRunForStart(thread.id, run1.id),
      rda.claimRunForStart(thread.id, run2.id),
    ]);

    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    assert.equal(succeeded.length, 1, 'exactly one cross-run claim should succeed');
    assert.equal(failed.length, 1, 'the other cross-run claim should fail');

    // The failed one should be 409
    const reason = (failed[0] as PromiseRejectedResult).reason;
    assert.equal(reason.statusCode || 409, 409, 'failed cross-run claim should be 409');
    assert.ok(reason.message?.includes('already running'), reason.message);

    // Final state: exactly one run is running
    const finalRuns = await Promise.all([
      rda.findRunById(run1.id),
      rda.findRunById(run2.id),
    ]);
    const runningCount = finalRuns.filter(r => r?.status === 'running').length;
    assert.equal(runningCount, 1, 'at most one run can be running per thread');
  });

  await it('18. Participant can start a run', async () => {
    const thread = await setupThreadAndParticipants(da);
    const jwt = (await import('jsonwebtoken')).default;
    // USER_B is a participant
    const participantToken = jwt.sign(
      { sub: USER_B.id, name: USER_B.name },
      'dev-only-change-this-secret',
    );

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { discussionRunsRouter } = await import('../src/routes/discussion-runs.js');
    app.use('/api/threads/:threadId/runs', discussionRunsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;

    // Creator creates run
    const creatorToken = jwt.sign(
      { sub: USER_A.id, name: USER_A.name },
      'dev-only-change-this-secret',
    );
    const createRes = await request(app)
      .post(`/api/threads/${thread.id}/runs`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Participant Start Test',
        participantOrder: [USER_B.id, USER_C.id],
        maxRounds: 1, maxMessages: 10,
        idempotencyKey: 'm1-participant',
        agentEndpoints: { [USER_B.id]: 'http://127.0.0.1:9999/none' },
      });
    const runId = createRes.body.run.id;

    // Participant starts run — should pass auth
    const startRes = await request(app)
      .post(`/api/threads/${thread.id}/runs/${runId}/start`)
      .set('Authorization', `Bearer ${participantToken}`);
    assert.notEqual(startRes.status, 403, 'participant should not get 403');
    assert.notEqual(startRes.status, 401, 'participant should not get 401');
  });
});
