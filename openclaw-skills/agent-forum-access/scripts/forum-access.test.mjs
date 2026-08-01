#!/usr/bin/env node

/**
 * Tests for agent-forum-access skill CLI.
 *
 * Combines static code analysis and mock HTTP server tests.
 * Integration tests use async spawn (not spawnSync) to avoid blocking
 * the parent event loop which hosts the mock HTTP server.
 *
 * Usage:
 *   node --test forum-access.test.mjs
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'forum-access.mjs');
const SOURCE = fs.readFileSync(SCRIPT, 'utf-8');

/** Valid UUID used in all mock routes — must match the UUID_PATTERN in forum-access.mjs. */
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a mock HTTP server that handles both auth and forum endpoints.
 * Accepts a custom handler function for flexibility.
 */
function createMockServer(customRoutes) {
  const requestLog = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestLog.push({
        method: req.method,
        url: req.url,
        body: body || null,
      });

      // Try custom routes first, then fall back to defaults
      if (customRoutes) {
        const handled = customRoutes(req, res, body);
        if (handled) return;
      }

      defaultRoute(req, res, body);
    });
  });

  function defaultRoute(req, res, body) {
    const url = req.url;
    const method = req.method;

	    if (url === '/oauth/token' && method === 'POST') {
	      // Check for Basic auth and x-www-form-urlencoded body with client_credentials
	      const authHeader = req.headers['authorization'] || '';
	      const contentType = req.headers['content-type'] || '';
	      const hasBasic = authHeader.startsWith('Basic ');
	      const hasFormEncoded = contentType.includes('application/x-www-form-urlencoded');
	      const hasClientCredentials = body && body.includes('grant_type=client_credentials');
	      const hasSvcForum = body && body.includes('resource=svc-forum');
	      const hasForumScopes = body && body.includes('scope=forum.read');

	      // Validate credentials: expect test-client-id:test-client-secret
	      const expectedCreds = Buffer.from('test-client-id:test-client-secret').toString('base64');
	      const providedCreds = authHeader.replace('Basic ', '');
	      const validCredentials = providedCreds === expectedCreds;

	      if (hasBasic && hasFormEncoded && hasClientCredentials && hasSvcForum && hasForumScopes && validCredentials) {
	        // Return a minimal JWT that decodeTokenClaims can parse
	        const payload = Buffer.from(JSON.stringify({
	          agent_id: 'test-agent',
	          sub: 'mock-uuid',
	          client_id: 'test-client',
	          scope: 'forum.read forum.write',
	        })).toString('base64url');
	        sendJson(res, 200, {
	          access_token: `header.${payload}.fakesignature`,
	          token_type: 'Bearer',
	          expires_in: 3600,
	          scope: 'forum.read forum.write',
	        });
	      } else {
	        sendJson(res, 401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
	      }
	      return;
	    }

    if (url === '/api/threads/' + VALID_UUID && method === 'GET') {
      sendJson(res, 200, { thread: { id: VALID_UUID, title: 'Test Thread', status: 'active' } });
      return;
    }

    if (url === '/api/threads/' + VALID_UUID + '/transcript?format=md' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/markdown' });
      res.end('# Test Thread\n\nThis is a test transcript.');
      return;
    }

    if (url === '/api/threads/' + VALID_UUID + '/transcript?format=json' && method === 'GET') {
      sendJson(res, 200, {
        thread: { id: VALID_UUID },
        messages: [{ id: 'msg-1', content: 'Hello' }],
      });
      return;
    }

    if (url === '/api/threads/' + VALID_UUID + '/messages' && method === 'POST') {
      const parsed = JSON.parse(body || '{}');
      sendJson(res, 201, {
        message: {
          id: 'msg-new',
          threadId: VALID_UUID,
          kind: parsed.kind || 'comment',
          content: parsed.content,
          authorId: 'test-agent',
          authorName: 'Test Agent',
          mentions: parsed.mentions || [],
        },
      });
      return;
    }

    // ── V1 awareness endpoints ─────────────────────────────────────────
    const u = new URL(url, 'http://mock.local');

    if (u.pathname === '/api/threads' && method === 'GET') {
      // Fallback list route — matches query params (?sort=latest) without
      // swallowing unknown URLs (pathname + method must still match).
      sendJson(res, 200, { items: [], total: 0, page: 1, limit: 20 });
      return;
    }

    if (u.pathname === '/api/me/notifications' && method === 'GET') {
      const reason = u.searchParams.get('reason') || 'mention';
      const limit = parseInt(u.searchParams.get('limit') || '20', 10);
      sendJson(res, 200, {
        items: [{
          threadId: VALID_UUID,
          threadTitle: 'Test Thread',
          messageId: 'notif-1',
          authorName: 'Other Agent',
          content: 'unread update',
          createdAt: new Date().toISOString(),
          reason,
        }],
        total: 1,
        page: 1,
        limit,
      });
      return;
    }

    if (u.pathname === '/api/threads/' + VALID_UUID + '/watch' && method === 'PUT') {
      sendJson(res, 200, {
        participant: { id: 'p-1', threadId: VALID_UUID, agentId: 'mock-uuid', joinedAt: new Date().toISOString(), leftAt: null },
      });
      return;
    }

    if (u.pathname === '/api/threads/' + VALID_UUID + '/watch' && method === 'DELETE') {
      sendJson(res, 200, {
        participant: { id: 'p-1', threadId: VALID_UUID, agentId: 'mock-uuid', leftAt: new Date().toISOString() },
      });
      return;
    }

    if (u.pathname === '/api/threads/' + VALID_UUID + '/read' && method === 'PUT') {
      sendJson(res, 200, {
        participant: { id: 'p-1', threadId: VALID_UUID, agentId: 'mock-uuid', lastReadAt: new Date().toISOString() },
      });
      return;
    }

    if (url === '/api/threads/' + VALID_UUID + '/review-readiness' && method === 'GET') {
      sendJson(res, 200, {
        ready: true,
        requiredReviewerIds: ['test-agent'],
        completedReviewerIds: ['test-agent'],
        pendingReviewerIds: [],
        waivedReviewerIds: [],
      });
      return;
    }

    if (url && url.startsWith('/api/threads/thread-1') && method === 'GET') {
      sendJson(res, 200, { thread: { id: 'sanitized' } });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  server.unref();

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        port: addr.port,
        requestLog,
        resetLog: () => { requestLog.length = 0; },
      });
    });
  });
}

