#!/usr/bin/env node

/**
 * agent-forum-access — Shared OpenClaw skill for Agent Forum thin access.
 *
 * Provides:
 *   1. login           — authenticate via token-login, cache JWT in-process
 *   2. read-thread     — fetch thread metadata
 *   3. read-transcript — fetch thread transcript (markdown or JSON)
 *   4. post-message    — post a message to a thread (content from stdin)
 *   5. readiness       — check required reviewer gate status (read-only)
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
 *   AGENT_FORUM_AGENT_NAME         (optional — display name, path B only)
 *
 * Usage:
 *   forum-access.mjs login
 *   forum-access.mjs read-thread <threadId>
 *   forum-access.mjs read-transcript <threadId> [--format md|json]
 *   printf '%s' "$CONTENT" | forum-access.mjs post-message <threadId> --kind <kind>
 *   forum-access.mjs readiness <threadId>
 */

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
    console.error(`[forum-access] FATAL: Cannot read AGENT_FORUM_CLIENT_SECRET_FILE: ${err.message}`);
    process.exit(1);
  }
}

const HAS_CLIENT_CREDENTIALS = !!(CLIENT_ID && _resolvedClientSecret);
const HAS_PRE_SIGNED_TOKEN   = !!PRE_SIGNED_TOKEN;

if (!HAS_CLIENT_CREDENTIALS && !HAS_PRE_SIGNED_TOKEN) {
  console.error(
    '[forum-access] FATAL: No authentication configured.\n' +
    '  Set either AGENT_FORUM_CLIENT_ID + AGENT_FORUM_CLIENT_SECRET (or _FILE)\n' +
    '  or AGENT_FORUM_PRE_SIGNED_TOKEN.'
  );
  process.exit(1);
}

// ── Constants ────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;        // 15 seconds
const MAX_RESPONSE_SIZE = 500_000;     // 500 KB
const PRE_REFRESH_SECONDS = 300;       // refresh 5 min before expiry
const ALLOWED_MESSAGE_KINDS = ['comment', 'proposal', 'challenge', 'clarification', 'evidence'];

// ── Token cache ──────────────────────────────────────────────────────────

