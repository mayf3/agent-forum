#!/usr/bin/env node

// Coordinator failure-recovery fault-injection suite. Run only against a
// freshly migrated disposable PostgreSQL database.
//
// Each case spawns the external parallel-isolation coordinator
// (test-subscription-verifier-parallel-isolation.mjs) with one test-only
// SUBSCRIPTION_COORDINATOR_TEST_FAULT injection and proves that the coordinator
// fails closed: the primary error is preserved, recovery and metadata
// validation failures are preserved, marker-mismatched recovery never crosses
// ownership, final database assertions run in finally, and any collected error
// forces a nonzero exit with no top-level success claim.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a freshly migrated disposable PostgreSQL database.');
  process.exit(2);
}

const coordinatorPath = fileURLToPath(new URL('./test-subscription-verifier-parallel-isolation.mjs', import.meta.url));
const faultSuitePath = fileURLToPath(import.meta.url);
const targetTables = ['forum_participations', 'forum_watch_subscriptions', 'forum_read_states', 'forum_mentions', 'forum_notification_facts'];
const caseCleanupErrors = [];
const caseFinalAssertionErrors = [];
let suiteSignal = null;
let activeCoordinator = null;

function makeVerifierIdentity() {
  const identity = {
    runId: randomUUID(), principalId: randomUUID(), threadId: randomUUID(),
    firstWatchId: randomUUID(), secondWatchId: randomUUID(),
  };
  identity.marker = `subscription-verifier:${identity.runId}`;
  identity.applicationNames = [`subver:${identity.runId}:first`, `subver:${identity.runId}:second`];
  return identity;
}

function makeCaseIdentity() {
  const verifiers = Array.from({ length: 12 }, makeVerifierIdentity);
  const harnesses = Array.from({ length: 3 }, () => {
    const runId = randomUUID();
    return {
      runId,
      marker: `subscription-verifier-harness:${runId}`,
      sentinelPrincipalId: randomUUID(),
      sentinelThreadId: randomUUID(),
    };
  });
  return {
    caseRunId: randomUUID(),
    verifiers,
    harnesses,
    applicationNames: verifiers.flatMap((identity) => identity.applicationNames),
  };
}

function captureFiveTableDigest() {
  return psql(`SELECT md5(coalesce(string_agg(row_text, E'\\n' ORDER BY row_text), '')) FROM (
 SELECT 'p:'||id::text||':'||to_jsonb(x)::text row_text FROM public.forum_participations x
 UNION ALL SELECT 'w:'||id::text||':'||to_jsonb(x)::text FROM public.forum_watch_subscriptions x
 UNION ALL SELECT 'r:'||thread_id::text||':'||principal_id::text||':'||to_jsonb(x)::text FROM public.forum_read_states x
 UNION ALL SELECT 'm:'||id::text||':'||to_jsonb(x)::text FROM public.forum_mentions x
 UNION ALL SELECT 'n:'||id::text||':'||to_jsonb(x)::text FROM public.forum_notification_facts x
) rows;`, true);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql, tuplesOnly = false) {
  const args = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];
  if (tuplesOnly) args.push('--tuples-only', '--no-align');
  return execFileSync('psql', args, { input: sql, encoding: 'utf8', timeout: 60_000 }).trim();
}

function assertGlobalZero(label) {
  const counts = psql(targetTables.map((table) => `SELECT '${table}=' || count(*) FROM public.${table};`).join('\n'), true);
  const nonzero = counts.split('\n').filter((line) => !line.endsWith('=0'));
  assert(nonzero.length === 0, `${label}: five target tables were not globally empty: ${counts}`);
}

function isGlobalZero() {
  try {
    assertGlobalZero('probe');
    return true;
  } catch {
    return false;
  }
}

function terminateSessionsExact(names) {
  if (names.length === 0) return;
  psql(`SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND application_name IN (${names.map(sqlLiteral).join(',')});`);
}

function countSessionsExact(names) {
  if (names.length === 0) return '0';
  return psql(`SELECT count(*) FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND application_name IN (${names.map(sqlLiteral).join(',')});`, true);
}

