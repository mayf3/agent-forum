#!/usr/bin/env node

/**
 * agent-forum-access — Shared OpenClaw skill for Agent Forum thin access.
 *
 * Provides four capabilities:
 *   1. login           — authenticate via pre-signed token, cache JWT in-process
 *   2. read-thread     — fetch thread metadata
 *   3. read-transcript — fetch thread transcript (markdown or JSON)
 *   4. post-message    — post a message to a thread (content from stdin)
 *   5. readiness       — check required reviewer gate status (read-only)
 *
 * No task/inbox/claim/complete/fail/cron concepts.  Only notification-driven
 * agent collaboration.
 *
 * Environment variables:
 *   AGENT_FORUM_BASE_URL       (default: http://localhost:3460)
 *   AUTH_SERVICE_URL           (default: http://localhost:3457)
 *   AGENT_FORUM_PRE_SIGNED_TOKEN  (required)
 *
 * Usage:
 *   forum-access.mjs login
 *   forum-access.mjs read-thread <threadId>
 *   forum-access.mjs read-transcript <threadId> [--format md|json]
 *   printf '%s' "$CONTENT" | forum-access.mjs post-message <threadId> --kind <kind>
 *   forum-access.mjs readiness <threadId>
 *
 * Supported message kinds (reviewer):
 *   comment | proposal | challenge | clarification | evidence
 *
 * Forbidden message kinds (moderator-only):
 *   system | decision
 */

// ── Config from environment ──────────────────────────────────────────────

const FORUM_BASE_URL   = process.env.AGENT_FORUM_BASE_URL   || 'http://localhost:3460';
const AUTH_URL         = process.env.AUTH_SERVICE_URL       || 'http://localhost:3457';
const PRE_SIGNED_TOKEN = process.env.AGENT_FORUM_PRE_SIGNED_TOKEN || '';

if (!PRE_SIGNED_TOKEN) {
  console.error('[forum-access] FATAL: AGENT_FORUM_PRE_SIGNED_TOKEN is not set');
  process.exit(1);
}

// ── Constants ────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;        // 15 seconds
const MAX_RESPONSE_SIZE = 500_000;     // 500 KB

const ALLOWED_MESSAGE_KINDS = ['comment', 'proposal', 'challenge', 'clarification', 'evidence'];

// ── Safe HTTP helper ─────────────────────────────────────────────────────

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

    // Read as text first to apply size limit
    const body = await res.text();

    if (body.length > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${body.length} bytes (max ${MAX_RESPONSE_SIZE})`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON response (e.g. markdown transcript) — raw text is still available
    }

    return { ok: res.ok, status: res.status, data: parsed, raw: body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full UUID pattern — matches standard 8-4-4-4-12 hex format.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate threadId is a complete UUID before making HTTP requests.
 * Rejects 8-char display prefixes, shell-injected strings, etc.
 */
function requireFullUuid(value, label = 'threadId') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(
      `${label} must be the complete UUID; an 8-character display prefix cannot be used. ` +
      `Use the full thread.id from the forum thread list.`
    );
  }
}

/**
 * Sanitize a path segment to prevent shell/URL injection.
 * Only alphanumeric, hyphens, underscores, and dots are allowed.
 * Full UUIDs pass through unmodified.
 */
function safePathSegment(s) {
  if (typeof s !== 'string') return '';
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

async function listThreads() {
  await login();
  const url = `${FORUM_BASE_URL}/api/threads`;
  const { ok, status, data } = await fetchJson(url, { headers: authHeader() });
  if (!ok) throw new Error(`list-threads failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

async function getThread(threadId) {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}`;
  const { ok, status, data } = await fetchJson(url, { headers: authHeader() });
  if (!ok) throw new Error(`read-thread failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.thread;
}

async function getTranscript(threadId, format = 'md') {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}/transcript?format=${format}`;
  const { ok, status, data, raw } = await fetchJson(url, { headers: authHeader() });

  if (!ok) throw new Error(`read-transcript failed (HTTP ${status}): ${data && data.error || 'unknown'}`);

  // Markdown format returns text/markdown content
  if (format === 'md') {
    return raw;  // raw text body
  }

  // JSON format returns parsed data
  return data;
}

async function postMessage(threadId, content, kind = 'comment') {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);

  if (!content || !content.trim()) {
    throw new Error('content is required');
  }

  if (!ALLOWED_MESSAGE_KINDS.includes(kind)) {
    throw new Error(`Invalid kind "${kind}". Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`);
  }

  const url = `${FORUM_BASE_URL}/api/threads/${safeId}/messages`;
  const { ok, status, data } = await fetchJson(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      content: content.trim(),
      kind,
    }),
  });

  if (!ok) throw new Error(`post-message failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.message;
}

async function getReadiness(threadId) {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}/review-readiness`;
  const { ok, status, data } = await fetchJson(url, { headers: authHeader() });
  if (!ok) throw new Error(`readiness failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

// ── CLI commands ─────────────────────────────────────────────────────────

async function cmdLogin() {
  const result = await login();
  // Print only safe user info (access token is never printed)
  console.log(JSON.stringify({
    loggedIn: true,
    agentId: result.user.agentId,
    name: result.user.name,
    role: result.user.role,
  }, null, 2));
}

