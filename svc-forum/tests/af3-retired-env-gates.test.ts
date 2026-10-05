/**
 * AF-3 regression — retired identity env values must not block Forum startup.
 *
 * The Forum app verifies inbound tokens via RS256 + JWKS (see
 * src/lib/auth-jwt.ts). The legacy shared-secret fields JWT_SECRET /
 * AUTH_JWT_SECRET and the retired FORUM_IDENTITY_MODE selector have no runtime
 * consumer in this process, yet leftover values in a shared environment used
 * to throw a ZodError during the global env.parse() at app import — taking
 * down content routes, the health route and valid RS256 requests together.
 *
 * Each case below spawns an isolated child process (tests/helpers/
 * af3-startup-child.mjs) that imports the real app under a controlled env:
 *   - baseline / retired-value cases must import cleanly (exit 0);
 *   - the health case additionally proves /api/health serves {ok:true}
 *     through the existing setPrisma() test hook (no real database);
 *   - a preservation case proves unrelated invalid config (AUTH_JWKS_URL) is
 *     still rejected, i.e. required-config validation is not weakened.
 *
 * No real database, network or live service is contacted by any case.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const svcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const childEntry = path.join(svcRoot, 'tests', 'helpers', 'af3-startup-child.mjs');

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runStartupProbe(
  mode: string,
  extraEnv: Record<string, string>,
): Promise<ChildResult> {
  // Controlled environment: the three retired fields are scrubbed from the
  // inherited machine env so each case's explicit value is the only source.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.JWT_SECRET;
  delete env.AUTH_JWT_SECRET;
  delete env.FORUM_IDENTITY_MODE;
  env.NODE_ENV = 'test';
  env.AF3_CHILD_MODE = mode;
  Object.assign(env, extraEnv);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childEntry], {
      cwd: svcRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d;
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function assertStartupOk(r: ChildResult): void {
  const detail = `child exit=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`;
  assert.equal(r.status, 0, detail);
  assert.ok(r.stdout.includes('AF3_CHILD_OK'), detail);
}

// [field, leftover value] pairs that must no longer block startup.
const RETIRED_VALUES: Array<[string, string]> = [
  ['JWT_SECRET', 'short'],
  ['JWT_SECRET', ''],
  ['AUTH_JWT_SECRET', 'short'],
  ['AUTH_JWT_SECRET', ''],
  ['FORUM_IDENTITY_MODE', 'retired-identity-mode'],
];

describe('AF-3 retired identity env gates must not block startup', () => {
  it('baseline: valid required config imports the app (control)', async () => {
    assertStartupOk(await runStartupProbe('import-app', {}));
  });

  for (const [field, value] of RETIRED_VALUES) {
    it(`retired value does not block import: ${field}=${value === '' ? '<empty>' : value}`, async () => {
      assertStartupOk(await runStartupProbe('import-app', { [field]: value }));
    });
  }

  it('health endpoint serves ok under valid config (setPrisma mock, no real DB)', async () => {
    assertStartupOk(await runStartupProbe('health', {}));
  });

  it('preservation: invalid AUTH_JWKS_URL is still rejected at startup', async () => {
    const r = await runStartupProbe('import-app', { AUTH_JWKS_URL: 'not-a-valid-url' });
    const detail = `child exit=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`;
    assert.equal(r.status, 1, detail);
    assert.ok(r.stdout.includes('AF3_CHILD_IMPORT_FAILED'), detail);
    assert.ok(r.stdout.includes('ZodError'), detail);
    assert.ok(r.stdout.includes('AUTH_JWKS_URL'), detail);
  });
});
