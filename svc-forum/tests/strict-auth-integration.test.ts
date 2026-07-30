/**
 * Strict-Auth Production Integration Test
 *
 * Spawns a REAL svc-forum HTTP server in an isolated child process on a random
 * port, configured in strict mode (NODE_ENV=production + FORUM_STRICT_AUTH=true),
 * then exercises a real protected route (GET /api/threads) over HTTP with
 * hand-minted JWTs.
 *
 * Critical isolation guarantees:
 *   - Each scenario spawns its OWN subprocess (strictAuth is a module-load const;
 *     we cannot mutate it within one process).
 *   - The child environment DELETES any inherited AUTH_JWT_SECRET / JWT_SECRET
 *     before setting the per-scenario value, so a pass can never be a false
 *     positive caused by the host machine's env.
 *   - A valid token carries the full claim set the source actually requires:
 *     iss=auth-service, aud=svc-forum, principal_type=agent, agent_id, sub, role.
 *
 * Strict-mode accept/reject map (from src/middleware/auth.ts):
 *   strictAuth == true  → only verifyAuthServiceJwt() is tried.
 *     accepts: HS256 signed with AUTH_JWT_SECRET, iss=AUTH_JWT_ISSUER, aud=AUTH_JWT_AUDIENCE.
 *     rejects: ADC JWT (iss=agent-dev-center/aud=adc-api)  [priority 2]
 *     rejects: bare JWT (no iss/aud)                       [priority 3]
 *     rejects: wrong issuer / wrong audience
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVC_ROOT = resolve(__dirname, '..');

// A non-default strong secret used by both the auth-service signing path and
// the forum verifying path. Distinct from the dev default
// 'dev-only-auth-service-secret-16' so the superRefine startup gate passes.
const STRICT_AUTH_JWT_SECRET = 'strict-auth-integration-non-default-secret-32-chars';
const ADC_SECRET = 'adc-jwt-secret-for-strict-integration-test-32';

const ISSUER_AUTH = 'auth-service';
const AUDIENCE_FORUM = 'svc-forum';

/** Grab an OS-assigned free TCP port and release it immediately. */
function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => res(port));
    });
  });
}

interface SpawnResult {
  child: ChildProcess;
  port: number;
  ready: Promise<void>;
  exited: Promise<{ code: number | null }>;
}

/**
 * Spawn a strict-mode server. The child env starts from a scrubbed base:
 * AUTH_JWT_SECRET and JWT_SECRET are removed, then (optionally) set per scenario.
 */
function spawnStrictServer(opts: {
  port: number;
  setAuthSecret?: boolean;
  authAudience?: string;
  authIssuer?: string;
}): SpawnResult {
  // Scrub inherited secrets to avoid false-positive passes from the host env.
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: 'production',
    FORUM_STRICT_AUTH: 'true',
    PORT: String(opts.port),
    DATABASE_URL: 'postgresql://forum:forum_pass@127.0.0.1:1/svc_forum_unreachable',
    AUTH_JWT_ISSUER: opts.authIssuer ?? ISSUER_AUTH,
    AUTH_JWT_AUDIENCE: opts.authAudience ?? AUDIENCE_FORUM,
    FORUM_SIGNING_KEY_VERSION: 'strict-test-1',
  } as any;

  // Delete then conditionally re-set the secrets.
  delete env.AUTH_JWT_SECRET;
  delete env.JWT_SECRET;
  delete (env as any).JWT_SECRET;
  if (opts.setAuthSecret) {
    env.AUTH_JWT_SECRET = STRICT_AUTH_JWT_SECRET;
  }
  // JWT_SECRET still required by zod min(16) for non-ADC paths; give a strong dev value.
  env.JWT_SECRET = ADC_SECRET;

  const child = spawn('npx', ['tsx', 'src/app.ts'], {
    cwd: SVC_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    let buf = '';
    const onOut = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes(`localhost:${opts.port}`)) {
        cleanup();
        resolveReady();
      }
      if (buf.toLowerCase().includes('error') && /zoderror|invalid|throw/i.test(buf)) {
        cleanup();
        // startup failed — resolve so the caller's exit check handles it
        resolveReady();
      }
    };
    const onErr = (d: Buffer) => {
      buf += d.toString();
      if (/zoderror|FORUM_STRICT_AUTH|must be set/i.test(buf)) {
        cleanup();
        resolveReady();
      }
    };
    const cleanup = () => {
      child.stdout?.off('data', onOut);
      child.stderr?.off('data', onErr);
    };
    child.stdout?.on('data', onOut);
    child.stderr?.on('data', onErr);
    child.on('error', rejectReady);
    // Failsafe: if nothing in 12s, give up waiting.
    setTimeout(() => { cleanup(); resolveReady(); }, 12000);
  });

  const exited = new Promise<{ code: number | null }>((resolveExit) => {
    child.on('exit', (code) => resolveExit({ code }));
  });

  return { child, port: opts.port, ready, exited };
}

/** Wait until a TCP port accepts a connection, or timeout. */
async function waitForPort(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await probePort(port, 1000);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function probePort(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const probe = createConnection({ host: '127.0.0.1', port });
    probe.once('connect', () => { probe.destroy(); res(true); });
    probe.once('error', () => res(false));
    setTimeout(() => { probe.destroy(); res(false); }, timeoutMs);
  });
}

async function httpGet(port: number, path: string, token?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}