/**
 * Async spawn a script for integration tests.
 * Uses async spawn so the parent event loop stays responsive
 * (needed for the mock HTTP server).
 */
function runScriptAsync(args, stdin, port) {
	return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
      env: {
        ...process.env,
        AGENT_FORUM_CLIENT_ID: 'test-client-id',
        AGENT_FORUM_CLIENT_SECRET: 'test-client-secret',
        AGENT_FORUM_BASE_URL: `http://127.0.0.1:${port}`,
        AUTH_SERVICE_URL: `http://127.0.0.1:${port}`,
      },
    });

    let stdout = '';
    let stderr = '';

    if (stdin !== null && stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      resolve({ status: code, stdout, stderr });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ── 1. Static Code Analysis ──────────────────────────────────────────────

describe('static analysis', () => {
  it('no /api/agent-tasks calls', () => {
    assert.ok(!SOURCE.includes('/api/agent-tasks'));
  });

  it('no claim/complete/fail', () => {
    assert.ok(!SOURCE.includes('.claim('));
    assert.ok(!SOURCE.includes('claimTask'));
    assert.ok(!SOURCE.includes('completeTask'));
    assert.ok(!SOURCE.includes('failTask'));
    assert.ok(!SOURCE.includes('cmdClaim'));
    assert.ok(!SOURCE.includes('cmdComplete'));
    assert.ok(!SOURCE.includes('cmdFail'));
  });

  it('no cron management code', () => {
    assert.ok(!SOURCE.includes('cron.schedule'));
    assert.ok(!SOURCE.includes('node-cron'));
    assert.ok(!SOURCE.includes('node-schedule'));
    assert.ok(!SOURCE.includes('cronjob'));
    assert.ok(!SOURCE.includes('cronJob'));
  });

  it('no feishu/lark integration', () => {
    assert.ok(!SOURCE.includes('feishu'));
    assert.ok(!SOURCE.includes('lark'));
    assert.ok(!SOURCE.includes('飞书'));
  });

  it('no eval usage', () => {
    assert.ok(!SOURCE.includes('eval('));
    assert.ok(!SOURCE.includes('eval '));
  });

  it('no shell command execution', () => {
    assert.ok(!SOURCE.includes('exec('));
    assert.ok(!SOURCE.includes('execSync'));
    assert.ok(!SOURCE.includes('spawnSync'));
    assert.ok(!SOURCE.includes("shell: true"));
    assert.ok(!SOURCE.includes("shell:true"));
  });

  it('HTTP timeout configured', () => {
    assert.ok(SOURCE.includes('AbortController'));
    assert.ok(SOURCE.includes('REQUEST_TIMEOUT'));
  });

  it('response size limit configured', () => {
    assert.ok(SOURCE.includes('MAX_RESPONSE_SIZE'));
  });

  it('safePathSegment prevents injection', () => {
    assert.ok(SOURCE.includes('safePathSegment'));
    assert.ok(SOURCE.includes('replace(/[^a-zA-Z0-9\\-_.]/g'));
  });

  it('env var config for base URLs', () => {
    assert.ok(SOURCE.includes('AGENT_FORUM_BASE_URL'));
    assert.ok(SOURCE.includes('AUTH_SERVICE_URL'));
    assert.ok(SOURCE.includes('AGENT_FORUM_CLIENT_ID'));
    assert.ok(SOURCE.includes('AGENT_FORUM_CLIENT_SECRET'));
  });

  it('no system/decision in allowed kinds', () => {
    const match = SOURCE.match(/ALLOWED_MESSAGE_KINDS\s*=\s*\[([^\]]+)\]/);
    if (match) {
      assert.ok(!match[1].includes('system'));
      assert.ok(!match[1].includes('decision'));
    }
  });

  it('no stack trace leakage', () => {
    assert.ok(SOURCE.includes('err.message'));
    assert.ok(!SOURCE.includes('err.stack'));
  });

  it('no authorId/authorName in post body', () => {
    const m = SOURCE.match(/body:\s*JSON\.stringify\(\{([^}]+)\}\).*postMessage/m);
    if (m) {
      const bodyContent = m[1];
      assert.ok(!bodyContent.includes('authorId'));
      assert.ok(!bodyContent.includes('authorName'));
    }
  });

  it('login output does not contain access_token key', () => {
    const m = SOURCE.match(/console\.log\(JSON\.stringify\(\{([\s\S]{0,500})\},.*\)\)/);
    if (m) {
      assert.ok(!m[0].includes('access_token'), 'access_token must not be in JSON output');
    }
  });
});

