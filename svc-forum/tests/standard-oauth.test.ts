/**
 * Standard OAuth (RS256 + JWKS) acceptance tests — verifier unit tests.
 *
 * Covers the verification layer using the factory pattern with a local key
 * source (no network). These tests do NOT use the production middleware or
 * the lazy remote-JWKS singleton, so they are fully independent.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet } from 'jose';
import {
  createAccessTokenVerifier,
} from '../src/lib/auth-jwt.js';
import {
  signTestToken,
  createTestVerifier,
  testJwks,
} from './helpers/auth-keys.js';

let verify: Awaited<ReturnType<typeof createTestVerifier>>;

before(async () => {
  verify = await createTestVerifier();
});

void describe('verifier — auth-jwt.ts unit tests', async () => {

  await it('STANDARD_OAUTH_TOKEN_ACCEPTED=true', async () => {
    const result = await verify(await signTestToken());
    assert.ok(result.agentId);
    assert.equal(result.principalType, 'agent');
    assert.ok(result.scopes.has('forum.read'));
    assert.ok(result.scopes.has('forum.write'));
  });

  await it('INVALID_ISSUER_REJECTED=true', async () => {
    const token = await signTestToken({ iss: 'attacker' });
    try {
      await verify(token);
      assert.fail('should reject');
    } catch (e: any) {
      assert.equal(e.code, 'TOKEN_CONTRACT_INVALID');
    }
  });

  await it('INVALID_AUDIENCE_REJECTED=true', async () => {
    const token = await signTestToken({ aud: 'other-service' });
    try {
      await verify(token);
      assert.fail('should reject');
    } catch (e: any) {
      assert.equal(e.code, 'TOKEN_CONTRACT_INVALID');
    }
  });

  await it('NON_ACCESS_TOKEN_REJECTED=true', async () => {
    const token = await signTestToken({ type: 'refresh' });
    try {
      await verify(token);
      assert.fail('should reject');
    } catch (e: any) {
      assert.equal(e.code, 'TOKEN_CONTRACT_INVALID');
    }
  });

  await it('INVALID_PRINCIPAL_TYPE_REJECTED=true', async () => {
    const token = await signTestToken({ principal_type: 'user' });
    try {
      await verify(token);
      assert.fail('should reject');
    } catch (e: any) {
      assert.equal(e.code, 'TOKEN_CONTRACT_INVALID');
    }
  });

  await it('HS256_TOKEN_REJECTED=true', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const hsToken = jwt.sign(
      { sub: 'x', iss: 'auth-service', aud: 'svc-forum',
        type: 'access', version: 'v1', principal_type: 'agent',
        agent_id: 'a', client_id: 'c', scope: 'forum.read' },
      'some-symmetric-secret',
    );
    try {
      await verify(hsToken);
      assert.fail('should reject HS256');
    } catch (e: any) {
      assert.equal(e.code, 'TOKEN_INVALID_OR_EXPIRED');
    }
  });

  await it('MISSING_KID_REJECTED=true', async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const altJwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'alt', use: 'sig', alg: 'RS256' }] });
    const altVerify = createAccessTokenVerifier(altJwks);

    const noKid = await new SignJWT({
      type: 'access', version: 'v1', principal_type: 'agent',
      agent_id: 'a', client_id: 'c', scope: 'forum.read',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('x').setIssuer('auth-service').setAudience('svc-forum')
      .setIssuedAt().setExpirationTime('5m')
      .sign(privateKey);

    try { await altVerify(noKid); assert.fail('should reject'); }
    catch (e: any) { assert.equal(e.code, 'TOKEN_CONTRACT_INVALID'); }
  });

  await it('EXPIRED token → TOKEN_INVALID_OR_EXPIRED', async () => {
    const token = await signTestToken({ expiredSecAgo: 120 });
    try { await verify(token); assert.fail('should reject'); }
    catch (e: any) { assert.equal(e.code, 'TOKEN_INVALID_OR_EXPIRED'); }
  });

  await it('UNKNOWN_KID_REJECTED → TOKEN_INVALID_OR_EXPIRED', async () => {
    // Create a verifier with test-key-1 only.
    const jwks = await testJwks();
    const localVerify = createAccessTokenVerifier(createLocalJWKSet(jwks));
    const token = await signTestToken({ kid: 'non-existent-key' });
    try { await localVerify(token); assert.fail('should reject'); }
    catch (e: any) { assert.equal(e.code, 'TOKEN_INVALID_OR_EXPIRED'); }
  });

  await it('TOKEN_CONTRACT_INVALID not refreshable (wrong_code ≠ TOKEN_INVALID_OR_EXPIRED)', async () => {
    const token = await signTestToken({ iss: 'wrong' });
    try { await verify(token); }
    catch (e: any) {
      assert.notEqual(e.code, 'TOKEN_INVALID_OR_EXPIRED');
    }
  });

  await it('NAME_CLAIM_NOT_REQUIRED=true', async () => {
    // Standard OAuth tokens have no `name` claim — the verifier core should
    // not require it.
    const result = await verify(await signTestToken({}));
    assert.ok(result.agentId);
  });

  await it('LOCAL_JWT_MINTING_ABSENT=true', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/lib/auth-jwt.ts', 'utf-8');
    assert.ok(!src.includes('mintAgentJwt'), 'auth-jwt.ts must not have JWT minting');
    assert.ok(!src.includes('jwt.sign'), 'auth-jwt.ts must not create JWTs');
  });

  await it('SPECIAL_TOKEN_LOGIN_PATH_ABSENT=true', async () => {
    const fs = await import('node:fs');
    const clientSrc = fs.readFileSync(
      '../openclaw-skills/agent-forum-access/scripts/forum-access.mjs', 'utf-8',
    );
    // Comment-only references to the abandoned path are OK.
    // Check that no runtime invocation of the endpoint exists.
    const nonComment = clientSrc.split('\n')
      .filter((l: string) => !/^\s*(\/\/|\*)/.test(l));
    const hasRuntimeTokenLogin = nonComment.some((l: string) => l.includes('token-login'));
    assert.ok(!hasRuntimeTokenLogin, 'no runtime code should reference token-login');
  });

  await it('DISPLAY_NAME_FALLBACK_TO_AGENT_ID=true', async () => {
    // Direct verifier check: the payload has no name, so the derived identity
    // comes from agentId. The middleware integration is tested in scope tests.
    const result = await verify(await signTestToken({ agent_id: 'fallback-agent' }));
    assert.equal(result.agentId, 'fallback-agent');
  });

  await it('CLIENT_USES_OAUTH_TOKEN_ENDPOINT=true (source assertion)', async () => {
    const fs = await import('node:fs');
    const clientSrc = fs.readFileSync(
      '../openclaw-skills/agent-forum-access/scripts/forum-access.mjs', 'utf-8',
    );
    assert.ok(clientSrc.includes('/oauth/token'), 'client must call /oauth/token');
    assert.ok(clientSrc.includes('x-www-form-urlencoded'), 'client must use form-encoded body');
    assert.ok(clientSrc.includes('client_credentials'), 'client must use client_credentials grant');
  });
});
