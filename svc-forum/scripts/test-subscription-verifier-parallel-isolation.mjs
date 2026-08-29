#!/usr/bin/env node

// External coordinator for parallel verifier isolation and harness recovery boundaries.
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
const harnessPath = fileURLToPath(new URL('./test-subscription-verifier-cleanup.mjs', import.meta.url));
const targetTables = ['forum_participations', 'forum_watch_subscriptions', 'forum_read_states', 'forum_mentions', 'forum_notification_facts'];
const allChildren = new Set();
const baseline = {
  marker: 'subscription-verifier:customer-data',
  principal1: randomUUID(), principal2: randomUUID(), thread: randomUUID(), message: randomUUID(),
  participation: randomUUID(), watch: randomUUID(), mention: randomUUID(), notification: randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql, tuplesOnly = false) {
  const args = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];
  if (tuplesOnly) args.push('--tuples-only', '--no-align');
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim();
}

function assertGlobalZero(label) {
  const counts = psql(targetTables.map((table) => `SELECT '${table}=' || count(*) FROM public.${table};`).join('\n'), true);
  const nonzero = counts.split('\n').filter((line) => !line.endsWith('=0'));
  assert(nonzero.length === 0, `${label}: five target tables were not globally empty: ${counts}`);
}

function seedBaseline() {
  const b = Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, sqlLiteral(value)]));
  psql(`BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
 (${b.principal1},${b.marker},${b.marker},now()),
 (${b.principal2},${sqlLiteral(`${baseline.marker}:recipient`)},${sqlLiteral(`${baseline.marker}:recipient`)},now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 (${b.thread},${b.marker},${b.marker},'baseline',now(),now());
INSERT INTO public.forum_messages (id,"threadId",seq,"authorId","authorName",content,"createdAt") VALUES
 (${b.message},${b.thread},1,${b.marker},'baseline','baseline',now());
INSERT INTO public.forum_participations (id,thread_id,principal_id,fact_state,provenance,updated_at) VALUES
 (${b.participation},${b.thread},${b.principal1},'known','runtime',now());
INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,ended_at,updated_at) VALUES
 (${b.watch},${b.thread},${b.principal1},'inactive','explicit','runtime',now(),now(),now());
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES
 (${b.thread},${b.principal1},'known',0,NULL,'runtime',now());
INSERT INTO public.forum_mentions (id,message_id,mentioned_principal_id,source_agent_id,created_at) VALUES
 (${b.mention},${b.message},${b.principal2},'baseline',now());
INSERT INTO public.forum_notification_facts (id,recipient_principal_id,thread_id,message_id,reason,source_event_key,created_at) VALUES
 (${b.notification},${b.principal2},${b.thread},${b.message},'mention',${sqlLiteral(`${baseline.marker}:event`)},now());
COMMIT;`);
}

function captureBaselineRows() {
  const b = Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, sqlLiteral(value)]));
  return psql(`SELECT jsonb_build_array(
 (SELECT to_jsonb(x) FROM public.forum_participations x WHERE id=${b.participation}::uuid),
 (SELECT to_jsonb(x) FROM public.forum_watch_subscriptions x WHERE id=${b.watch}::uuid),
 (SELECT to_jsonb(x) FROM public.forum_read_states x WHERE thread_id=${b.thread}::uuid AND principal_id=${b.principal1}::uuid),
 (SELECT to_jsonb(x) FROM public.forum_mentions x WHERE id=${b.mention}::uuid),
 (SELECT to_jsonb(x) FROM public.forum_notification_facts x WHERE id=${b.notification}::uuid)
)::text;`, true);
}

function cleanupBaseline() {
  const b = Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, sqlLiteral(value)]));
  psql(`BEGIN;
DELETE FROM public.forum_notification_facts WHERE id=${b.notification}::uuid;
DELETE FROM public.forum_mentions WHERE id=${b.mention}::uuid;
DELETE FROM public.forum_read_states WHERE thread_id=${b.thread}::uuid AND principal_id=${b.principal1}::uuid;
DELETE FROM public.forum_watch_subscriptions WHERE id=${b.watch}::uuid;
DELETE FROM public.forum_participations WHERE id=${b.participation}::uuid;
DELETE FROM public.forum_messages WHERE id=${b.message}::uuid;
DELETE FROM public.forum_threads WHERE id=${b.thread}::uuid AND title=${b.marker} AND "createdById"=${b.marker};
DELETE FROM public.forum_principals WHERE id IN (${b.principal1}::uuid,${b.principal2}::uuid);
COMMIT;`);
}