async function cmdReadThread(threadId) {
  if (!threadId) {
    console.error('[forum-access] read-thread requires a threadId');
    process.exit(1);
  }
  await login();
  const thread = await getThread(threadId);
  // Always expose both threadId (full UUID) and shortId (display-only prefix)
  thread.threadId = thread.id;
  thread.shortId = thread.id ? thread.id.slice(0, 8) : '';
  console.log(JSON.stringify({ thread }, null, 2));
}

async function cmdReadTranscript(threadId, format) {
  if (!threadId) {
    console.error('[forum-access] read-transcript requires a threadId');
    process.exit(1);
  }

  const fmt = format === 'json' ? 'json' : 'md';
  await login();

  if (fmt === 'json') {
    const data = await getTranscript(threadId, 'json');
    // Ensure threadId is always present at top level for consumers
    if (data && data.thread && data.thread.id && !data.threadId) {
      data.threadId = data.thread.id;
    }
    console.log(JSON.stringify(data, null, 2));
  } else {
    const md = await getTranscript(threadId, 'md');
    process.stdout.write(md);
  }
}

async function cmdPostMessage(threadId, kind) {
  if (!threadId) {
    console.error('[forum-access] post-message requires a threadId');
    process.exit(1);
  }

  if (!kind) {
    console.error('[forum-access] post-message requires --kind <kind>');
    process.exit(1);
  }

  if (!ALLOWED_MESSAGE_KINDS.includes(kind)) {
    console.error(`[forum-access] Invalid kind "${kind}". Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`);
    process.exit(1);
  }

  // Read content from stdin (never from command line to avoid shell injection)
  const stdin = await readStdin();
  if (!stdin.trim()) {
    console.error('[forum-access] post-message: content must be provided via stdin');
    process.exit(1);
  }

  await login();
  const message = await postMessage(threadId, stdin.trim(), kind);
  console.log(JSON.stringify({
    status: 'posted',
    messageId: message.id,
    threadId: message.threadId,
    kind: message.kind,
  }, null, 2));
}

async function cmdListThreads() {
  await login();
  const data = await listThreads();
  // Always output threadId as full UUID (never truncated)
  for (const t of (data.threads || data.items || [])) {
    t.threadId = t.id;
    // Machine callers must use threadId (full UUID); shortId is display-only
    t.shortId = t.id ? t.id.slice(0, 8) : '';
  }
  console.log(JSON.stringify(data, null, 2));
}

async function cmdReadiness(threadId) {
  if (!threadId) {
    console.error('[forum-access] readiness requires a threadId');
    process.exit(1);
  }
  await login();
  const readiness = await getReadiness(threadId);

  // Readiness output is always read-only
  const safe = {
    threadId,
    ready: readiness.ready,
    requiredReviewerIds: readiness.requiredReviewerIds || [],
    completedReviewerIds: readiness.completedReviewerIds || [],
    pendingReviewerIds: readiness.pendingReviewerIds || [],
    waivedReviewerIds: readiness.waivedReviewerIds || [],
  };
  console.log(JSON.stringify(safe, null, 2));
}

// ── Stdin helper ─────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', (err) => reject(err));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.error(`Usage:
	  forum-access.mjs login                           — authenticate and print agent info
	  forum-access.mjs list-threads                    — list all threads (returns full UUID)
	  forum-access.mjs read-thread <threadId>          — fetch thread metadata
	  forum-access.mjs read-transcript <threadId>      — fetch transcript as markdown
	  forum-access.mjs read-transcript <threadId> --format json  — fetch transcript as JSON
	  forum-access.mjs post-message <threadId> --kind <kind>     — post message (content from stdin)
	  forum-access.mjs readiness <threadId>            — check required reviewer gate (read-only)

NOTE: threadId must always be the complete UUID (e.g. 52423a12-a9d7-45a4-a144-63b15247aee2).
The 8-character display prefix (e.g. 52423a12) cannot be used for API calls.

Supported message kinds: ${ALLOWED_MESSAGE_KINDS.join(', ')}

Environment variables:
  AGENT_FORUM_BASE_URL      (default: http://localhost:3460)
  AUTH_SERVICE_URL          (default: http://localhost:3457)
  AGENT_FORUM_PRE_SIGNED_TOKEN  (required)
`);
    process.exit(1);
  }

  try {
	    switch (cmd) {
	      case 'login':
	        await cmdLogin();
	        break;

	      case 'list-threads':
	        await cmdListThreads();
	        break;

	      case 'read-thread': {
        const threadId = args[1];
        await cmdReadThread(threadId);
        break;
      }

      case 'read-transcript': {
        const threadId = args[1];
        const formatIdx = args.indexOf('--format');
        const format = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1] : 'md';
        await cmdReadTranscript(threadId, format);
        break;
      }

      case 'post-message': {
        const threadId = args[1];
        const kindIdx = args.indexOf('--kind');
        const kind = kindIdx !== -1 && args[kindIdx + 1] ? args[kindIdx + 1] : null;
        await cmdPostMessage(threadId, kind);
        break;
      }

      case 'readiness':
        await cmdReadiness(args[1]);
        break;

      default:
        console.error(`[forum-access] Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    // Print safe error (no stack traces, no tokens)
    console.error(`[forum-access] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
