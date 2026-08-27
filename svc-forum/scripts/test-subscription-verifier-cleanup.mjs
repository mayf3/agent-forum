#!/usr/bin/env node

// Fault-injection tests for verify-subscription-storage.mjs.
// Run only against a freshly migrated disposable PostgreSQL database.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a freshly migrated disposable PostgreSQL database.');
  process.exit(2);
}

const verifierPath = fileURLToPath(new URL('./verify-subscription-storage.mjs', import.meta.url));
const oldPrincipalId = '81000000-0000-0000-0000-000000000001';
const oldThreadId = '82000000-0000-0000-0000-000000000001';
const sentinelPrincipalId = randomUUID();
const sentinelThreadId = randomUUID();
const sentinelMarker = `subscription-verifier-test-sentinel:${randomUUID()}`;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql, tuplesOnly = false) {
  const args = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];
  if (tuplesOnly) args.push('--tuples-only', '--no-align');
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim();
}

function parseFixture(output) {
  const value = (name) => {
    const match = output.match(new RegExp(`^${name}=(.+)$`, 'm'));
    if (!match) throw new Error(`verifier output omitted ${name}`);
    return match[1].trim();
  };
  return {
    runId: value('FIXTURE_RUN_ID'),
    marker: value('FIXTURE_OWNERSHIP_MARKER'),
    principalId: value('FIXTURE_PRINCIPAL_ID'),
    threadId: value('FIXTURE_THREAD_ID'),
    firstWatchId: value('FIXTURE_FIRST_WATCH_ID'),
    secondWatchId: value('FIXTURE_SECOND_WATCH_ID'),
  };
}

function runVerifier(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, output, fixture: parseFixture(output) }));
  });
}

function runVerifierUntilSetup(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: {
        ...process.env,
        SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl,
        SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const inspect = (chunk) => {
      output += chunk;
      if (!settled && output.includes('TEST_PAUSE_AFTER_SETUP=READY')) {
        settled = true;
        resolve({ child, fixture: parseFixture(output), getOutput: () => output });
      }
    };
    child.stdout.on('data', (chunk) => inspect(chunk.toString()));
    child.stderr.on('data', (chunk) => inspect(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (!settled) reject(new Error(`verifier exited before setup pause: code=${code} signal=${signal}\n${output}`));
    });
  });
}

function runVerifierUntilLocks() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: {
        ...process.env,
        SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl,
        SUBSCRIPTION_VERIFIER_TEST_FAULT: 'signal-active',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const inspect = (chunk) => {
      output += chunk;
      if (!settled && output.includes('CONCURRENCY_LOCKS_READY') && output.includes('SECOND_SESSION_STARTED=YES')) {
        settled = true;
        resolve({ child, fixture: parseFixture(output), getOutput: () => output });
      }
    };
    child.stdout.on('data', (chunk) => inspect(chunk.toString()));
    child.stderr.on('data', (chunk) => inspect(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (!settled) reject(new Error(`verifier exited before active-child signal boundary: code=${code} signal=${signal}\n${output}`));
    });
  });
}

function waitForExit(child, getOutput) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output: getOutput() }));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCounts(fixture) {
  return psql(`
SELECT
  (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(fixture.principalId)}::uuid),
  (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(fixture.threadId)}::uuid),
  (SELECT count(*) FROM public.forum_read_states WHERE thread_id=${sqlLiteral(fixture.threadId)}::uuid AND principal_id=${sqlLiteral(fixture.principalId)}::uuid),
  (SELECT count(*) FROM public.forum_watch_subscriptions WHERE id IN (${sqlLiteral(fixture.firstWatchId)}::uuid,${sqlLiteral(fixture.secondWatchId)}::uuid));
`, true).replaceAll('|', ',');
}

function assertRunClean(fixture, label) {
  assert(runCounts(fixture) === '0,0,0,0', `${label}: owned fixture residue remained (${runCounts(fixture)})`);
}

function assertSentinelPreserved(label) {
  const actual = psql(`
SELECT count(*) FROM public.forum_principals
WHERE id=${sqlLiteral(sentinelPrincipalId)}::uuid
  AND auth_subject=${sqlLiteral(sentinelMarker)} AND agent_id=${sqlLiteral(sentinelMarker)};
SELECT count(*) FROM public.forum_threads
WHERE id=${sqlLiteral(sentinelThreadId)}::uuid
  AND title=${sqlLiteral(sentinelMarker)} AND "createdById"=${sqlLiteral(sentinelMarker)};
`, true).split('\n').join(',');
  assert(actual === '1,1', `${label}: preexisting sentinel parent changed (${actual})`);
}