function parseValues(output, names) {
  return Object.fromEntries(names.map((name) => {
    const matches = [...output.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))];
    assert(matches.length === 1, `output omitted or duplicated ${name}:\n${output}`);
    return [name, matches[0][1].trim()];
  }));
}

function parseFixture(output) {
  const values = parseValues(output, [
    'FIXTURE_RUN_ID', 'FIXTURE_OWNERSHIP_MARKER', 'FIXTURE_PRINCIPAL_ID',
    'FIXTURE_THREAD_ID', 'FIXTURE_FIRST_WATCH_ID', 'FIXTURE_SECOND_WATCH_ID',
  ]);
  return {
    runId: values.FIXTURE_RUN_ID,
    marker: values.FIXTURE_OWNERSHIP_MARKER,
    principalId: values.FIXTURE_PRINCIPAL_ID,
    threadId: values.FIXTURE_THREAD_ID,
    firstWatchId: values.FIXTURE_FIRST_WATCH_ID,
    secondWatchId: values.FIXTURE_SECOND_WATCH_ID,
  };
}

function start(script, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  allChildren.add(child);
  let output = '';
  const listeners = new Set();
  const inspect = (chunk) => {
    output += chunk.toString();
    for (const listener of listeners) listener(output);
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  const done = new Promise((resolve) => {
    let spawnError;
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code, signal) => {
      allChildren.delete(child);
      resolve({ child, code, signal, output, spawnError });
    });
  });
  const waitFor = (text) => new Promise((resolve, reject) => {
    if (output.includes(text)) return resolve(output);
    const timer = setTimeout(() => {
      listeners.delete(listener);
      reject(new Error(`timed out waiting for ${text}:\n${output}`));
    }, 45_000);
    const listener = (current) => {
      if (current.includes(text)) {
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(current);
      }
    };
    listeners.add(listener);
    done.then((result) => {
      if (!result.output.includes(text)) {
        clearTimeout(timer);
        listeners.delete(listener);
        reject(new Error(`process exited before ${text}: code=${result.code} signal=${result.signal}\n${result.output}`));
      }
    });
  });
  return { child, done, waitFor, getOutput: () => output };
}

function assertDisjoint(a, b, label) {
  const aValues = new Set(Object.values(a));
  for (const value of Object.values(b)) assert(!aValues.has(value), `${label}: fixture value was shared across runs: ${value}`);
}

function runCountsForRecovery(fixture) {
  return psql(`
SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(fixture.principalId)}::uuid),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(fixture.threadId)}::uuid),
 (SELECT count(*) FROM public.forum_read_states WHERE thread_id=${sqlLiteral(fixture.threadId)}::uuid AND principal_id=${sqlLiteral(fixture.principalId)}::uuid),
 (SELECT count(*) FROM public.forum_watch_subscriptions WHERE id IN (${sqlLiteral(fixture.firstWatchId)}::uuid,${sqlLiteral(fixture.secondWatchId)}::uuid));
`, true).replaceAll('|', ',');
}

