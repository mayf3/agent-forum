/**
 * Shared test JWKS mock HTTP server.
 *
 * Starts a lightweight HTTP server that serves the test RSA public key as a
 * JWKS document (/.well-known/jwks.json).
 *
 * IMPORTANT: this module depends only on ./test-keys.ts (pure jose) so it can
 * be imported WITHOUT triggering src/config/env.js. Integration tests that
 * exercise the production auth middleware must:
 *
 *   1. startTestJwksServer()           → bind a port, get the URL
 *   2. process.env.AUTH_JWKS_URL = url → set BEFORE importing any src module
 *   3. import auth-keys / routes       → auth-jwt.ts freezes the URL at load
 *
 * This keeps production code free of request-time env reads and test hooks.
 */

import { createServer } from 'node:http';
import { testJwks } from './test-keys.js';

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
 * Convenience: start the JWKS server and set process.env.AUTH_JWKS_URL.
 * Call this BEFORE importing any src module (auth-keys.ts, routes, middleware).
 * Returns the server handle for the `after` cleanup hook.
 */
export async function setupTestJwks() {
  const server = await startTestJwksServer();
  process.env.AUTH_JWKS_URL = server.url;
  return server;
}
