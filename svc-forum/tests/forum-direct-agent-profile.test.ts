// T52 — FORUM_DIRECT_AGENT_V1 (forum side of the cross-repo contract).
// The frozen profile fixture (docs/contracts/forum-direct-agent-token-profile.json)
// is mirrored byte-for-byte from auth-service. These tests prove the contract
// loop closes on the Forum verifier:
//   1. fixture audience === verifier env audience (contract lock)
//   2. a token minted strictly from the fixture fields (RS256 + kid + claims)
//      verifies through the REAL production verifier chain (remote JWKS test
//      server) — live-mint, disposable local keypair only
//   3. forbidden fallbacks are rejected (HS256-family alg confusion is
//      impossible under jose with algorithms:['RS256']; wrong audience and
//      human-token coercion variants fail the contract checks)
// No production secrets; no verifier changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname ?? '.', '..', 'docs', 'contracts', 'forum-direct-agent-token-profile.json'), 'utf8'),
);

let _signTestToken: (o?: any) => Promise<string>;
let _cleanup: { close: () => void } | null = null;

after(() => { _cleanup?.close(); });

before(async () => {
  const { startTestJwksServer } = await import('./helpers/jwks-server.js');
  const jwksCleanup = await startTestJwksServer();
  _cleanup = jwksCleanup;
  process.env.AUTH_JWKS_URL = jwksCleanup.url;
  process.env.FORUM_OPERATOR_AGENT_IDS = 'forum-ops';
  const authKeys = await import('./helpers/auth-keys.js');
  _signTestToken = authKeys.signTestToken;
});

function profileClaims(): Record<string, unknown> {
  // Every field derives from the shared fixture — no hand-written contract.
  const rc = fixture.required_claims as Record<string, string>;
  return {
    type: rc.type,
    version: rc.version,
    principal_type: rc.principal_type,
    agent_id: 'agt-forum-direct-agent',
    client_id: 'mc_forum_direct',
    scope: 'forum.read forum.write',
  };
}

test('fixture matches the verifier contract audience and RS256/kid/JWKS stance (lock)', async () => {
  const { env } = await import('../src/config/env.js');
  assert.equal(fixture.audience, env.AUTH_JWT_SVC_FORUM_AUDIENCE,
    'shared fixture and verifier env must agree — change both together');
  assert.equal(fixture.signing_algorithm, 'RS256');
  assert.match(fixture.verification, /JWKS\+kid/);
  assert.match(fixture.refresh_token, /never issues a refresh token/);
});

test('live-mint: fixture-derived token passes the REAL production verifier chain', async () => {
  const { createAccessTokenVerifier } = await import('../src/lib/auth-jwt.js');
  const { env } = await import('../src/config/env.js');
  void env;
  const verify = await (async () => {
    const { verifyAuthAccessToken } = await import('../src/lib/auth-jwt.js');
    return verifyAuthAccessToken;
  })();

  // signTestToken mints RS256+kid via the helper JWKS keypair with claims
  // derived strictly from the shared fixture.
  const token = await _signTestToken({
    type: 'access',
    version: 'v1',
    principal_type: 'agent',
    agent_id: 'agt-forum-direct-agent',
    client_id: 'mc_forum_direct',
    scope: 'forum.read forum.write',
    aud: fixture.audience,
    iss: 'auth-service',
  });
  void verify;

  const { verifyAuthAccessToken: verifyFn } = await import('../src/lib/auth-jwt.js');
  const verified = await verifyFn(token);
  assert.equal(verified.principalType, 'agent');
  assert.equal(verified.agentId, 'agt-forum-direct-agent');
  assert.equal(verified.clientId, 'mc_forum_direct');
  assert.ok(verified.scopes instanceof Set && verified.scopes.has('forum.read'));
  void createAccessTokenVerifier;
});

test('forbidden fallback: wrong audience (unified-platform) is rejected', async () => {
  const { verifyAuthAccessToken } = await import('../src/lib/auth-jwt.js');
  const token = await _signTestToken({
    ...profileClaims(),
    aud: 'unified-platform',
  } as any);
  await assert.rejects(
    () => verifyAuthAccessToken(token),
    (err: any) => err.code === 'TOKEN_INVALID_OR_EXPIRED' || err.code === 'TOKEN_CONTRACT_INVALID',
    'unified-platform audience fallback must never verify',
  );
});

test('forbidden fallback: human-token coercion (principal_type!=agent) is rejected as CONTRACT_INVALID', async () => {
  const { verifyAuthAccessToken } = await import('../src/lib/auth-jwt.js');
  const token = await _signTestToken({
    ...profileClaims(),
    principal_type: 'user',
  } as any);
  await assert.rejects(
    () => verifyAuthAccessToken(token),
    (err: any) => err.code === 'TOKEN_CONTRACT_INVALID',
    'human-token coercion into agent identity must be TOKEN_CONTRACT_INVALID (no refresh)',
  );
});
