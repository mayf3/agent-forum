/**
 * Participant nested-mutation guard tests (GOVERNANCE-FINAL-AUDIT-A776CF4-R1 M-1).
 *
 * PATCH/DELETE /api/threads/:threadId/participants/:participantId must share
 * the unified visibility guard used by every other nested surface (hidden/
 * deleted thread → 404 for ordinary callers, no existence leak; governance
 * callers retain access) and must bind the target participant to the route
 * thread (a participant id from another thread → 404, CTR-AUTHZ-004).
 * Open-thread behavior must not regress.
 *
 * Run: npx tsx --test tests/governance-participant-guards.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

let _jwksCleanup: { url: string; close: () => void };
let _signTestToken: typeof import('./helpers/auth-keys.js').signTestToken;
before(async () => {
  const { startTestJwksServer } = await import('./helpers/jwks-server.js');
  _jwksCleanup = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = _jwksCleanup.url;
  process.env.FORUM_OPERATOR_AGENT_IDS = 'forum-ops';
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});
after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

const IDS = {
  creator:   { sub: '10000000-0000-4000-8000-000000000011', agentId: 'creator-agent',   pid: '10000000-0000-4000-8000-0000000000b1' },
  plain:     { sub: '10000000-0000-4000-8000-000000000012', agentId: 'plain-agent',    pid: '10000000-0000-4000-8000-0000000000b2' },
  moderator: { sub: '10000000-0000-4000-8000-000000000013', agentId: 'forum-moderator', pid: '10000000-0000-4000-8000-0000000000b3' },
  member:    { sub: '10000000-0000-4000-8000-000000000014', agentId: 'member-agent',   pid: '10000000-0000-4000-8000-0000000000b4' },
};

const SCOPES = {
  plain: 'forum.read forum.write',
  moderator: 'forum.read forum.write forum.moderate',
};

const threads = new Map<string, any>();
const participants = new Map<string, any>();
const principals = new Map<string, any>();

const THREAD_ID = '51111111-1111-4111-a111-111111111111';
const OTHER_THREAD_ID = '52222222-2222-4222-a222-222222222222';
// Participant row that belongs to OTHER_THREAD_ID (cross-thread target).
const FOREIGN_PARTICIPANT_ID = '53333333-3333-4333-a333-333333333333';

function resetDb() {
  threads.clear(); participants.clear(); principals.clear();
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

function seedPrincipals() {
  for (const key of Object.keys(IDS) as Array<keyof typeof IDS>) {
    const id = IDS[key];
    principals.set(id.pid, {
      id: id.pid, authSubject: id.sub, principalType: 'agent',
      agentId: id.agentId, displayName: id.agentId, source: 'jit', status: 'active',
      firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }
}

function seedThreads(status = 'open') {
  threads.set(THREAD_ID, {
    id: THREAD_ID, title: 'Guarded thread', status, type: 'discussion',
    messageCount: 0, viewCount: 0, pinned: false, featured: false,
    createdById: IDS.creator.pid, createdByName: 'creator-agent', createdByType: 'agent',
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  });
  threads.set(OTHER_THREAD_ID, {
    id: OTHER_THREAD_ID, title: 'Other thread', status: 'open', type: 'discussion',
    messageCount: 0, viewCount: 0, pinned: false, featured: false,
    createdById: IDS.creator.pid, createdByName: 'creator-agent', createdByType: 'agent',
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  });
}

/** Participant of THREAD_ID (the mutation target). Returns its id. */
function seedThreadParticipant(role = 'member'): string {
  return seedParticipantFor('member', role);
}

/** Participant row of THREAD_ID owned by the given identity. */
function seedParticipantFor(who: keyof typeof IDS, role = 'member'): string {
  const id = mockUuid();
  const owner = IDS[who];
  participants.set(id, {
    id, threadId: THREAD_ID, agentId: owner.pid, agentName: owner.agentId,
    role, status: 'active', joinedAt: new Date(), leftAt: null,
  });
  return id;
}

function seedForeignParticipant() {
  participants.set(FOREIGN_PARTICIPANT_ID, {
    id: FOREIGN_PARTICIPANT_ID, threadId: OTHER_THREAD_ID,
    agentId: IDS.member.pid, agentName: IDS.member.agentId,
    role: 'member', status: 'active', joinedAt: new Date(), leftAt: null,
  });
}

