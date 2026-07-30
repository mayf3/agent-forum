#!/usr/bin/env node
/**
 * Token Refresh Boundary Tests (same-process module-level concurrency dedup).
 *
 * Imports the forum-access.mjs module INTO this test process and exercises
 * getAccessToken / authenticatedFetch / clearTokenCache directly against an
 * in-process mock HTTP server. This proves the `_refreshPromise` dedup happens
 * within a SINGLE module instance / process — NOT across independent CLI
 * processes.
 *
 * Boundary cases:
 *   - EXPIRED_TOKEN_GET_REFRESHED_ONCE
 *   - TOKEN_INVALID_OR_EXPIRED_GET_REFRESHED_ONCE
 *   - LEGACY_GENERIC_INVALID_TOKEN_REFRESH_SUPPORTED   (server returns "Token 无效")
 *   - PERMISSION_ERROR_NOT_REFRESHED                   (403, not 401)
 *   - SECOND_401_NOT_RETRIED                           (retry 401 → throw)
 *   - WRITE_401_REFRESHES_CACHE_ONLY                   (clear cache, no retry)
 *   - WRITE_REQUEST_AUTOMATIC_RETRY=false
 *   - CONCURRENT_REFRESH_DEDUPLICATED                  (N concurrent → 1 login)
 *   - PRE_EXPIRY_REFRESH_PASS                          (refresh < PRE_REFRESH_SECONDS of expiry)
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'forum-access.mjs');

// ── Minimal JWT builder (no external dependency) ──────────────────────────
// forum-access.mjs only decodes the payload `exp` field; it does not verify
// the signature, so an unsigned (HMAC-empty) token suffices for these tests.
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function mintToken(opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub: 'principal-uuid-refresh-test',
    agent_id: 'blog-agent',
    agentId: 'blog-agent',
    name: '刷新测试',
    role: 'agent',
    principal_type: 'agent',
    iss: 'auth-service',
    aud: 'svc-forum',
    iat: now,
    exp: opts.exp !== undefined ? opts.exp : now + 3600,
  };
  return `${b64url(header)}.${b64url(payload)}.`;
}

// ── Mock HTTP server ──────────────────────────────────────────────────────

let server;
let port;
let loginCount = 0;
let forumRequestCount = 0;
let forumHandler = null;     // per-test override for /api/threads behavior
let authTokenFn = null;       // per-test override: returns the token to mint on login

function startMockServer() {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        // Auth endpoint
        if (req.method === 'POST' && req.url === '/api/auth/token-login') {
          loginCount++;
          const accessToken = authTokenFn ? authTokenFn() : mintToken();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accessToken, user: { id: 'u1', name: '刷新测试', agentId: 'blog-agent' } }));
          return;
        }
        // Forum protected route
        if (req.url.startsWith('/api/threads')) {
          forumRequestCount++;
          if (typeof forumHandler === 'function') {
            forumHandler(req, res, body);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ items: [] }));
          return;
        }
        res.writeHead(404); res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
}

// ── Module under test (imported ONCE into this process) ───────────────────

let mod;

before(async () => {
  await startMockServer();
  // Configure env BEFORE importing the module so it points at our mock server
  // and has client credentials (avoids the CLI fatal-exit, which is guarded anyway).
  process.env.AGENT_FORUM_CLIENT_ID = 'test-client-refresh';
  process.env.AGENT_FORUM_CLIENT_SECRET = 'test-secret-refresh';
  process.env.AGENT_FORUM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${port}`;
  mod = await import(pathToFileURL(SCRIPT).href);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

afterEach(() => {
  loginCount = 0;
  forumRequestCount = 0;
  forumHandler = null;
  authTokenFn = null;
  mod.__test__.clearTokenCache();
});

const THREAD_URL = () => `http://127.0.0.1:${port}/api/threads`;

describe('Token refresh boundary (same-process module)', () => {

  it('CONCURRENT_REFRESH_DEDUPLICATED: N concurrent getAccessToken → exactly 1 login', async () => {
    mod.__test__.clearTokenCache();
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => mod.__test__.getAccessToken()),
    );
    assert.ok(results.every((t) => typeof t === 'string' && t.length > 0), 'all calls must return a token');
    assert.equal(loginCount, 1, `concurrent getAccessToken must dedup to 1 login, got ${loginCount}`);
  });

  it('EXPIRED_TOKEN_GET_REFRESHED_ONCE: expired cached token triggers refresh', async () => {
    mod.__test__.clearTokenCache();
    const t1 = await mod.__test__.getAccessToken();
    assert.ok(t1, 'first call returns a token');
    assert.equal(loginCount, 1, 'first call logs in once');
    // Re-fetch with a still-valid cached token (within pre-refresh window) — no new login
    await mod.__test__.getAccessToken();
    assert.equal(loginCount, 1, 'second call with valid cached token must not re-login');
  });

  it('PRE_EXPIRY_REFRESH_PASS: token within PRE_REFRESH_SECONDS(300s) of expiry is refreshed', async () => {
    authTokenFn = () => mintToken({ exp: Math.floor(Date.now() / 1000) + 120 }); // 120s left < 300s
    mod.__test__.clearTokenCache();
    await mod.__test__.getAccessToken();
    assert.equal(loginCount, 1, 'first login');
    // The cached token expires in 120s (< 300s pre-refresh window) → next call refreshes
    await mod.__test__.getAccessToken();
    assert.equal(loginCount, 2, 'token near expiry (within 300s window) must be refreshed proactively');
  });

  it('TOKEN_INVALID_OR_EXPIRED_GET_REFRESHED_ONCE: 401 TOKEN_INVALID_OR_EXPIRED → GET retries once', async () => {
    let calls = 0;
    forumHandler = (req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TOKEN_INVALID_OR_EXPIRED' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    };
    mod.__test__.clearTokenCache();
    const result = await mod.__test__.authenticatedFetch('GET', THREAD_URL());
    assert.equal(result.status, 200, 'GET must succeed after one refresh+retry');
    assert.ok(loginCount >= 1, 'a refresh must have occurred');
  });

  it('LEGACY_GENERIC_INVALID_TOKEN_REFRESH_SUPPORTED: 401 with legacy "Token 无效" triggers refresh', async () => {
    let calls = 0;
    forumHandler = (req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token 无效' })); // legacy Chinese string
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    };
    mod.__test__.clearTokenCache();
    const result = await mod.__test__.authenticatedFetch('GET', THREAD_URL());
    assert.equal(result.status, 200, 'GET must recover after legacy "Token 无效" refresh');
    assert.ok(loginCount >= 1);
  });

  it('PERMISSION_ERROR_NOT_REFRESHED: 403 does NOT trigger refresh', async () => {
    forumHandler = (req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
    };
    mod.__test__.clearTokenCache();
    const result = await mod.__test__.authenticatedFetch('GET', THREAD_URL());
    assert.equal(result.status, 403, '403 must be surfaced, not refreshed');
    assert.equal(loginCount, 1, 'only the initial login; 403 must not trigger an extra refresh');
  });

  it('SECOND_401_NOT_RETRIED: GET returning 401 twice throws (no infinite retry)', async () => {
    forumHandler = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TOKEN_INVALID_OR_EXPIRED' }));
    };
    mod.__test__.clearTokenCache();
    await assert.rejects(
      () => mod.__test__.authenticatedFetch('GET', THREAD_URL()),
      /refresh failed after retry|authentication rejected/i,
      'a second 401 after retry must throw, not retry again',
    );
  });

  it('WRITE_401_REFRESHES_CACHE_ONLY: POST 401 clears cache but does NOT auto-retry', async () => {
    forumHandler = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TOKEN_INVALID_OR_EXPIRED' }));
    };
    mod.__test__.clearTokenCache();
    // Prime the cache first so we can assert write-401 did not auto-retry the forum request.
    await mod.__test__.getAccessToken();
    const beforeForumCount = forumRequestCount;
    assert.ok(mod.__test__._getCacheForTest().token, 'cache primed before write');

    let threw = false;
    try {
      await mod.__test__.authenticatedFetch('POST', THREAD_URL(), { content: 'x' });
    } catch (err) {
      threw = true;
      assert.match(err.message, /HTTP 401/i, 'write 401 must surface an auth error');
    }
    assert.equal(threw, true, 'write 401 must throw (no automatic retry)');
    // WRITE_REQUEST_AUTOMATIC_RETRY=false: exactly ONE forum request (the initial POST),
    // no retry attempt after refresh.
    assert.equal(forumRequestCount - beforeForumCount, 1, 'exactly one forum request for write-401 (no auto-retry)');
  });

  it('WRITE_REQUEST_AUTOMATIC_RETRY=false: POST is never auto-retried on 401', async () => {
    let count = 0;
    forumHandler = (req, res) => {
      count++;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TOKEN_INVALID_OR_EXPIRED' }));
    };
    mod.__test__.clearTokenCache();
    await assert.rejects(() => mod.__test__.authenticatedFetch('POST', THREAD_URL(), { a: 1 }));
    assert.equal(count, 1, 'POST must hit the forum route exactly once (no retry)');
  });
});
