#!/usr/bin/env node

/**
 * agent-forum-access — Shared OpenClaw skill for Agent Forum thin access.
 *
 * Provides four capabilities:
 *   1. login           — obtain a standard OAuth access token, cache in-process
 *   2. read-thread     — fetch thread metadata
 *   3. read-transcript — fetch thread transcript (markdown or JSON)
 *   4. post-message    — post a message to a thread (content from stdin)
 *   5. readiness       — check required reviewer gate status (read-only)
 *
 * No task/inbox/claim/complete/fail/cron concepts.  Only notification-driven
 * agent collaboration.
 *
 * ── Authentication: standard OAuth2 client_credentials ──────────────────────
 * Obtains an RS256 access token from the auth-service `/oauth/token` endpoint:
 *   POST /oauth/token
 *   Content-Type: application/x-www-form-urlencoded
 *   Authorization: Basic base64(client_id:client_secret)
 *   grant_type=client_credentials&resource=svc-forum&scope=forum.read forum.write
 *
 * Credentials come from (never from arguments/stdin):
 *   AGENT_FORUM_CLIENT_ID          (required)
 *   AGENT_FORUM_CLIENT_SECRET      (optional — raw client_secret)
 *   AGENT_FORUM_CLIENT_SECRET_FILE (optional — path to file with client_secret)
 *
 * Token lifecycle (short-lived, matches the auth-service TTL):
 *   - Cached in-memory only; refreshed proactively before `exp`.
 *   - Concurrent callers share a single refresh Promise (deduplication).
 *   - On a GET that receives a clear token-invalid error (TOKEN_INVALID_OR_EXPIRED),
 *     clear the cache, refresh once, and retry exactly once; a second failure stops.
 *   - Contract errors (TOKEN_CONTRACT_INVALID), permission errors (403),
 *     and JWKS-unavailable (503) do NOT trigger a refresh.
 *   - POST/PUT/DELETE are never auto-retried (the token is refreshed so the
 *     caller can retry the operation explicitly).
 *
 * This script does NOT use:
 *   - abandoned token-login endpoint (Forum-specific, removed)
 *   - AGENT_FORUM_PRE_SIGNED_TOKEN / pre-signed JWT
 *   - AGENT_FORUM_JWT_SECRET / local JWT minting
 *
 * Environment variables:
 *   AGENT_FORUM_BASE_URL       (default: http://localhost:3460)
 *   AUTH_SERVICE_URL           (default: http://localhost:4001)
 *   AGENT_FORUM_CLIENT_ID      (required)
 *   AGENT_FORUM_CLIENT_SECRET  (optional — or use _FILE)
 *   AGENT_FORUM_CLIENT_SECRET_FILE (optional)
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

import { readFileSync } from 'node:fs';

// ── Config from environment ──────────────────────────────────────────────

const FORUM_BASE_URL = process.env.AGENT_FORUM_BASE_URL || 'http://localhost:3460';
const AUTH_URL       = process.env.AUTH_SERVICE_URL    || 'http://localhost:4001';
const CLIENT_ID        = process.env.AGENT_FORUM_CLIENT_ID || '';
const CLIENT_SECRET      = process.env.AGENT_FORUM_CLIENT_SECRET || '';
const CLIENT_SECRET_FILE = process.env.AGENT_FORUM_CLIENT_SECRET_FILE || '';

// Resolve client_secret: prefer direct env var, fall back to file.
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

if (!CLIENT_ID || !_resolvedClientSecret) {
  console.error(
    '[forum-access] FATAL: Standard OAuth credentials not configured.\n' +
    '  Set AGENT_FORUM_CLIENT_ID and AGENT_FORUM_CLIENT_SECRET (or AGENT_FORUM_CLIENT_SECRET_FILE).'
  );
  process.exit(1);
}

// ── Constants ────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;        // 15 seconds
const MAX_RESPONSE_SIZE = 500_000;     // 500 KB
const PRE_REFRESH_SECONDS = 60;        // refresh 60s before expiry
const ALLOWED_MESSAGE_KINDS = ['comment', 'proposal', 'challenge', 'clarification', 'evidence'];

// Standard OAuth request constants.
const OAUTH_RESOURCE = 'svc-forum';
const OAUTH_SCOPE = 'forum.read forum.write';

// ── Token cache ──────────────────────────────────────────────────────────

let _cachedAccessToken = null;   // raw JWT string
let _cachedExpiresAt = 0;        // unix timestamp (seconds); 0 = unknown
let _refreshPromise = null;      // shared Promise to deduplicate concurrent refreshes

// ── Safe HTTP helper ─────────────────────────────────────────────────────

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
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

// ── Auth: standard OAuth client_credentials ──────────────────────────────

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
 * Obtain a standard OAuth access token from /oauth/token and cache it.
 */
