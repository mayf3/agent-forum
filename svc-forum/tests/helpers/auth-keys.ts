/**
 * Test helper for standard OAuth (RS256 + JWKS) token signing.
 *
 * Generates a single RSA keypair per test process and exposes:
 *   - signTestToken(overrides)  : sign an RS256 access token with full Forum claims
 *   - createTestVerifier()      : build a verifier bound to a local JWKS (no network),
 *                                 using createAccessTokenVerifier() from production code
 *   - testJwks                  : the JWKS document (for mock HTTP servers)
 *
 * This lets tests verify the REAL production verifier logic (auth-jwt.ts) with an
 * isolated key source — no mutable global state, no .env dependency, no network.
 *
 * Production verification is unchanged: createAccessTokenVerifier() is the same
 * function the server uses; tests only swap the key resolver.
 */

import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createLocalJWKSet } from 'jose';
import { createAccessTokenVerifier } from '../../src/lib/auth-jwt.js';

// ── Shared test keypair (generated once per process) ───────────────────────

const TEST_KID = 'test-key-1';

let _keypair: Awaited<ReturnType<typeof generateKeyPair>> | null = null;
let _publicJwk: any = null;

async function ensureKeyPair() {
  if (!_keypair) {
    _keypair = await generateKeyPair('RS256');
    _publicJwk = await exportJWK(_keypair.publicKey);
  }
  return _keypair;
}

/** JWKS document containing the test public key. */
export async function testJwks() {
  await ensureKeyPair();
  return { keys: [{ ..._publicJwk, kid: TEST_KID, use: 'sig', alg: 'RS256' }] };
}

export const TEST_KID_VALUE = TEST_KID;

// ── Token signing ──────────────────────────────────────────────────────────

export interface SignTokenOverrides {
  /** Override the kid in the protected header. */
  kid?: string;
  /** Override JWT.sub (MachinePrincipal.id). Default a valid UUID. */
  sub?: string;
  /** Override JWT.agent_id. Default 'test-agent'. */
  agent_id?: string;
  /** Override JWT.client_id. Default 'mc_test_client'. */
  client_id?: string;
  /** Override JWT.scope (space-separated). Default 'forum.read forum.write'. */
  scope?: string;
  /** Override JWT.type. Default 'access'. */
  type?: string;
  /** Override JWT.version. Default 'v1'. */
  version?: string;
  /** Override JWT.principal_type. Default 'agent'. */
  principal_type?: string;
  /** Override JWT.iss. Default 'auth-service'. */
  iss?: string;
  /** Override JWT.aud. Default 'svc-forum'. */
  aud?: string;
  /** Override expiration: seconds from now. Default 600. */
  expiresInSec?: number;
  /** Set a negative expiry (seconds ago) to produce an expired token. */
  expiredSecAgo?: number;
  /**
   * Sign with a DIFFERENT keypair (wrong signer) to produce a bad-signature token.
   * When true, a fresh throwaway keypair signs the token; the test JWKS still
   * only contains the original key, so verification fails.
   */
  wrongKey?: boolean;
}

const DEFAULT_SUB = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Sign an RS256 access token with the Forum contract claims.
 * Defaults produce a valid token; overrides let tests craft negative cases.
 */
export async function signTestToken(overrides: SignTokenOverrides = {}): Promise<string> {
  const kp = await ensureKeyPair();
  const signer = overrides.wrongKey ? await generateKeyPair('RS256') : kp;

  const now = Math.floor(Date.now() / 1000);
  const exp = overrides.expiredSecAgo
    ? now - overrides.expiredSecAgo
    : now + (overrides.expiresInSec ?? 600);

  const payload: Record<string, unknown> = {
    type: overrides.type ?? 'access',
    version: overrides.version ?? 'v1',
    principal_type: overrides.principal_type ?? 'agent',
    agent_id: overrides.agent_id ?? 'test-agent',
    client_id: overrides.client_id ?? 'mc_test_client',
    scope: overrides.scope ?? 'forum.read forum.write',
  };

  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? TEST_KID })
    .setIssuer(overrides.iss ?? 'auth-service')
    .setAudience(overrides.aud ?? 'svc-forum')
    .setIssuedAt(now)
    .setExpirationTime(exp);

  // sub: set only if provided or default; omit for "missing sub" tests by
  // passing sub: null explicitly.
  if (overrides.sub !== undefined) {
    builder = builder.setSubject(overrides.sub as string);
  } else {
    builder = builder.setSubject(DEFAULT_SUB);
  }

  return builder.sign(signer.privateKey);
}

// ── Verifier bound to the test keypair ─────────────────────────────────────

/**
 * Build a production-equivalent verifier backed by a local JWKS (no network).
 * This exercises the real createAccessTokenVerifier() logic in isolation.
 */
export async function createTestVerifier() {
  return createAccessTokenVerifier(createLocalJWKSet(await testJwks()));
}