function mockStore(store: Map<string, any>) {
  return {
    findUnique: async ({ where }: any) => {
      if (where.id) return store.get(where.id) || null;
      if (where.authSubject) {
        for (const v of store.values()) if (v.authSubject === where.authSubject) return v;
        return null;
      }
      if (where.threadId_agentId) {
        const { threadId, agentId } = where.threadId_agentId;
        for (const v of store.values()) if (v.threadId === threadId && v.agentId === agentId && !v.leftAt) return v;
        return null;
      }
      return null;
    },
    findMany: async () => Array.from(store.values()),
    update: async ({ where, data }: any) => {
      const existing = store.get(where.id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.set(where.id, updated);
      return updated;
    },
    create: async ({ data }: any) => {
      const doc = { ...data, id: data.id || mockUuid(), createdAt: new Date(), updatedAt: new Date() };
      store.set(doc.id, doc);
      return doc;
    },
  };
}

function createMockPrisma() {
  return {
    forumThread: mockStore(threads),
    forumThreadParticipant: mockStore(participants),
    forumPrincipal: mockStore(principals),
    forumThreadMessage: { findFirst: async () => null },
    $transaction: async (fn: (tx: any) => any) => fn({
      forumThread: mockStore(threads),
      forumThreadParticipant: mockStore(participants),
      forumPrincipal: mockStore(principals),
      forumThreadMessage: { findFirst: async () => null },
    }),
    $disconnect: async () => {},
  };
}

let _supertest: any;
async function buildApp() {
  const { participantsRouter } = await import('../src/routes/participants.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use('/api/threads/:threadId/participants', participantsRouter);
  app.use(errorHandler);
  return app;
}

async function req(app: any, method: string, path: string, token: string, body?: any) {
  if (!_supertest) _supertest = (await import('supertest')).default;
  let r: any;
  if (method === 'PATCH') r = _supertest(app).patch(path);
  else if (method === 'DELETE') r = _supertest(app).delete(path);
  else if (method === 'POST') r = _supertest(app).post(path);
  else throw new Error(`Unknown method: ${method}`);
  r = r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) r = r.send(body);
  return r;
}

function tokenFor(who: keyof typeof IDS, scope?: string) {
  const id = IDS[who];
  return _signTestToken({ sub: id.sub, agent_id: id.agentId, client_id: 'mc_test', scope: scope ?? SCOPES.plain });
}

let prismaMod: typeof import('../src/lib/prisma.js');

void describe('Participant nested-mutation guards (visibility + thread binding)', async () => {
  before(async () => {
    prismaMod = await import('../src/lib/prisma.js');
  });

  beforeEach(() => {
    resetDb();
    seedPrincipals();
    seedThreads('open');
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('ordinary writer PATCH/DELETE on a hidden thread participant → 404 (no existence leak)', async () => {
    seedThreads('hidden');
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { role: 'moderator' });
    assert.equal(patched.status, 404);

    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${pid}`, token);
    assert.equal(deleted.status, 404);

    // Nothing mutated
    assert.equal(participants.get(pid).role, 'member');
    assert.equal(participants.get(pid).leftAt, null);
  });

  await it('ordinary writer PATCH/DELETE on a deleted thread participant → 404', async () => {
    seedThreads('deleted');
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { status: 'left' });
    assert.equal(patched.status, 404);
    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${pid}`, token);
    assert.equal(deleted.status, 404);
    assert.equal(participants.get(pid).leftAt, null);
  });

  await it('governance caller retains access on a hidden thread (unified guard, not a blanket 404)', async () => {
    seedThreads('hidden');
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const mod = await tokenFor('moderator', SCOPES.moderator);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, mod, { role: 'required_reviewer' });
    assert.equal(patched.status, 200);
    assert.equal(participants.get(pid).role, 'required_reviewer');
  });

  await it('participantId belonging to another thread → 404 on both PATCH and DELETE (CTR-AUTHZ-004)', async () => {
    seedForeignParticipant();
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);

    // Target row exists (in OTHER_THREAD_ID) but must not be reachable
    // through THIS thread's route.
    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${FOREIGN_PARTICIPANT_ID}`, token, { role: 'moderator' });
    assert.equal(patched.status, 404);
    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${FOREIGN_PARTICIPANT_ID}`, token);
    assert.equal(deleted.status, 404);

    // The foreign row is untouched
    assert.equal(participants.get(FOREIGN_PARTICIPANT_ID).threadId, OTHER_THREAD_ID);
    assert.equal(participants.get(FOREIGN_PARTICIPANT_ID).role, 'member');
    assert.equal(participants.get(FOREIGN_PARTICIPANT_ID).leftAt, null);
  });

  await it('open thread: creator PATCH/DELETE keep working (no regression)', async () => {
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const token = await tokenFor('creator', SCOPES.plain);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { role: 'required_reviewer', status: 'invited' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.participant.role, 'required_reviewer');
    assert.equal(patched.body.participant.status, 'invited');

    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${pid}`, token);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { ok: true });
    assert.ok(participants.get(pid).leftAt instanceof Date, 'soft-deleted via leftAt');
  });

  await it('plain writer PATCH/DELETE on ANOTHER principal participant row → 403 (CTR-AUTHZ-004)', async () => {
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { role: 'required_reviewer' });
    assert.equal(patched.status, 403);
    assert.equal(participants.get(pid).role, 'member', 'role unchanged');

    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${pid}`, token);
    assert.equal(deleted.status, 403);
    assert.equal(participants.get(pid).leftAt, null, 'row untouched');
  });

  await it('self-service: own lastReadAt PATCH allowed; own row DELETE (leave) allowed', async () => {
    const pid = seedParticipantFor('plain');
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { lastReadAt: new Date().toISOString() });
    assert.equal(patched.status, 200);
    assert.ok(participants.get(pid).lastReadAt instanceof Date, 'own lastReadAt updated');

    const deleted = await req(app, 'DELETE', `/api/threads/${THREAD_ID}/participants/${pid}`, token);
    assert.equal(deleted.status, 200, 'self-leave is self-service');
  });

  await it('governance scope PATCH on another principal row → 200 (CTR-AUTHZ-004 creator-or-moderate)', async () => {
    const pid = seedThreadParticipant();
    const app = await buildApp();
    const token = await tokenFor('moderator', SCOPES.moderator);

    const patched = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${pid}`, token, { role: 'required_reviewer' });
    assert.equal(patched.status, 200);
    assert.equal(participants.get(pid).role, 'required_reviewer');
  });
});

void describe('Participant authority matrix (CTR-AUTHZ-002/003/004 — boundary audit F1/F2 closure)', async () => {
  beforeEach(() => {
    resetDb();
    seedPrincipals();
    seedThreads('open');
    prismaMod.setPrisma(createMockPrisma() as any);
  });

  await it('creator can add another known agent (201)', async () => {
    const app = await buildApp();
    const token = await tokenFor('creator', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.member.agentId });
    assert.equal(res.status, 201);
    assert.equal(res.body.participant.role, 'member');
  });

  await it('plain writer adding ANOTHER agent → 403', async () => {
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.member.agentId });
    assert.equal(res.status, 403);
  });

  await it('self-service join as member → 201; self-elevation → 403', async () => {
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);
    const joined = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.plain.agentId });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.participant.role, 'member');

    const elevated = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.plain.agentId, role: 'moderator' });
    assert.equal(elevated.status, 403);
  });

  await it('UNKNOWN agent id → 400 (no ghost participant row — F2 poison closed)', async () => {
    const app = await buildApp();
    const token = await tokenFor('creator', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: 'ghost-not-a-principal' });
    assert.equal(res.status, 400);
    assert.ok(Array.from(participants.values()).every(p => p.agentId !== 'ghost-not-a-principal'));
  });

  await it('role/status outside the closed enum → 400', async () => {
    const app = await buildApp();
    const token = await tokenFor('creator', SCOPES.plain);
    const badRole = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.member.agentId, role: 'superadmin' });
    assert.equal(badRole.status, 400);
    const badStatus = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants`, token, { agentId: IDS.member.agentId, status: 'banned' });
    assert.equal(badStatus.status, 400);
  });

  await it('participant role moderator does NOT authorize waive; governance scope does (CTR-AUTHZ-003)', async () => {
    const reviewerPid = seedParticipantFor('member', 'required_reviewer');
    seedParticipantFor('plain', 'moderator'); // plain-scoped caller holds a 'moderator' row
    const app = await buildApp();
    const plainToken = await tokenFor('plain', SCOPES.plain);
    const res = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants/${IDS.member.pid}/waive-review`, plainToken, { reason: 'role-based attempt' });
    assert.equal(res.status, 403, 'participant role string must not confer waive authority');

    const modToken = await tokenFor('moderator', SCOPES.moderator);
    const res2 = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants/${IDS.member.pid}/waive-review`, modToken, { reason: 'scope-based waiver' });
    assert.equal(res2.status, 200, 'verified forum.moderate scope authorizes waive (no participant row needed)');

    // Waiver is idempotent once set: replaying as the (authorized) creator
    // returns the existing waiver.
    const creatorToken = await tokenFor('creator', SCOPES.plain);
    const res3 = await req(app, 'POST', `/api/threads/${THREAD_ID}/participants/${IDS.member.pid}/waive-review`, creatorToken, { reason: 'creator replay' });
    assert.equal(res3.status, 200, 'idempotent waiver replay');
    assert.equal(res3.body.participant.reviewWaiverReason, 'scope-based waiver');
  });
  await it('unknown participantId on an open thread → 404 (unchanged)', async () => {
    const app = await buildApp();
    const token = await tokenFor('plain', SCOPES.plain);
    const res = await req(app, 'PATCH', `/api/threads/${THREAD_ID}/participants/${mockUuid()}`, token, { role: 'member' });
    assert.equal(res.status, 404);
  });
});
