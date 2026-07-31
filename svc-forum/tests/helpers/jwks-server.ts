/**
 * Shared test JWKS mock HTTP server.
 *
 * Starts a lightweight HTTP server that serves the test RSA public key as a
 * JWKS document (/.well-known/jwks.json). Tests that exercise the production
 * auth middleware set `process.env.AUTH_JWKS_URL` to point here before the
 * first lazy `verifyAuthAccessToken` call, so the production verifier fetches
 * the test public key.
 *
 * Usage (in a test file before section):
 *   import { startTestJwksServer } from './helpers/jwks-server.js';
 *   let jwksUrl: string;
 *   let jwksServer: ReturnType<typeof startTestJwksServer>;
 *   before(async () => {
 *     jwksServer = await startTestJwksServer();
 *     process.env.AUTH_JWKS_URL = jwksServer.url;
 *   });
 *   after(() => jwksServer.close());
 */

import { createServer } from 'node:http';
import { testJwks } from './auth-keys.js';

export async function startTestJwksServer() {
  const jwks = await testJwks();
  const jwksBody = JSON.stringify(jwks);

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(jwksBody);
  });

  return new Promise<{
    url: string;
    close: () => void;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3999;
      resolve({
        url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
        close: () => { server.close(); },
      });
    });
  });
}

/**
 * Convenience: call this in the `before` hook of a test suite to set up JWKS
 * and return the cleanup function for `after`.
 */
export async function setupTestJwks() {
  const server = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = server.url;
  return server;
}
