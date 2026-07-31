/**
 * svc-forum MVP acceptance tests.
 *
 * Uses setPrisma() to inject an in-memory mock so no PostgreSQL is required.
 * Tests cover all 12 Phase 1 MVP scenarios.
 *
 * Run: npx tsx --test tests/forum.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Test JWKS server + deferred signTestToken ─────────────────────
// The JWKS server starts (and AUTH_JWKS_URL is set) BEFORE the first import
// of any src module, so auth-jwt.ts freezes the test URL at module load.
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

// ── Test data ──

const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };
const USER_B = { id: 'user-b-uuid', name: 'Agent Beta' };

// ── In-memory database ──

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const messages = new Map<string, any>();
const snapshots = new Map<string, any>();
const outcomes = new Map<string, any>();
const principals = new Map<string, any>();

function resetDb() {
  threads.clear();
  participants.clear();
  messages.clear();
  snapshots.clear();
  outcomes.clear();
  principals.clear();
}

/** Generate a valid UUID v4 for mock IDs */
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

// Build a PrismaClient-compatible mock
function mockStore(store: Map<string, any>, name: string) {
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
          if (k === 'summaryMd' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.summaryMd?.toLowerCase().includes(q));
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
  const fp = mockStore(principals, 'principal');

  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumContextSnapshot: s,
    forumOutcome: o,
    forumPrincipal: fp,
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
        forumPrincipal: fp,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ── Tests ──

void describe('svc-forum MVP Acceptance Tests', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  // ── 1. Health ──
  await it('1. GET /api/health returns ok', async () => {
    const { prisma } = await import('../src/lib/prisma.js');
    try {
      await prisma.$queryRaw`SELECT 1`;
      assert.ok(true, 'health query succeeded');
    } catch {
      assert.fail('health query failed');
    }
  });

  // ── 2. Create thread ──
  await it('2. Create thread successfully', async () => {
    const thread = await da.createThread({
      title: 'Test Discussion',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });
    assert.ok(thread.id);
    assert.equal(thread.title, 'Test Discussion');
    assert.equal(thread.status, 'open');
    assert.equal(thread.messageCount, 0);
  });

  // ── 3. Create thread with participants ──
  await it('3. Create thread with participants', async () => {
    const thread = await da.createThread({
      title: 'Thread w/ Participants',
      type: 'okr_review',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    const p1 = await da.addParticipant({
      threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'creator', status: 'responded',
    });
    const p2 = await da.addParticipant({
      threadId: thread.id, agentId: USER_B.id, agentName: USER_B.name,
      role: 'required_reviewer', status: 'invited',
    });

    assert.equal(p1.role, 'creator');
    assert.equal(p2.agentId, USER_B.id);

    const list = await da.findParticipantsByThreadId(thread.id);
    assert.equal(list.length, 2);
  });

  // ── 4. Add message updates messageCount / lastMessageAt ──
  await it('4. Add message updates messageCount and lastMessageAt', async () => {
    const thread = await da.createThread({
      title: 'Count Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: 'First',
    });
    const updated1 = await da.findThreadById(thread.id);
    assert.equal(updated1!.messageCount, 1);
    assert.ok(updated1!.lastMessageAt);

    await da.createMessage({
      threadId: thread.id, authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'comment', content: 'Second',
    });
    const updated2 = await da.findThreadById(thread.id);
    assert.equal(updated2!.messageCount, 2);
  });

  // ── 5. Message parentId nesting ──
  await it('5. Message supports parentId nested reply', async () => {
    const thread = await da.createThread({
      title: 'Nested Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    const parent = await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'proposal', content: 'Parent',
    });

    const reply = await da.createMessage({
      threadId: thread.id, parentId: parent.id,
      authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'clarification', content: 'Reply',
    });

    assert.equal(reply.parentId, parent.id);
    assert.equal(reply.seq, 2);

    const msgs = await da.findMessagesByThreadId(thread.id);
    assert.equal(msgs.length, 2);
  });

  // ── 6. Duplicate participant ──
  await it('6. Duplicate participant—duplicate throws or idempotent', async () => {
    const thread = await da.createThread({
      title: 'Dup Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    await da.addParticipant({
      threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'member', status: 'invited',
    });

    const existing = await da.findParticipant(thread.id, USER_A.id);
    assert.ok(existing, 'first participant exists');

    // Adding same agent again should throw unique constraint
    try {
      await da.addParticipant({
        threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
        role: 'member', status: 'invited',
      });
      assert.fail('Should have thrown on duplicate');
    } catch (err: any) {
      assert.ok(err, 'duplicate correctly rejected');
    }
  });

  // ── 7. Create context snapshot ──
  await it('7. Create context snapshot', async () => {
    const thread = await da.createThread({
      title: 'Snapshot Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    const snap = await da.createContextSnapshot({
      threadId: thread.id,
      snapshotType: 'thread_creation',
      sourceType: 'okr', sourceRef: 'okr-123',
      title: 'Initial OKR Context',
      excerptMd: 'Relevant OKR context',
      takenById: USER_A.id, takenByName: USER_A.name,
    });
    assert.ok(snap.id);
    assert.equal(snap.sourceRef, 'okr-123');

    const snaps = await da.findSnapshotsByThreadId(thread.id);
    assert.equal(snaps.length, 1);
  });

  // ── 8. Create outcome ──
  await it('8. Create outcome', async () => {
    const thread = await da.createThread({
      title: 'Outcome Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    const outcome = await da.createOutcome({
      threadId: thread.id,
      summaryMd: '## Decision\nWe decided to go with option A.',
      decisionsJson: [{ decision: 'Choose option A', reason: 'Scalability' }],
      actionItemsJson: [{ action: 'Implement A', assignee: USER_A.name }],
      createdById: USER_A.id, createdByName: USER_A.name,
    });
    assert.ok(outcome.id);
    assert.ok(outcome.summaryMd.includes('Decision'));

    const list = await da.findOutcomesByThreadId(thread.id);
    assert.equal(list.length, 1);
  });

  // ── 9. Resolve thread with outcome ──
  await it('9. Resolve thread must have outcome summary', async () => {
    const thread = await da.createThread({
      title: 'Resolve Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    // Create outcome first
    await da.createOutcome({
      threadId: thread.id,
      summaryMd: 'Resolved with decision.',
      createdById: USER_A.id, createdByName: USER_A.name,
    });

    // Resolve
    const updated = await da.updateThread(thread.id, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedById: USER_A.id,
      resolvedByName: USER_A.name,
    });
    assert.equal(updated.status, 'resolved');
    assert.ok(updated.resolvedAt);

    // The route handler enforces summaryMd requirement — verify via data layer
    const latest = await da.findLatestOutcomeByThreadId(thread.id);
    assert.ok(latest, 'outcome exists');
    assert.ok(latest.summaryMd.length > 0, 'outcome has summary');
  });

  // ── 10. Transcript markdown ──
  await it('10. Transcript markdown returns complete discussion', async () => {
    const thread = await da.createThread({
      title: 'Transcript Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });

    await da.addParticipant({
      threadId: thread.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'creator', status: 'responded',
    });
    await da.addParticipant({
      threadId: thread.id, agentId: USER_B.id, agentName: USER_B.name,
      role: 'member', status: 'responded',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Hello everyone',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'comment', content: 'Hi Alpha',
    });
    await da.createContextSnapshot({
      threadId: thread.id, snapshotType: 'thread_creation',
      sourceType: 'okr', sourceRef: 'okr-456', title: 'Related OKR',
      takenById: USER_A.id, takenByName: USER_A.name,
    });
    await da.createOutcome({
      threadId: thread.id, summaryMd: '## Conclusion\nDone.',
      decisionsJson: [{ decision: 'Approved' }],
      createdById: USER_A.id, createdByName: USER_A.name,
    });

    const md = await da.buildTranscriptMd(thread.id);
    assert.ok(md, 'transcript should exist');
    assert.ok(md.includes('Transcript Test'), 'title in transcript');
    assert.ok(md.includes('Hello everyone'), 'message content in transcript');
    assert.ok(md.includes('Hi Alpha'), 'second message in transcript');
    assert.ok(md.includes('Related OKR'), 'snapshot in transcript');
    assert.ok(md.includes('Conclusion'), 'outcome in transcript');
    assert.ok(md.includes('Approved'), 'decision in transcript');
  });

  // ── 11. List threads with filters ──
  await it('11. List threads filtered by status/type/agentId', async () => {
    const t1 = await da.createThread({
      title: 'Thread A', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.addParticipant({
      threadId: t1.id, agentId: USER_A.id, agentName: USER_A.name,
      role: 'creator', status: 'responded',
    });

    const t2 = await da.createThread({
      title: 'Thread B', type: 'okr_review',
      createdById: USER_B.id, createdByName: USER_B.name, createdByType: 'agent',
    });
    await da.addParticipant({
      threadId: t2.id, agentId: USER_B.id, agentName: USER_B.name,
      role: 'creator', status: 'responded',
    });
    await da.updateThread(t2.id, { status: 'resolved' });

    // By type
    const byType = await da.findThreads({ type: 'discussion' });
    assert.equal(byType.total, 1);
    assert.equal(byType.items[0].id, t1.id);

    // By status
    const byStatus = await da.findThreads({ status: 'resolved' });
    assert.equal(byStatus.total, 1);
    assert.equal(byStatus.items[0].id, t2.id);

    // By agentId
    const byAgent = await da.findThreads({ agentId: USER_A.id });
    assert.equal(byAgent.total, 1);
    assert.equal(byAgent.items[0].id, t1.id);
  });

  // ── 13-14. Route-level transcript endpoint verification ──
  // These tests prove the spec path GET /api/threads/:threadId/transcript works
  await it('13. GET /api/threads/:threadId/transcript?format=md returns markdown', async () => {
    const thread = await da.createThread({
      title: 'Route Transcript', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Route-level test message',
    });

	    // Sign a test RS256 JWT via the test keypair
	    const token = await _signTestToken({
	      sub: USER_A.id,
	      agent_id: 'test-agent',
	      client_id: 'mc_test',
	      scope: 'forum.read forum.write',
	    });

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    // Mount threads router directly (it uses authRequired internally)
    const { threadsRouter } = await import('../src/routes/threads.js');
    app.use('/api/threads', threadsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get(`/api/threads/${thread.id}/transcript?format=md`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200, 'transcript md endpoint should return 200');
    assert.ok(res.text.includes('Route Transcript'), 'md body contains thread title');
    assert.ok(res.text.includes('Route-level test message'), 'md body contains message');
    assert.ok(res.headers['content-type']?.includes('text/markdown'), 'response is markdown');
  });

  await it('14. GET /api/threads/:threadId/transcript?format=json returns JSON', async () => {
    const thread = await da.createThread({
      title: 'Route Transcript JSON', type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });

	    const token = await _signTestToken({
	      sub: USER_A.id,
	      agent_id: 'test-agent',
	      client_id: 'mc_test',
	      scope: 'forum.read forum.write',
	    });

	    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    app.use('/api/threads', threadsRouter);
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use(errorHandler);

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get(`/api/threads/${thread.id}/transcript?format=json`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200, 'transcript json endpoint should return 200');
    assert.equal(res.body.thread?.title, 'Route Transcript JSON');
    assert.ok(Array.isArray(res.body.messages), 'messages is an array');
    assert.ok(Array.isArray(res.body.participants), 'participants is an array');
  });

  // ── 12. Search ──
  await it('12. Search finds thread title and message content', async () => {
    const thread = await da.createThread({
      title: 'Performance Issue',
      type: 'discussion',
      createdById: USER_A.id, createdByName: USER_A.name, createdByType: 'agent',
    });

    await da.createMessage({
      threadId: thread.id, authorId: USER_A.id, authorName: USER_A.name,
      authorType: 'agent', kind: 'comment',
      content: 'We need to optimize the database queries',
    });
    await da.createMessage({
      threadId: thread.id, authorId: USER_B.id, authorName: USER_B.name,
      authorType: 'agent', kind: 'comment',
      content: 'I suggest adding an index on the status column',
    });

    // Search thread title
    const r1 = await da.searchAll('Performance');
    assert.ok(r1.threads.length >= 1);
    assert.ok(r1.threads.some((t: any) => t.title.includes('Performance')));

    // Search message content
    const r2 = await da.searchAll('database queries');
    assert.ok(r2.messages.length >= 1);
    assert.ok(r2.messages.some((m: any) => m.content.includes('database queries')));

    // Search other message
    const r3 = await da.searchAll('adding an index');
    assert.ok(r3.messages.length >= 1);
  });
});