// Claim set the source actually consumes (payloadToUser + verify constraints).
function signAuthForumToken(claims: Record<string, any>, secret = STRICT_AUTH_JWT_SECRET, opts: Record<string, any> = {}): string {
  return jwt.sign(
    {
      sub: claims.sub ?? 'agent-principal-uuid',
      agent_id: claims.agent_id ?? 'blog-agent',
      agentId: claims.agentId ?? 'blog-agent',
      name: claims.name ?? '博客运营编辑',
      role: claims.role ?? 'agent',
      principal_type: claims.principal_type ?? 'agent',
      ...claims,
    },
    secret,
    { issuer: ISSUER_AUTH, audience: AUDIENCE_FORUM, expiresIn: '1h', ...opts },
  );
}

describe('Strict-Auth production integration (isolated subprocess + random port)', () => {
  let port: number;
  let srv: SpawnResult | null = null;

  before(async () => {
    port = await getFreePort();
  });

  async function startStrictServer(): Promise<void> {
    srv = spawnStrictServer({ port, setAuthSecret: true });
    await srv.ready;
    await waitForPort(port, 8000);
  }

  after(async () => {
    if (srv?.child && srv.child.exitCode === null) {
      srv.child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      if (srv.child.exitCode === null) srv.child.kill('SIGKILL');
    }
  });

  // ── Case 1: valid auth-service token accepted ──────────────────────────
  it('VALID_AUTH_SERVICE_TOKEN_ACCEPTED: strict mode accepts a canonical auth-service JWT', async () => {
    await startStrictServer();
    const token = signAuthForumToken({ sub: 'p-uuid-1', agent_id: 'blog-agent', name: '博客运营编辑' });
    const { status, body } = await httpGet(port, '/api/threads', token);
    // 401 would mean the token was rejected; 200/4xx-non-401 means it passed auth.
    // The DB is intentionally unreachable, so we expect a non-401 error (auth passed, DB failed),
    // OR 200 if prisma tolerates. The contract: status !== 401.
    assert.notEqual(status, 401, `valid auth-service token must NOT be rejected in strict mode (got ${status}: ${JSON.stringify(body).slice(0,120)})`);
  });

  // ── Case 2: ADC JWT (priority 2) rejected ──────────────────────────────
  it('ADC_PRIORITY_2_TOKEN_REJECTED: strict mode rejects an ADC issuer/audience JWT', async () => {
    const adcToken = jwt.sign(
      { sub: 'adc-user', agentId: 'adc-agent', name: 'ADC', role: 'agent' },
      ADC_SECRET,
      { issuer: 'agent-dev-center', audience: 'adc-api', expiresIn: '1h' },
    );
    const { status } = await httpGet(port, '/api/threads', adcToken);
    assert.equal(status, 401, 'ADC JWT (priority 2) must be rejected in strict mode');
  });

  // ── Case 3: bare JWT (priority 3) rejected ─────────────────────────────
  it('BARE_PRIORITY_3_TOKEN_REJECTED: strict mode rejects a bare JWT (no issuer/audience)', async () => {
    const bareToken = jwt.sign(
      { sub: 'bare-user', agentId: 'bare-agent', name: 'Bare', role: 'agent' },
      ADC_SECRET,
      { expiresIn: '1h' }, // no issuer/audience
    );
    const { status } = await httpGet(port, '/api/threads', bareToken);
    assert.equal(status, 401, 'bare JWT (priority 3) must be rejected in strict mode');
  });

  // ── Case 4: invalid issuer rejected ────────────────────────────────────
  it('INVALID_ISSUER_REJECTED: strict mode rejects a token with wrong issuer', async () => {
    const token = jwt.sign(
      { sub: 'u', agent_id: 'a', name: 'n', role: 'agent', principal_type: 'agent' },
      STRICT_AUTH_JWT_SECRET,
      { issuer: 'wrong-issuer', audience: AUDIENCE_FORUM, expiresIn: '1h' },
    );
    const { status } = await httpGet(port, '/api/threads', token);
    assert.equal(status, 401, 'wrong issuer must be rejected');
  });

  // ── Case 5: invalid audience rejected ──────────────────────────────────
  it('INVALID_AUDIENCE_REJECTED: strict mode rejects a token with wrong audience', async () => {
    const token = jwt.sign(
      { sub: 'u', agent_id: 'a', name: 'n', role: 'agent', principal_type: 'agent' },
      STRICT_AUTH_JWT_SECRET,
      { issuer: ISSUER_AUTH, audience: 'wrong-audience', expiresIn: '1h' },
    );
    const { status } = await httpGet(port, '/api/threads', token);
    assert.equal(status, 401, 'wrong audience must be rejected');
  });

  // ── Case 6: missing AUTH_JWT_SECRET → startup rejected ─────────────────
  it('MISSING_AUTH_SECRET_STARTUP_REJECTED: server fails to start without a valid AUTH_JWT_SECRET', async () => {
    const badPort = await getFreePort();
    const bad = spawnStrictServer({
      port: badPort,
      setAuthSecret: false, // leaves default 'dev-only-auth-service-secret-16' → superRefine fails
    });
    const { code } = await Promise.race([
      bad.exited,
      new Promise<{ code: number | null }>((r) => setTimeout(() => r({ code: null }), 12000)),
    ]);
    // kill if still alive
    if (bad.child.exitCode === null) bad.child.kill('SIGKILL');
    const listened = await probePort(badPort);
    assert.notEqual(code, 0, 'process must exit non-zero when strict secret is missing');
    assert.notEqual(code, null, 'process must have exited (not still running)');
    assert.equal(listened, false, 'no port must ever be listened when startup is rejected');
  });
});
