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

// Coordinator mode identity: the external parallel-isolation coordinator
// prespawns the harness run/sentinel identity and optionally the held child's
// fixture identity through explicit test-only environment variables. Without
// them the independent harness path keeps generating its own random UUIDs.
const harnessCoordinatorFields = {
  RUN_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_RUN_ID',
  SENTINEL_PRINCIPAL_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_SENTINEL_PRINCIPAL_ID',
  SENTINEL_THREAD_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_SENTINEL_THREAD_ID',
};
const harnessChildCoordinatorFields = {
  RUN_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_RUN_ID',
  PRINCIPAL_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_PRINCIPAL_ID',
  THREAD_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_THREAD_ID',
  FIRST_WATCH_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_FIRST_WATCH_ID',
  SECOND_WATCH_ID: 'SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_SECOND_WATCH_ID',
};

function readUuidGroup(fields, label) {
  const present = Object.values(fields).filter((name) => process.env[name] !== undefined);
  if (present.length === 0) return null;
  const missing = Object.values(fields).filter((name) => process.env[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`${label} environment variables must be set together; missing ${missing.join(', ')}`);
  }
  const values = {};
  for (const [field, envName] of Object.entries(fields)) {
    const value = process.env[envName];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`invalid ${label} ${field} UUID: ${value}`);
    }
    values[field] = value;
  }
  return values;
}

const harnessCoordinatorIdentity = readUuidGroup(harnessCoordinatorFields, 'coordinator harness identity');
const harnessChildCoordinatorIdentity = readUuidGroup(harnessChildCoordinatorFields, 'coordinator harness child identity');
if (harnessChildCoordinatorIdentity
  && new Set([
    harnessChildCoordinatorIdentity.PRINCIPAL_ID,
    harnessChildCoordinatorIdentity.THREAD_ID,
    harnessChildCoordinatorIdentity.FIRST_WATCH_ID,
    harnessChildCoordinatorIdentity.SECOND_WATCH_ID,
  ]).size !== 4) {
  throw new Error('coordinator harness child identity fixture IDs are not distinct');
}
if (harnessCoordinatorIdentity && harnessCoordinatorIdentity.SENTINEL_PRINCIPAL_ID === harnessCoordinatorIdentity.SENTINEL_THREAD_ID) {
  throw new Error('coordinator harness sentinel IDs are not distinct');
}

const harnessRunId = harnessCoordinatorIdentity?.RUN_ID ?? randomUUID();
const harnessOwnershipMarker = `subscription-verifier-harness:${harnessRunId}`;
const sentinelPrincipalId = harnessCoordinatorIdentity?.SENTINEL_PRINCIPAL_ID ?? randomUUID();
const sentinelThreadId = harnessCoordinatorIdentity?.SENTINEL_THREAD_ID ?? randomUUID();
const sentinelMarker = harnessOwnershipMarker;
const activeChildren = new Set();
const knownFixtures = new Map();
const harnessFault = process.env.SUBSCRIPTION_CLEANUP_HARNESS_FAULT ?? '';
const pauseAfterSentinel = process.env.SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_AFTER_SENTINEL === '1';
const pauseWithChild = process.env.SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD === '1';
let harnessCleanupStarted = false;

console.log(`HARNESS_RUN_ID=${harnessRunId}`);
console.log(`HARNESS_OWNERSHIP_MARKER=${harnessOwnershipMarker}`);
console.log(`HARNESS_SENTINEL_PRINCIPAL_ID=${sentinelPrincipalId}`);
console.log(`HARNESS_SENTINEL_THREAD_ID=${sentinelThreadId}`);

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql, tuplesOnly = false) {
  const args = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];
  if (tuplesOnly) args.push('--tuples-only', '--no-align');
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim();
}

function parseFixture(stdout) {
  const value = (name) => {
    const matches = [...stdout.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`verifier output omitted or duplicated ${name}`);
    return matches[0][1].trim();
  };
  const fixture = {
    runId: value('FIXTURE_RUN_ID'),
    marker: value('FIXTURE_OWNERSHIP_MARKER'),
    principalId: value('FIXTURE_PRINCIPAL_ID'),
    threadId: value('FIXTURE_THREAD_ID'),
    firstWatchId: value('FIXTURE_FIRST_WATCH_ID'),
    secondWatchId: value('FIXTURE_SECOND_WATCH_ID'),
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [name, value] of Object.entries(fixture)) {
    if (name !== 'marker' && !uuid.test(value)) throw new Error(`invalid fixture metadata ${name}: ${value}`);
  }
  if (fixture.marker !== `subscription-verifier:${fixture.runId}`) throw new Error('fixture marker/run mismatch');
  if (new Set([fixture.principalId, fixture.threadId, fixture.firstWatchId, fixture.secondWatchId]).size !== 4) {
    throw new Error('fixture metadata IDs are not distinct');
  }
  return fixture;
}

