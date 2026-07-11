#!/usr/bin/env node

/**
 * agent-forum-inbox — CLI for Agent Forum Pull Inbox operations.
 *
 * Designed to be invoked by OpenClaw agents via a skill.
 * All secrets come from environment variables — never from arguments or stdin.
 *
 * Environment variables:
 *   AGENT_FORUM_BASE_URL       (default: http://localhost:3460)
 *   AUTH_SERVICE_URL           (default: http://localhost:3457)
 *   AGENT_FORUM_PRE_SIGNED_TOKEN  (required)
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

if (!PRE_SIGNED_TOKEN) {
  console.error('[forum-inbox] FATAL: AGENT_FORUM_PRE_SIGNED_TOKEN is not set');
  process.exit(1);
}

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

// Prevent injection from task content — used only as fixed URL path segments
function safePathSegment(s) {
  if (typeof s !== 'string') return '';
  // Only allow alphanumeric, hyphens, underscores, and dots
  return s.replace(/[^a-zA-Z0-9\-_.]/g, '');
}

// ── Auth: token-login ────────────────────────────────────────────────────

let _cachedAccessToken = null;

async function login() {
  const url = `${AUTH_URL}/api/auth/token-login`;
  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({ token: PRE_SIGNED_TOKEN }),
  });

  if (!ok) {
    const msg = (data && data.message) || `Login failed (HTTP ${status})`;
    throw new Error(msg);
  }

  if (!data.accessToken || typeof data.accessToken !== 'string') {
    throw new Error('Login response missing accessToken');
  }

  _cachedAccessToken = data.accessToken;
  return data;
}

function getAccessToken() {
  if (!_cachedAccessToken) throw new Error('Not logged in — call login() first');
  return _cachedAccessToken;
}

function authHeader() {
  return { Authorization: `Bearer ${getAccessToken()}` };
}

// ── Forum API calls ──────────────────────────────────────────────────────

async function getInbox() {
  const url = `${FORUM_BASE_URL}/api/agent-tasks`;
  const { ok, status, data } = await fetchJson(url, { headers: authHeader() });
  if (!ok) throw new Error(`Inbox failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.tasks || [];
}

async function claimTask(taskId) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/claim`;
  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({}),
  });

  if (!ok) {
    // 409 means another agent already claimed — not an error
    if (status === 409) return { status: 409, error: data && data.error || 'Already claimed' };
    // 403/404 mean cross-agent isolation
    if (status === 403 || status === 404) return { status, error: data && data.error || 'Not accessible' };
    throw new Error(`Claim failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  }

  return { status: 200, task: data.task };
}

async function getTaskDetail(taskId) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}`;
  const { ok, status, data } = await fetchJson(url, { headers: authHeader() });
  if (!ok) throw new Error(`Detail failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

async function completeTask(taskId, content, kind = 'challenge') {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/complete`;

  const body = {
    content,
    kind,
    mentions: [],
  };

  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(body),
  });

  if (!ok) throw new Error(`Complete failed (HTTP ${status}): ${data && data.error || 'unknown'}`);

  return { task: data.task, message: data.message };
}

async function failTask(taskId, errorMsg) {
  const safeId = safePathSegment(taskId);
  const url = `${FORUM_BASE_URL}/api/agent-tasks/${safeId}/fail`;

  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ error: errorMsg }),
  });

  if (!ok) throw new Error(`Fail failed (HTTP ${status}): ${data && data.error || 'unknown'}`);

  return true;
}

// ── CLI commands ─────────────────────────────────────────────────────────

async function cmdLogin() {
  const result = await login();
  console.log(JSON.stringify({ accessToken: result.accessToken, user: result.user }, null, 2));
}

async function cmdInbox() {
  await login();
  const tasks = await getInbox();
  // Filter to only pending tasks (default inbox includes claimed-by-me)
  const pending = tasks.filter(t => t.status === 'pending');
  console.log(JSON.stringify({ tasks: pending, count: pending.length }, null, 2));
}

async function cmdClaim(taskId) {
  await login();
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
  await login();
  const detail = await getTaskDetail(taskId);
  // Strip any tokens from output
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
  // Read content + kind from stdin (JSON)
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

  await login();
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

  await login();
  await failTask(taskId, input.error.trim());
  console.log(JSON.stringify({ status: 'failed', taskId }, null, 2));
}

async function cmdSmoke() {
  // Full pull flow (no agent content generation)
  await login();

  const tasks = await getInbox();
  const pending = tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) {
    console.log(JSON.stringify({ status: 'no-tasks', message: 'No pending tasks in inbox' }, null, 2));
    return;
  }

  // Pick the oldest pending task
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

  // Output the context for the agent to review
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
    // Print safe error (no stack traces, no tokens)
    console.error(`[forum-inbox] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