async function expectFault(fault, label, expectedOutput) {
  const result = await runVerifier({ SUBSCRIPTION_VERIFIER_TEST_FAULT: fault });
  assert(result.code !== 0, `${label}: verifier unexpectedly succeeded`);
  if (expectedOutput) {
    assert(result.output.includes(expectedOutput), `${label}: expected fault output ${expectedOutput} was absent:\n${result.output}`);
  }
  assertRunClean(result.fixture, label);
  assertSentinelPreserved(label);
  console.log(`${label}=PASS`);
}

function externalCleanup(fixture) {
  const marker = sqlLiteral(fixture.marker);
  const principal = sqlLiteral(fixture.principalId);
  const thread = sqlLiteral(fixture.threadId);
  psql(`
BEGIN;
DELETE FROM public.forum_read_states r
USING public.forum_principals p, public.forum_threads t
WHERE r.thread_id=${thread}::uuid AND r.principal_id=${principal}::uuid
  AND p.id=r.principal_id AND p.auth_subject=${marker} AND p.agent_id=${marker}
  AND t.id=r.thread_id AND t.title=${marker} AND t."createdById"=${marker};
DELETE FROM public.forum_watch_subscriptions w
USING public.forum_principals p, public.forum_threads t
WHERE w.id IN (${sqlLiteral(fixture.firstWatchId)}::uuid,${sqlLiteral(fixture.secondWatchId)}::uuid)
  AND w.thread_id=${thread}::uuid AND w.principal_id=${principal}::uuid
  AND p.id=w.principal_id AND p.auth_subject=${marker} AND p.agent_id=${marker}
  AND t.id=w.thread_id AND t.title=${marker} AND t."createdById"=${marker};
DELETE FROM public.forum_threads WHERE id=${thread}::uuid AND title=${marker} AND "createdById"=${marker};
DELETE FROM public.forum_principals WHERE id=${principal}::uuid AND auth_subject=${marker} AND agent_id=${marker};
COMMIT;
`);
}

