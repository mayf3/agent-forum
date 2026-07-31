/**
 * Standard OAuth integration tests — middleware + scope guards.
 *
 * A SINGLE JWKS server is shared across all describe blocks (started once
 * at file-level) so the lazy production `verifyAuthAccessToken` always
 * resolves to the same URL.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { signTestToken } from './helpers/auth-keys.js';

// ── File-level JWKS server (shared across all tests) ─────────────────────
let server: { close: () => void };
const principals = new Map<string, any>();

before(async () => {
  const { setupTestJwks } = await import('./helpers/jwks-server.js');
  server = await setupTestJwks();

  // Set up a minimal prisma mock so auth middleware's resolvePrincipal works.
  const prismaMod = await import('../src/lib/prisma.js');
    const fp = {
        findUnique: async ({ where }: any) => {
            const result = principals.get(where.authSubject) || null;
            if (where.agentId) {
                // Find by iterating over all values to match agentId
                for (const v of principals.values()) {
                    if (v.agentId === where.agentId) {
                        return v;
                    }
                }
                return null;
            }
            return result;
        },
    create: async ({ data }: any) => {
      const record = { ...data, id: data.id || 'p-' + Date.now() };
      principals.set(record.authSubject, record);
      return record;
    },
    update: async ({ where, data }: any) => {
      const existing = { ...principals.get(where.id) };
      Object.assign(existing, data);
      principals.set(existing.authSubject, existing);
      return existing;
    },
  };
  prismaMod.setPrisma({
    forumPrincipal: fp,
    forumThread: { findUnique: async () => null, count: async () => 0 },
    $transaction: async (fn: any) => fn({ forumPrincipal: fp }),
    $queryRaw: async () => [{ 1: 1 }],
    $disconnect: async () => {},
  } as any);
});

after(() => { if (server) server.close(); });

// ── Scope enforcement ───────────────────────────────────────────────────

void describe('scope enforcement (authRequired + scope-guard)', async () => {

  async function buildApp() {
    const express = (await import('express')).default;
    const { authRequired } = await import('../src/middleware/auth.js');
    const { requireReadScope, requireWriteScope } = await import('../src/middleware/scope-guard.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.get('/read', authRequired, requireReadScope(), (req: any, res: any) => res.json({ ok: true }));
    app.post('/write', authRequired, requireWriteScope(), (req: any, res: any) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  await it('READ_SCOPE_ACCEPTED=true', async () => {
    const app = await buildApp();
    const token = await signTestToken({ scope: 'forum.read' });
    const st = (await import('supertest')).default;
    assert.equal((await st(app).get('/read').set('Authorization', `Bearer ${token}`)).status, 200);
  });

  await it('READ_WITHOUT_FORUM_READ_REJECTED=true', async () => {
    const app = await buildApp();
    const token = await signTestToken({ scope: 'forum.write' });
    const st = (await import('supertest')).default;
    const res = await st(app).get('/read').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
  });

  await it('WRITE_SCOPE_ACCEPTED=true', async () => {
    const app = await buildApp();
    const token = await signTestToken({ scope: 'forum.read forum.write' });
    const st = (await import('supertest')).default;
    assert.equal((await st(app).post('/write').set('Authorization', `Bearer ${token}`)).status, 200);
  });

  await it('WRITE_WITHOUT_FORUM_WRITE_REJECTED=true', async () => {
    const app = await buildApp();
    const token = await signTestToken({ scope: 'forum.read' });
    const st = (await import('supertest')).default;
    const res = await st(app).post('/write').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'));
  });

  await it('INSUFFICIENT_SCOPE_NOT_REFRESHED=true', async () => {
    const app = await buildApp();
    const token = await signTestToken({ scope: 'forum.read' });
    const st = (await import('supertest')).default;
    const res = await st(app).post('/write').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.ok(!res.body.error.includes('TOKEN_INVALID_OR_EXPIRED'));
  });
});

// ── authOptional semantics ───────────────────────────────────────────────

// ── authOptional semantics ───────────────────────────────────────────────

void describe('authOptional', async () => {
  async function buildApp() {
    const express = (await import('express')).default;
    const { authOptional } = await import('../src/middleware/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.get('/opt', authOptional, (req: any, res: any) => res.json({ user: req.user ? { agentId: req.user.agentId } : null }));
    app.use(errorHandler);
    return app;
  }

  await it('AUTH_OPTIONAL_ABSENT_TOKEN_ALLOWED=true', async () => {
    const app = await buildApp();
    const st = (await import('supertest')).default;
    const res = await st(app).get('/opt');
    assert.equal(res.status, 200);
    assert.strictEqual(res.body.user, null);
  });

  await it('AUTH_OPTIONAL_INVALID_TOKEN_REJECTED=true', async () => {
    const app = await buildApp();
    const st = (await import('supertest')).default;
    const res = await st(app).get('/opt').set('Authorization', 'Bearer not-a-jwt');
    assert.equal(res.status, 401);
  });
});

// ── JWKS infrastructure failure → 503 (uses its own factory, not lazy) ──

void describe('JWKS infrastructure', async () => {
  await it('JWKS_UNAVAILABLE_RETURNS_503=true', async () => {
    const { createRemoteJWKSet } = await import('jose');
    const { createAccessTokenVerifier } = await import('../src/lib/auth-jwt.js');
    const deadVerifier = createAccessTokenVerifier(
      createRemoteJWKSet(new URL('http://127.0.0.1:1/.well-known/jwks.json')),
    );
    const token = await signTestToken();
    try { await deadVerifier(token); assert.fail(); }
    catch (e: any) { assert.equal(e.code, 'AUTH_JWKS_UNAVAILABLE'); }
  });
});

// ── JWKS key rotation ───────────────────────────────────────────────────

void describe('key rotation', async () => {
  await it('JWKS_KEY_ROTATION_PASS=true', async () => {
    const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = await import('jose');
    const { createAccessTokenVerifier } = await import('../src/lib/auth-jwt.js');
    const { testJwks } = await import('./helpers/auth-keys.js');

    const { publicKey: newPub, privateKey: newPriv } = await generateKeyPair('RS256');
    const newJwk = await exportJWK(newPub);
    const jwks = await testJwks();

    const rotatedJwks = {
      keys: [
        { ...jwks.keys[0] },
        { ...newJwk, kid: 'key-v2', use: 'sig', alg: 'RS256' },
      ],
    };
    const rotatedVerifier = createAccessTokenVerifier(createLocalJWKSet(rotatedJwks));

    // Old key token still works
    await rotatedVerifier(await signTestToken());

    // New key token works too
    const newToken = await new SignJWT({
      type: 'access', version: 'v1', principal_type: 'agent',
      agent_id: 'rotated', client_id: 'c', scope: 'forum.read',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-v2' })
      .setSubject('rotated-uuid').setIssuer('auth-service').setAudience('svc-forum')
      .setIssuedAt().setExpirationTime('5m')
      .sign(newPriv);

    const result = await rotatedVerifier(newToken);
    assert.equal(result.agentId, 'rotated');
  });
});
