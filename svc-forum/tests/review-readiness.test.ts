/**
 * Required Reviewer Gate — Phase 2b2a acceptance tests.
 *
 * Tests cover:
 * 1. No required reviewer → decision/resolve allowed
 * 2. Two required reviewers, none replied → 409
 * 3. One reviewer replied → still blocked, pendingReviewerIds shows other
 * 4. Both replied → success
 * 5. `system` message doesn't count
 * 6. `challenge` message counts
 * 7. `evidence`/`comment` message counts
 * 8. One replied + other waived → success
 * 9. Empty waiver reason → 400
 * 10. Non-creator/non-moderator waiver → 403
 * 11. Waiver on non-required_reviewer → 400
 * 12. GET review-readiness returns correct data
 * 13. Manual mode (no DiscussionRun) → participant posts → decision → resolve
 * 14. Original forum tests pass (run separately)
 * 15. Original discussion run tests pass (run separately)
 *
 * Run: NODE_ENV=test npx tsx --test tests/review-readiness.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Test JWKS + deferred signTestToken (standard OAuth RS256) ──────────
// The JWKS server starts (and AUTH_JWKS_URL is set) BEFORE the first import
// of any src module so auth-jwt.ts freezes the test URL at module load.
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

// ── Test agents ──

// Identity ids must be valid UUIDs: standard OAuth requires sub to be a
// MachinePrincipal UUID, and the mock resolves principal.id = authSubject,
// so thread/participant ids must match the token sub.
const CREATOR = { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Creator Agent' };
const MODERATOR = { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Moderator Agent' };
const REVIEWER_A = { id: '550e8400-e29b-41d4-a716-446655440003', name: '博客写作专家' };
const REVIEWER_B = { id: '550e8400-e29b-41d4-a716-446655440004', name: '写作风格分析师' };
const INTRUDER = { id: '550e8400-e29b-41d4-a716-446655440005', name: 'Intruder' };
const REGULAR_MEMBER = { id: '550e8400-e29b-41d4-a716-446655440006', name: 'Regular Member' };

// ── In-memory stores ──

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

// ── Mock store factory ──

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
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
          if (k === 'authorId') items = items.filter(i => i.authorId === v);
          if (k === 'kind') {
            if (v && typeof v === 'object' && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
            } else if (typeof v === 'string') {
              items = items.filter(i => i.kind === v);
            }
          }
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
          if (k === 'authorId') items = items.filter(i => i.authorId === v);
          if (k === 'status') items = items.filter(i => i.status === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'leftAt' && v === null) items = items.filter(i => !i.leftAt);
          if (k === 'title' && (v as any)?.contains) {
            const q = (v as any).contains.toLowerCase();
            items = items.filter(i => i.title?.toLowerCase().includes(q));
          }
          if (k === 'kind') {
            if (v && typeof v === 'object' && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
            } else if (typeof v === 'string') {
              items = items.filter(i => i.kind === v);
            }
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
          if (k === 'threadId') items = items.filter(i => i.threadId === v);
          if (k === 'deletedAt' && v === null) items = items.filter(i => !i.deletedAt);
          if (k === 'kind') {
            if (v && typeof v === 'object' && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
            } else if (typeof v === 'string') {
              items = items.filter(i => i.kind === v);
            }
          }
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

  // Principal store: principal.id = authSubject (JWT sub) so that
  // req.user.id matches the test data ids (creator/participant lookups).
  const principalsStore = new Map<string, any>();
  const fp = {
    findUnique: async ({ where }: any) => {
      if (where.authSubject) return principalsStore.get(where.authSubject) || null;
      if (where.agentId) {
        for (const v of principalsStore.values()) { if (v.agentId === where.agentId) return v; }
        return null;
      }
      if (where.id) {
        for (const v of principalsStore.values()) { if (v.id === where.id) return v; }
        return null;
      }
      return null;
    },
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.authSubject || 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
      principalsStore.set(data.authSubject, doc);
      return doc;
    },
    update: async ({ where, data }: any) => {
      for (const [key, v] of principalsStore) {
        if (v.authSubject === where.authSubject || v.id === where.id) {
          const updated = { ...v, ...data, updatedAt: new Date() };
          principalsStore.set(key, updated);
          return updated;
        }
      }
      throw new Error('Not found');
    },
  };

  // Governance V1: resolve runs through applyGovernanceAction — the prisma
  // (and tx) client needs the audit-event and notification-fact models.
  const auditEvents = new Map<string, any>();
  const audit = {
    create: async ({ data }: any) => {
      const doc = { ...data, eventId: data.eventId || mockUuid(), createdAt: new Date() };
      auditEvents.set(doc.eventId, doc);
      return doc;
    },
  };
  const notificationFacts = {
    createMany: async ({ data }: any) => {
      const list = Array.isArray(data) ? data : [data];
      return { count: list.length };
    },
  };

  const mock: any = {
    forumThread: t,
    forumThreadParticipant: p,
    forumThreadMessage: m,
    forumContextSnapshot: s,
    forumOutcome: o,
    forumPrincipal: fp,
    forumAuditEvent: audit,
    forumNotificationFact: notificationFacts,
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
        forumPrincipal: fp,
        forumAuditEvent: audit,
        forumNotificationFact: notificationFacts,
        $executeRaw: async () => {},
      };
      return fn(tx);
    },
    $disconnect: async () => {},
  };
  return mock;
}

// ── Helpers ──

async function createTestThread(da: any) {
  return da.createThread({
    title: 'Review Gate Test Thread',
    type: 'discussion',
    createdById: CREATOR.id,
    createdByName: CREATOR.name,
    createdByType: 'agent',
  });
}

async function addParticipants(da: any, threadId: string, extra: Array<{ id: string; name: string; role: string }> = []) {
  // Always add creator
  await da.addParticipant({
    threadId, agentId: CREATOR.id, agentName: CREATOR.name,
    role: 'creator', status: 'responded',
  });
  for (const p of extra) {
    await da.addParticipant({
      threadId, agentId: p.id, agentName: p.name,
      role: p.role, status: p.role === 'required_reviewer' ? 'invited' : 'responded',
    });
  }
}

async function signToken(userId: string, _userName: string, scope = 'forum.read forum.write forum.moderate') {
  // Standard OAuth access token: RS256 + forum scopes.
  // agent_id must be unique per token — JIT principal resolution rejects a
  // second authSubject claiming an already-mapped agent_id (409 → 401).
  return _signTestToken({
    sub: userId,
    agent_id: userId,
    client_id: 'mc_test_client',
    scope,
  });
}

function buildApp() {
  // Using dynamic import inside test functions to ensure modules are fresh
  return (async () => {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const { threadsRouter } = await import('../src/routes/threads.js');
    const { messagesRouter } = await import('../src/routes/messages.js');
    const { participantsRouter } = await import('../src/routes/participants.js');
    const { reviewReadinessRouter } = await import('../src/routes/review-readiness.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    app.use('/api/threads', threadsRouter);
    app.use('/api/threads/:threadId/messages', messagesRouter);
    app.use('/api/threads/:threadId/participants', participantsRouter);
    app.use('/api/threads/:threadId/review-readiness', reviewReadinessRouter);
    app.use(errorHandler);
    return app;
  })();
}

// ── Tests ──

void describe('Required Reviewer Gate — Phase 2b2a', async () => {
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

  // ── Test 1: No required reviewer → decision allowed, resolve allowed ──
  await it('1. No required reviewer — decision and resolve allowed', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    // Decision — should succeed
    const msg = await da.createMessage({
      threadId: thread.id,
      authorId: CREATOR.id,
      authorName: CREATOR.name,
      authorType: 'agent',
      kind: 'decision',
      content: 'Approved',
    });
    assert.equal(msg.kind, 'decision');

    // Resolve — should succeed
    await da.createOutcome({
      threadId: thread.id, summaryMd: 'Done.', createdById: CREATOR.id, createdByName: CREATOR.name,
    });
    const updated = await da.updateThread(thread.id, {
      status: 'resolved', resolvedAt: new Date(), resolvedById: CREATOR.id, resolvedByName: CREATOR.name,
    });
    assert.equal(updated.status, 'resolved');
  });

  // ── Test 2: Two required reviewers, none replied → 409 ──
  await it('2. Two required reviewers, none replied — decision 409, resolve 409, pendingReviewerIds contains both', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
      { id: REVIEWER_B.id, name: REVIEWER_B.name, role: 'required_reviewer' },
    ]);

    // Check readiness via data layer
    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.pendingReviewerIds.length, 2);
    assert.ok(readiness.pendingReviewerIds.includes(REVIEWER_A.id));
    assert.ok(readiness.pendingReviewerIds.includes(REVIEWER_B.id));

    // Route-level: decision → 409
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'My decision', kind: 'decision' });
    assert.equal(decisionRes.status, 409, 'decision without reviewer replies should be 409');
    assert.ok(decisionRes.body.error?.includes('Required reviewers'));
    assert.ok(decisionRes.body.pendingReviewerIds?.includes(REVIEWER_A.id));

    // Route-level: resolve → 409
    const resolveRes = await request(app)
      .post(`/api/threads/${thread.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ summaryMd: 'Final outcome.' });
    assert.equal(resolveRes.status, 409, 'resolve without reviewer replies should be 409');
    assert.ok(resolveRes.body.error?.includes('Required reviewers'));
    assert.equal(resolveRes.body.pendingReviewerIds.length, 2);
  });

  // ── Test 3: One reviewer replied → still blocked, pendingReviewerIds shows other ──
  await it('3. One reviewer replied — still blocked, pendingReviewerIds shows other only', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
      { id: REVIEWER_B.id, name: REVIEWER_B.name, role: 'required_reviewer' },
    ]);

    // Reviewer A posts a comment
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'comment', content: 'I have reviewed this',
    });

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.pendingReviewerIds.length, 1);
    assert.equal(readiness.pendingReviewerIds[0], REVIEWER_B.id);

    // Decision → 409
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'My decision', kind: 'decision' });
    assert.equal(decisionRes.status, 409);
    assert.deepEqual(decisionRes.body.pendingReviewerIds, [REVIEWER_B.id]);
  });

  // ── Test 4: Both reviewers replied → success ──
  await it('4. Both reviewers replied — decision and resolve succeed', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
      { id: REVIEWER_B.id, name: REVIEWER_B.name, role: 'required_reviewer' },
    ]);

    // Both post messages
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'challenge', content: 'Challenge point',
    });
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_B.id, authorName: REVIEWER_B.name,
      authorType: 'agent', kind: 'evidence', content: 'Supporting evidence',
    });

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.pendingReviewerIds.length, 0);

    // Decision → 201
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Final decision', kind: 'decision' });
    assert.equal(decisionRes.status, 201, 'decision should succeed when all reviewers replied');

    // Resolve → 200
    const resolveRes = await request(app)
      .post(`/api/threads/${thread.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ summaryMd: 'All resolved.' });
    assert.equal(resolveRes.status, 200, 'resolve should succeed when all reviewers replied');
  });

  // ── Test 5: system message doesn't count as reviewer reply ──
  await it('5. system message does not count as reviewer reply', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    // Reviewer A posts a system message only
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'system', content: 'System generated message',
    });

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, false, 'system message should not count as reply');
    assert.equal(readiness.pendingReviewerIds.length, 1);
    assert.equal(readiness.requiredReviewers[0].satisfied, false);

    // Decision → 409
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);
    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Decision', kind: 'decision' });
    assert.equal(decisionRes.status, 409, 'system message should not unblock decision');
  });

  // ── Test 6: challenge message counts ──
  await it('6. challenge message counts as reviewer reply', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'challenge', content: 'I challenge this',
    });

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.requiredReviewers[0].satisfiedBy, 'message');
  });

  // ── Test 7: evidence / comment message counts ──
  await it('7. evidence and comment messages count as reviewer reply', async () => {
    const thread = await createTestThread(da);

    // Test evidence
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'evidence', content: 'Evidence here',
    });
    let readiness = await da.getThreadReviewReadiness(thread.id);
    assert.equal(readiness!.ready, true);
    assert.equal(readiness!.requiredReviewers[0].satisfiedBy, 'message');

    // Reset and test comment
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);

    const thread2 = await createTestThread(da);
    await addParticipants(da, thread2.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);
    await da.createMessage({
      threadId: thread2.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Just a comment',
    });
    readiness = await da.getThreadReviewReadiness(thread2.id);
    assert.equal(readiness!.ready, true);
    assert.equal(readiness!.requiredReviewers[0].satisfiedBy, 'message');
  });

  // ── Test 8: One replied + other waived → success ──
  await it('8. One reviewer replied, other waived — decision and resolve succeed', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
      { id: REVIEWER_B.id, name: REVIEWER_B.name, role: 'required_reviewer' },
    ]);

    // Reviewer A posts
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Review done',
    });

    // Waive Reviewer B via data layer (simulate what waiver API does)
    const participantB = await da.findParticipant(thread.id, REVIEWER_B.id);
    assert.ok(participantB);
    await da.updateParticipant(participantB.id, {
      reviewWaivedAt: new Date(),
      reviewWaivedById: CREATOR.id,
      reviewWaiverReason: 'Endpoint unavailable, waived by creator',
    });

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.equal(readiness.ready, true, 'one replied + one waived = ready');
    assert.equal(readiness.pendingReviewerIds.length, 0);

    // Route-level: decision → 201
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Decision after waiver', kind: 'decision' });
    assert.equal(decisionRes.status, 201, 'decision should succeed when one replied, other waived');

    // Resolve → 200
    const resolveRes = await request(app)
      .post(`/api/threads/${thread.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ summaryMd: 'Resolved after waiver.' });
    assert.equal(resolveRes.status, 200, 'resolve should succeed when one replied, other waived');
  });

  // ── Test 9: Empty waiver reason → 400 ──
  await it('9. Empty waiver reason returns 400', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '' });
    assert.equal(waiverRes.status, 400, 'empty reason should be 400');
    assert.ok(waiverRes.body.error?.includes('reason'));

    // Missing reason field
    const waiverRes2 = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(waiverRes2.status, 400, 'missing reason should be 400');
  });

  // ── Test 10: Non-creator/non-moderator waiver → 403 ──
  await it('10. Non-creator/non-moderator cannot waive a reviewer', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    const app = await buildApp();
    const request = (await import('supertest')).default;

    // Intruder tries to waive (not creator, no governance scope — plain scopes)
    const intruderToken = await signToken(INTRUDER.id, INTRUDER.name, 'forum.read forum.write');
    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ reason: 'Skip this reviewer' });
    assert.equal(waiverRes.status, 403, 'intruder should get 403');

    // Regular member also cannot waive
    await da.addParticipant({
      threadId: thread.id, agentId: REGULAR_MEMBER.id, agentName: REGULAR_MEMBER.name,
      role: 'member', status: 'responded',
    });
    const memberToken = await signToken(REGULAR_MEMBER.id, REGULAR_MEMBER.name, 'forum.read forum.write');
    const waiverRes2 = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ reason: 'Skip' });
    assert.equal(waiverRes2.status, 403, 'regular member should get 403');

    // A participant role string NEVER confers waiver authority: even with the
    // member row elevated to 'moderator', the plain-scoped caller gets 403
    // (CTR-AUTHZ-003).
    const moderatorRow = await da.findParticipant(thread.id, REGULAR_MEMBER.id);
    if (moderatorRow) {
      await da.updateParticipant(moderatorRow.id, { role: 'moderator' });
      const waiverRes3 = await request(app)
        .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ reason: 'Skip' });
      assert.equal(waiverRes3.status, 403, 'participant role moderator must NOT authorize waive');
    }
  });

  // ── Test 11: Waiver on non-required_reviewer → 400 ──
  await it('11. Waiver on non-required_reviewer returns 400', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    // Try to waive the creator (role=creator, not required_reviewer)
    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${CREATOR.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'waive creator' });
    assert.equal(waiverRes.status, 400, 'waiving non-required_reviewer should be 400');

    // Waive a regular member
    await da.addParticipant({
      threadId: thread.id, agentId: REGULAR_MEMBER.id, agentName: REGULAR_MEMBER.name,
      role: 'member', status: 'responded',
    });
    const waiverRes2 = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REGULAR_MEMBER.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'waive member' });
    assert.equal(waiverRes2.status, 400, 'waiving non-required_reviewer should be 400');
  });

  // ── Test 12: GET review-readiness returns correct data ──
  await it('12. GET /review-readiness returns correct ready, satisfied, pendingReviewerIds', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
      { id: REVIEWER_B.id, name: REVIEWER_B.name, role: 'required_reviewer' },
    ]);

    // Step 1: No replies → not ready
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    let res = await request(app)
      .get(`/api/threads/${thread.id}/review-readiness`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ready, false);
    assert.equal(res.body.requiredReviewers.length, 2);
    assert.equal(res.body.requiredReviewers[0].satisfied, false);
    assert.equal(res.body.requiredReviewers[1].satisfied, false);
    assert.equal(res.body.pendingReviewerIds.length, 2);

    // Step 2: Reviewer A replies
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Reviewed',
    });

    res = await request(app)
      .get(`/api/threads/${thread.id}/review-readiness`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.ready, false);
    const reviewerAStatus = res.body.requiredReviewers.find((r: any) => r.agentId === REVIEWER_A.id);
    assert.ok(reviewerAStatus);
    assert.equal(reviewerAStatus.satisfied, true);
    assert.equal(reviewerAStatus.satisfiedBy, 'message');
    assert.ok(reviewerAStatus.messageId);
    assert.equal(res.body.pendingReviewerIds.length, 1);
    assert.equal(res.body.pendingReviewerIds[0], REVIEWER_B.id);

    // Step 3: Waive Reviewer B
    const participantB = await da.findParticipant(thread.id, REVIEWER_B.id);
    await da.updateParticipant(participantB.id, {
      reviewWaivedAt: new Date(),
      reviewWaivedById: CREATOR.id,
      reviewWaiverReason: 'Waived for testing',
    });

    res = await request(app)
      .get(`/api/threads/${thread.id}/review-readiness`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.ready, true);
    const reviewerBStatus = res.body.requiredReviewers.find((r: any) => r.agentId === REVIEWER_B.id);
    assert.ok(reviewerBStatus);
    assert.equal(reviewerBStatus.satisfied, true);
    assert.equal(reviewerBStatus.satisfiedBy, 'waiver');
    assert.ok(reviewerBStatus.waiverReason, 'Waived for testing');
    assert.equal(res.body.pendingReviewerIds.length, 0);

    // Step 4: 404 for non-existent thread
    const notFoundRes = await request(app)
      .get(`/api/threads/non-existent-id/review-readiness`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(notFoundRes.status, 404);
  });

  // ── Test 13: Manual mode (no DiscussionRun) — participant posts → decision → resolve ──
  await it('13. Manual mode — participant posts, decision, resolve (no DiscussionRun)', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    // No DiscussionRun created — simulating manual mode

    // Step 1: Reviewer posts a message manually
    const app = await buildApp();
    const request = (await import('supertest')).default;
    const reviewerToken = await signToken(REVIEWER_A.id, REVIEWER_A.name);

    const postRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ content: 'Manual review comment', kind: 'comment' });
    assert.equal(postRes.status, 201, 'reviewer should be able to post manually');

    // Step 2: Creator can now post decision
    const creatorToken = await signToken(CREATOR.id, CREATOR.name);
    const decisionRes = await request(app)
      .post(`/api/threads/${thread.id}/messages`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ content: 'Decision after manual review', kind: 'decision' });
    assert.equal(decisionRes.status, 201, 'decision should succeed in manual mode');

    // Step 3: Resolve
    const resolveRes = await request(app)
      .post(`/api/threads/${thread.id}/resolve`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ summaryMd: 'Manual review completed.' });
    assert.equal(resolveRes.status, 200, 'resolve should succeed in manual mode');
  });

  // ── Test 14: Waiver is idempotent ──
  await it('14. Duplicate waiver returns existing state (idempotent)', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    // First waiver
    const waiver1 = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'First waiver reason' });
    assert.equal(waiver1.status, 200);
    assert.equal(waiver1.body.participant.reviewWaiverReason, 'First waiver reason');

    // Second waiver (idempotent)
    const waiver2 = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Second waiver reason should be ignored' });
    assert.equal(waiver2.status, 200);
    assert.equal(waiver2.body.participant.reviewWaiverReason, 'First waiver reason',
      'duplicate waiver should return original reason');
  });

  // ── Test 15: Already replied reviewer cannot be waived ──
  await it('15. Already replied reviewer cannot be waived (409)', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);

    // Reviewer already replied
    await da.createMessage({
      threadId: thread.id, authorId: REVIEWER_A.id, authorName: REVIEWER_A.name,
      authorType: 'agent', kind: 'comment', content: 'Already replied',
    });

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const token = await signToken(CREATOR.id, CREATOR.name);

    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Try to waive after reply' });
    assert.equal(waiverRes.status, 409, 'already replied reviewer should get 409 on waiver');
    assert.ok(waiverRes.body.error?.includes('already posted'));
  });

  // ── Test 16: Moderator can waive ──
  await it('16. Moderator can waive a required reviewer', async () => {
    const thread = await createTestThread(da);
    await addParticipants(da, thread.id, [
      { id: REVIEWER_A.id, name: REVIEWER_A.name, role: 'required_reviewer' },
    ]);
    // Add moderator
    await da.addParticipant({
      threadId: thread.id, agentId: MODERATOR.id, agentName: MODERATOR.name,
      role: 'moderator', status: 'responded',
    });

    const app = await buildApp();
    const request = (await import('supertest')).default;
    const moderatorToken = await signToken(MODERATOR.id, MODERATOR.name);

    const waiverRes = await request(app)
      .post(`/api/threads/${thread.id}/participants/${REVIEWER_A.id}/waive-review`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'Moderator waiver' });
    assert.equal(waiverRes.status, 200, 'moderator should be able to waive');
    assert.equal(waiverRes.body.participant.reviewWaiverReason, 'Moderator waiver');

    // Readiness should be ready now
    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.equal(readiness!.ready, true);
  });
});