function externalCleanup(fixture) {
  const marker = sqlLiteral(fixture.marker);
  const principal = sqlLiteral(fixture.principalId);
  const thread = sqlLiteral(fixture.threadId);
  psql(`
BEGIN;
SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND application_name IN ('subver:' || ${sqlLiteral(fixture.runId)} || ':first','subver:' || ${sqlLiteral(fixture.runId)} || ':second');
DELETE FROM public.forum_read_states r USING public.forum_principals p, public.forum_threads t
WHERE r.thread_id=${thread}::uuid AND r.principal_id=${principal}::uuid
  AND p.id=r.principal_id AND p.auth_subject=${marker} AND p.agent_id=${marker}
  AND t.id=r.thread_id AND t.title=${marker} AND t."createdById"=${marker};
DELETE FROM public.forum_watch_subscriptions w USING public.forum_principals p, public.forum_threads t
WHERE w.id IN (${sqlLiteral(fixture.firstWatchId)}::uuid,${sqlLiteral(fixture.secondWatchId)}::uuid)
  AND w.thread_id=${thread}::uuid AND w.principal_id=${principal}::uuid
  AND p.id=w.principal_id AND p.auth_subject=${marker} AND p.agent_id=${marker}
  AND t.id=w.thread_id AND t.title=${marker} AND t."createdById"=${marker};
DELETE FROM public.forum_threads WHERE id=${thread}::uuid AND title=${marker} AND "createdById"=${marker};
DELETE FROM public.forum_principals WHERE id=${principal}::uuid AND auth_subject=${marker} AND agent_id=${marker};
COMMIT;`);
}

function recoverHarnessSentinel(harness) {
  psql(`BEGIN;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(harness.sentinelThreadId)}::uuid AND title=${sqlLiteral(harness.marker)} AND "createdById"=${sqlLiteral(harness.marker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(harness.sentinelPrincipalId)}::uuid AND auth_subject=${sqlLiteral(harness.marker)} AND agent_id=${sqlLiteral(harness.marker)};
COMMIT;`);
}

function deleteForeignFixture(fixture) {
  psql(`BEGIN;
DELETE FROM public.forum_read_states WHERE thread_id=${sqlLiteral(fixture.threadId)}::uuid AND principal_id=${sqlLiteral(fixture.principalId)}::uuid;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(fixture.threadId)}::uuid AND title=${sqlLiteral(fixture.marker)} AND "createdById"=${sqlLiteral(fixture.marker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(fixture.principalId)}::uuid AND auth_subject=${sqlLiteral(fixture.marker)} AND agent_id=${sqlLiteral(fixture.marker)};
COMMIT;`);
}

function foreignMismatchCounts(fixture) {
  return psql(`
SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(fixture.principalId)}::uuid AND auth_subject=${sqlLiteral(fixture.marker)} AND agent_id=${sqlLiteral(fixture.marker)}),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(fixture.threadId)}::uuid AND title=${sqlLiteral(fixture.marker)} AND "createdById"=${sqlLiteral(fixture.marker)}),
 (SELECT count(*) FROM public.forum_read_states WHERE thread_id=${sqlLiteral(fixture.threadId)}::uuid AND principal_id=${sqlLiteral(fixture.principalId)}::uuid);
`, true).replaceAll('|', ',');
}