function runVerifier(extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let spawnError;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      let fixture;
      let fixtureParseError;
      try {
        fixture = parseFixture(stdout);
        knownFixtures.set(fixture.runId, fixture);
      } catch (error) {
        fixtureParseError = error;
      }
      resolve({ code, signal, stdout, stderr, output: `${stdout}${stderr}`, fixture, fixtureParseError, spawnError });
    });
  });
}

function runVerifierUntilSetup(extraEnv = {}, coordinatorChildEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifierPath], {
      env: {
        ...process.env,
        SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl,
        SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1',
        ...coordinatorChildEnv,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let output = '';
    let settled = false;
    const inspect = (chunk) => {
      output += chunk;
      if (!settled && output.includes('TEST_PAUSE_AFTER_SETUP=READY')) {
        settled = true;
        const fixture = parseFixture(output);
        knownFixtures.set(fixture.runId, fixture);
        resolve({ child, fixture, getOutput: () => output });
      }
    };
    child.stdout.on('data', (chunk) => inspect(chunk.toString()));
    child.stderr.on('data', (chunk) => inspect(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
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
    activeChildren.add(child);
    let output = '';
    let settled = false;
    const inspect = (chunk) => {
      output += chunk;
      if (!settled && output.includes('CONCURRENCY_LOCKS_READY') && output.includes('SECOND_SESSION_STARTED=YES')) {
        settled = true;
        const fixture = parseFixture(output);
        knownFixtures.set(fixture.runId, fixture);
        resolve({ child, fixture, getOutput: () => output });
      }
    };
    child.stdout.on('data', (chunk) => inspect(chunk.toString()));
    child.stderr.on('data', (chunk) => inspect(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
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
  assert(result.fixture && !result.fixtureParseError, `${label}: fixture metadata unavailable: ${result.fixtureParseError?.message}`);
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

function emergencyHarnessCleanup(signal) {
  if (harnessCleanupStarted) return;
  harnessCleanupStarted = true;
  console.error(`HARNESS_RECEIVED_${signal}=YES`);
  for (const child of activeChildren) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  for (const fixture of knownFixtures.values()) {
    try {
      psql(`SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE pid <> pg_catalog.pg_backend_pid() AND application_name IN ('subver:' || ${sqlLiteral(fixture.runId)} || ':first','subver:' || ${sqlLiteral(fixture.runId)} || ':second');`);
      externalCleanup(fixture);
    } catch (error) {
      console.error(`signal recovery failed for ${fixture.runId}: ${error.message}`);
    }
  }
  try {
    psql(`BEGIN;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(sentinelThreadId)}::uuid AND title=${sqlLiteral(harnessOwnershipMarker)} AND "createdById"=${sqlLiteral(harnessOwnershipMarker)};
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(oldThreadId)}::uuid AND title='old fixed verifier thread' AND "createdById"='old-fixed-owner';
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(sentinelPrincipalId)}::uuid AND auth_subject=${sqlLiteral(harnessOwnershipMarker)} AND agent_id=${sqlLiteral(harnessOwnershipMarker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(oldPrincipalId)}::uuid AND auth_subject='old-fixed-verifier-principal' AND agent_id='old-fixed-verifier-agent';
COMMIT;`);
  } catch (error) {
    console.error(`harness signal sentinel cleanup failed: ${error.message}`);
  }
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => emergencyHarnessCleanup(signal));
}

try {
  psql(`
BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
  (${sqlLiteral(sentinelPrincipalId)},${sqlLiteral(sentinelMarker)},${sqlLiteral(sentinelMarker)},now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
  (${sqlLiteral(sentinelThreadId)},${sqlLiteral(sentinelMarker)},${sqlLiteral(sentinelMarker)},'sentinel',now(),now());
COMMIT;
`);
  if (harnessFault === 'assertion') throw new Error('injected harness assertion failure');
  if (pauseWithChild) {
    const coordinatorChildEnv = {};
    if (harnessChildCoordinatorIdentity) {
      coordinatorChildEnv.SUBSCRIPTION_VERIFIER_COORDINATOR_RUN_ID = harnessChildCoordinatorIdentity.RUN_ID;
      coordinatorChildEnv.SUBSCRIPTION_VERIFIER_COORDINATOR_PRINCIPAL_ID = harnessChildCoordinatorIdentity.PRINCIPAL_ID;
      coordinatorChildEnv.SUBSCRIPTION_VERIFIER_COORDINATOR_THREAD_ID = harnessChildCoordinatorIdentity.THREAD_ID;
      coordinatorChildEnv.SUBSCRIPTION_VERIFIER_COORDINATOR_FIRST_WATCH_ID = harnessChildCoordinatorIdentity.FIRST_WATCH_ID;
      coordinatorChildEnv.SUBSCRIPTION_VERIFIER_COORDINATOR_SECOND_WATCH_ID = harnessChildCoordinatorIdentity.SECOND_WATCH_ID;
    }
    const held = await runVerifierUntilSetup({}, coordinatorChildEnv);
    console.log(`HARNESS_CHILD_PID=${held.child.pid}`);
    console.log(`HARNESS_CHILD_FIXTURE_RUN_ID=${held.fixture.runId}`);
    console.log(`HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER=${held.fixture.marker}`);
    console.log(`HARNESS_CHILD_FIXTURE_PRINCIPAL_ID=${held.fixture.principalId}`);
    console.log(`HARNESS_CHILD_FIXTURE_THREAD_ID=${held.fixture.threadId}`);
    console.log(`HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID=${held.fixture.firstWatchId}`);
    console.log(`HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID=${held.fixture.secondWatchId}`);
    console.log('HARNESS_PAUSE_WITH_CHILD=READY');
    await new Promise(() => { setInterval(() => {}, 1_000); });
  }
  if (pauseAfterSentinel) {
    console.log('HARNESS_PAUSE_AFTER_SENTINEL=READY');
    await new Promise(() => { setInterval(() => {}, 1_000); });
  }
  psql(`BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES (${sqlLiteral(oldPrincipalId)},'old-fixed-verifier-principal','old-fixed-verifier-agent',now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES (${sqlLiteral(oldThreadId)},'old fixed verifier thread','old-fixed-owner','old-fixed-owner',now(),now());
COMMIT;`);

  const earlyExit = await runVerifier({ SUBSCRIPTION_VERIFIER_TEST_PRINCIPAL_ID: 'not-a-uuid' });
  assert(earlyExit.code !== 0, 'invalid test-only UUID verifier unexpectedly succeeded');
  assert(earlyExit.output.includes('invalid test-only PRINCIPAL_ID UUID: not-a-uuid'), `early exit lost original verifier error:\n${earlyExit.output}`);
  assert(!earlyExit.fixture, 'early exit unexpectedly produced fixture metadata');
  assert(earlyExit.fixtureParseError?.message.includes('FIXTURE_RUN_ID'), 'early exit did not report controlled missing fixture metadata');
  assertSentinelPreserved('early exit parse failure');
  console.log('EARLY_EXIT_ERROR_PRESERVATION=PASS');
  console.log('FIXTURE_PARSE_ERROR_CONTROLLED=PASS');

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

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const signaled = await runVerifierUntilLocks();
    const signaledExit = waitForExit(signaled.child, signaled.getOutput);
    signaled.child.kill(signal);
    const signalResult = await signaledExit;
    assert(signalResult.code !== 0 || signalResult.signal, `${signal} verifier unexpectedly exited successfully`);
    assert(signalResult.output.includes('CATCHABLE_SIGNAL_CLEANUP=PASS'), `${signal} handler did not report cleanup:\n${signalResult.output}`);
    assertRunClean(signaled.fixture, signal);
    assertSentinelPreserved(signal);
    console.log(`${signal}_CLEANUP=PASS`);
  }
  console.log('CLEANUP_REENTRANCY_GUARD=PASS');

  await expectFault('uncaught-exception', 'UNCAUGHT_EXCEPTION_CLEANUP', 'injected verifier uncaught exception');
  await expectFault('unhandled-rejection', 'UNHANDLED_REJECTION_CLEANUP', 'injected verifier unhandled rejection');

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
  harnessCleanupStarted = true;
  for (const child of activeChildren) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  for (const fixture of knownFixtures.values()) {
    try {
      psql(`SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE pid <> pg_catalog.pg_backend_pid() AND application_name IN ('subver:' || ${sqlLiteral(fixture.runId)} || ':first','subver:' || ${sqlLiteral(fixture.runId)} || ':second');`);
      externalCleanup(fixture);
    } catch (error) {
      console.error(`harness external recovery failed for ${fixture.runId}: ${error.message}`);
    }
  }
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

assert(harnessCleanupStarted, 'harness top-level finally was not reached');
assert(psql(`SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(sentinelPrincipalId)}::uuid OR auth_subject=${sqlLiteral(harnessOwnershipMarker)};`, true) === '0', 'harness sentinel Principal remained');
assert(psql(`SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(sentinelThreadId)}::uuid OR title=${sqlLiteral(harnessOwnershipMarker)};`, true) === '0', 'harness sentinel Thread remained');
console.log('HARNESS_FINALLY_REACHED=PASS');
console.log('HARNESS_OWNED_SENTINEL_CLEANUP=PASS');
