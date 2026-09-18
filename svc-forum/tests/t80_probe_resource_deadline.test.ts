/**
 * T80 regression — AF-SCOUT-08 probe resource boundary.
 *
 * OWNER_DECISION_COMMIT (OWNER_GATE_MATERIALIZATION_AND_NIGHTLY_RELEASE_20260916_V1,
 * BOUNDED_FIX_AUTHORIZED): ONE bounded deadline must cover fetch, response
 * body consumption and resource release of the availability probe; equivalent
 * concurrent probes may share in-flight work. The T58 error taxonomy and
 * token semantics are untouched.
 *
 * Baseline RED (pre-fix): a JWKS endpoint with delayed headers hung the
 * probe (and token verification) forever; a never-ending response body left
 * the socket pinned; N concurrent resolver failures fired N endpoint fetches.
 *
 * Run: npx tsx --test tests/t80_probe_resource_deadline.test.ts
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'

const { withJwksAvailabilityProbe } = await import('../src/lib/auth-jwt.js')

/** Resolver that always fails like a jose key-selection error. */
function failingResolver(failure: Error) {
  return async () => {
    throw failure
  }
}

function resolverFailure() {
  const err: any = new Error('T80 simulated resolver failure')
  err.code = 'T80_RESOLVER_FAILURE'
  return err
}

/** Fixture modes exercised by the four legs. */
type Mode = 'hang-headers' | 'never-ending-body' | 'counting-503' | 'counting-ok'

function startFixture(mode: Mode, delayMs = 0): Promise<{
  srv: Server
  url: URL
  requests: () => number
  connectionsClosed: () => Promise<void>
}> {
  let requestCount = 0
  let resolveClosed: (() => void) | null = null
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  const srv = createServer((req, res) => {
    requestCount += 1
    if (mode === 'hang-headers') return // never respond
    if (mode === 'never-ending-body') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write(JSON.stringify({ keys: [] })) // headers + one chunk, never end
      return
    }
    setTimeout(() => {
      if (mode === 'counting-503') { res.writeHead(503); res.end() }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [] })) }
    }, delayMs)
  })
  return new Promise(resolve => {
    srv.unref()
    srv.listen(0, '127.0.0.1', () => {
      srv.on('connection', (socket) => {
        socket.once('close', () => resolveClosed!())
      })
      resolve({
        srv,
        url: new URL(`http://127.0.0.1:${(srv.address() as any).port}/.well-known/jwks.json`),
        requests: () => requestCount,
        connectionsClosed: () => closed,
      })
    })
  })
}

async function settleWithin(p: Promise<unknown>, ms: number): Promise<{ settled: boolean }> {
  let settled = true
  const watchdog = new Promise<void>(resolve => setTimeout(() => { settled = false; resolve() }, ms))
  await Promise.race([p.catch(() => {}), watchdog])
  return { settled }
}

test('T80-A: delayed-headers endpoint cannot hang the probe — deadline aborts into AUTH_JWKS_UNAVAILABLE', { timeout: 8000 }, async () => {
  const fx = await startFixture('hang-headers')
  try {
    const probe = withJwksAvailabilityProbe(failingResolver(resolverFailure()), fx.url, { probeDeadlineMs: 250 })
    const started = Date.now()
    await assert.rejects(
      () => probe({ alg: 'RS256', kid: 'k' } as any, {} as any),
      (e: any) => e.code === 'AUTH_JWKS_UNAVAILABLE',
      'an endpoint that cannot answer in time is unavailable (taxonomy unchanged)',
    )
    assert.ok(Date.now() - started < 2000, `probe must settle at the deadline, took ${Date.now() - started}ms`)
  } finally {
    fx.srv.close()
  }
})

test('T80-B: never-ending response body — deadline covers the body phase and the socket is released', { timeout: 8000 }, async () => {
  const fx = await startFixture('never-ending-body')
  try {
    const probe = withJwksAvailabilityProbe(failingResolver(resolverFailure()), fx.url, { probeDeadlineMs: 250 })
    const started = Date.now()
    await assert.rejects(
      () => probe({ alg: 'RS256', kid: 'k' } as any, {} as any),
      (e: any) => e.code === 'T80_RESOLVER_FAILURE',
      'healthy-status endpoint: the original resolver error is re-raised (taxonomy unchanged)',
    )
    assert.ok(Date.now() - started < 2000, `probe must settle after releasing the body, took ${Date.now() - started}ms`)
    // Resource release: cancelling the never-ending body destroys the socket.
    const closed = await settleWithin(fx.connectionsClosed(), 1500)
    assert.ok(closed.settled, 'server socket must be released after the probe settles')
  } finally {
    fx.srv.close()
  }
})

test('T80-C: concurrent resolver failures share ONE in-flight probe fetch', { timeout: 8000 }, async () => {
  const fx = await startFixture('counting-503', 150)
  try {
    const probe = withJwksAvailabilityProbe(failingResolver(resolverFailure()), fx.url, { probeDeadlineMs: 3000 })
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        probe({ alg: 'RS256', kid: 'k' } as any, {} as any).then(
          () => 'resolved',
          (e: any) => e.code,
        )),
    )
    for (const code of outcomes) assert.equal(code, 'AUTH_JWKS_UNAVAILABLE')
    assert.equal(fx.requests(), 1, `concurrent probes must share in-flight work, saw ${fx.requests()} fetches`)
  } finally {
    fx.srv.close()
  }
})

test('T80-D: taxonomy guard — 503 under the deadline still classifies AUTH_JWKS_UNAVAILABLE', { timeout: 8000 }, async () => {
  const fx = await startFixture('counting-503', 0)
  try {
    const probe = withJwksAvailabilityProbe(failingResolver(resolverFailure()), fx.url, { probeDeadlineMs: 3000 })
    await assert.rejects(
      () => probe({ alg: 'RS256', kid: 'k' } as any, {} as any),
      (e: any) => {
        assert.equal(e.code, 'AUTH_JWKS_UNAVAILABLE')
        assert.match(e.message, /probe status 503/, 'message shape unchanged')
        return true
      },
    )
  } finally {
    fx.srv.close()
  }
})
