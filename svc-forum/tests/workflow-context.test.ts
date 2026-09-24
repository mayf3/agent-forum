/**
 * AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1 route tests (mock prisma).
 *
 * The in-memory mock EMULATES the partial unique index from migration
 * 20260924000000_workflow_instance_context: forumThread.create rejects with
 * {code:'P2002'} when a workflow_instance thread with the same contextId
 * already exists. The real-db guarantee is the migration itself (plus
 * real-db smoke); these tests pin the ROUTE contract:
 *   - duplicate create  → 409 WORKFLOW_CONTEXT_THREAD_EXISTS (CTR-FWIC-002)
 *   - context drift     → 409 WORKFLOW_CONTEXT_IMMUTABLE    (CTR-FWIC-003)
 *   - other contextTypes keep today's multi-thread semantics
 *   - canonical context query resolves the one thread      (CTR-FWIC-004)
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

const WF_CONTEXT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const WF_CONTEXT = () => ({
  contextType: 'workflow_instance',
  contextId: WF_CONTEXT_ID,
});

const threads = new Map<string, any>();

function resetDb() {
  threads.clear();
}

/** UUID v4-shaped id (findThreadById gates on isUuid). */
function mockUuid(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[(Math.random() * 4 | 0) + 8];
    else s += h[(Math.random() * 16) | 0];
  }
  return s;
}

/** forumThread delegate with the partial-unique-index emulation (CTR-FWIC-001). */
function threadDelegate() {
  const byContext = (contextId: string) => {
    for (const v of threads.values()) {
      if (v.contextType === 'workflow_instance' && v.contextId === contextId) return v;
    }
    return null;
  };
  return {
    create: async ({ data }: any) => {
      if (data.contextType === 'workflow_instance' && data.contextId && byContext(data.contextId)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = {
        id: mockUuid(),
        title: data.title,
        type: data.type ?? 'discussion',
        contextType: data.contextType ?? null,
        contextId: data.contextId ?? null,
        status: 'active',
        createdById: data.createdById,
        createdByName: data.createdByName,
        createdAt: new Date(),
        lastMessageAt: new Date(),
        viewCount: 0,
        messageCount: 0,
        tags: data.tags ?? [],
        pinned: false,
        featured: false,
      };
      threads.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: any) => (where.id ? threads.get(where.id) ?? null : null),
    findFirst: async () => null,
    findMany: async () => Array.from(threads.values()),
    count: async () => threads.size,
    update: async ({ where, data }: any) => {
      const row = threads.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };
}

function createMockPrisma() {
  const empty = () => ({
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: any) => data,
    update: async () => ({}),
    upsert: async ({ where, create }: any) => ({ id: where?.agentId ?? 'fp-1', ...create }),
  });
  return {
    forumThread: threadDelegate(),
    forumThreadParticipant: empty(),
    forumThreadMessage: empty(),
    forumContextSnapshot: empty(),
    forumOutcome: empty(),
    forumPrincipal: empty(),
    forumAuditEvent: empty(),
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn: (tx: any) => any) => fn(createMockPrisma()),
    $disconnect: async () => {},
  };
}

void describe('workflow-instance canonical context (AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1)', async () => {
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  async function build() {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    app.use('/api/threads', threadsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);
    const request = (await import('supertest')).default;
    const token = await _signTestToken({
      sub: '660e8400-e29b-41d4-a716-446655440099',
      agent_id: 'workflow-bot',
      client_id: 'mc_wf_test',
      scope: 'forum.read forum.write',
    });
    return { app, token, request };
  }

  await it('CTR-FWIC-002: duplicate workflow_instance create → 409 WORKFLOW_CONTEXT_THREAD_EXISTS', async () => {
    const { app, request, token } = await build();
    const post = () => request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Workflow X thread', ...WF_CONTEXT() });

    const first = await post();
    assert.equal(first.status, 201, 'first canonical create succeeds');
    assert.equal(first.body.thread.contextType, 'workflow_instance');

    const second = await post();
    assert.equal(second.status, 409, 'duplicate create conflicts');
    assert.equal(second.body.error, 'WORKFLOW_CONTEXT_THREAD_EXISTS');

    // CTR-FWIC-004: the context query still resolves exactly the one thread.
    const query = await request(app)
      .get('/api/threads')
      .query(WF_CONTEXT())
      .set('Authorization', `Bearer ${token}`);
    assert.equal(query.status, 200);
    const listed = (query.body.items ?? []).filter(
      (t: any) => t.contextType === 'workflow_instance' && t.contextId === WF_CONTEXT_ID,
    );
    assert.equal(listed.length, 1, 'exactly one canonical thread exists');
  });

  await it('CTR-FWIC-003: context drift on a workflow_instance thread → 409 WORKFLOW_CONTEXT_IMMUTABLE', async () => {
    const { app, request, token } = await build();
    const created = await request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Immutability target', ...WF_CONTEXT() });
    assert.equal(created.status, 201);

    const driftedId = await request(app)
      .patch(`/api/threads/${created.body.thread.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contextId: '999e6679-7425-40de-944b-e07fc1f90ae7' });
    assert.equal(driftedId.status, 409);
    assert.equal(driftedId.body.error, 'WORKFLOW_CONTEXT_IMMUTABLE');

    const driftedType = await request(app)
      .patch(`/api/threads/${created.body.thread.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contextType: 'something_else' });
    assert.equal(driftedType.status, 409);
    assert.equal(driftedType.body.error, 'WORKFLOW_CONTEXT_IMMUTABLE');

    // Non-context metadata edits keep working for the creator.
    const retitled = await request(app)
      .patch(`/api/threads/${created.body.thread.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Immutability target (renamed)' });
    assert.equal(retitled.status, 200);
    assert.equal(retitled.body.thread.title, 'Immutability target (renamed)');
    assert.equal(retitled.body.thread.contextId, WF_CONTEXT_ID, 'context unchanged');
  });

  await it('other contextTypes keep today multi-thread semantics (no regression)', async () => {
    const { app, request, token } = await build();
    const post = (title: string) => request(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title, contextType: 'requirement', contextId: 'req-123' });

    const a = await post('first');
    const b = await post('second');
    assert.equal(a.status, 201);
    assert.equal(b.status, 201, 'non-workflow contexts stay unconstrained');
  });
});
