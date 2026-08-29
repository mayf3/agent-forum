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
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a freshly migrated disposable PostgreSQL database.');
  process.exit(2);
}

const coordinatorPath = fileURLToPath(new URL('./test-subscription-verifier-parallel-isolation.mjs', import.meta.url));
const targetTables = ['forum_participations', 'forum_watch_subscriptions', 'forum_read_states', 'forum_mentions', 'forum_notification_facts'];

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

function runCoordinator(fault) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [coordinatorPath], {
      env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, SUBSCRIPTION_COORDINATOR_TEST_FAULT: fault },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* resolved by close below */ }
    }, 240_000);
    child.on('error', () => { /* resolved by close below */ });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
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

assertGlobalZero('coordinator fault suite start');
for (const testCase of cases) {
  const result = await runCoordinator(testCase.fault);
  assert(result.code !== 0 && result.signal !== 'SIGKILL', `${testCase.fault}: coordinator unexpectedly exited ${result.code}/${result.signal}`);
  const dump = parseIdentityDump(result.output);
  assert(dump !== null, `${testCase.fault}: coordinator failure did not persist an expected-identity dump`);
  testCase.verify(result);
  if (testCase.verifyAfterDump) testCase.verifyAfterDump(result, dump);
  await cleanupAfterCoordinator(dump, testCase.fault);
  console.log(`${testCase.label}=PASS`);
}

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
console.log('SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS');
