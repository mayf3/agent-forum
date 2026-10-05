/**
 * AF-3 startup-probe child entry (tests/helpers/af3-startup-child.mjs).
 *
 * Spawned as an isolated child process by tests/af3-retired-env-gates.test.ts.
 * Imports the real Forum app under a controlled environment and reports the
 * outcome on stdout:
 *   AF3_CHILD_OK                       — app imported (and health probed when
 *                                        AF3_CHILD_MODE=health), exit 0
 *   AF3_CHILD_IMPORT_FAILED <detail>   — import threw (e.g. ZodError), exit 1
 *   AF3_CHILD_HEALTH_FAILED <detail>   — /api/health not 200 {ok:true}, exit 1
 *
 * Modes:
 *   import-app (default) — import src/app.ts only. No listen (NODE_ENV=test),
 *                          no DB connection (Prisma client is lazy), no network
 *                          (the JWKS fetch happens on first token verify only).
 *   health               — additionally swap an in-memory Prisma mock in via
 *                          the existing setPrisma() test hook and assert
 *                          GET /api/health returns 200 {ok:true} via supertest.
 *
 * No real database, network or live service is contacted in any mode.
 */

const mode = process.env.AF3_CHILD_MODE || 'import-app';

try {
  if (mode === 'health') {
    const prismaMod = await import('../../src/lib/prisma.js');
    prismaMod.setPrisma({
      $queryRaw: async () => [{ 1: 1 }],
      $disconnect: async () => {},
    });
  }

  const appMod = await import('../../src/app.js');
  if (!appMod || !appMod.app) {
    console.log('AF3_CHILD_IMPORT_FAILED app-export-missing');
    process.exit(1);
  }

  if (mode === 'health') {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;
    // supertest binds an ephemeral loopback port per request — no listen, no
    // external interface.
    const res = await supertest(appMod.app).get('/api/health');
    if (res.status !== 200 || res.body?.ok !== true) {
      console.log(
        `AF3_CHILD_HEALTH_FAILED status=${res.status} body=${JSON.stringify(res.body)}`,
      );
      process.exit(1);
    }
  }

  console.log('AF3_CHILD_OK');
  process.exit(0);
} catch (err) {
  const isZod = !!err && err.name === 'ZodError';
  const paths =
    isZod && Array.isArray(err.issues)
      ? err.issues.map((i) => (i.path || []).join('.')).join(',')
      : '';
  const firstLine = String((err && err.message) || err).split('\n')[0].slice(0, 200);
  console.log(
    `AF3_CHILD_IMPORT_FAILED ${isZod ? 'ZodError' : (err && err.name) || 'Error'} paths=${paths} msg=${firstLine}`,
  );
  process.exit(1);
}
