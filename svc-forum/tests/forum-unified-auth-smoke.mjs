/**
 * Forum Unified Auth Smoke Test — end-to-end verification.
 *
 * Tests the full JIT Principal + scope guard chain using:
 * - Real JWT signing with auth-service secret (from env module)
 * - Real Express app with authRequired + requireWriteScope
 * - In-memory Prisma mock for ForumPrincipal
 *
 * Does NOT require a running auth-service or PostgreSQL.
 * Does NOT persist tokens.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import express from 'express';
import supertest from 'supertest';

const AGENT_SUB = '81c7fc7e-c696-4b47-bfd6-f12a9ecb68a6'; // blog-agent MachinePrincipal UUID
const AGENT_ID = 'blog-agent';
const CLIENT_ID = 'mc_smoke-test-client-id';

// In-memory principal store
const principals = new Map();
let AUTH_SECRET;
let authRequired, requireWriteScope, errorHandler, setPrisma;

function makePrincipalStore() {
  return {
    findUnique: async ({ where }) => {
      if (where?.authSubject) return principals.get(where.authSubject) || null;
      if (where?.agentId) {
        for (const v of principals.values()) {
          if (v.agentId === where.agentId) return v;
        }
        return null;
      }
      return null;
    },
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => principals.size,
    create: async ({ data }) => {
      const doc = { ...data, id: 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
      principals.set(data.authSubject, doc);
      return doc;
    },
    update: async ({ where, data }) => {
      for (const [key, v] of principals) {
        if (v.authSubject === where.authSubject || v.id === where.id) {
          const updated = { ...v, ...data, updatedAt: new Date() };
          principals.set(key, updated);
          return updated;
        }
      }
      throw new Error('Not found');
    },
    updateMany: async () => ({ count: 0 }),
  };
}

function mockPrisma() {
  const p = makePrincipalStore();
  return {
    forumPrincipal: p,
    forumThread: {
      findUnique: async () => null, findFirst: async () => null,
      findMany: async () => [], count: async () => 0,
      create: async ({ data }) => data,
      update: async ({ data }) => data,
      updateMany: async () => ({ count: 0 }),
    },
    forumThreadParticipant: {
      findUnique: async () => null, findFirst: async () => null,
      findMany: async () => [], count: async () => 0,
      create: async ({ data }) => data,
    },
    forumThreadMessage: {
      findUnique: async () => null, findFirst: async () => null,
      findMany: async () => [], count: async () => 0,
      create: async ({ data }) => data,
    },
    forumContextSnapshot: {
      findUnique: async () => null, findMany: async () => [],
      create: async ({ data }) => data,
    },
    forumOutcome: {
      findUnique: async () => null, findMany: async () => [],
      create: async ({ data }) => data,
    },
    $queryRaw: async () => [{ 1: 1 }],
    $transaction: async (fn) => fn({
      forumPrincipal: { findUnique: p.findUnique, create: p.create, update: p.update },
    }),
    $disconnect: async () => {},
  };
}

function signAgentToken(scope = 'forum.read') {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: AGENT_SUB, iss: 'auth-service', aud: 'svc-forum', iat: now, exp: now + 600, jti: 'smoke-' + now, type: 'access', version: 'v1', principal_type: 'agent', agent_id: AGENT_ID, client_id: CLIENT_ID, scope },
    AUTH_SECRET,
  );
}

void describe('Forum Unified Auth Smoke', async () => {
  before(async () => {
    // Import env module first to get the actual AUTH_JWT_SECRET
    const envMod = await import('../src/config/env.js');
    AUTH_SECRET = envMod.env.AUTH_JWT_SECRET;

    // Import middleware
    const authMod = await import('../src/middleware/auth.js');
    authRequired = authMod.authRequired;

    const scopeMod = await import('../src/middleware/scope-guard.js');
    requireWriteScope = scopeMod.requireWriteScope;

    const errMod = await import('../src/middleware/error-handler.js');
    errorHandler = errMod.errorHandler;

    const prismaMod = await import('../src/lib/prisma.js');
    setPrisma = prismaMod.setPrisma;
  });

  beforeEach(() => {
    principals.clear();
    if (setPrisma) setPrisma(mockPrisma());
  });

  // ── 1. Read endpoint works with forum.read token ──
  await it('1. GET /api/threads — read endpoint works with forum.read token', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/threads', authRequired, (req, res) => {
      res.json({ ok: true, authSource: req.user.authSource, scopes: req.user.scopes });
    });
    app.use(errorHandler);

    const token = signAgentToken();
    const res = await supertest(app)
      .get('/api/threads')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200, 'read endpoint should succeed');
    assert.equal(res.body.authSource, 'auth_service_agent_jwt');
    assert.ok(res.body.scopes.includes('forum.read'));
    assert.ok(!res.body.token, 'token not in response body');
  });

  // ── 2. Write endpoint rejected with forum.read only token ──
  await it('2. POST /api/threads — write endpoint rejected with forum.read only', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/threads', authRequired, requireWriteScope, (req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const token = signAgentToken();
    const res = await supertest(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'smoke test' });

    assert.equal(res.status, 403, 'write endpoint should be rejected');
    assert.ok(res.text.includes('Insufficient scope') || res.text.includes('forum.write'),
      `Error message mentions scope: ${res.text.substring(0, 200)}`);
  });

  // ── 3. Write endpoint succeeds with forum.read + forum.write ──
  await it('3. POST /api/threads — write endpoint succeeds with forum.write scope', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/threads', authRequired, requireWriteScope, (req, res) => {
      res.json({ ok: true, authSource: req.user.authSource });
    });
    app.use(errorHandler);

    const token = signAgentToken('forum.read forum.write');
    const res = await supertest(app)
      .post('/api/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'smoke test' });

    assert.equal(res.status, 200, 'write endpoint with forum.write scope should succeed');
  });

  // ── 4. JIT creates principal on first access ──
  await it('4. JIT creates ForumPrincipal on first access', async () => {
    assert.equal(principals.size, 0, 'no principals before access');

    const app = express();
    app.use(express.json());
    app.get('/api/test', authRequired, (req, res) => {
      res.json({ id: req.user.id, authSubject: req.user.authSubjectId });
    });
    app.use(errorHandler);

    const token = signAgentToken();
    await supertest(app).get('/api/test').set('Authorization', `Bearer ${token}`);

    assert.equal(principals.size, 1, 'one principal created after JIT');
    const p = principals.get(AGENT_SUB);
    assert.ok(p, 'principal exists for authSubject');
    assert.equal(p.agentId, AGENT_ID);
    assert.equal(p.source, 'jit');
  });

  // ── 5. No token persistence ──
  await it('5. Token is not persisted anywhere', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/test', authRequired, (req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const token = signAgentToken();
    await supertest(app).get('/api/test').set('Authorization', `Bearer ${token}`);

    // Check that no principal has the token stored
    for (const p of principals.values()) {
      assert.ok(!p.token, 'token not stored in principal');
      assert.ok(!p.accessToken, 'accessToken not stored');
      assert.ok(!p.secret, 'secret not stored');
    }
  });

  // ── 6. Auth metadata does not include client secret ──
  await it('6. Auth metadata does not include client secret', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/test', authRequired, (req, res) => {
      res.json({
        authSource: req.user.authSource,
        scopes: req.user.scopes,
        hasSecret: req.user.clientSecret !== undefined,
        hasToken: req.user.token !== undefined,
      });
    });
    app.use(errorHandler);

    const token = signAgentToken();
    const res = await supertest(app).get('/api/test').set('Authorization', `Bearer ${token}`);

    assert.equal(res.body.hasSecret, false, 'no client secret in req.user');
    assert.equal(res.body.hasToken, false, 'no token in req.user');
  });
});