// ── 2. CLI Argument Parsing (sync — no HTTP calls made) ──────────────────

describe('cli parsing', () => {
	  it('no args shows usage', () => {
    const r = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Usage'));
  });

  it('unknown command shows error', () => {
    const r = spawnSync('node', [SCRIPT, 'bogus'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Unknown'));
  });

  it('read-thread without threadId fails', () => {
    const r = spawnSync('node', [SCRIPT, 'read-thread'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('requires a threadId'));
  });

  it('read-transcript without threadId fails', () => {
    const r = spawnSync('node', [SCRIPT, 'read-transcript'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('requires a threadId'));
  });

  it('post-message without threadId fails', () => {
    const r = spawnSync('node', [SCRIPT, 'post-message'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('requires a threadId'));
  });

  it('post-message without --kind fails', () => {
    const r = spawnSync('node', [SCRIPT, 'post-message', 'thread-1'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('--kind'));
  });

  it('post-message with invalid kind fails', () => {
    const r = spawnSync('node', [SCRIPT, 'post-message', 'thread-1', '--kind', 'invalid'], {
      encoding: 'utf-8', timeout: 3000, input: 'content',
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Invalid kind'));
  });

  it('readiness without threadId fails', () => {
    const r = spawnSync('node', [SCRIPT, 'readiness'], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: 'test', AGENT_FORUM_CLIENT_SECRET: 'test' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('requires a threadId'));
  });

  it('missing CLIENT_ID exits', () => {
    const r = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8', timeout: 3000,
      env: { ...process.env, AGENT_FORUM_CLIENT_ID: '', AGENT_FORUM_CLIENT_SECRET: '' },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('AGENT_FORUM_CLIENT_ID'));
  });
});

// ── 3. Integration Tests (async spawn + mock HTTP server) ───────────────

describe('integration', () => {
  let mock;
  let port;

  before(async () => {
    mock = await createMockServer();
    port = mock.port;
  });

  after(() => {
    if (mock) mock.resetLog();
  });

  beforeEach(() => {
    if (mock) mock.resetLog();
  });

  // ── Login ──

  it('login succeeds with valid token', async () => {
    const r = await runScriptAsync(['login'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.loggedIn, true);
    assert.equal(o.agentId, 'test-agent');
    assert.equal(o.principalId, 'mock-uuid');
    assert.ok(o.scope);
  });

  it('login failure exits with error', async () => {
    const child = spawn('node', [SCRIPT, 'login'], {
      encoding: 'utf-8', timeout: 5000,
	      env: {
        ...process.env,
        AGENT_FORUM_CLIENT_ID: 'wrong-client-id',
        AGENT_FORUM_CLIENT_SECRET: 'wrong-secret',
        AGENT_FORUM_BASE_URL: `http://127.0.0.1:${port}`,
        AUTH_SERVICE_URL: `http://127.0.0.1:${port}`,
      },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise(r => child.on('close', r));
    assert.equal(code, 1);
    const lower = stderr.toLowerCase();
    assert.ok(lower.includes('error'), 'stderr should include Error');
    assert.ok(lower.includes('invalid') || lower.includes('fail'), 'stderr should describe the failure');
  });

  // ── Read Thread ──

  it('read-thread uses complete UUID and rejects short ID', async () => {
    // Short ID is rejected before HTTP call
    const r1 = await runScriptAsync(['read-thread', '52423a12'], null, port);
    assert.notEqual(r1.status, 0);
    assert.ok(r1.stderr.includes('complete UUID'), 'short ID must be rejected');

    // Full UUID works
    const r2 = await runScriptAsync(['read-thread', VALID_UUID], null, port);
    assert.equal(r2.status, 0, r2.stderr);
    const o = JSON.parse(r2.stdout);
    assert.equal(o.thread.id, VALID_UUID);
    // threadId and shortId must always be present
    assert.equal(o.thread.threadId, VALID_UUID, 'threadId must be present and equal to full UUID');
    assert.equal(o.thread.shortId, VALID_UUID.slice(0, 8), 'shortId must be display-only prefix');

    const calls = mock.requestLog.filter(
      e => e.url === '/api/threads/' + VALID_UUID && e.method === 'GET'
    );
    assert.equal(calls.length, 1);
  });

  it('read-thread output threadId is never empty string', async () => {
    // Full UUID works
    const r = await runScriptAsync(['read-thread', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.ok(o.thread.threadId, 'threadId must not be empty');
    assert.ok(o.thread.threadId.length > 0, 'threadId must have content');
    assert.notEqual(o.thread.threadId, '', 'threadId must not be empty string');
  });

  // ── List Threads ──

  it('list-threads returns threads with full UUID', async () => {
    // Add a list-threads route to the mock
    mock.server.close();
    mock = await createMockServer((req, res, body) => {
      if (req.url === '/api/threads' && req.method === 'GET') {
        sendJson(res, 200, {
          items: [{ id: VALID_UUID, title: 'Test Thread', status: 'active' }],
          total: 1,
        });
        return true;
      }
      return false;
    });
    port = mock.port;

    const r = await runScriptAsync(['list-threads'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.ok(data.items, 'list returns items');
    assert.equal(data.items[0].id, VALID_UUID, 'full UUID preserved');
    assert.equal(data.items[0].threadId, VALID_UUID, 'threadId equals full UUID');
    assert.equal(data.items[0].shortId, VALID_UUID.slice(0, 8), 'shortId is display-only prefix');
  });

  // ── Read Transcript ──

  it('read-transcript uses complete UUID (default md format)', async () => {
    const r = await runScriptAsync(['read-transcript', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Test Thread'));

    const calls = mock.requestLog.filter(
      e => e.url === '/api/threads/' + VALID_UUID + '/transcript?format=md' && e.method === 'GET'
    );
    assert.equal(calls.length, 1);
  });

  it('read-transcript --format json returns JSON with threadId', async () => {
    const r = await runScriptAsync(['read-transcript', VALID_UUID, '--format', 'json'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.thread.id, VALID_UUID);
    assert.ok(Array.isArray(o.messages));
    // Top-level threadId must be present
    assert.equal(o.threadId, VALID_UUID, 'top-level threadId must equal full UUID');

    const calls = mock.requestLog.filter(
      e => e.url === '/api/threads/' + VALID_UUID + '/transcript?format=json' && e.method === 'GET'
    );
    assert.equal(calls.length, 1);
  });

  // ── Post Message ──

  it('post-message reads content from stdin', async () => {
    const content = 'This is a test challenge.';
    const r = await runScriptAsync(
      ['post-message', VALID_UUID, '--kind', 'challenge'],
      content, port
    );
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.status, 'posted');
    assert.equal(o.messageId, 'msg-new');
  });

  it('post-message does not send authorId/authorName', async () => {
    const content = 'Another review comment.';
    const r = await runScriptAsync(
      ['post-message', VALID_UUID, '--kind', 'comment'],
      content, port
    );
    assert.equal(r.status, 0, r.stderr);

    const posts = mock.requestLog.filter(
      e => e.url === '/api/threads/' + VALID_UUID + '/messages' && e.method === 'POST'
    );
    assert.equal(posts.length, 1);
    const postedBody = JSON.parse(posts[0].body);
    assert.equal(postedBody.authorId, undefined);
    assert.equal(postedBody.authorName, undefined);
    assert.equal(postedBody.content, 'Another review comment.');
    assert.equal(postedBody.kind, 'comment');
  });

  it('all safe message kinds are accepted', async () => {
    const kinds = ['comment', 'proposal', 'challenge', 'clarification', 'evidence'];
    for (const kind of kinds) {
      mock.resetLog();
      const r = await runScriptAsync(
        ['post-message', VALID_UUID, '--kind', kind],
        `Test ${kind} message`, port
      );
      assert.equal(r.status, 0, `kind "${kind}" should pass: ${r.stderr}`);
    }
  });

  it('system and decision kinds are rejected', async () => {
    const forbidden = ['system', 'decision'];
    for (const kind of forbidden) {
      const r = await runScriptAsync(
        ['post-message', VALID_UUID, '--kind', kind],
        `Test ${kind} message`, port
      );
      assert.equal(r.status, 1, `kind "${kind}" should be rejected`);
      assert.ok(r.stderr.includes('Invalid kind'), `kind "${kind}" should show invalid kind error`);
    }
  });

  // ── Readiness ──

  it('readiness returns correct data and is read-only', async () => {
    const r = await runScriptAsync(['readiness', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.threadId, VALID_UUID);
    assert.equal(o.ready, true);
    assert.ok(Array.isArray(o.requiredReviewerIds));
    assert.ok(Array.isArray(o.pendingReviewerIds));

    const forumMutations = mock.requestLog.filter(
      e => e.url.startsWith('/api/threads') && e.method !== 'GET'
    );
    assert.equal(forumMutations.length, 0, 'readiness should not POST/PATCH');
  });

  // ── Safety ──

  it('non-UUID threadId is rejected before HTTP request', async () => {
    // Shell injection string is not a valid UUID → rejected before safePathSegment
    const maliciousId = 'thread-1; rm -rf /';
    const r = await runScriptAsync(['read-thread', maliciousId], null, port);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes('complete UUID'));

    // No HTTP request reaches the server
    const calls = mock.requestLog.filter(e => e.url.startsWith('/api/threads/'));
    // The list-threads test may have left calls; just check no request for maliciousId
    const maliciousCalls = mock.requestLog.filter(e => e.url.includes('thread-1') || e.url.includes('rm'));
    assert.equal(maliciousCalls.length, 0);
  });

  it('no stack trace in error output', async () => {
    const child = spawn('node', [SCRIPT, 'read-thread', 'nonexistent'], {
      encoding: 'utf-8', timeout: 5000,
	      env: {
        ...process.env,
        AGENT_FORUM_CLIENT_ID: 'test-client-id',
        AGENT_FORUM_CLIENT_SECRET: 'test-client-secret',
        AGENT_FORUM_BASE_URL: `http://127.0.0.1:${port}`,
        AUTH_SERVICE_URL: `http://127.0.0.1:${port}`,
      },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    await new Promise(r => child.on('close', r));
    assert.ok(!stderr.includes('at '), 'should not contain stack trace lines');
    assert.ok(!stderr.includes('node:internal'), 'should not contain internal paths');
  });

  it('token and Authorization not leaked in output', async () => {
    const r = await runScriptAsync(['read-thread', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('Bearer'));
    assert.ok(!r.stdout.includes('mock-access-jwt'));
    assert.ok(!r.stderr.includes('mock-access-jwt'));
  });

  // ── UUID validation ──

  it('short 8-char threadId is rejected before HTTP request', async () => {
    const r = await runScriptAsync(['read-thread', '52423a12'], null, port);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes('complete UUID'));

    // Verify no request reached the mock server
    const forumCalls = mock.requestLog.filter(e => e.url.startsWith('/api/threads'));
    // The list-threads test may have left calls; just check no call for short ID
    const shortIdCalls = mock.requestLog.filter(e => e.url.includes('52423a12'));
    assert.equal(shortIdCalls.length, 0);
  });

  it('injection chars in threadId are caught by UUID validation', async () => {
    // Shell injection appended to a UUID prefix fails UUID validation
    const maliciousId = '11111111-1111-4111-8111-111111111111; rm -rf /';
    const r = await runScriptAsync(['read-thread', maliciousId], null, port);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes('complete UUID'));

    // No request reaches the server
    const calls = mock.requestLog.filter(e => e.url.startsWith('/api/threads/'));
    assert.equal(calls.length, 0, 'no HTTP request should be made for invalid UUID');
  });

  it('safePathSegment preserves valid UUID', () => {
    // Verify the source code preserves full UUIDs through safePathSegment
    assert.ok(SOURCE.includes('safePathSegment'));
    assert.ok(SOURCE.includes('replace(/[^a-zA-Z0-9\\-_.]/g'));
  });

  // ── Single operation per command ──

  it('each command performs exactly one forum operation', async () => {
    mock.resetLog();
    let r = await runScriptAsync(['read-thread', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    let forumOps = mock.requestLog.filter(e => e.url.startsWith('/api/threads'));
    assert.equal(forumOps.length, 1, 'read-thread should make exactly 1 forum call');

    mock.resetLog();
    r = await runScriptAsync(['readiness', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    forumOps = mock.requestLog.filter(e => e.url.startsWith('/api/threads'));
    assert.equal(forumOps.length, 1, 'readiness should make exactly 1 forum call');

    mock.resetLog();
    r = await runScriptAsync(
      ['post-message', VALID_UUID, '--kind', 'comment'],
      'test', port
    );
    assert.equal(r.status, 0, r.stderr);
    forumOps = mock.requestLog.filter(e => e.url.startsWith('/api/threads'));
    assert.equal(forumOps.length, 1, 'post-message should make exactly 1 forum call');
  });

  // ── V1 awareness: notifications, watch/unwatch, mark-read, --sort ──

  it('post-message --mentions is forwarded to the server', async () => {
    mock.resetLog();
    const r = await runScriptAsync(
      ['post-message', VALID_UUID, '--kind', 'comment', '--mentions', 'agent-b, agent-c,agent-b'],
      'hello world', port
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.method === 'POST' && e.url.includes('/messages'));
    assert.equal(calls.length, 1);
    const posted = JSON.parse(calls[0].body);
    assert.deepEqual(posted.mentions, ['agent-b', 'agent-c', 'agent-b'],
      'mentions list is trimmed and passed through');
    assert.equal(posted.content, 'hello world');
    // Without --mentions the field is omitted entirely
    mock.resetLog();
    const r2 = await runScriptAsync(['post-message', VALID_UUID, '--kind', 'comment'], 'plain', port);
    assert.equal(r2.status, 0, r2.stderr);
    const calls2 = mock.requestLog.filter(e => e.method === 'POST' && e.url.includes('/messages'));
    assert.ok(!('mentions' in JSON.parse(calls2[0].body)), 'no mentions key when flag absent');
  });

  it('my-notifications lists unread notifications', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['my-notifications', '--limit', '5'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.total, 1);
    assert.equal(o.items[0].threadId, VALID_UUID);
    assert.equal(o.limit, 5, '--limit is forwarded');
  });

  it('my-mentions requests reason=mention', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['my-mentions'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.url.includes('/api/me/notifications'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('reason=mention'), calls[0].url);
    const o = JSON.parse(r.stdout);
    assert.equal(o.items[0].reason, 'mention');
  });

  it('my-updates requests reason=watch', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['my-updates'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.url.includes('/api/me/notifications'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('reason=watch'), calls[0].url);
    const o = JSON.parse(r.stdout);
    assert.equal(o.items[0].reason, 'watch');
  });

  it('watch sends PUT /watch without any agentId in the body', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['watch', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.method === 'PUT' && e.url.endsWith('/watch'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body, null, 'no body is sent (server derives identity)');
    const o = JSON.parse(r.stdout);
    assert.equal(o.status, 'watching');
    assert.equal(o.threadId, VALID_UUID);
  });

  it('unwatch sends DELETE /watch', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['unwatch', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.method === 'DELETE' && e.url.endsWith('/watch'));
    assert.equal(calls.length, 1);
    const o = JSON.parse(r.stdout);
    assert.equal(o.status, 'unwatched');
  });

  it('mark-read sends PUT /read (no participantId lookup needed)', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['mark-read', VALID_UUID], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.method === 'PUT' && e.url.endsWith('/read'));
    assert.equal(calls.length, 1);
    const o = JSON.parse(r.stdout);
    assert.equal(o.status, 'read');
    assert.ok(o.lastReadAt);
  });

  it('list-threads --sort latest is forwarded as a query param', async () => {
    mock.resetLog();
    const r = await runScriptAsync(['list-threads', '--sort', 'latest'], null, port);
    assert.equal(r.status, 0, r.stderr);
    const calls = mock.requestLog.filter(e => e.url.includes('/api/threads'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('sort=latest'), calls[0].url);
  });
});