async function doLogin() {
  const url = `${AUTH_URL}/oauth/token`;
  const credentials = Buffer.from(`${CLIENT_ID}:${_resolvedClientSecret}`).toString('base64');
  const body = `grant_type=client_credentials&resource=${encodeURIComponent(OAUTH_RESOURCE)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`;

  const { ok, status, data } = await fetchResponse(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!ok) {
    const msg = (data && (data.error_description || data.message)) ||
                (data && data.error) ||
                `Login failed (HTTP ${status})`;
    throw new Error(msg);
  }

  // Standard OAuth uses snake_case `access_token`.
  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error('Login response missing access_token');
  }

  _cachedAccessToken = data.access_token;
  _cachedExpiresAt = decodeExp(data.access_token);
  return data;
}

/**
 * Get a valid access token, refreshing if needed.
 * Concurrent calls share a single refresh Promise (deduplication).
 */
async function getAccessToken() {
  const nowSec = Date.now() / 1000;
  const needsRefresh =
    !_cachedAccessToken ||
    (_cachedExpiresAt > 0 && nowSec >= _cachedExpiresAt - PRE_REFRESH_SECONDS);

  if (needsRefresh) {
    if (!_refreshPromise) {
      _refreshPromise = doLogin()
        .then(() => {
          _refreshPromise = null;
          return _cachedAccessToken;
        })
        .catch((err) => {
          _refreshPromise = null;
          throw err;
        });
    }
    return _refreshPromise;
  }

  return _cachedAccessToken;
}

/**
 * Force-clear the cached token (used on a token-invalid 401).
 */
function clearTokenCache() {
  _cachedAccessToken = null;
  _cachedExpiresAt = 0;
}

async function authHeader() {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

// ── Error-code helpers ───────────────────────────────────────────────────

/**
 * A response error the client may refresh in response to.
 * Only TOKEN_INVALID_OR_EXPIRED means the token is stale/expired and a fresh
 * token could help. CONTRACT_INVALID, INSUFFICIENT_SCOPE, and AUTH_JWKS_UNAVAILABLE
 * must NOT trigger a refresh.
 */
function isRefreshableTokenError(status, data) {
  return status === 401 && data && data.error === 'TOKEN_INVALID_OR_EXPIRED';
}

// ── Authenticated request with 401 handling ─────────────────────────────

/**
 * Wrapper around fetchResponse that handles token-invalid 401s for GET:
 *   - On a refreshable token error: clear cache, refresh once, retry once.
 *   - On a contract/permission/503 error: surface as-is (no refresh).
 *   - POST/PUT/DELETE: never auto-retry (the cache is cleared so the caller
 *     can refresh + retry explicitly).
 */
async function authenticatedFetch(method, url, bodyPayload = null) {
  const headers = await authHeader();
  const body = bodyPayload ? JSON.stringify(bodyPayload) : undefined;

  const result = await fetchResponse(url, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });

  if (isRefreshableTokenError(result.status, result.data)) {
    clearTokenCache();

    if (method === 'GET') {
      // Retry exactly once with a freshly minted token.
      const freshHeaders = await authHeader();
      const retryResult = await fetchResponse(url, {
        method,
        headers: { ...freshHeaders, 'Content-Type': 'application/json' },
        body,
      });
      if (isRefreshableTokenError(retryResult.status, retryResult.data)) {
        // Second consecutive token failure — stop.
        throw new Error('Token refresh failed after retry — authentication rejected');
      }
      return retryResult;
    }

    // Write operations: refresh but do NOT retry.
    throw new Error('Authentication expired (HTTP 401) — token refreshed, please retry operation');
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
  const result = await doLogin();
  // Print only safe info derived from the token (the access token itself is never printed).
  const claims = decodeTokenClaims(result.access_token);
  console.log(JSON.stringify({
    loggedIn: true,
    agentId: claims.agent_id || '',
    principalId: claims.sub || '',
    clientId: claims.client_id || '',
    scope: claims.scope || OAUTH_SCOPE,
    expiresIn: result.expires_in,
  }, null, 2));
}

/**
 * Decode a JWT payload (without verification) to read identity claims for
 * the login summary. Signature is verified by the server, not here.
 */
function decodeTokenClaims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return {};
  }
}

async function cmdReadThread(threadId) {
  if (!threadId) {
    console.error('[forum-access] read-thread requires a threadId');
    process.exit(1);
  }
  await getAccessToken(); // ensure logged in
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
  await getAccessToken(); // ensure logged in

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

  await getAccessToken(); // ensure logged in
  const message = await postMessage(threadId, stdin.trim(), kind);
  console.log(JSON.stringify({
    status: 'posted',
    messageId: message.id,
    threadId: message.threadId,
    kind: message.kind,
  }, null, 2));
}

async function cmdListThreads() {
  await getAccessToken(); // ensure logged in
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
  await getAccessToken(); // ensure logged in
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

Authentication (standard OAuth2 client_credentials):
  AGENT_FORUM_BASE_URL          (default: http://localhost:3460)
  AUTH_SERVICE_URL              (default: http://localhost:4001)
  AGENT_FORUM_CLIENT_ID         (required)
  AGENT_FORUM_CLIENT_SECRET     (or AGENT_FORUM_CLIENT_SECRET_FILE)
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