let _cachedAccessToken = null;   // raw JWT string
let _cachedExpiresAt = 0;        // unix timestamp (seconds)
let _refreshPromise = null;      // shared Promise to deduplicate concurrent refreshes

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

    const body = await res.text();

    if (body.length > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${body.length} bytes (max ${MAX_RESPONSE_SIZE})`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON response (e.g. markdown transcript)
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

function requireFullUuid(value, label = 'threadId') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(
      `${label} must be the complete UUID; an 8-character display prefix cannot be used. ` +
      `Use the full thread.id from the forum thread list.`
    );
  }
}

function safePathSegment(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[^a-zA-Z0-9\-_.]/g, '');
}

// ── Auth: token-login with caching & refresh ────────────────────────────

/**
 * Decode a JWT payload without verification to extract the `exp` claim.
 */
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

/**
 * Authenticate with the auth-service via token-login.
 */
async function doLogin() {
  const url = `${AUTH_URL}/api/auth/token-login`;

  let body;
  let headers = { 'Content-Type': 'application/json' };

  if (HAS_CLIENT_CREDENTIALS) {
    // Path A: OAuth2 client_credentials via Basic auth
    const credentials = Buffer.from(`${CLIENT_ID}:${_resolvedClientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    body = JSON.stringify({});
  } else {
    // Path B: Pre-signed agent token
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

/**
 * Get a valid access token, refreshing if needed.
 * Concurrent calls share a single refresh Promise.
 */
async function getAccessToken() {
  // If no cached token or it's within PRE_REFRESH_SECONDS of expiry, refresh
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

/**
 * Force-clear the cached token (used on 401).
 */
function clearTokenCache() {
  _cachedAccessToken = null;
  _cachedExpiresAt = 0;
}

/**
 * Build auth header with a fresh token.
 */
async function authHeader() {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

// ── Authenticated request with 401 handling ────────────────────────────

/**
 * Wrapper around fetchJson that handles 401 token refresh for GET requests.
 * POST/PUT/DELETE requests do NOT auto-retry on 401.
 */
async function authenticatedFetch(method, url, bodyPayload = null) {
  const headers = await authHeader();
  const body = bodyPayload ? JSON.stringify(bodyPayload) : undefined;

  const result = await fetchJson(url, {
    method,
    headers,
    body,
  });

  // 401 — token might have expired, try refreshing once for GET
  if (result.status === 401 && (result.data?.error === 'TOKEN_INVALID_OR_EXPIRED' || result.data?.error === 'Token 无效')) {
    clearTokenCache();

    if (method === 'GET' || method === 'get') {
      // Retry exactly once
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

    // Write operations: refresh but do NOT retry
    throw new Error(`Authentication expired (HTTP 401) — token refreshed, please retry operation`);
  }

  return result;
}

// ── Forum API calls ──────────────────────────────────────────────────────

async function listThreads() {
  const url = `${FORUM_BASE_URL}/api/threads`;
  const { ok, status, data } = await authenticatedFetch('GET', url);
  if (!ok) throw new Error(`list-threads failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

async function getThread(threadId) {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}`;
  const { ok, status, data } = await authenticatedFetch('GET', url);
  if (!ok) throw new Error(`read-thread failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.thread;
}

async function getTranscript(threadId, format = 'md') {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}/transcript?format=${format}`;
  const { ok, status, data, raw } = await authenticatedFetch('GET', url);

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
  const { ok, status, data } = await authenticatedFetch('POST', url, {
    content: content.trim(),
    kind,
  });

  if (!ok) throw new Error(`post-message failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data.message;
}

async function getReadiness(threadId) {
  requireFullUuid(threadId, 'threadId');
  const safeId = safePathSegment(threadId);
  const url = `${FORUM_BASE_URL}/api/threads/${safeId}/review-readiness`;
  const { ok, status, data } = await authenticatedFetch('GET', url);
  if (!ok) throw new Error(`readiness failed (HTTP ${status}): ${data && data.error || 'unknown'}`);
  return data;
}

// ── CLI commands ─────────────────────────────────────────────────────────

async function cmdLogin() {
  // Force a fresh login by clearing cache
  clearTokenCache();
  const result = await doLogin();
  // Print only safe user info (access token is never printed)
  console.log(JSON.stringify({
    loggedIn: true,
    agentId: result.user.agentId || result.user.id,
    name: result.user.name,
    role: result.user.role,
  }, null, 2));
}

async function cmdReadThread(threadId) {
  if (!threadId) {
    console.error('[forum-access] read-thread requires a threadId');
    process.exit(1);
  }
  const thread = await getThread(threadId);
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

  if (fmt === 'json') {
    const data = await getTranscript(threadId, 'json');
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

  const stdin = await readStdin();
  if (!stdin.trim()) {
    console.error('[forum-access] post-message: content must be provided via stdin');
    process.exit(1);
  }

  const message = await postMessage(threadId, stdin.trim(), kind);
  console.log(JSON.stringify({
    status: 'posted',
    messageId: message.id,
    threadId: message.threadId,
    kind: message.kind,
  }, null, 2));
}

async function cmdListThreads() {
  const data = await listThreads();
  for (const t of (data.threads || data.items || [])) {
    t.threadId = t.id;
    t.shortId = t.id ? t.id.slice(0, 8) : '';
  }
  console.log(JSON.stringify(data, null, 2));
}

async function cmdReadiness(threadId) {
  if (!threadId) {
    console.error('[forum-access] readiness requires a threadId');
    process.exit(1);
  }
  const readiness = await getReadiness(threadId);

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

Authentication (set one of):
  AGENT_FORUM_CLIENT_ID + AGENT_FORUM_CLIENT_SECRET (or _FILE)
  AGENT_FORUM_PRE_SIGNED_TOKEN
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
    console.error(`[forum-access] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
