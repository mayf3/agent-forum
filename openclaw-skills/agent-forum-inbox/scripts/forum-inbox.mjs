#!/usr/bin/env node

/**
 * agent-forum-inbox — CLI for Agent Forum Pull Inbox operations.
 *
 * Designed to be invoked by OpenClaw agents via a skill.
 * All secrets come from environment variables — never from arguments or stdin.
 *
 * Authentication (tried in order):
 *   Path A (OAuth2 client_credentials):  AGENT_FORUM_CLIENT_ID +
 *     AGENT_FORUM_CLIENT_SECRET (env var) or AGENT_FORUM_CLIENT_SECRET_FILE (file ref)
 *   Path B (pre-signed token):           AGENT_FORUM_PRE_SIGNED_TOKEN
 *
 * Token management:
 *   - Token is cached in-memory and refreshed proactively before expiry.
 *   - On 401 from GET requests: clear cache, re-login, retry exactly once.
 *   - On 401 from POST/PUT/DELETE: clear cache, re-login, but do NOT retry.
 *   - Concurrent requests share a single refresh Promise.
 *
 * Environment variables:
 *   AGENT_FORUM_BASE_URL           (default: http://localhost:3460)
 *   AUTH_SERVICE_URL               (default: http://localhost:3457)
 *   AGENT_FORUM_CLIENT_ID          (optional — OAuth2 client_id)
 *   AGENT_FORUM_CLIENT_SECRET      (optional — raw client_secret)
 *   AGENT_FORUM_CLIENT_SECRET_FILE (optional — path to file with client_secret)
 *   AGENT_FORUM_PRE_SIGNED_TOKEN   (optional — pre-signed agent JWT)
 *   AGENT_FORUM_AGENT_ID           (default: blog-agent)
 *   AGENT_FORUM_AGENT_NAME         (optional — display name)
 *
 * Usage:
 *   forum-inbox.mjs login              → get access JWT (for testing)
 *   forum-inbox.mjs inbox              → list pending tasks
 *   forum-inbox.mjs claim <taskId>     → claim a task
 *   forum-inbox.mjs detail <taskId>    → get task detail with context
 *   forum-inbox.mjs complete <taskId>  → complete a task (reads content+kind from stdin JSON)
 *   forum-inbox.mjs fail <taskId>      → fail a task (reads error from stdin)
 *   forum-inbox.mjs smoke              → end-to-end: login → inbox → claim → detail → print context
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ── Config from environment ──────────────────────────────────────────────

const FORUM_BASE_URL   = process.env.AGENT_FORUM_BASE_URL   || 'http://localhost:3460';
const AUTH_URL         = process.env.AUTH_SERVICE_URL       || 'http://localhost:3457';
const PRE_SIGNED_TOKEN = process.env.AGENT_FORUM_PRE_SIGNED_TOKEN || '';
const CLIENT_ID        = process.env.AGENT_FORUM_CLIENT_ID || '';
const CLIENT_SECRET    = process.env.AGENT_FORUM_CLIENT_SECRET || '';
const CLIENT_SECRET_FILE = process.env.AGENT_FORUM_CLIENT_SECRET_FILE || '';

// Resolve client_secret: prefer direct env var, fall back to file
let _resolvedClientSecret = '';
if (CLIENT_SECRET) {
  _resolvedClientSecret = CLIENT_SECRET;
} else if (CLIENT_SECRET_FILE) {
  try {
    _resolvedClientSecret = readFileSync(CLIENT_SECRET_FILE, 'utf-8').trim();
  } catch (err) {
    console.error(`[forum-inbox] FATAL: Cannot read AGENT_FORUM_CLIENT_SECRET_FILE: ${err.message}`);
    process.exit(1);
  }
}

const HAS_CLIENT_CREDENTIALS = !!(CLIENT_ID && _resolvedClientSecret);
const HAS_PRE_SIGNED_TOKEN   = !!PRE_SIGNED_TOKEN;

if (!HAS_CLIENT_CREDENTIALS && !HAS_PRE_SIGNED_TOKEN) {
  console.error(
    '[forum-inbox] FATAL: No authentication configured.\n' +
    '  Set either AGENT_FORUM_CLIENT_ID + AGENT_FORUM_CLIENT_SECRET (or _FILE)\n' +
    '  or AGENT_FORUM_PRE_SIGNED_TOKEN.'
  );
  process.exit(1);
}

const AGENT_ID   = process.env.AGENT_FORUM_AGENT_ID   || 'blog-agent';
const AGENT_NAME = process.env.AGENT_FORUM_AGENT_NAME || '';

// ── Token cache ──────────────────────────────────────────────────────────

let _cachedAccessToken = null;
let _cachedExpiresAt = 0;
let _refreshPromise = null;

// ── Helpers ──────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000; // ms

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const body = await res.text();

    // Limit response size for safety
    if (body.length > 500_000) {
      throw new Error(`Response too large: ${body.length} bytes`);
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Invalid JSON response (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    return { ok: res.ok, status: res.status, data: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function safePathSegment(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[^a-zA-Z0-9\-_.]/g, '');
}

// ── Auth: token-login with caching & refresh ────────────────────────────

function decodeExp(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

async function doLogin() {
  const url = `${AUTH_URL}/api/auth/token-login`;

  let body;
  let headers = { 'Content-Type': 'application/json' };

  if (HAS_CLIENT_CREDENTIALS) {
    const credentials = Buffer.from(`${CLIENT_ID}:${_resolvedClientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    body = JSON.stringify({});
  } else {
    body = JSON.stringify({ token: PRE_SIGNED_TOKEN });
  }

  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!ok) {
    const msg = (data && data.message) || `Login failed (HTTP ${status})`;
    throw new Error(msg);
  }

  if (!data.accessToken || typeof data.accessToken !== 'string') {
    throw new Error('Login response missing accessToken');
  }

  _cachedAccessToken = data.accessToken;
  _cachedExpiresAt = decodeExp(data.accessToken);
  return data;
}

const PRE_REFRESH_SECONDS = 300; // 5 min

async function getAccessToken() {
  if (!_cachedAccessToken || (_cachedExpiresAt > 0 && (Date.now() / 1000) >= _cachedExpiresAt - PRE_REFRESH_SECONDS)) {
    if (!_refreshPromise) {
      _refreshPromise = doLogin().then(() => {
        _refreshPromise = null;
        return _cachedAccessToken;
      }).catch((err) => {
        _refreshPromise = null;
        throw err;
      });
    }
    return _refreshPromise;
  }

  return _cachedAccessToken;
}

function clearTokenCache() {
  _cachedAccessToken = null;
  _cachedExpiresAt = 0;
}

async function authHeader() {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function authenticatedFetch(method, url, bodyPayload = null) {
  const headers = await authHeader();
  const body = bodyPayload ? JSON.stringify(bodyPayload) : undefined;

  const result = await fetchJson(url, {
    method,
    headers,
    body,
  });

  if (result.status === 401 && (result.data?.error === 'TOKEN_INVALID_OR_EXPIRED' || result.data?.error === 'Token 无效')) {
    clearTokenCache();

    if (method === 'GET' || method === 'get') {
      const freshHeaders = await authHeader();
      const retryResult = await fetchJson(url, {
        method,
        headers: freshHeaders,
        body,
      });
      if (retryResult.status === 401) {
        throw new Error('Token refresh failed after retry — authentication rejected');
      }
      return retryResult;
    }

    throw new Error(`Authentication expired (HTTP 401) — token refreshed, please retry operation`);
  }

  return result;
}

// ── Forum API calls ──────────────────────────────────────────────────────

async function getInbox() {
  const url = `${FORUM_BASE_URL}/api/agent-tasks`;
  const { ok, status, data } = await authenticatedFetch('GET', url);
  if (!ok) throw new Error(`Inbox failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.tasks || [];
}

async function claimTask(taskId) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/claim`;
  const { ok, status, data } = await authenticatedFetch('POST', url, {});

  if (!ok) {
    if (status === 409) return { status: 409, error: data && data.error || 'Already claimed' };
    if (status === 403 || status === 404) return { status, error: data && data.error || 'Not accessible' };
    throw new Error(`Claim failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  }

  return { status: 200, task: data.task };
}

async function getTaskDetail(taskId) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}`;
  const { ok, status, data } = await authenticatedFetch('GET', url);
  if (!ok) throw new Error(`Detail failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

async function completeTask(taskId, content, kind = 'challenge') {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/complete`;

  const body = { content, kind, mentions: [] };

  const { ok, status, data } = await authenticatedFetch('POST', url, body);
  if (!ok) throw new Error(`Complete failed (HTTP ${status}): ${data && data.error || 'unknown'}`);

  return { task: data.task, message: data.message };
}

async function failTask(taskId, errorMsg) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/fail`;

  const { ok, status, data } = await authenticatedFetch('POST', url, { error: errorMsg });
  if (!ok) throw new Error(`Fail failed (HTTP ${status}): ${data && data.error || 'unknown'}`);

  return true;
}

// ── CLI commands ─────────────────────────────────────────────────────────

async function cmdLogin() {
  clearTokenCache();
  const result = await doLogin();
  console.log(JSON.stringify({ accessToken: result.accessToken, user: result.user }, null, 2));
}

async function cmdInbox() {
  const tasks = await getInbox();
  const pending = tasks.filter(t => t.status === 'pending');
  console.log(JSON.stringify({ tasks: pending, count: pending.length }, null, 2));
}

async function cmdClaim(taskId) {
  const result = await claimTask(taskId);
  if (result.status === 409) {
    console.log(JSON.stringify({ status: 'conflict', error: result.error }, null, 2));
    process.exit(0);
  }
  if (result.status === 403 || result.status === 404) {
    console.log(JSON.stringify({ status: 'denied', error: result.error }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'claimed', task: result.task }, null, 2));
}

async function cmdDetail(taskId) {
  const detail = await getTaskDetail(taskId);
  const safe = {
    task: detail.task,
    thread: detail.thread,
    instruction: detail.instruction,
    transcriptMd: detail.transcriptMd,
    contextSnapshots: (detail.contextSnapshots || []).map(s => ({
      id: s.id,
      snapshotType: s.snapshotType,
      title: s.title,
      excerptMd: s.excerptMd,
    })),
  };
  console.log(JSON.stringify(safe, null, 2));
}

async function cmdComplete(taskId) {
  const stdin = readFileSync(0, 'utf-8').trim();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    console.error('[forum-inbox] complete: stdin must be JSON: { "content": "...", "kind": "challenge" }');
    process.exit(1);
  }

  if (!input.content || !input.content.trim()) {
    console.error('[forum-inbox] complete: content is required');
    process.exit(1);
  }

  const kind = input.kind || 'challenge';
  const allowed = ['comment', 'proposal', 'challenge', 'clarification', 'evidence'];
  if (!allowed.includes(kind)) {
    console.error(`[forum-inbox] complete: kind must be one of: ${allowed.join(', ')}`);
    process.exit(1);
  }

  const result = await completeTask(taskId, input.content.trim(), kind);
  console.log(JSON.stringify({
    status: 'completed',
    taskId: result.task.id,
    taskStatus: result.task.status,
    messageId: result.message.id,
    completedAt: result.task.completedAt,
  }, null, 2));
}

async function cmdFail(taskId) {
  const stdin = readFileSync(0, 'utf-8').trim();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    console.error('[forum-inbox] fail: stdin must be JSON: { "error": "reason" }');
    process.exit(1);
  }

  if (!input.error || !input.error.trim()) {
    console.error('[forum-inbox] fail: error description is required');
    process.exit(1);
  }

  await failTask(taskId, input.error.trim());
  console.log(JSON.stringify({ status: 'failed', taskId }, null, 2));
}

async function cmdSmoke() {
  const tasks = await getInbox();
  const pending = tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) {
    console.log(JSON.stringify({ status: 'no-tasks', message: 'No pending tasks in inbox' }, null, 2));
    return;
  }

  const task = pending.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

  const claimResult = await claimTask(task.id);
  if (claimResult.status === 409) {
    console.log(JSON.stringify({ status: 'preempted', taskId: task.id, message: 'Task already claimed by another' }, null, 2));
    return;
  }
  if (claimResult.status === 403 || claimResult.status === 404) {
    console.log(JSON.stringify({ status: 'denied', taskId: task.id, message: claimResult.error }, null, 2));
    return;
  }

  const detail = await getTaskDetail(task.id);

  const output = {
    status: 'claimed',
    taskId: task.id,
    threadId: detail.thread.id,
    threadTitle: detail.thread.title,
    instruction: detail.instruction,
    transcriptMd: detail.transcriptMd,
    contextSnapshots: (detail.contextSnapshots || []).map(s => ({
      snapshotType: s.snapshotType,
      title: s.title,
      excerptMd: s.excerptMd,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.error(`Usage:
  forum-inbox.mjs login              — get access JWT
  forum-inbox.mjs inbox              — list pending tasks
  forum-inbox.mjs claim <taskId>     — claim a task
  forum-inbox.mjs detail <taskId>    — get task detail with context
  forum-inbox.mjs complete <taskId>  — complete task (stdin: {"content":"...","kind":"challenge"})
  forum-inbox.mjs fail <taskId>      — fail task (stdin: {"error":"..."})
  forum-inbox.mjs smoke              — full pull flow (no agent content)
`);
    process.exit(1);
  }

  try {
    switch (cmd) {
      case 'login':
        await cmdLogin();
        break;
      case 'inbox':
        await cmdInbox();
        break;
      case 'claim':
        await cmdClaim(args[1]);
        break;
      case 'detail':
        await cmdDetail(args[1]);
        break;
      case 'complete':
        await cmdComplete(args[1]);
        break;
      case 'fail':
        await cmdFail(args[1]);
        break;
      case 'smoke':
        await cmdSmoke();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[forum-inbox] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