try {
  psql(`
BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
  (${sqlLiteral(sentinelPrincipalId)},${sqlLiteral(sentinelMarker)},${sqlLiteral(sentinelMarker)},now()),
  (${sqlLiteral(oldPrincipalId)},'old-fixed-verifier-principal','old-fixed-verifier-agent',now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
  (${sqlLiteral(sentinelThreadId)},${sqlLiteral(sentinelMarker)},${sqlLiteral(sentinelMarker)},'sentinel',now(),now()),
  (${sqlLiteral(oldThreadId)},'old fixed verifier thread','old-fixed-owner','old-fixed-owner',now(),now());
COMMIT;
`);

  const fixedRegression = await runVerifier();
  assert(fixedRegression.code === 0, `fixed-ID regression verifier failed:\n${fixedRegression.output}`);
  assert(fixedRegression.fixture.principalId !== oldPrincipalId, 'new verifier reused old fixed Principal UUID');
  assert(fixedRegression.fixture.threadId !== oldThreadId, 'new verifier reused old fixed Thread UUID');
  assertRunClean(fixedRegression.fixture, 'fixed-ID regression');
  const oldRows = psql(`
SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(oldPrincipalId)}::uuid AND auth_subject='old-fixed-verifier-principal' AND agent_id='old-fixed-verifier-agent';
SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(oldThreadId)}::uuid AND title='old fixed verifier thread' AND "createdById"='old-fixed-owner';
`, true).split('\n').join(',');
  assert(oldRows === '1,1', `fixed-ID regression changed preexisting old fixture (${oldRows})`);
  console.log('FIXED_UUID_REGRESSION_TEST=PASS');

  const collisionId = randomUUID();
  const collisionMarker = `foreign-collision:${randomUUID()}`;
  psql(`INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES (${sqlLiteral(collisionId)},${sqlLiteral(collisionMarker)},${sqlLiteral(collisionMarker)},now());`);
  const collision = await runVerifier({ SUBSCRIPTION_VERIFIER_TEST_PRINCIPAL_ID: collisionId });
  assert(collision.code !== 0, 'setup collision verifier unexpectedly succeeded');
  assert(!collision.output.includes('SETUP_COMMITTED=YES'), 'setup collision falsely reported a committed fixture');
  const collisionPreserved = psql(`SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(collisionId)}::uuid AND auth_subject=${sqlLiteral(collisionMarker)} AND agent_id=${sqlLiteral(collisionMarker)};`, true);
  assert(collisionPreserved === '1', 'setup collision deleted or modified preexisting Principal');
  assert(psql(`SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(collision.fixture.threadId)}::uuid;`, true) === '0', 'atomic setup left Thread after Principal collision');
  assertSentinelPreserved('setup collision');
  psql(`DELETE FROM public.forum_principals WHERE id=${sqlLiteral(collisionId)}::uuid AND auth_subject=${sqlLiteral(collisionMarker)} AND agent_id=${sqlLiteral(collisionMarker)};`);
  console.log('SETUP_COLLISION_TEST=PASS');
  console.log('SETUP_CONFLICT_NONDESTRUCTIVE=PASS');

  await expectFault('setup-postcommit-before-ack', 'POST_COMMIT_ACK_FAILURE_CLEANUP', 'post-COMMIT pre-acknowledgement failure');
  const cleanupRetry = await runVerifier({ SUBSCRIPTION_VERIFIER_TEST_FAULT: 'cleanup-first-failure' });
  assert(cleanupRetry.code === 0, `cleanup retry verifier failed:\n${cleanupRetry.output}`);
  assert(cleanupRetry.output.includes('CLEANUP_ATTEMPT=1') && cleanupRetry.output.includes('CLEANUP_ATTEMPT=2'), 'cleanup retry did not execute two guarded attempts');
  assertRunClean(cleanupRetry.fixture, 'cleanup retry');
  assertSentinelPreserved('cleanup retry');
  console.log('CLEANUP_RETRY_AFTER_TRANSIENT_FAILURE=PASS');

  await expectFault('first-before-ready', 'FIRST_SESSION_FAILURE_CLEANUP');
  await expectFault('first-after-ready', 'FIRST_SESSION_AFTER_READY_CLEANUP');
  await expectFault('second-failure', 'SECOND_SESSION_FAILURE_CLEANUP');
  await expectFault('lock-timeout', 'LOCK_TIMEOUT_CLEANUP', 'lock timeout');
  await expectFault('statement-timeout', 'STATEMENT_TIMEOUT_CLEANUP', 'statement timeout');

  const sigterm = await runVerifierUntilLocks();
  const sigtermExit = waitForExit(sigterm.child, sigterm.getOutput);
  sigterm.child.kill('SIGTERM');
  sigterm.child.kill('SIGHUP');
  const sigtermResult = await sigtermExit;
  assert(sigtermResult.code !== 0 || sigtermResult.signal, 'SIGTERM verifier unexpectedly exited successfully');
  assert(sigtermResult.output.includes('CATCHABLE_SIGNAL_CLEANUP=PASS'), `SIGTERM handler did not report cleanup:\n${sigtermResult.output}`);
  assertRunClean(sigterm.fixture, 'SIGTERM');
  assertSentinelPreserved('SIGTERM');
  console.log('SIGTERM_CLEANUP=PASS');
  console.log('CLEANUP_REENTRANCY_GUARD=PASS');

  const sigkill = await runVerifierUntilSetup();
  const sigkillExit = waitForExit(sigkill.child, sigkill.getOutput);
  sigkill.child.kill('SIGKILL');
  const sigkillResult = await sigkillExit;
  assert(sigkillResult.signal === 'SIGKILL', `SIGKILL boundary returned unexpected exit (${sigkillResult.code}, ${sigkillResult.signal})`);
  assert(runCounts(sigkill.fixture) === '1,1,1,0', `SIGKILL did not leave the expected identifiable setup residue (${runCounts(sigkill.fixture)})`);
  const identifiable = psql(`
SELECT count(*) FROM public.forum_principals p JOIN public.forum_threads t ON t.id=${sqlLiteral(sigkill.fixture.threadId)}::uuid
WHERE p.id=${sqlLiteral(sigkill.fixture.principalId)}::uuid
  AND p.auth_subject=${sqlLiteral(sigkill.fixture.marker)} AND p.agent_id=${sqlLiteral(sigkill.fixture.marker)}
  AND t.title=${sqlLiteral(sigkill.fixture.marker)} AND t."createdById"=${sqlLiteral(sigkill.fixture.marker)};
`, true);
  assert(identifiable === '1', 'SIGKILL residue was not identifiable by exact ownership marker');
  externalCleanup(sigkill.fixture);
  assertRunClean(sigkill.fixture, 'SIGKILL external recovery');
  externalCleanup(sigkill.fixture);
  assertRunClean(sigkill.fixture, 'SIGKILL external recovery retry');
  assertSentinelPreserved('SIGKILL');
  console.log('SIGKILL_BOUNDARY_TEST=PASS');
  console.log('SIGKILL_RESIDUE_OWNERSHIP_IDENTIFIABLE=PASS');

  console.log('PREEXISTING_PARENT_PRESERVATION=PASS');
  console.log('CLEANUP_IDEMPOTENT_FOR_OWNED_FIXTURES=PASS');
  console.log('SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS');
} finally {
  psql(`
BEGIN;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(sentinelThreadId)}::uuid
  AND title=${sqlLiteral(sentinelMarker)} AND "createdById"=${sqlLiteral(sentinelMarker)};
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(oldThreadId)}::uuid
  AND title='old fixed verifier thread' AND "createdById"='old-fixed-owner';
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(sentinelPrincipalId)}::uuid
  AND auth_subject=${sqlLiteral(sentinelMarker)} AND agent_id=${sqlLiteral(sentinelMarker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(oldPrincipalId)}::uuid
  AND auth_subject='old-fixed-verifier-principal' AND agent_id='old-fixed-verifier-agent';
COMMIT;
`);
}