function runCoordinator(fault, caseIdentity, timeoutMs = 240_000) {
  const child = spawn(process.execPath, [coordinatorPath], {
    env: {
      ...process.env,
      SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl,
      SUBSCRIPTION_COORDINATOR_TEST_FAULT: fault,
      SUBSCRIPTION_COORDINATOR_TEST_IDENTITY_PLAN: JSON.stringify({
        verifiers: caseIdentity.verifiers.map(({ runId, principalId, threadId, firstWatchId, secondWatchId }) => ({ runId, principalId, threadId, firstWatchId, secondWatchId })),
        harnesses: caseIdentity.harnesses.map(({ runId, sentinelPrincipalId, sentinelThreadId }) => ({ runId, sentinelPrincipalId, sentinelThreadId })),
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  let spawnError = null;
  let timedOut = false;
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => {
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => resolve({ code, signal, get output() { return output; }, spawnError, timedOut }));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') caseCleanupErrors.push(new Error(`timeout process-group kill failed: ${error.message}`)); }
  }, timeoutMs);
  done.finally(() => clearTimeout(timer));
  const record = { child, done, getOutput: () => output, caseIdentity };
  activeCoordinator = record;
  return record;
}

function parseIdentityDump(output) {
  const matches = [...output.matchAll(/^COORDINATOR_EXPECTED_IDENTITY_DUMP=(.+)$/gm)];
  if (matches.length !== 1) return null;
  return JSON.parse(matches[0][1]);
}

function cleanupAfterCoordinator(dump, label) {
  terminateSessionsExact(dump.applicationNames ?? []);
  for (const identity of dump.children ?? []) {
    if (identity.kind === 'VERIFIER') {
      externalCleanup(identity);
    } else {
      if (identity.child) externalCleanup(identity.child);
      recoverHarnessSentinel(identity);
    }
  }
  for (const fixture of dump.foreignFixtures ?? []) deleteForeignFixture(fixture);
  psql('SELECT pg_catalog.pg_sleep(1);');
  assertGlobalZero(`fault suite cleanup after ${label}`);
  assert(countSessionsExact(dump.applicationNames ?? []) === '0', `coordinator sessions remained after ${label} suite cleanup`);
}

function runIdentityCounts(identity) {
  return psql(`SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(identity.principalId)}::uuid),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(identity.threadId)}::uuid),
 (SELECT count(*) FROM public.forum_read_states WHERE thread_id=${sqlLiteral(identity.threadId)}::uuid AND principal_id=${sqlLiteral(identity.principalId)}::uuid),
 (SELECT count(*) FROM public.forum_watch_subscriptions WHERE id IN (${sqlLiteral(identity.firstWatchId)}::uuid,${sqlLiteral(identity.secondWatchId)}::uuid));`, true).replaceAll('|', ',');
}

function harnessIdCounts(identity) {
  return psql(`SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(identity.sentinelPrincipalId)}::uuid),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(identity.sentinelThreadId)}::uuid);`, true).replaceAll('|', ',');
}

function cleanupTestOwnedForeign(identity, marker, principalId, threadId) {
  psql(`BEGIN;
DELETE FROM public.forum_read_states WHERE thread_id=${sqlLiteral(threadId)}::uuid AND principal_id=${sqlLiteral(principalId)}::uuid;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(threadId)}::uuid AND title=${sqlLiteral(marker)} AND "createdById"=${sqlLiteral(marker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(principalId)}::uuid AND auth_subject=${sqlLiteral(marker)} AND agent_id=${sqlLiteral(marker)};
COMMIT;`);
}

async function cleanupCasePlan(context, label) {
  const errors = [];
  const attempt = (step, fn) => { try { fn(); } catch (error) { errors.push(new Error(`${label} ${step}: ${error.message}`)); } };
  if (context.record?.child?.exitCode === null) {
    try { process.kill(-context.record.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') errors.push(new Error(`${label} process-group kill: ${error.message}`)); }
    await Promise.race([context.record.done, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  attempt('exact session termination', () => terminateSessionsExact(context.identity.applicationNames));
  for (const identity of context.identity.verifiers) attempt(`verifier cleanup ${identity.runId}`, () => externalCleanup(identity));
  for (const harness of context.identity.harnesses) attempt(`harness cleanup ${harness.runId}`, () => recoverHarnessSentinel(harness));
  for (const identity of context.identity.verifiers) {
    attempt(`foreign mismatch cleanup ${identity.runId}`, () => cleanupTestOwnedForeign(identity, `foreign-mismatch:${identity.runId}`, identity.principalId, identity.threadId));
  }
  for (const harness of context.identity.harnesses) {
    attempt(`tampered sentinel cleanup ${harness.runId}`, () => cleanupTestOwnedForeign(harness, `foreign-sentinel:${harness.runId}`, harness.sentinelPrincipalId, harness.sentinelThreadId));
  }
  attempt('session settle', () => psql('SELECT pg_catalog.pg_sleep(1);'));
  for (const identity of context.identity.verifiers) {
    attempt(`verifier final IDs ${identity.runId}`, () => assert(runIdentityCounts(identity) === '0,0,0,0', `residue ${runIdentityCounts(identity)}`));
  }
  for (const harness of context.identity.harnesses) {
    attempt(`harness final IDs ${harness.runId}`, () => assert(harnessIdCounts(harness) === '0,0', `residue ${harnessIdCounts(harness)}`));
  }
  attempt('session final assertion', () => assert(countSessionsExact(context.identity.applicationNames) === '0', 'case-owned sessions remained'));
  attempt('baseline final assertion', () => assert(captureFiveTableDigest() === context.baselineDigest, 'case baseline digest changed'));
  attempt('global zero final assertion', () => assertGlobalZero(`fault suite cleanup after ${label}`));
  if (errors.length) caseCleanupErrors.push(...errors);
  return errors;
}

function expect(condition, message) {
  assert(condition, message);
}

const cases = [
  {
    fault: 'child-pre-metadata-exit',
    label: 'CHILD_PRE_METADATA_EXIT_RECOVERY',
    verify(result) {
      expect(result.output.includes('METADATA_VALIDATION=FAIL'), 'pre-metadata exit was not rejected');
      expect(result.output.includes('output omitted or duplicated FIXTURE_RUN_ID'), 'pre-metadata validation error missing FIXTURE_RUN_ID detail');
      expect(result.output.includes('injected child-pre-metadata-exit child failed before usable metadata'), 'original child error was not preserved');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final assertions did not pass after expected-identity recovery');
      expect(isGlobalZero(), 'coordinator left residue after pre-metadata recovery');
    },
  },
  {
    fault: 'partial-metadata',
    label: 'PARTIAL_METADATA_REJECTED',
    verify(result) {
      expect(result.output.includes('METADATA_VALIDATION=FAIL'), 'partial metadata was not rejected');
      expect(result.output.includes('output omitted or duplicated FIXTURE_PRINCIPAL_ID'), 'partial metadata validation error missing field detail');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final assertions did not pass after expected-identity recovery');
      expect(isGlobalZero(), 'coordinator left residue after partial-metadata recovery');
    },
  },
  {
    fault: 'duplicate-metadata',
    label: 'DUPLICATE_METADATA_REJECTED',
    verify(result) {
      expect(result.output.includes('METADATA_VALIDATION=FAIL'), 'duplicate metadata was not rejected');
      expect(result.output.includes('output omitted or duplicated FIXTURE_RUN_ID'), 'duplicate metadata validation error missing field detail');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final assertions did not pass after expected-identity recovery');
      expect(isGlobalZero(), 'coordinator left residue after duplicate-metadata recovery');
    },
  },
  {
    fault: 'mixed-metadata',
    label: 'AMBIGUOUS_OUTPUT_REJECTED',
    verify(result) {
      expect(result.output.includes('METADATA_VALIDATION=FAIL'), 'mixed-kind output was not rejected');
      expect(result.output.includes('ambiguous metadata'), 'mixed-kind rejection detail missing');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final assertions did not pass after expected-identity recovery');
      expect(isGlobalZero(), 'coordinator left residue after mixed-metadata recovery');
    },
  },
  {
    fault: 'forged-metadata',
    label: 'FORGED_METADATA_REJECTED',
    verify(result) {
      const rejections = [...result.output.matchAll(/METADATA_VALIDATION=FAIL child=VERIFIER/g)].length;
      expect(rejections >= 5, `expected at least five forged-metadata rejections, saw ${rejections}`);
      expect(result.output.includes('did not match the coordinator-expected identity'), 'forged metadata rejection detail missing');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final assertions did not pass after expected-identity recovery');
      expect(isGlobalZero(), 'coordinator deleted nothing it should not have, yet residue remained');
    },
  },
  {
    fault: 'process-group-kill-failure',
    label: 'PROCESS_GROUP_KILL_FAILURE_PROPAGATION',
    verify(result) {
      expect(result.output.includes('PRIMARY_ERROR=injected coordinator failure with a running child'), 'primary error was not preserved');
      expect(result.output.includes('injected process-group kill failure'), 'injected kill failure was not preserved');
      expect(result.output.includes('RECOVERY_ERRORS[0]='), 'recovery errors were not reported');
      expect(result.output.includes('PROCESS_GROUP_BACKEND_FALLBACK=EXECUTED'), 'backend termination fallback did not run');
      expect(!result.output.includes('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'), 'coordinator printed overall success despite collected errors');
      expect(isGlobalZero(), 'kill-failure residue was not cleaned');
      expect(countSessionsExact([]) === '0', 'session helper sanity');
    },
  },
  {
    fault: 'external-cleanup-transient-failure',
    label: 'TRANSIENT_CLEANUP_FAILURE_RECOVERED_WITH_RETRY',
    verify(result) {
      expect(result.output.includes('external cleanup for run'), 'cleanup step was not named');
      expect(result.output.includes('attempt 1 failed: injected transient external cleanup failure'), 'transient failure was not preserved');
      expect(!result.output.includes('attempt 2 failed'), 'retry unexpectedly failed');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'retry did not leave a clean database');
      expect(isGlobalZero(), 'residue remained after transient cleanup retry');
    },
  },
  {
    fault: 'external-cleanup-permanent-failure',
    label: 'PERMANENT_CLEANUP_FAILURE_PROPAGATED',
    verify(result) {
      expect(result.output.includes('external cleanup for run'), 'cleanup step was not named');
      expect(result.output.includes('attempt 2 failed: injected permanent external cleanup failure'), 'permanent failure did not propagate after retries');
      expect(!result.output.includes('FIVE_TABLES_EMPTY=PASS'), 'global-zero PASS was printed despite permanent cleanup failure');
      expect(!result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'final global-zero assertion PASS was printed despite residue');
      expect(!result.output.includes('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'), 'overall success was printed despite permanent failure');
    },
  },
  {
    fault: 'marker-mismatch',
    label: 'MARKER_MISMATCH_NO_CROSS_MARKER_DELETE',
    verify(result) {
      expect(result.output.includes('MARKER_MISMATCH_DETECTED'), 'marker mismatch was not detected');
      expect(!result.output.includes('FIVE_TABLES_EMPTY=PASS'), 'global-zero PASS was printed despite preserved foreign row');
      expect(!result.output.includes('COORDINATOR_BASELINE_FINAL_ASSERTION=PASS'), 'baseline assertion PASS was printed despite foreign row');
    },
    verifyAfterDump(result, dump) {
      for (const fixture of dump.foreignFixtures ?? []) {
        expect(foreignMismatchCounts(fixture) === '1,1,1', `foreign mismatch fixture was altered: ${foreignMismatchCounts(fixture)}`);
      }
    },
  },
  {
    fault: 'sentinel-marker-tamper',
    label: 'MARKER_MISMATCH_FAIL_CLOSED',
    verify(result) {
      expect(result.output.includes('ownership mismatch for harness'), 'tampered sentinel ownership mismatch was not reported');
      expect(result.output.includes('harness sentinel exact-ID residue remained'), 'ID-only sentinel assertion did not detect tampered residue');
      expect(!result.output.includes('COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION=PASS'), 'sentinel PASS printed despite exact-ID residue');
      expect(!result.output.includes('SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES'), 'success ordering claim printed despite tampered residue');
      expect(!result.output.includes('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'), 'overall PASS printed despite tampered residue');
    },
  },
  {
    fault: 'sentinel-recovery-failure',
    label: 'SENTINEL_RECOVERY_FAILURE_PROPAGATED',
    verify(result) {
      expect(result.output.includes('harness sentinel recovery for run'), 'sentinel recovery step was not named');
      expect(result.output.includes('injected sentinel recovery failure'), 'sentinel recovery failure did not propagate');
      expect(!result.output.includes('COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION=PASS'), 'sentinel final assertion PASS was printed despite residue');
      expect(result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'five tables should still be clean; only sentinel rows remain');
    },
  },
  {
    fault: 'deliberate-residue',
    label: 'DELIBERATE_RESIDUE_CAUGHT_BY_FINAL_ASSERTION',
    verify(result) {
      expect(result.output.includes('DELIBERATE_RESIDUE_INJECTED'), 'deliberate residue injection was not recorded');
      expect(result.output.includes('FINAL_ASSERTION_ERRORS[0]='), 'final assertion did not catch the residue');
      expect(!result.output.includes('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS'), 'global-zero PASS was printed despite deliberate residue');
      expect(!result.output.includes('FIVE_TABLES_EMPTY=PASS'), 'five-tables PASS was printed despite deliberate residue');
      expect(!result.output.includes('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'), 'overall success was printed despite deliberate residue');
    },
  },
];

const activeContexts = new Set();
let suitePrimaryError = null;
let suiteFinallyReached = false;

async function emergencySuiteCleanup(signal) {
  suiteSignal = signal;
  console.error(`FAULT_SUITE_SIGNAL_HANDLER=${signal}`);
  for (const context of activeContexts) await cleanupCasePlan(context, `signal-${signal}`);
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { void emergencySuiteCleanup(signal); });

async function runFaultSuiteSignalTest() {
  const child = spawn(process.execPath, [faultSuitePath], {
    env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, SUBSCRIPTION_FAULT_SUITE_SIGNAL_WORKER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  for (let attempt = 0; attempt < 100 && !output.includes('FAULT_SUITE_SIGNAL_WORKER_READY'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert(output.includes('FAULT_SUITE_SIGNAL_WORKER_READY'), `fault-suite signal worker was not ready:\n${output}`);
  child.kill('SIGTERM');
  const result = await done;
  assert(result.code !== 0 || result.signal, 'fault-suite SIGTERM worker unexpectedly succeeded');
  assert(output.includes('FAULT_SUITE_SIGNAL_HANDLER=SIGTERM'), `fault-suite SIGTERM handler output missing:\n${output}`);
  assertGlobalZero('fault-suite SIGTERM worker cleanup');
  console.log('FAULT_SUITE_SIGTERM_CLEANUP=PASS');
}

async function runExpectedSelfFailure(label, fault, trigger, timeoutMs = 240_000) {
  const context = { identity: makeCaseIdentity(), baselineDigest: captureFiveTableDigest(), record: null };
  activeContexts.add(context);
  let expectedError = null;
  let cleanupErrors = [];
  try {
    context.record = runCoordinator(fault, context.identity, timeoutMs);
    const result = await context.record.done;
    trigger(result);
    throw new Error(`${label}: self-failure trigger unexpectedly returned`);
  } catch (error) {
    expectedError = error;
  } finally {
    cleanupErrors = await cleanupCasePlan(context, label);
    activeContexts.delete(context);
  }
  assert(expectedError, `${label}: expected primary self-failure was not preserved`);
  assert(cleanupErrors.length === 0, `${label}: cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`);
  console.log(`${label}=PASS`);
}

if (process.env.SUBSCRIPTION_FAULT_SUITE_SIGNAL_WORKER === '1') {
  const workerContext = { identity: makeCaseIdentity(), baselineDigest: captureFiveTableDigest(), record: null };
  activeContexts.add(workerContext);
  workerContext.record = runCoordinator('process-group-kill-failure', workerContext.identity);
  console.log('FAULT_SUITE_SIGNAL_WORKER_READY');
  await new Promise(() => { setInterval(() => {}, 1_000); });
} else {
try {
  assertGlobalZero('coordinator fault suite start');
  for (const testCase of cases) {
    const context = {
      identity: makeCaseIdentity(),
      baselineDigest: captureFiveTableDigest(),
      record: null,
      primaryCaseError: null,
      cleanupErrors: [],
      finalAssertionErrors: [],
    };
    activeContexts.add(context);
    try {
      for (const identity of context.identity.verifiers) assert(runIdentityCounts(identity) === '0,0,0,0', `${testCase.fault}: prespawn verifier IDs collided with baseline`);
      for (const harness of context.identity.harnesses) assert(harnessIdCounts(harness) === '0,0', `${testCase.fault}: prespawn harness IDs collided with baseline`);
      context.record = runCoordinator(testCase.fault, context.identity);
      const result = await context.record.done;
      assert(result.code !== 0 && result.signal !== 'SIGKILL', `${testCase.fault}: coordinator unexpectedly exited ${result.code}/${result.signal}`);
      const dump = parseIdentityDump(result.output);
      assert(dump !== null, `${testCase.fault}: coordinator failure did not persist a diagnostic identity dump`);
      testCase.verify(result);
      if (testCase.verifyAfterDump) testCase.verifyAfterDump(result, dump);
    } catch (error) {
      context.primaryCaseError = error;
    } finally {
      context.cleanupErrors = await cleanupCasePlan(context, testCase.fault);
      activeContexts.delete(context);
    }
    if (context.primaryCaseError || context.cleanupErrors.length || context.finalAssertionErrors.length) {
      throw new AggregateError(
        [context.primaryCaseError, ...context.cleanupErrors, ...context.finalAssertionErrors].filter(Boolean),
        `${testCase.fault}: primary case and cleanup errors preserved`,
      );
    }
    console.log(`${testCase.label}=PASS`);
  }
  await runExpectedSelfFailure('FAULT_SUITE_OUTPUT_PARSE_FAILURE_CLEANUP', 'sentinel-recovery-failure', () => {
    JSON.parse('{invalid coordinator output');
  });
  await runExpectedSelfFailure('FAULT_SUITE_ASSERTION_FAILURE_CLEANUP', 'sentinel-recovery-failure', () => {
    assert(false, 'injected fault-suite assertion failure');
  });
  await runExpectedSelfFailure('FAULT_SUITE_COORDINATOR_TIMEOUT_CLEANUP', 'process-group-kill-failure', (result) => {
    assert(result.timedOut, 'coordinator timeout injection did not fire');
    throw new Error(`controlled coordinator timeout: ${result.code}/${result.signal}`);
  }, 50);
  await runFaultSuiteSignalTest();
} catch (error) {
  suitePrimaryError = error;
} finally {
  suiteFinallyReached = true;
  for (const context of activeContexts) await cleanupCasePlan(context, 'suite-finally');
  try { assertGlobalZero('fault suite top-level finally'); } catch (error) { caseFinalAssertionErrors.push(error); }
}

if (suitePrimaryError || caseCleanupErrors.length || caseFinalAssertionErrors.length) {
  const failures = [suitePrimaryError, ...caseCleanupErrors, ...caseFinalAssertionErrors].filter(Boolean);
  console.error(`PRIMARY_CASE_ERROR=${suitePrimaryError?.message ?? 'NONE'}`);
  caseCleanupErrors.forEach((error, index) => console.error(`CASE_CLEANUP_ERRORS[${index}]=${error.message}`));
  caseFinalAssertionErrors.forEach((error, index) => console.error(`CASE_FINAL_ASSERTION_ERRORS[${index}]=${error.message}`));
  console.error(new AggregateError(failures, 'fault suite combined primary, cleanup, and final assertion report').message);
  process.exit(1);
}

assert(suiteFinallyReached, 'fault suite top-level finally was not reached');
console.log('COORDINATOR_PARSE_FAILURE_PROPAGATION=PASS');
console.log('COORDINATOR_RECOVERY_FAILURE_PROPAGATION=PASS');
console.log('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS');
console.log('COORDINATOR_BASELINE_FINAL_ASSERTION=PASS');
console.log('RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS');
console.log('PRIMARY_ERROR_PRESERVED=PASS');
console.log('RECOVERY_ERROR_PRESERVED=PASS');
console.log('COMBINED_ERROR_REPORTING=PASS');
console.log('CHILD_KIND_BINDING=PASS');
console.log('AMBIGUOUS_OUTPUT_REJECTED=PASS');
console.log('FAULT_SUITE_IDENTITY_AUTHORITY=PRESPAWN_EXPECTED_IDENTITY');
console.log('FAULT_SUITE_TOP_LEVEL_FINALLY=PASS');
console.log('FAULT_SUITE_PRIMARY_ERROR_PRESERVED=PASS');
console.log('FAULT_SUITE_CLEANUP_ERROR_PRESERVED=PASS');
console.log('FAULT_SUITE_COMBINED_ERROR_REPORTING=PASS');
console.log('FAULT_SUITE_BASELINE_FINAL_ASSERTION=PASS');
console.log('FAULT_SUITE_OWNED_ID_FINAL_ASSERTION=PASS');
console.log('FAULT_SUITE_SESSION_FINAL_ASSERTION=PASS');
console.log('FAULT_SUITE_SIGKILL_CLEANUP_GUARANTEED=NO');
console.log('FOREIGN_MARKER_NOT_DELETED_BY_COORDINATOR=PASS');
console.log('FAULT_SUITE_TAMPERED_FIXTURE_RECOVERED=PASS');
console.log('SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS');
}
