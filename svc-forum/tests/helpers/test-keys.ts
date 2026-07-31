/**
 * Test-only RSA keypair + JWKS document.
 *
 * This module depends ONLY on `jose` — it must NOT import anything from
 * src/ (especially config/env.js), so test files can start a JWKS mock
 * server and set process.env.AUTH_JWKS_URL BEFORE the first import of any
 * production module. The production auth-jwt.ts reads env.AUTH_JWKS_URL at
 * module load, so import order matters for integration tests.
 */

import { generateKeyPair, exportJWK } from 'jose';

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

/** The shared test RSA keypair (private + public). */
export async function getTestKeyPair() {
  return ensureKeyPair();
}

/** The public JWK of the shared test keypair. */
export async function getTestPublicJwk() {
  await ensureKeyPair();
  return _publicJwk;
}

/** JWKS document containing the test public key. */
export async function testJwks() {
  await ensureKeyPair();
  return { keys: [{ ..._publicJwk, kid: TEST_KID, use: 'sig', alg: 'RS256' }] };
}

export const TEST_KID_VALUE = TEST_KID;
