/**
 * T58 regression — AF-JWKS-HTTP-ERROR-CLASSIFICATION.
 * Production wiring (createRemoteJWKSet wrapped by withJwksAvailabilityProbe —
 * the exact composition verifyAuthAccessToken uses) against a scriptable JWKS
 * HTTP fixture. Infrastructure failures MUST classify AUTH_JWKS_UNAVAILABLE
 * (503, non-refreshable); token-side failures stay in the token-invalid family.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { SignJWT, generateKeyPair, exportJWK, createRemoteJWKSet } from 'jose'

const { createAccessTokenVerifier, withJwksAvailabilityProbe } = await import('../src/lib/auth-jwt.js')

const kp = await generateKeyPair('RS256', { extractable: true })
const pub = await exportJWK(kp.publicKey)
pub.kid = 't58-key'
pub.alg = 'RS256'
pub.use = 'sig'

let mode: 'ok' | 'e500json' | 'e500empty' | 'e503json' | 'e503empty' | 'dead' = 'ok'
const srv = createServer((_q, r) => {
  if (mode === 'ok') { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ keys: [pub] })); return }
  if (mode === 'e500json') { r.writeHead(500, { 'content-type': 'application/json' }); r.end(JSON.stringify({ error: 'x' })); return }
  if (mode === 'e500empty') { r.writeHead(500); r.end(); return }
  if (mode === 'e503json') { r.writeHead(503, { 'content-type': 'application/json' }); r.end(JSON.stringify({ error: 'x' })); return }
  if (mode === 'e503empty') { r.writeHead(503); r.end(); return }
  r.socket.destroy()
})
await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
srv.unref()
const url = new URL(`http://127.0.0.1:${(srv.address() as any).port}/.well-known/jwks.json`)

async function sign(kid = 't58-key', ttl = 600) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ type: 'access', version: 'v1', principal_type: 'agent', agent_id: 'agt-t58', client_id: 'mc-t58', scope: 'forum.read' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer('auth-service').setAudience('svc-forum')
    .setSubject('550e8400-e29b-41d4-a716-446655440058')
    .setIssuedAt(now).setExpirationTime(now + ttl)
    .sign(kp.privateKey)
}

const good = await sign()
const expired = await sign('t58-key', -600)
const unknownKid = await sign('no-such-kid')

test('infrastructure failures classify AUTH_JWKS_UNAVAILABLE (503, non-refreshable)', async () => {
  const tk = {
    a: await sign('k-500a'), b: await sign('k-500b'), c: await sign('k-503a'),
    d: await sign('k-503b'), e: await sign('k-dead'),
  }
  for (const [label, m, tok] of [
    ['500 json body', 'e500json', tk.a],
    ['500 empty body', 'e500empty', tk.b],
    ['503 json body', 'e503json', tk.c],
    ['503 empty body', 'e503empty', tk.d],
    ['connection refused', 'dead', tk.e],
  ] as const) {
    mode = m
    const verifier = createAccessTokenVerifier(withJwksAvailabilityProbe(createRemoteJWKSet(new URL(url.href), { cooldownDuration: 0 }), url))
    await assert.rejects(() => verifier(tok), (e: any) => {
      assert.equal(e.code, 'AUTH_JWKS_UNAVAILABLE', `${label}: expected 503 class, got ${e.code}`)
      return true
    }, label)
  }
})

test('healthy endpoint: token-side failures keep token-invalid family', async () => {
  mode = 'ok'
  const verifier = createAccessTokenVerifier(withJwksAvailabilityProbe(createRemoteJWKSet(new URL(url.href), { cooldownDuration: 0 }), url))
  await verifier(await sign()) // control: verifies
  await assert.rejects(async () => verifier(await sign('t58-key', -600)), (e: any) => e.code === 'TOKEN_INVALID_OR_EXPIRED')
  await assert.rejects(async () => verifier(await sign('no-such-kid-2')), (e: any) => e.code === 'TOKEN_INVALID_OR_EXPIRED')
})

test('control: valid token verifies end-to-end', async () => {
  mode = 'ok'
  const verifier = createAccessTokenVerifier(withJwksAvailabilityProbe(createRemoteJWKSet(new URL(url.href), { cooldownDuration: 0 }), url))
  const result = (await verifier(await sign())) as any
  assert.equal(result.principalType, 'agent')
  srv.close()
})
