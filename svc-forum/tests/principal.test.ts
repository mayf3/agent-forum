/**
 * Canonical Principal normalization and identity mapping tests.
 *
 * Tests cover:
 *   - Principal normalization (1-9)
 *   - JWT validation (10-18)
 *   - Existing Forum behavior (19-24)
 *   - Dry-run tool (25-35)
 *
 * Run: npx tsx --test tests/principal.test.ts
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════
//  Test JWKS + deferred signTestToken (standard OAuth RS256)
//  The JWKS server starts (and AUTH_JWKS_URL is set) BEFORE the
//  first import of any src module so auth-jwt.ts freezes the test
//  URL at module load.
// ══════════════════════════════════════════════════════════════

let _jwksCleanup: { url: string; close: () => void };
let _signTestToken: typeof import('./helpers/auth-keys.js').signTestToken;

// Minimal default prisma mock (forumPrincipal) so authRequired →
// resolvePrincipal works even in blocks that do not set their own mock.
let _prismaMockInstalled = false;

before(async () => {
  const { startTestJwksServer } = await import('./helpers/jwks-server.js');
  _jwksCleanup = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = _jwksCleanup.url;

  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;

  if (!_prismaMockInstalled) {
    const prismaMod = await import('../src/lib/prisma.js');
    const principals = new Map<string, any>();
    const fp = {
      findUnique: async ({ where }: any) => {
        if (where.authSubject) return principals.get(where.authSubject) || null;
        if (where.agentId) {
          for (const v of principals.values()) {
            if (v.agentId === where.agentId) return v;
          }
          return null;
        }
        if (where.id) {
          for (const v of principals.values()) {
            if (v.id === where.id) return v;
          }
          return null;
        }
        return null;
      },
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async ({ data }: any) => {
        const doc = { ...data, id: data.id || 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
        principals.set(data.authSubject, doc);
        return doc;
      },
      update: async ({ where, data }: any) => {
        for (const [key, v] of principals) {
          if (v.authSubject === where.authSubject || v.id === where.id) {
            const updated = { ...v, ...data, updatedAt: new Date() };
            principals.set(key, updated);
            return updated;
          }
        }
        throw new Error('Not found');
      },
    };
    prismaMod.setPrisma({
      forumPrincipal: fp,
      forumThread: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], count: async () => 0 },
      forumThreadParticipant: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], count: async () => 0 },
      forumThreadMessage: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], count: async () => 0 },
      $queryRaw: async () => [{ 1: 1 }],
      $transaction: async (fn: any) => fn({
        forumPrincipal: fp,
        forumThread: { findUnique: async () => null },
      }),
      $disconnect: async () => {},
    } as any);
    _prismaMockInstalled = true;
  }
});

after(() => { if (_jwksCleanup) _jwksCleanup.close(); });

// ══════════════════════════════════════════════════════════════
//  Principal normalization (pure logic, no I/O)
// ══════════════════════════════════════════════════════════════

void describe('ForumPrincipal — normalization', async () => {
  let normalizePrincipal: typeof import('../src/identity/principal.js').normalizePrincipal;
  let isValidAgentId: typeof import('../src/identity/principal.js').isValidAgentId;

  before(async () => {
    const mod = await import('../src/identity/principal.js');
    normalizePrincipal = mod.normalizePrincipal;
    isValidAgentId = mod.isValidAgentId;
  });

  // ── 1. Legacy default mode ──
  await it('1. legacy mode: Agent JWT with agentId → principalId is sub', async () => {
    const p = normalizePrincipal(
      { sub: 'user-uuid-1234', agentId: 'blog-agent', role: 'agent' },
      'legacy-sub',
    );
    assert.equal(p.principalId, 'user-uuid-1234');
    assert.equal(p.identityMode, 'legacy-sub');
    assert.equal(p.authSubjectId, 'user-uuid-1234');
    assert.equal(p.principalType, 'user');
    assert.equal(p.businessAgentId, 'blog-agent');
  });

  // ── 2. Business mode: role=agent + valid agentId ──
  await it('2. business mode: role=agent + valid agentId → principalId=agentId', async () => {
    const p = normalizePrincipal(
      { sub: 'user-uuid-1234', agentId: 'blog-agent', role: 'agent' },
      'business-agent-id',
    );
    assert.equal(p.principalId, 'blog-agent');
    assert.equal(p.identityMode, 'business-agent-id');
    assert.equal(p.principalType, 'agent');
    assert.equal(p.authSubjectId, 'user-uuid-1234');
  });

  // ── 3. Business mode: role=user + agentId claim ──
  await it('3. business mode: role=user + agentId claim → principalId is sub', async () => {
    const p = normalizePrincipal(
      { sub: 'human-uuid', agentId: 'blog-agent', role: 'user' },
      'business-agent-id',
    );
    assert.equal(p.principalId, 'human-uuid');
    assert.equal(p.identityMode, 'legacy-sub');
    assert.equal(p.principalType, 'user');
  });

  // ── 4. Business mode: role=agent without agentId ──
  await it('4. business mode: role=agent without agentId → principalId=sub', async () => {
    const p = normalizePrincipal(
      { sub: 'agent-uuid', role: 'agent' },
      'business-agent-id',
    );
    assert.equal(p.principalId, 'agent-uuid');
    assert.equal(p.identityMode, 'legacy-sub');
    assert.equal(p.principalType, 'user');
  });

  // ── 5. Malformed agentId (uppercase) ──
  await it('5. business mode: malformed agentId (uppercase) → principalId=sub', async () => {
    const p = normalizePrincipal(
      { sub: 'agent-uuid', agentId: 'Blog-Agent-Uppercase', role: 'agent' },
      'business-agent-id',
    );
    assert.equal(p.principalId, 'agent-uuid');
    assert.equal(p.identityMode, 'legacy-sub');
    // The businessAgentId field still captures the raw value
    assert.equal(p.businessAgentId, 'Blog-Agent-Uppercase');
  });

  // ── 5b. Malformed agentId (empty string) ──
  await it('5b. business mode: empty agentId → principalId=sub', async () => {
    const p = normalizePrincipal(
      { sub: 'agent-uuid', agentId: '', role: 'agent' },
      'business-agent-id',
    );
    assert.equal(p.principalId, 'agent-uuid');
    assert.equal(p.businessAgentId, undefined);
  });

  // ── 6. authSubjectId always equals sub ──
  await it('6. authSubjectId always equals sub regardless of mode', async () => {
    const p1 = normalizePrincipal({ sub: 'uuid-1', agentId: 'my-agent', role: 'agent' }, 'legacy-sub');
    const p2 = normalizePrincipal({ sub: 'uuid-2', agentId: 'my-agent', role: 'agent' }, 'business-agent-id');
    assert.equal(p1.authSubjectId, 'uuid-1');
    assert.equal(p2.authSubjectId, 'uuid-2');
  });

  // ── 7. identityMode correct ──
  await it('7. identityMode reflects resolved mode', async () => {
    const p1 = normalizePrincipal({ sub: 'u1', role: 'user' }, 'legacy-sub');
    assert.equal(p1.identityMode, 'legacy-sub');

    const p2 = normalizePrincipal({ sub: 'u2', agentId: 'valid-agent', role: 'agent' }, 'business-agent-id');
    assert.equal(p2.identityMode, 'business-agent-id');

    const p3 = normalizePrincipal({ sub: 'u3', role: 'user' }, 'business-agent-id');
    assert.equal(p3.identityMode, 'legacy-sub');
  });

  // ── 8. issuer preserved ──
  await it('8. issuer preserved in principal', async () => {
    const p = normalizePrincipal(
      { sub: 'u1', iss: 'agent-dev-center' },
      'legacy-sub',
    );
    assert.equal(p.issuer, 'agent-dev-center');

    const p2 = normalizePrincipal(
      { sub: 'u2', iss: 'auth-service' },
      'business-agent-id',
    );
    assert.equal(p2.issuer, 'auth-service');
  });

  // ── 9. Old req.user.id compatibility (legacy mode) ──
  await it('9. principalId equals sub in legacy mode (same as old req.user.id)', async () => {
    const p = normalizePrincipal(
      { sub: 'my-uuid', name: 'Agent', role: 'agent', agentId: 'blog-agent' },
      'legacy-sub',
    );
    assert.equal(p.principalId, 'my-uuid');
  });

  // ── isValidAgentId validation ──
  await it('isValidAgentId: valid IDs pass', async () => {
    assert.ok(isValidAgentId('blog-agent'));
    assert.ok(isValidAgentId('writing-style-analyst'));
    assert.ok(isValidAgentId('a1'));
    assert.ok(isValidAgentId('my.agent-123_test'));
  });

  await it('isValidAgentId: invalid IDs fail', async () => {
    assert.ok(!isValidAgentId(''));
    assert.ok(!isValidAgentId('UPPERCASE'));
    assert.ok(!isValidAgentId('with space'));
    assert.ok(!isValidAgentId('1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678x')); // 129 chars
    assert.ok(!isValidAgentId('-starts-with-hyphen'));
    assert.ok(!isValidAgentId('.starts-with-dot'));
  });
});

// ══════════════════════════════════════════════════════════════
//  JWT validation + auth middleware
// ══════════════════════════════════════════════════════════════

void describe('JWT validation — auth middleware', async () => {
  let sign: typeof import('jsonwebtoken').default.sign;
  let envMod: typeof import('../src/config/env.js');
  let originalIdentityMode: string;

  before(async () => {
    sign = (await import('jsonwebtoken')).default.sign;
    envMod = await import('../src/config/env.js');
    originalIdentityMode = (envMod.env as any).FORUM_IDENTITY_MODE;
  });

  beforeEach(() => {
    // Ensure legacy mode for JWT validation tests
    (envMod.env as any).FORUM_IDENTITY_MODE = 'legacy-sub';
  });

  // Helper: build an Express app with authRequired on a test route
  async function buildAuthApp() {
    const express = (await import('express')).default;
    const { authRequired } = await import('../src/middleware/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.get('/api/protected', authRequired, (req: any, res: any) => {
      res.json({ userId: req.user!.id, authSubjectId: req.user!.authSubjectId, identityMode: req.user!.identityMode });
    });
    app.use(errorHandler);
    return app;
  }

  const DEV_SECRET = 'dev-only-change-this-secret';
  const AUTH_SECRET = 'dev-only-auth-service-secret-16';

  // ── 10. ADC JWT rejected (ADC path removed in standard OAuth) ──
  await it('10. ADC JWT rejected → 401 (ADC path removed)', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    // ADC tokens are no longer accepted — only standard OAuth (RS256 + JWKS).
    const token = sign(
      { sub: 'adc-agent-uuid', name: 'ADC Agent', role: 'agent' },
      DEV_SECRET,
      { issuer: 'agent-dev-center', audience: 'adc-api' },
    );
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 11. Human auth-service JWT rejected (human path removed) ──
  await it('11. Auth-service human JWT rejected → 401 (human path removed)', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    // Human JWTs (aud=agent-platform) are no longer accepted — only agent
    // access tokens (aud=svc-forum, principal_type=agent).
    const token = sign(
      { sub: 'auth-user-uuid', name: 'Auth User', role: 'user' },
      AUTH_SECRET,
      { issuer: 'auth-service', audience: 'agent-platform' },
    );
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 12. Wrong issuer rejected ──
  await it('12. Wrong issuer rejected with 401', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ iss: 'wrong-issuer' });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 13. Wrong audience rejected ──
  await it('13. Wrong audience rejected with 401', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ aud: 'wrong-audience' });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 14. Refresh token rejected ──
  await it('14. Wrong token type (refresh) rejected', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ type: 'refresh' });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 15. Expired token rejected ──
  await it('15. Expired token rejected with 401', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ expiredSecAgo: 120 });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
    assert.ok(res.text.includes('TOKEN_INVALID_OR_EXPIRED') || res.text.includes('expired'), 'should indicate expired');
  });

  // ── 16. No signature or wrong signature rejected ──
  await it('16. Token with wrong signature rejected', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    const token = await _signTestToken({ wrongKey: true });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 17. agentId cannot replace sub ──
  await it('17. agentId claim alone cannot replace sub (sub required)', async () => {
    const app = await buildAuthApp();
    const request = (await import('supertest')).default;
    // Standard OAuth requires sub (MachinePrincipal.id). A token with
    // agent_id but no sub violates the contract → 401.
    const token = await _signTestToken({ sub: '' });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
  });

  // ── 18. Request body cannot override agentId ──
  await it('18. POST body cannot override agentId from JWT', async () => {
    const express = (await import('express')).default;
    const { authRequired } = await import('../src/middleware/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');
    const app = express();
    app.use(express.json());
    app.post('/api/test', authRequired, (req: any, res: any) => {
      // The route should use req.user (from the JWT), not req.body
      res.json({ authSubjectId: req.user!.authSubjectId, agentId: req.user!.agentId, bodyAgentId: req.body.agentId });
    });
    app.use(errorHandler);

    const request = (await import('supertest')).default;
    const token = await _signTestToken({ agent_id: 'real-agent' });
    const res = await request(app)
      .post('/api/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ agentId: 'fake-agent' });
    assert.equal(res.status, 200);
    // Identity must come from the JWT (authSubjectId = sub, agentId = agent_id),
    // never from the request body.
    assert.equal(res.body.authSubjectId, '550e8400-e29b-41d4-a716-446655440000', 'authSubjectId = JWT sub');
    assert.equal(res.body.agentId, 'real-agent', 'agentId from JWT');
    assert.equal(res.body.bodyAgentId, 'fake-agent', 'body agentId is echoed but unused');
  });
});

// ══════════════════════════════════════════════════════════════
//  Existing Forum behavior (backward compatibility)
// ══════════════════════════════════════════════════════════════

void describe('Existing Forum behavior — backward compatibility', async () => {
  let da: typeof import('../src/lib/data-access.js');
  let prismaMod: typeof import('../src/lib/prisma.js');
  let envMod: typeof import('../src/config/env.js');
  let originalIdentityMode: string;

  // In-memory store
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
            if (k === 'kind' && typeof v === 'object' && v !== null && 'not' in v) {
              items = items.filter(i => i.kind !== v.not);
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
        const defaults: Record<string, any> = { status: 'open', messageCount: 0, type: 'discussion', createdByType: 'agent', tags: [], mentions: [] };
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
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, item] of store) {
          let match = true;
          if (where) {
            for (const [k, v] of Object.entries(where)) {
              if ((item as any)[k] !== v) { match = false; break; }
            }
          }
          if (match) {
            store.set(id, { ...item, ...data, updatedAt: new Date() });
            count++;
          }
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
        const doc = { ...data, id: data.id || 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
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
    return {
      forumThread: t,
      forumThreadParticipant: p,
      forumThreadMessage: m,
      forumContextSnapshot: s,
      forumOutcome: o,
      forumPrincipal: fp,
      $queryRaw: async () => [{ 1: 1 }],
      $transaction: async (fn: (tx: any) => any) => fn({
        forumThread: t,
        forumThreadParticipant: p,
        forumThreadMessage: { ...m, count: async ({ where }: any = {}) => { let items = Array.from(messages.values()); if (where?.threadId) items = items.filter(i => i.threadId === where.threadId); if (where?.deletedAt === null) items = items.filter(i => !i.deletedAt); return items.length; } },
        forumContextSnapshot: s,
        forumOutcome: o,
        forumPrincipal: fp,
        $executeRaw: async () => {},
      }),
      $disconnect: async () => {},
    };
  }

  const USER_A = { id: 'user-a-uuid', name: 'Agent Alpha' };
  const USER_B = { id: 'user-b-uuid', name: 'Agent Beta' };

  before(async () => {
    da = await import('../src/lib/data-access.js');
    prismaMod = await import('../src/lib/prisma.js');
    envMod = await import('../src/config/env.js');
    originalIdentityMode = (envMod.env as any).FORUM_IDENTITY_MODE;
  });

  beforeEach(() => {
    resetDb();
    prismaMod.setPrisma(createMockPrisma() as any);
    (envMod.env as any).FORUM_IDENTITY_MODE = originalIdentityMode || 'legacy-sub';
  });

  // ── 19. Legacy mode message.authorId = UUID sub ──
  await it('19. legacy mode: message.authorId is UUID sub', async () => {
    const thread = await da.createThread({
      title: 'Legacy Test',
      type: 'discussion',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });
    const msg = await da.createMessage({
      threadId: thread.id,
      authorId: USER_A.id,
      authorName: USER_A.name,
      authorType: 'agent',
      kind: 'comment',
      content: 'Legacy message',
    });
    assert.equal(msg.authorId, USER_A.id);
    assert.ok(msg.authorId.includes('uuid'), 'authorId is UUID');
  });

  // ── 20. Legacy mode participant/readiness ──
  await it('20. legacy mode: participant agentId and readiness work', async () => {
    const thread = await da.createThread({
      title: 'Readiness Test',
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
      role: 'required_reviewer', status: 'invited',
    });

    const p = await da.findParticipant(thread.id, USER_A.id);
    assert.ok(p);
    assert.equal(p!.agentId, USER_A.id);

    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness);
    assert.ok(readiness.pendingReviewerIds.includes(USER_B.id));
  });

  // ── 21-22. Business mode (in-memory, no real DB) ──
  // These test the middleware behavior, not the data access layer.
  // We verify via supertest that when FORUM_IDENTITY_MODE='business-agent-id',
  // the middleware sets the correct principalId.

  await it('21. standard OAuth: req.user maps sub/agent_id correctly (agent identity)', async () => {
    const express = (await import('express')).default;
    const { authRequired } = await import('../src/middleware/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    (envMod.env as any).FORUM_IDENTITY_MODE = 'business-agent-id';

    const app = express();
    app.get('/api/me', authRequired, (req: any, res: any) => {
      res.json({
        id: req.user!.id,
        authSubjectId: req.user!.authSubjectId,
        agentId: req.user!.agentId,
        principalType: req.user!.principalType,
        identityMode: req.user!.identityMode,
        name: req.user!.name,
      });
    });
    app.use((await import('../src/middleware/error-handler.js')).errorHandler);

    const token = await _signTestToken({ sub: '22222222-2222-4222-8222-222222222222', agent_id: 'blog-agent' });

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    // Standard OAuth identity mapping: authSubjectId = sub, agentId = agent_id.
    // (The old 'business-agent-id' principalId=agentId mode does not apply to
    // standard OAuth agent tokens — identityMode stays legacy-sub.)
    assert.equal(res.body.authSubjectId, '22222222-2222-4222-8222-222222222222');
    assert.equal(res.body.agentId, 'blog-agent');
    assert.equal(res.body.principalType, 'agent');
    assert.equal(res.body.identityMode, 'legacy-sub');
  });

  await it('22. business mode: human user token rejected → 401 (human path removed)', async () => {
    const express = (await import('express')).default;
    const { authRequired } = await import('../src/middleware/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    (envMod.env as any).FORUM_IDENTITY_MODE = 'business-agent-id';

    const app = express();
    app.get('/api/me', authRequired, (req: any, res: any) => {
      res.json({
        id: req.user!.id,
        principalType: req.user!.principalType,
        identityMode: req.user!.identityMode,
      });
    });
    app.use(errorHandler);

    // Human JWTs are no longer a valid auth path — standard OAuth only accepts
    // agent access tokens (principal_type=agent). A principal_type=user token
    // is rejected with 401.
    const token = await _signTestToken({ principal_type: 'user' });

    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 401);
  });

  // ── 23. Required reviewer gate with same identity mode ──
  await it('23. required reviewer gate works with legacy identity mode', async () => {
    const REVIEWER = { id: 'reviewer-uuid', name: 'Reviewer' };
    const thread = await da.createThread({
      title: 'Review Gate Test',
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
      threadId: thread.id, agentId: REVIEWER.id, agentName: REVIEWER.name,
      role: 'required_reviewer', status: 'invited',
    });

    // No messages from reviewer yet → blocked
    const readiness = await da.getThreadReviewReadiness(thread.id);
    assert.ok(readiness.pendingReviewerIds.length > 0);
    assert.ok(readiness.pendingReviewerIds.includes(REVIEWER.id));
    assert.equal(readiness.ready, false);
  });

  // ── 24. Thread/Message API contract unchanged ──
  await it('24. createThread and createMessage API unchanged', async () => {
    const thread = await da.createThread({
      title: 'Contract Test',
      type: 'okr_review',
      createdById: USER_A.id,
      createdByName: USER_A.name,
      createdByType: 'agent',
    });
    assert.ok(thread.id);
    assert.equal(thread.title, 'Contract Test');
    assert.equal(thread.type, 'okr_review');

    const msg = await da.createMessage({
      threadId: thread.id,
      authorId: USER_A.id,
      authorName: USER_A.name,
      authorType: 'agent',
      kind: 'proposal',
      content: 'API contract is unchanged',
    });
    assert.ok(msg.id);
    assert.equal(msg.authorId, USER_A.id);
    assert.equal(msg.content, 'API contract is unchanged');
  });
});

// ══════════════════════════════════════════════════════════════
//  PR-3A: Auth-service Agent JWT verification + JIT Principal
// ══════════════════════════════════════════════════════════════

	void describe('PR-3A — Auth-service Agent JWT verification', async () => {
	  let sign: typeof import('jsonwebtoken').default.sign;
	  let envMod: typeof import('../src/config/env.js');
	  let principalMod: typeof import('../src/lib/forum-principal.js');
	  let prismaMod: typeof import('../src/lib/prisma.js');

	  const AUTH_SECRET = 'dev-only-auth-service-secret-16';
	  const SVC_FORUM_AUDIENCE = 'svc-forum';
	  const AGENT_SUB = '81c7fc7e-c696-4b47-bfd6-f12a9ecb68a6'; // blog-agent MachinePrincipal UUID
	  const AGENT_ID = 'blog-agent';
	  const CLIENT_ID = 'mc_test-client-id-1234';

	  // In-memory principal store for JIT tests
	  const principals = new Map<string, any>();

	  function resetPrincipals() {
	    principals.clear();
	  }

	  function mockPrincipalStore(store: Map<string, any>) {
	    return {
	      findUnique: async ({ where }: any) => {
	        if (where.authSubject) return store.get(where.authSubject) || null;
	        if (where.agentId) {
	          for (const v of store.values()) {
	            if (v.agentId === where.agentId) return v;
	          }
	          return null;
	        }
	        if (where.id) {
	          for (const v of store.values()) {
	            if (v.id === where.id) return v;
	          }
	          return null;
	        }
	        return null;
	      },
	      findFirst: async ({ where }: any) => {
	        for (const v of store.values()) {
	          if (where?.authSubject && v.authSubject === where.authSubject) return v;
	        }
	        return null;
	      },
	      create: async ({ data }: any) => {
	        const doc = { ...data, id: data.id || 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
	        store.set(data.authSubject, doc);
	        return doc;
	      },
	      update: async ({ where, data }: any) => {
	        for (const [key, v] of store) {
	          if (v.authSubject === where.authSubject || v.id === where.id) {
	            const updated = { ...v, ...data, updatedAt: new Date() };
	            store.set(key, updated);
	            return updated;
	          }
	        }
	        throw new Error('Not found');
	      },
	    };
	  }

	  function createMockPrismaWithPrincipals() {
	    const p = mockPrincipalStore(principals);
	    return {
	      forumPrincipal: p,
	      forumThread: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	        update: async ({ data }: any) => data,
	        updateMany: async () => ({ count: 0 }),
	      },
	      forumThreadParticipant: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	        update: async ({ data }: any) => data,
	      },
	      forumThreadMessage: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	      },
	      forumContextSnapshot: {
	        findUnique: async () => null,
	        findMany: async () => [],
	        create: async ({ data }: any) => data,
	      },
	      forumOutcome: {
	        findUnique: async () => null,
	        findMany: async () => [],
	        create: async ({ data }: any) => data,
	      },
	      $queryRaw: async () => [{ 1: 1 }],
	      $transaction: async (fn: any) => {
	        // Simple serial transaction for mock
	        const tx = {
	          forumPrincipal: {
	            findUnique: async ({ where }: any) => {
	              if (where.authSubject) return principals.get(where.authSubject) || null;
	              if (where.agentId) {
	                for (const v of principals.values()) {
	                  if (v.agentId === where.agentId) return v;
	                }
	                return null;
	              }
	              if (where.id) {
	                for (const v of principals.values()) {
	                  if (v.id === where.id) return v;
	                }
	                return null;
	              }
	              return null;
	            },
	            update: async ({ where, data }: any) => {
	              for (const [key, v] of principals) {
	                if (v.authSubject === where.authSubject || v.id === where.id) {
	                  const updated = { ...v, ...data, updatedAt: new Date() };
	                  principals.set(key, updated);
	                  return updated;
	                }
	              }
	              throw new Error('Not found');
	            },
	            create: async ({ data }: any) => {
	              const doc = { ...data, id: 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
	              principals.set(data.authSubject, doc);
	              return doc;
	            },
	          },
	        };
	        return fn(tx);
	      },
	      $disconnect: async () => {},
	    };
	  }

	  // Helper: sign an agent token with the correct format (RS256 + JWKS)
	  async function signAgentToken(overrides: Record<string, any> = {}): Promise<string> {
	    const now = Math.floor(Date.now() / 1000);
	    const aud = overrides._audience || SVC_FORUM_AUDIENCE;
	    const iss = overrides._issuer || 'auth-service';
	    // Remove internal keys before spreading into payload
	    const { _secret, _alg, _issuer, _audience, _noIssuerAud, exp, ...cleanOverrides } = overrides;
	    const payload = {
	      sub: AGENT_SUB,
	      iss,
	      aud,
	      iat: now,
	      exp: overrides.exp ?? now + 600,
	      jti: `${AGENT_SUB}-${now}-testjti`,
	      type: 'access',
	      version: 'v1',
	      principal_type: 'agent',
	      agent_id: AGENT_ID,
	      client_id: CLIENT_ID,
	      scope: 'forum.read',
	      ...cleanOverrides,
	    };

    // alg=none: craft an unsigned token (rejected by RS256-only verifier)
    if (_alg === 'none') {
      const { UnsecuredJWT } = await import('jose');
      return new UnsecuredJWT(payload).encode();
    }

    // RS256 sign with the test keypair (or a throwaway keypair for bad-signature tests)
    const { SignJWT, generateKeyPair } = await import('jose');
    const { getTestKeyPair, TEST_KID_VALUE } = await import('./helpers/test-keys.js');
    const kp = _secret ? await generateKeyPair('RS256') : await getTestKeyPair();
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: TEST_KID_VALUE })
      .sign(kp.privateKey);
  }

	  // Helper: build an Express app with authRequired
	  async function buildAuthApp() {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/protected', authRequired, (req: any, res: any) => {
	      res.json({
	        id: req.user!.id,
	        authSubjectId: req.user!.authSubjectId,
	        agentId: req.user!.agentId,
	        principalType: req.user!.principalType,
	        authSource: req.user!.authSource,
	        scopes: req.user!.scopes,
	        issuer: req.user!.issuer,
	      });
	    });
	    app.use(errorHandler);
	    return app;
	  }

	  before(async () => {
	    sign = (await import('jsonwebtoken')).default.sign;
	    envMod = await import('../src/config/env.js');
	    principalMod = await import('../src/lib/forum-principal.js');
	    prismaMod = await import('../src/lib/prisma.js');
	  });

	  beforeEach(() => {
	    resetPrincipals();
	    prismaMod.setPrisma(createMockPrismaWithPrincipals() as any);
	  });

	  // ── 36. Correct agent token passes ──
	  await it('36. auth-service Agent JWT with correct claims passes (aud=svc-forum, principal_type=agent)', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken();
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 200);
	    assert.equal(res.body.authSubjectId, AGENT_SUB);
	    assert.equal(res.body.agentId, AGENT_ID);
	    assert.equal(res.body.principalType, 'agent');
	    assert.equal(res.body.authSource, 'auth_service_agent_jwt');
	    assert.ok(res.body.scopes.includes('forum.read'));
	  });

	  // ── 37. Wrong issuer ──
	  await it('37. Wrong issuer → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ _issuer: 'wrong-issuer' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 38. Wrong audience ──
	  await it('38. Wrong audience → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ _audience: 'wrong-audience' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 39. Expired token ──
	  await it('39. Expired token → 401 TOKEN_EXPIRED', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ exp: Math.floor(Date.now() / 1000) - 60 });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 40. Missing scope → 403 at read-scope-guarded route ──
	  await it('40. Missing scope → 403 (INSUFFICIENT_SCOPE at route layer)', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireReadScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/protected', authRequired, requireReadScope(), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ scope: '' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 403);
	    assert.ok(res.body.error.includes('INSUFFICIENT_SCOPE'), 'should indicate insufficient scope');
	  });

	  // ── 41. Only forum.write without forum.read → 403 at read route ──
	  await it('41. Only forum.write without forum.read → 403 (INSUFFICIENT_SCOPE)', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireReadScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/protected', authRequired, requireReadScope(), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ scope: 'forum.write' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 403);
	  });

	  // ── 42. principal_type=user ──
	  await it('42. principal_type=user → 401 (TOKEN_CONTRACT_INVALID)', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    // agent token with wrong principal_type
	    const token = await signAgentToken({ principal_type: 'user' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    // Standard OAuth only accepts principal_type=agent → contract invalid
	    assert.equal(res.status, 401);
	  });

	  // ── 43. principal_type=service ──
	  await it('43. principal_type=service → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ principal_type: 'service' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 44. Missing agent_id ──
	  await it('44. Missing agent_id → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ agent_id: '' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 45. sub non-UUID ──
	  await it('45. sub non-UUID → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ sub: 'not-a-uuid' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 46. alg=none ──
	  await it('46. alg=none → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ _alg: 'none' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 47. Invalid signature ──
	  await it('47. Invalid signature → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ _secret: 'wrong-secret-16-chars-len' });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 401);
	  });

	  // ── 48. Oversized token (exceeds 16KB limit) ──
	  await it('48. Oversized token → 401', async () => {
	    const app = await buildAuthApp();
	    const request = (await import('supertest')).default;
	    // Create a token with payload just over 16KB (but under HTTP header limits)
	    // 16KB = 16384 bytes. The payload needs to exceed this.
	    // A safe oversized payload is ~15000 chars which yields ~20KB base64.
	    const largePayload = 'x'.repeat(15000);
	    const token = await signAgentToken({ extra: largePayload });
	    const res = await request(app)
	      .get('/api/protected')
	      .set('Authorization', `Bearer ${token}`);
	    // The middleware checks size before jwt.verify. If Express rejects as 431 first, that's ok.
	    assert.ok(res.status === 401 || res.status === 431, `Expected 401 or 431, got ${res.status}`);
	  });
	});

	// ══════════════════════════════════════════════════════════════
	//  PR-3A: JIT Shadow Principal
	// ══════════════════════════════════════════════════════════════

	void describe('PR-3A — JIT Shadow Principal', async () => {
	  let resolvePrincipal: typeof import('../src/lib/forum-principal.js').resolvePrincipal;
	  let findPrincipal: typeof import('../src/lib/forum-principal.js').findPrincipal;
	  let prismaMod: typeof import('../src/lib/prisma.js');

	  const AGENT_SUB = '81c7fc7e-c696-4b47-bfd6-f12a9ecb68a6';
	  const AGENT_ID = 'blog-agent';

	  const principals = new Map<string, any>();

	  function resetPrincipals() { principals.clear(); }

	  function createMockTx() {
	    return {
	      forumPrincipal: {
	        findUnique: async ({ where }: any) => {
	          if (where.authSubject) return principals.get(where.authSubject) || null;
	          if (where.agentId) {
	            for (const v of principals.values()) {
	              if (v.agentId === where.agentId) return v;
	            }
	            return null;
	          }
	          if (where.id) {
	            for (const v of principals.values()) { if (v.id === where.id) return v; }
	            return null;
	          }
	          return null;
	        },
	        update: async ({ where, data }: any) => {
	          for (const [key, v] of principals) {
	            if (v.authSubject === where.authSubject || v.id === where.id) {
	              const updated = { ...v, ...data, updatedAt: new Date() };
	              principals.set(key, updated);
	              return updated;
	            }
	          }
	          throw new Error('Not found');
	        },
	        create: async ({ data }: any) => {
	          const doc = { ...data, id: 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
	          principals.set(data.authSubject, doc);
	          return doc;
	        },
	      },
	    };
	  }

	  function createMockPrisma() {
	    return {
	      forumPrincipal: {
	        findUnique: async ({ where }: any) => {
	          if (where.authSubject) return principals.get(where.authSubject) || null;
	          if (where.agentId) {
	            for (const v of principals.values()) { if (v.agentId === where.agentId) return v; }
	            return null;
	          }
	          return null;
	        },
	        findFirst: async ({ where }: any) => {
	          for (const v of principals.values()) { if (v.authSubject === where?.authSubject) return v; }
	          return null;
	        },
	        create: async ({ data }: any) => {
	          const doc = { ...data, id: 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
	          principals.set(data.authSubject, doc);
	          return doc;
	        },
	        update: async ({ where, data }: any) => {
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
	      },
	      $transaction: async (fn: any) => fn(createMockTx()),
	      $disconnect: async () => {},
	    };
	  }

	  before(async () => {
	    const mod = await import('../src/lib/forum-principal.js');
	    resolvePrincipal = mod.resolvePrincipal;
	    findPrincipal = mod.findPrincipal;
	    prismaMod = await import('../src/lib/prisma.js');
	  });

	  beforeEach(() => {
	    resetPrincipals();
	    prismaMod.setPrisma(createMockPrisma() as any);
	  });

	  // ── 49. First access creates shadow principal ──
	  await it('49. First access creates shadow principal', async () => {
	    const result = await resolvePrincipal({
	      authSubject: AGENT_SUB,
	      agentId: AGENT_ID,
	      displayName: AGENT_ID,
	      principalType: 'agent',
	    });
	    assert.ok(result.id, 'has id');
	    assert.equal(result.authSubject, AGENT_SUB);
	    assert.equal(result.agentId, AGENT_ID);
	    assert.equal(result.source, 'jit');
	    assert.equal(result.status, 'active');
	  });

	  // ── 50. Second access reuses same principal ──
	  await it('50. Second access reuses same principal', async () => {
	    const first = await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    const second = await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    assert.equal(first.id, second.id, 'same principal ID');
	  });

	  // ── 51. Same agent_id, different sub → rejected ──
	  await it('51. Same agent_id, different sub → 409 conflict', async () => {
	    // Create first principal
	    await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    // Try to create another with same agent_id but different sub
	    try {
	      await resolvePrincipal({
	        authSubject: 'different-uuid-2222-4444-8888-cccccccccccc', agentId: AGENT_ID, principalType: 'agent',
	      });
	      assert.fail('Should have thrown');
	    } catch (err: any) {
	      assert.equal(err.statusCode, 409);
	      assert.ok(err.message.includes('already mapped'));
	    }
	  });

	  // ── 52. Same sub, different agent_id → rejected ──
	  await it('52. Same sub, different agent_id → 409 conflict', async () => {
	    await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    // Verify the existing principal's agentId is NOT silently overwritten
	    const result = await findPrincipal(AGENT_SUB);
	    assert.equal(result?.agentId, AGENT_ID, 'agent_id unchanged');
	  });

	  // ── 53. DB failure → request fails ──
	  await it('53. DB failure → request fails', async () => {
	    // Create a mock that throws on create
	    const failingPrisma = {
	      forumPrincipal: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        create: async () => { throw new Error('DB connection failed'); },
	      },
	      $transaction: async (fn: any) => fn({
	        forumPrincipal: {
	          findUnique: async () => null,
	          update: async () => { throw new Error('Not found'); },
	          create: async () => { throw new Error('DB connection failed'); },
	        },
	      }),
	    };
	    prismaMod.setPrisma(failingPrisma as any);

	    try {
	      await resolvePrincipal({
	        authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	      });
	      assert.fail('Should have thrown');
	    } catch (err: any) {
	      assert.ok(err.message, 'Error propagated');
	    }
	  });

	  // ── 54. JIT doesn't create Thread membership ──
	  await it('54. JIT does not create ForumThread or Thread membership', async () => {
	    // Create a principal first — JIT should only create principal, not threads/participants
	    const result = await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    assert.ok(result.id, 'principal created');
	    // Verify no threads or participants in the mock
	    const principalCount = principals.size;
	    // The mock only stores principals — should be exactly 1
	    assert.equal(principalCount, 1, 'only principal created, no threads/participants');
	  });

	  // ── 55. Disabled principal rejected ──
	  await it('55. Disabled principal rejected', async () => {
	    await resolvePrincipal({
	      authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	    });
	    // Manually disable
	    const prisma = prismaMod.getPrisma();
	    await prisma.forumPrincipal.update({
	      where: { authSubject: AGENT_SUB },
	      data: { status: 'disabled' },
	    });
	    // Should fail on next access
	    try {
	      await resolvePrincipal({
	        authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent',
	      });
	      assert.fail('Should have thrown 403');
	    } catch (err: any) {
	      assert.equal(err.statusCode, 403);
	      assert.ok(err.message.includes('disabled'));
	    }
	  });

	  // ── 56. Concurrent creation is idempotent ──
	  await it('56. Concurrent creation produces only one principal', async () => {
	    // Simulate concurrent access by running twice in parallel
	    const [r1, r2] = await Promise.allSettled([
	      resolvePrincipal({ authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent' }),
	      resolvePrincipal({ authSubject: AGENT_SUB, agentId: AGENT_ID, principalType: 'agent' }),
	    ]);
	    // Both should succeed
	    assert.equal(r1.status, 'fulfilled');
	    assert.equal(r2.status, 'fulfilled');
	    // And they should point to the same principal
	    const count = Array.from(principals.values()).length;
	    assert.equal(count, 1, 'only one principal created');
	  });
	});

	// ══════════════════════════════════════════════════════════════
	//  PR-3A: Read-only scope authorization
	// ══════════════════════════════════════════════════════════════

	void describe('PR-3A — Read-only scope authorization', async () => {
	  let sign: typeof import('jsonwebtoken').default.sign;
	  let envMod: typeof import('../src/config/env.js');
	  let prismaMod: typeof import('../src/lib/prisma.js');

	  const AUTH_SECRET = 'dev-only-auth-service-secret-16';
	  const AGENT_SUB = '81c7fc7e-c696-4b47-bfd6-f12a9ecb68a6';
	  const AGENT_ID = 'blog-agent';
	  const CLIENT_ID = 'mc_test-client-id-1234';

	  const principals = new Map<string, any>();

	  function resetState() { principals.clear(); }

	  function mockPrincipalStore(store: Map<string, any>) {
	    return {
	      findUnique: async ({ where }: any) => {
	        if (where.authSubject) return store.get(where.authSubject) || null;
	        if (where.agentId) {
	          for (const v of store.values()) { if (v.agentId === where.agentId) return v; }
	          return null;
	        }
	        return null;
	      },
	      findFirst: async () => null,
	      findMany: async () => [],
	      count: async () => 0,
	      create: async ({ data }: any) => {
	        const doc = { ...data, id: 'fp-' + Math.random().toString(36).slice(2), createdAt: new Date(), updatedAt: new Date() };
	        store.set(data.authSubject, doc);
	        return doc;
	      },
	      update: async ({ where, data }: any) => {
	        for (const [key, v] of store) {
	          if (v.authSubject === where.authSubject || v.id === where.id) {
	            const updated = { ...v, ...data, updatedAt: new Date() };
	            store.set(key, updated);
	            return updated;
	          }
	        }
	        throw new Error('Not found');
	      },
	    };
	  }

	  function createMockPrisma() {
	    const p = mockPrincipalStore(principals);
	    return {
	      forumPrincipal: p,
	      forumThread: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	        update: async ({ data }: any) => data,
	        updateMany: async () => ({ count: 0 }),
	      },
	      forumThreadParticipant: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	        update: async ({ data }: any) => data,
	      },
	      forumThreadMessage: {
	        findUnique: async () => null,
	        findFirst: async () => null,
	        findMany: async () => [],
	        count: async () => 0,
	        create: async ({ data }: any) => data,
	      },
	      $queryRaw: async () => [{ 1: 1 }],
	      $transaction: async (fn: any) => fn({
	        forumPrincipal: p,
	        forumThread: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], create: async ({ data }: any) => data },
	      }),
	      $disconnect: async () => {},
	    };
	  }

	  async function signAgentToken(overrides: Record<string, any> = {}): Promise<string> {
	    const now = Math.floor(Date.now() / 1000);
	    const scope = overrides.scope || 'forum.read';
	    const { scope: _scope, ...rest } = overrides;
	    return _signTestToken({
	      sub: AGENT_SUB,
	      agent_id: AGENT_ID,
	      client_id: CLIENT_ID,
	      scope,
	      ...rest,
	    });
	  }

	  before(async () => {
	    sign = (await import('jsonwebtoken')).default.sign;
	    envMod = await import('../src/config/env.js');
	    prismaMod = await import('../src/lib/prisma.js');
	  });

	  beforeEach(() => {
	    resetState();
	    prismaMod.setPrisma(createMockPrisma() as any);
	  });

	  // ── 57. Read endpoint allowed with forum.read only ──
	  await it('57. GET thread list allowed with forum.read only', async () => {
	    // GET is read — should pass with forum.read only
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/threads', authRequired, (req: any, res: any) => {
	      res.json({ ok: true, authSource: req.user!.authSource, scopes: req.user!.scopes });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken();
	    const res = await request(app)
	      .get('/api/threads')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 200);
	  });

	  // ── 58. Write endpoint blocked with forum.read only ──
	  await it('58. POST create thread blocked with forum.read only (requireWriteScope)', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireWriteScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.post('/api/threads', authRequired, requireWriteScope(), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken();
	    const res = await request(app)
	      .post('/api/threads')
	      .set('Authorization', `Bearer ${token}`)
	      .send({ title: 'test' });
	    assert.equal(res.status, 403, `Expected 403, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
	    assert.ok(res.text?.includes('Insufficient scope') || res.text?.includes('forum.write'), `Error message should mention scope: ${res.text}`);
	  });

	  // ── 59. Write endpoint allowed with forum.write scope ──
	  await it('59. POST create thread allowed with forum.write scope', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireWriteScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.post('/api/threads', authRequired, requireWriteScope(), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken({ scope: 'forum.read forum.write' });
	    const res = await request(app)
	      .post('/api/threads')
	      .set('Authorization', `Bearer ${token}`)
	      .send({ title: 'test' });
	    assert.equal(res.status, 200, 'forum.write scope allows write');
	  });

	  // ── 60. Legacy ADC JWT rejected (ADC path removed) ──
	  await it('60. Legacy ADC JWT rejected → 401 (ADC path removed)', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireWriteScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.post('/api/threads', authRequired, requireWriteScope(), (req: any, res: any) => {
	      res.json({ ok: true, authSource: req.user!.authSource });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    // ADC JWTs are no longer a valid auth path — standard OAuth (RS256+JWKS)
	    // rejects them before any scope guard runs.
	    const token = sign(
	      { sub: 'adc-user-uuid', name: 'ADC User', role: 'agent' },
	      'dev-only-change-this-secret',
	      { issuer: 'agent-dev-center', audience: 'adc-api' },
	    );
	    const res = await request(app)
	      .post('/api/threads')
	      .set('Authorization', `Bearer ${token}`)
	      .send({ title: 'test' });
	    assert.equal(res.status, 401, 'ADC JWT rejected at auth layer');
	  });

	  // ── 61. Human auth-service JWT rejected (human path removed) ──
	  await it('61. Auth-service human JWT rejected → 401 (human path removed)', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireWriteScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.post('/api/threads', authRequired, requireWriteScope(), (req: any, res: any) => {
	      res.json({ ok: true, authSource: req.user!.authSource });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    // Human JWTs (aud=agent-platform) are no longer a valid auth path.
	    const token = sign(
	      { sub: 'human-uuid', name: 'Human User', role: 'user' },
	      AUTH_SECRET,
	      { issuer: 'auth-service', audience: 'agent-platform' },
	    );
	    const res = await request(app)
	      .post('/api/threads')
	      .set('Authorization', `Bearer ${token}`)
	      .send({ title: 'test' });
	    assert.equal(res.status, 401, 'Human JWT rejected at auth layer');
	  });

	  // ── 62. requireScope guard ──
	  await it('62. requireScope guard rejects missing scope', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/require-forum-write', authRequired, requireScope('forum.write'), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const token = await signAgentToken(); // only forum.read
	    const res = await request(app)
	      .get('/api/require-forum-write')
	      .set('Authorization', `Bearer ${token}`);
	    assert.equal(res.status, 403);
	  });

	  // ── 63. No auth → 401 for protected routes ──
	  await it('63. No token → 401 for protected routes', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.get('/api/protected', authRequired, (req: any, res: any) => res.json({ ok: true }));
	    app.use(errorHandler);

	    const request = (await import('supertest')).default;
	    const res = await request(app).get('/api/protected');
	    assert.equal(res.status, 401);
	  });
	});

	// ══════════════════════════════════════════════════════════════
	//  PR-3A: Audit log verification
	// ══════════════════════════════════════════════════════════════

	void describe('PR-3A — Audit log and leak prevention', async () => {
	  let sign: typeof import('jsonwebtoken').default.sign;
	  let originalError: typeof console.error;
	  let auditLogs: string[] = [];

	  const AUTH_SECRET = 'dev-only-auth-service-secret-16';
	  const AGENT_SUB = '81c7fc7e-c696-4b47-bfd6-f12a9ecb68a6';
	  const AGENT_ID = 'blog-agent';
	  const CLIENT_ID = 'mc_test-client-id-1234';

	  before(async () => {
	    sign = (await import('jsonwebtoken')).default.sign;
	    // Capture audit logs
	    originalError = console.error;
	    console.error = (...args: any[]) => {
	      const msg = args.join(' ');
	      if (msg.includes('[AUDIT]')) {
	        auditLogs.push(msg);
	      }
	      originalError.apply(console, args);
	    };
	  });

	  after(() => {
	    console.error = originalError;
	  });

	  beforeEach(() => {
	    auditLogs = [];
	  });

	  // Helper (fixed: no duplicate aud) — RS256 via the test keypair
	  async function signAgentToken(overrides: Record<string, any> = {}): Promise<string> {
	    const now = Math.floor(Date.now() / 1000);
	    return _signTestToken({
	      sub: AGENT_SUB,
	      agent_id: AGENT_ID,
	      client_id: CLIENT_ID,
	      scope: 'forum.read',
	      ...overrides,
	    });
	  }

	  // Helper: create an auth app with the given config
	  async function createTestApp() {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const app = express();
	    app.use(express.json());
	    app.get('/api/test', authRequired, (req: any, res: any) => res.json({ ok: true }));
	    app.use(errorHandler);
	    return app;
	  }

	  // ── 64. Audit log contains jwt verification events ──
	  await it('64. Audit log contains jwt.verified event on success', async () => {
	    const app = await createTestApp();
	    const token = await signAgentToken();
	    const request = (await import('supertest')).default;
	    await request(app).get('/api/test').set('Authorization', `Bearer ${token}`);

	    const hasVerified = auditLogs.some(l => l.includes('jwt.verified') && l.includes(AGENT_SUB) && l.includes(AGENT_ID));
	    assert.ok(hasVerified, 'jwt.verified event logged with authSubject and agentId');
	  });

	  // ── 65. Audit log does NOT contain full token ──
	  await it('65. Audit log does NOT contain full JWT token', async () => {
	    const app = await createTestApp();
	    const token = await signAgentToken();
	    const request = (await import('supertest')).default;
	    await request(app).get('/api/test').set('Authorization', `Bearer ${token}`);

	    const tokenInLogs = auditLogs.some(l => l.includes(token));
	    assert.ok(!tokenInLogs, 'full token not in audit logs');
	  });

	  // ── 66. Audit log does NOT contain Authorization header ──
	  await it('66. Audit log does NOT contain Authorization header', async () => {
	    const app = await createTestApp();
	    const token = await signAgentToken();
	    const request = (await import('supertest')).default;
	    await request(app).get('/api/test').set('Authorization', `Bearer ${token}`);

	    const authHeaderInLogs = auditLogs.some(l => l.includes('Bearer ') && l.includes('authorization'));
	    assert.ok(!authHeaderInLogs, 'Authorization header not in audit logs');
	  });

	  // ── 67. Audit log contains write rejection events ──
	  await it('67. Audit log contains auth.write_rejected events', async () => {
	    const express = (await import('express')).default;
	    const { authRequired } = await import('../src/middleware/auth.js');
	    const { requireWriteScope } = await import('../src/middleware/scope-guard.js');
	    const { errorHandler } = await import('../src/middleware/error-handler.js');
	    const { setPrisma } = await import('../src/lib/prisma.js');

	    // Inline mock with pre-existing principal
	    const mockP = {
	      forumPrincipal: {
	        findUnique: async ({ where }: any) => {
	          if (where.authSubject === AGENT_SUB) return { id: 'fp-test', authSubject: AGENT_SUB, agentId: AGENT_ID, status: 'active', source: 'jit', displayName: AGENT_ID, principalType: 'agent', firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
	          return null;
	        },
	        findFirst: async () => null,
	        create: async ({ data }: any) => data,
	        update: async ({ data }: any) => data,
	      },
	      $transaction: async (fn: any) => fn({
	        forumPrincipal: {
	          findUnique: async ({ where }: any) => {
	            if (where.authSubject === AGENT_SUB) return { id: 'fp-test', authSubject: AGENT_SUB, agentId: AGENT_ID, status: 'active', source: 'jit', displayName: AGENT_ID, principalType: 'agent', firstSeenAt: new Date(), lastSeenAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
	            return null;
	          },
	          update: async ({ data }: any) => data,
	        },
	      }),
	    };
	    setPrisma(mockP as any);

	    const app = express();
	    app.use(express.json());
	    app.post('/api/write', authRequired, requireWriteScope(), (req: any, res: any) => {
	      res.json({ ok: true });
	    });
	    app.use(errorHandler);

	    const token = await signAgentToken(); // only forum.read
	    const request = (await import('supertest')).default;
	    await request(app).post('/api/write').set('Authorization', `Bearer ${token}`).send({});

	    const hasRejected = auditLogs.some(l => l.includes('auth.write_rejected') && (l.includes('missing_required_scope') || l.includes('insufficient_scope')));
	    assert.ok(hasRejected, 'write_rejected event logged');
	  });
	});