function assertRunClean(fixture, label) {
  const counts = runCountsForRecovery(fixture);
  assert(counts === '0,0,0,0', `${label}: owned residue remained (${counts})`);
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

function parseHarness(output) {
  const values = parseValues(output, [
    'HARNESS_RUN_ID', 'HARNESS_OWNERSHIP_MARKER',
    'HARNESS_SENTINEL_PRINCIPAL_ID', 'HARNESS_SENTINEL_THREAD_ID',
  ]);
  return {
    runId: values.HARNESS_RUN_ID,
    marker: values.HARNESS_OWNERSHIP_MARKER,
    principalId: values.HARNESS_SENTINEL_PRINCIPAL_ID,
    threadId: values.HARNESS_SENTINEL_THREAD_ID,
  };
}

function parseHarnessChild(output) {
  const values = parseValues(output, [
    'HARNESS_CHILD_PID', 'HARNESS_CHILD_FIXTURE_RUN_ID',
    'HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER', 'HARNESS_CHILD_FIXTURE_PRINCIPAL_ID',
    'HARNESS_CHILD_FIXTURE_THREAD_ID', 'HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID',
    'HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID',
  ]);
  return {
    pid: Number.parseInt(values.HARNESS_CHILD_PID, 10),
    runId: values.HARNESS_CHILD_FIXTURE_RUN_ID,
    marker: values.HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER,
    principalId: values.HARNESS_CHILD_FIXTURE_PRINCIPAL_ID,
    threadId: values.HARNESS_CHILD_FIXTURE_THREAD_ID,
    firstWatchId: values.HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID,
    secondWatchId: values.HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID,
  };
}

function harnessSentinelCounts(harness) {
  return psql(`
SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(harness.principalId)}::uuid AND auth_subject=${sqlLiteral(harness.marker)} AND agent_id=${sqlLiteral(harness.marker)}),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(harness.threadId)}::uuid AND title=${sqlLiteral(harness.marker)} AND "createdById"=${sqlLiteral(harness.marker)});
`, true).replaceAll('|', ',');
}

function recoverHarnessSentinel(harness) {
  psql(`BEGIN;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(harness.threadId)}::uuid AND title=${sqlLiteral(harness.marker)} AND "createdById"=${sqlLiteral(harness.marker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(harness.principalId)}::uuid AND auth_subject=${sqlLiteral(harness.marker)} AND agent_id=${sqlLiteral(harness.marker)};
COMMIT;`);
}

function coordinatorRecovery() {
  psql(`
SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND application_name ~ '^subver:[0-9a-f-]{36}:(first|second)$';
BEGIN;
DELETE FROM public.forum_read_states r USING public.forum_principals p, public.forum_threads t
WHERE p.id=r.principal_id AND t.id=r.thread_id AND p.auth_subject=p.agent_id
  AND p.auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND t.title=t."createdById" AND t.title=p.auth_subject;
DELETE FROM public.forum_watch_subscriptions w USING public.forum_principals p, public.forum_threads t
WHERE p.id=w.principal_id AND t.id=w.thread_id AND p.auth_subject=p.agent_id
  AND p.auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND t.title=t."createdById" AND t.title=p.auth_subject;
DELETE FROM public.forum_threads WHERE title="createdById"
  AND (title ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR title ~ '^subscription-verifier-harness:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
DELETE FROM public.forum_principals WHERE auth_subject=agent_id
  AND (auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR auth_subject ~ '^subscription-verifier-harness:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
COMMIT;`);
}

const emergency = [];
try {
  assertGlobalZero('baseline test start');
  seedBaseline();
  const exactBaseline = captureBaselineRows();
  assert(JSON.parse(exactBaseline).every((row) => row !== null), `baseline capture was incomplete: ${exactBaseline}`);

  const baselineNormal = await start(verifierPath).done;
  assert(baselineNormal.code === 0, `baseline normal verifier failed:\n${baselineNormal.output}`);
  assert(captureBaselineRows() === exactBaseline, 'normal verifier changed exact five-table baseline');
  const baselineFault = await start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_FAULT: 'first-before-ready' }).done;
  assert(baselineFault.code !== 0, 'baseline fault verifier unexpectedly succeeded');
  assert(captureBaselineRows() === exactBaseline, 'fault verifier changed exact five-table baseline');
  const baselineSignal = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_FAULT: 'signal-active' });
  emergency.push(baselineSignal.child);
  await baselineSignal.waitFor('CONCURRENCY_LOCKS_READY');
  baselineSignal.child.kill('SIGTERM');
  const baselineSignalResult = await baselineSignal.done;
  assert(baselineSignalResult.code !== 0 || baselineSignalResult.signal, 'baseline signal verifier unexpectedly succeeded');
  assert(captureBaselineRows() === exactBaseline, 'signal verifier changed exact five-table baseline');
  cleanupBaseline();
  assertGlobalZero('parallel coordinator start');
  console.log('NONEMPTY_EXACT_BASELINE_PRESERVATION=PASS');
  console.log('LOOKALIKE_MARKER_BASELINE_PRESERVATION=PASS');

  const normalA = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  const normalB = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([normalA.waitFor('TEST_HOLD_AFTER_SETUP=READY'), normalB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  assert(runCountsForRecovery(parseFixture(normalA.getOutput())) === '1,1,1,0', 'parallel normal A fixture was not concurrently present');
  assert(runCountsForRecovery(parseFixture(normalB.getOutput())) === '1,1,1,0', 'parallel normal B fixture was not concurrently present');
  const [normalAResult, normalBResult] = await Promise.all([normalA.done, normalB.done]);
  assert(normalAResult.code === 0, `parallel normal A failed:\n${normalAResult.output}`);
  assert(normalBResult.code === 0, `parallel normal B failed:\n${normalBResult.output}`);
  const normalAFixture = parseFixture(normalAResult.output);
  const normalBFixture = parseFixture(normalBResult.output);
  assertDisjoint(normalAFixture, normalBFixture, 'parallel normal');
  assertRunClean(normalAFixture, 'parallel normal A');
  assertRunClean(normalBFixture, 'parallel normal B');

  for (const fault of ['first-before-ready', 'second-failure']) {
    const failing = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_FAULT: fault, SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
    const healthy = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
    await Promise.all([failing.waitFor('TEST_HOLD_AFTER_SETUP=READY'), healthy.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
    assert(runCountsForRecovery(parseFixture(failing.getOutput())) === '1,1,1,0', `${fault}: failing fixture not concurrently present`);
    assert(runCountsForRecovery(parseFixture(healthy.getOutput())) === '1,1,1,0', `${fault}: healthy fixture not concurrently present`);
    const [failedResult, healthyResult] = await Promise.all([failing.done, healthy.done]);
    assert(failedResult.code !== 0, `${fault}: failing verifier unexpectedly succeeded`);
    assert(healthyResult.code === 0, `${fault}: healthy verifier failed:\n${healthyResult.output}`);
    const failedFixture = parseFixture(failedResult.output);
    const healthyFixture = parseFixture(healthyResult.output);
    assertDisjoint(failedFixture, healthyFixture, fault);
    assertRunClean(failedFixture, `${fault} A`);
    assertRunClean(healthyFixture, `${fault} B`);
  }

  const termA = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_FAULT: 'signal-active' });
  emergency.push(termA.child);
  const termB = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([termA.waitFor('CONCURRENCY_LOCKS_READY'), termB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  const termAFixture = parseFixture(termA.getOutput());
  const termBReadyFixture = parseFixture(termB.getOutput());
  assert(runCountsForRecovery(termAFixture) === '1,1,1,0', 'parallel SIGTERM A fixture not concurrently present');
  assert(runCountsForRecovery(termBReadyFixture) === '1,1,1,0', 'parallel SIGTERM B fixture not concurrently present');
  termA.child.kill('SIGTERM');
  const [termAResult, termBResult] = await Promise.all([termA.done, termB.done]);
  assert(termAResult.code !== 0 || termAResult.signal, 'parallel SIGTERM A unexpectedly succeeded');
  assert(termAResult.output.includes('CATCHABLE_SIGNAL_CLEANUP=PASS'), `parallel SIGTERM A cleanup absent:\n${termAResult.output}`);
  assert(termBResult.code === 0, `parallel SIGTERM B failed:\n${termBResult.output}`);
  const termBFixture = parseFixture(termBResult.output);
  assertDisjoint(termAFixture, termBFixture, 'parallel SIGTERM');
  assertRunClean(termAFixture, 'parallel SIGTERM A');
  assertRunClean(termBFixture, 'parallel SIGTERM B');

  const killA = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1' });
  emergency.push(killA.child);
  const killB = start(verifierPath, { SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([killA.waitFor('TEST_PAUSE_AFTER_SETUP=READY'), killB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  const killAFixture = parseFixture(killA.getOutput());
  const killBReadyFixture = parseFixture(killB.getOutput());
  assert(runCountsForRecovery(killAFixture) === '1,1,1,0', 'parallel SIGKILL A fixture not concurrently present');
  assert(runCountsForRecovery(killBReadyFixture) === '1,1,1,0', 'parallel SIGKILL B fixture not concurrently present');
  killA.child.kill('SIGKILL');
  const [killAResult, killBResult] = await Promise.all([killA.done, killB.done]);
  assert(killAResult.signal === 'SIGKILL', `parallel SIGKILL A wrong exit: ${killAResult.code}/${killAResult.signal}`);
  assert(killBResult.code === 0, `parallel SIGKILL B failed:\n${killBResult.output}`);
  const killBFixture = parseFixture(killBResult.output);
  assertDisjoint(killAFixture, killBFixture, 'parallel SIGKILL');
  assertRunClean(killBFixture, 'parallel SIGKILL B');
  externalCleanup(killAFixture);
  assertRunClean(killAFixture, 'parallel SIGKILL A external recovery');

  const assertionHarness = start(harnessPath, { SUBSCRIPTION_CLEANUP_HARNESS_FAULT: 'assertion' });
  const assertionResult = await assertionHarness.done;
  assert(assertionResult.code !== 0, 'injected harness assertion unexpectedly succeeded');
  const assertionMeta = parseHarness(assertionResult.output);
  assert(harnessSentinelCounts(assertionMeta) === '0,0', 'harness assertion failure left sentinel residue');
  console.log('HARNESS_ASSERTION_FAILURE_CLEANUP=PASS');

  const termHarness = start(harnessPath, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD: '1' });
  emergency.push(termHarness.child);
  await termHarness.waitFor('HARNESS_PAUSE_WITH_CHILD=READY');
  const termHarnessMeta = parseHarness(termHarness.getOutput());
  const termHarnessChild = parseHarnessChild(termHarness.getOutput());
  termHarness.child.kill('SIGTERM');
  const termHarnessResult = await termHarness.done;
  assert(termHarnessResult.code !== 0 || termHarnessResult.signal, 'SIGTERM harness unexpectedly succeeded');
  assert(harnessSentinelCounts(termHarnessMeta) === '0,0', 'SIGTERM harness left sentinel residue');
  assertRunClean(termHarnessChild, 'SIGTERM harness child recovery');
  console.log('HARNESS_SIGTERM_CLEANUP=PASS');

  const killHarness = start(harnessPath, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD: '1' });
  emergency.push(killHarness.child);
  await killHarness.waitFor('HARNESS_PAUSE_WITH_CHILD=READY');
  const killHarnessMeta = parseHarness(killHarness.getOutput());
  const killHarnessChild = parseHarnessChild(killHarness.getOutput());
  killHarness.child.kill('SIGKILL');
  const killHarnessResult = await killHarness.done;
  assert(killHarnessResult.signal === 'SIGKILL', `SIGKILL harness wrong exit: ${killHarnessResult.code}/${killHarnessResult.signal}`);
  assert(harnessSentinelCounts(killHarnessMeta) === '1,1', 'SIGKILL harness residue was not exactly identifiable');
  assert(runCountsForRecovery(killHarnessChild) === '1,1,1,0', 'SIGKILL harness child residue was not exactly identifiable');
  try { process.kill(killHarnessChild.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  externalCleanup(killHarnessChild);
  assertRunClean(killHarnessChild, 'external harness child SIGKILL recovery');
  recoverHarnessSentinel(killHarnessMeta);
  assert(harnessSentinelCounts(killHarnessMeta) === '0,0', 'external harness SIGKILL recovery failed');

  assertGlobalZero('parallel coordinator final');
  console.log('PARALLEL_VERIFIER_RUN_ISOLATION=PASS');
  console.log('CROSS_RUN_DELETE_PROTECTION=PASS');
  console.log('CROSS_RUN_SESSION_TERMINATION_PROTECTION=PASS');
  console.log('GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR');
  console.log('FIVE_TABLES_EMPTY=PASS');
  console.log('HARNESS_SIGKILL_CLEANUP_GUARANTEED=NO');
  console.log('HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE=PASS');
  console.log('HARNESS_EXTERNAL_RECOVERY=PASS');
  console.log('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS');
} finally {
  for (const child of allChildren) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  try { coordinatorRecovery(); } catch (error) { console.error(`coordinator recovery failed: ${error.message}`); }
  try { cleanupBaseline(); } catch (error) { console.error(`baseline cleanup failed: ${error.message}`); }
}
