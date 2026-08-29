#!/usr/bin/env node

// Fail-closed external coordinator for parallel verifier isolation and harness
// recovery boundaries. Run only against a freshly migrated disposable
// PostgreSQL database.
//
// The coordinator is the recovery identity authority (COORDINATOR_IDENTITY_AUTHORITY
// = PRESPAWN_EXPECTED_IDENTITY): every child kind, fixture run ID, Principal /
// Thread / Watch ID, ownership marker, expected application_name, harness run ID,
// harness sentinel ID, and harness ownership marker is generated here before any
// child is spawned and passed through explicit test-only environment variables.
// Child stdout metadata is used only to validate that the child echoed the
// expected identity, never to construct recovery DELETEs. Every recovery-step
// error, metadata validation failure, and final database assertion failure is
// collected; any collected error forces a nonzero exit. Top-level success claims
// print only after the finally recovery and its mandatory database assertions
// have completed with no collected error.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a freshly migrated disposable PostgreSQL database.');
  process.exit(2);
}

const coordinatorFault = process.env.SUBSCRIPTION_COORDINATOR_TEST_FAULT ?? '';
const hasCoordinatorIdentityPlan = process.env.SUBSCRIPTION_COORDINATOR_TEST_IDENTITY_PLAN !== undefined;
const coordinatorIdentityPlan = hasCoordinatorIdentityPlan
  ? JSON.parse(process.env.SUBSCRIPTION_COORDINATOR_TEST_IDENTITY_PLAN)
  : { verifiers: [], harnesses: [] };
let verifierIdentityIndex = 0;
let harnessIdentityIndex = 0;
const verifierPath = fileURLToPath(new URL('./verify-subscription-storage.mjs', import.meta.url));
const harnessPath = fileURLToPath(new URL('./test-subscription-verifier-cleanup.mjs', import.meta.url));
const targetTables = ['forum_participations', 'forum_watch_subscriptions', 'forum_read_states', 'forum_mentions', 'forum_notification_facts'];
const fixtureMetadataPrefixes = ['FIXTURE_RUN_ID', 'FIXTURE_OWNERSHIP_MARKER', 'FIXTURE_PRINCIPAL_ID', 'FIXTURE_THREAD_ID', 'FIXTURE_FIRST_WATCH_ID', 'FIXTURE_SECOND_WATCH_ID'];
const harnessMetadataPrefixes = ['HARNESS_RUN_ID', 'HARNESS_OWNERSHIP_MARKER', 'HARNESS_SENTINEL_PRINCIPAL_ID', 'HARNESS_SENTINEL_THREAD_ID', 'HARNESS_CHILD_PID', 'HARNESS_CHILD_FIXTURE_RUN_ID', 'HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER', 'HARNESS_CHILD_FIXTURE_PRINCIPAL_ID', 'HARNESS_CHILD_FIXTURE_THREAD_ID', 'HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID', 'HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const childRecords = new Map();
const controlChildren = new Set();
const allApplicationNames = [];
const foreignFixtures = [];
const recoveryErrors = [];
const finalAssertionErrors = [];
let primaryError = null;
let deliberateResidueRecord = null;
let exactBaselineDigest = null;
const baseline = {
  marker: 'subscription-verifier:customer-data',
  principal1: randomUUID(), principal2: randomUUID(), thread: randomUUID(), message: randomUUID(),
  participation: randomUUID(), watch: randomUUID(), mention: randomUUID(), notification: randomUUID(),
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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

// Stable five-table state digest (PK set plus row content) used by the
// mandatory final baseline assertion.
function captureFiveTableDigest() {
  return psql(`
SELECT md5(coalesce(string_agg(row_text, E'\\n' ORDER BY row_text), ''))
FROM (
  SELECT 'forum_participations:' || id::text || ':' || to_jsonb(x)::text AS row_text FROM public.forum_participations x
  UNION ALL
  SELECT 'forum_watch_subscriptions:' || id::text || ':' || to_jsonb(x)::text FROM public.forum_watch_subscriptions x
  UNION ALL
  SELECT 'forum_read_states:' || thread_id::text || ':' || principal_id::text || ':' || to_jsonb(x)::text FROM public.forum_read_states x
  UNION ALL
  SELECT 'forum_mentions:' || id::text || ':' || to_jsonb(x)::text FROM public.forum_mentions x
  UNION ALL
  SELECT 'forum_notification_facts:' || id::text || ':' || to_jsonb(x)::text FROM public.forum_notification_facts x
) AS rows;
`, true);
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

// ---------------------------------------------------------------------------
// Coordinator-owned identity authority
// ---------------------------------------------------------------------------

function verifierIdentity() {
  const planned = coordinatorIdentityPlan.verifiers?.[verifierIdentityIndex++];
  if (!planned && hasCoordinatorIdentityPlan) throw new Error('prespawn verifier identity plan exhausted');
  const identity = planned ? { ...planned } : {
    runId: randomUUID(),
    principalId: randomUUID(),
    threadId: randomUUID(),
    firstWatchId: randomUUID(),
    secondWatchId: randomUUID(),
  };
  for (const field of ['runId', 'principalId', 'threadId', 'firstWatchId', 'secondWatchId']) {
    if (!uuidPattern.test(identity[field])) throw new Error(`invalid prespawn verifier identity ${field}: ${identity[field]}`);
  }
  if (new Set([identity.principalId, identity.threadId, identity.firstWatchId, identity.secondWatchId]).size !== 4) {
    throw new Error('prespawn verifier fixture IDs are not distinct');
  }
  identity.marker = `subscription-verifier:${identity.runId}`;
  identity.applicationNames = [`subver:${identity.runId}:first`, `subver:${identity.runId}:second`];
  allApplicationNames.push(...identity.applicationNames);
  return identity;
}

function harnessIdentity(withChild) {
  const planned = coordinatorIdentityPlan.harnesses?.[harnessIdentityIndex++];
  if (!planned && hasCoordinatorIdentityPlan) throw new Error('prespawn harness identity plan exhausted');
  const identity = planned ? { ...planned, child: null } : {
    runId: randomUUID(),
    sentinelPrincipalId: randomUUID(),
    sentinelThreadId: randomUUID(),
    child: null,
  };
  for (const field of ['runId', 'sentinelPrincipalId', 'sentinelThreadId']) {
    if (!uuidPattern.test(identity[field])) throw new Error(`invalid prespawn harness identity ${field}: ${identity[field]}`);
  }
  if (identity.sentinelPrincipalId === identity.sentinelThreadId) throw new Error('prespawn harness sentinel IDs are not distinct');
  identity.child = withChild ? verifierIdentity() : null;
  identity.marker = `subscription-verifier-harness:${identity.runId}`;
  return identity;
}

function verifierIdentityEnv(identity) {
  return {
    SUBSCRIPTION_VERIFIER_COORDINATOR_RUN_ID: identity.runId,
    SUBSCRIPTION_VERIFIER_COORDINATOR_PRINCIPAL_ID: identity.principalId,
    SUBSCRIPTION_VERIFIER_COORDINATOR_THREAD_ID: identity.threadId,
    SUBSCRIPTION_VERIFIER_COORDINATOR_FIRST_WATCH_ID: identity.firstWatchId,
    SUBSCRIPTION_VERIFIER_COORDINATOR_SECOND_WATCH_ID: identity.secondWatchId,
  };
}

function harnessIdentityEnv(identity) {
  const env = {
    SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_RUN_ID: identity.runId,
    SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_SENTINEL_PRINCIPAL_ID: identity.sentinelPrincipalId,
    SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_SENTINEL_THREAD_ID: identity.sentinelThreadId,
  };
  if (identity.child) {
    env.SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_RUN_ID = identity.child.runId;
    env.SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_PRINCIPAL_ID = identity.child.principalId;
    env.SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_THREAD_ID = identity.child.threadId;
    env.SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_FIRST_WATCH_ID = identity.child.firstWatchId;
    env.SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_CHILD_SECOND_WATCH_ID = identity.child.secondWatchId;
  }
  return env;
}

function identityFields(identity) {
  return {
    runId: identity.runId,
    marker: identity.marker,
    principalId: identity.principalId,
    threadId: identity.threadId,
    firstWatchId: identity.firstWatchId,
    secondWatchId: identity.secondWatchId,
  };
}

function sessionNamesFor(record) {
  if (record.kind === 'VERIFIER') return record.identity.applicationNames;
  return record.identity.child ? record.identity.child.applicationNames : [];
}

// ---------------------------------------------------------------------------
// Child process management with explicit kind binding
// ---------------------------------------------------------------------------

function startChild(script, kind, identity, env) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
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
      resolve({ child, code, signal, output, spawnError });
    });
  });
  const record = {
    kind, identity, child, done, getOutput: () => output, settled: null, metadataValidated: false,
    creationReceipt: { verifierFixture: false, harnessSentinel: false, harnessChildFixture: false },
  };
  done.then((result) => { record.settled = result; });
  childRecords.set(child, record);
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
  record.waitFor = waitFor;
  return record;
}

function startVerifierWithIdentity(extraEnv = {}) {
  const identity = verifierIdentity();
  return startChild(verifierPath, 'VERIFIER', identity, { ...verifierIdentityEnv(identity), ...extraEnv });
}

function startHarness(withChild, extraEnv = {}) {
  const identity = harnessIdentity(withChild);
  return startChild(harnessPath, 'CLEANUP_HARNESS', identity, { ...harnessIdentityEnv(identity), ...extraEnv });
}

async function waitBounded(record, ms) {
  if (record.settled || record.child.exitCode !== null) return true;
  const closed = await Promise.race([record.done.then(() => true), sleep(ms).then(() => false)]);
  return closed || record.settled !== null || record.child.exitCode !== null;
}

// ---------------------------------------------------------------------------
// Run-scoped database session helpers (exact application_name literals only)
// ---------------------------------------------------------------------------

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

function startControlSession() {
  const appName = `subver:${randomUUID()}:control`;
  allApplicationNames.push(appName);
  const child = spawn('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  controlChildren.add(child);
  child.stdin.write(`SELECT pg_catalog.set_config('application_name', ${sqlLiteral(appName)}, false);\nSELECT pg_catalog.pg_sleep(30);\n`);
  child.stdin.end();
  const done = new Promise((resolve) => { child.once('close', () => resolve()); });
  return {
    appName,
    async stillVisible() {
      return countSessionsExact([appName]) === '1';
    },
    async waitVisible() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await this.stillVisible()) return true;
        await sleep(500);
      }
      return false;
    },
    async terminate() {
      terminateSessionsExact([appName]);
      await Promise.race([done, sleep(5_000)]);
      controlChildren.delete(child);
    },
  };
}

// ---------------------------------------------------------------------------
// Recovery SQL driven only by coordinator-held expected identity
// ---------------------------------------------------------------------------

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
  const ownership = psql(`SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${principal}::uuid),
 (SELECT count(*) FROM public.forum_principals WHERE id=${principal}::uuid AND auth_subject=${marker} AND agent_id=${marker}),
 (SELECT count(*) FROM public.forum_threads WHERE id=${thread}::uuid),
 (SELECT count(*) FROM public.forum_threads WHERE id=${thread}::uuid AND title=${marker} AND "createdById"=${marker});`, true).replaceAll('|', ',');
  const [principalAny, principalOwned, threadAny, threadOwned] = ownership.split(',').map(Number);
  if (principalAny !== principalOwned || threadAny !== threadOwned) {
    throw new Error(`ownership mismatch for run ${fixture.runId}: exact/owned principal=${principalAny}/${principalOwned} thread=${threadAny}/${threadOwned}`);
  }
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

function harnessSentinelCounts(harness) {
  return psql(`
SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(harness.sentinelPrincipalId)}::uuid AND auth_subject=${sqlLiteral(harness.marker)} AND agent_id=${sqlLiteral(harness.marker)}),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(harness.sentinelThreadId)}::uuid AND title=${sqlLiteral(harness.marker)} AND "createdById"=${sqlLiteral(harness.marker)});
`, true).replaceAll('|', ',');
}

function harnessSentinelIdCounts(harness) {
  return psql(`SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(harness.sentinelPrincipalId)}::uuid),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(harness.sentinelThreadId)}::uuid);`, true).replaceAll('|', ',');
}

function recoverHarnessSentinel(harness) {
  const exact = harnessSentinelIdCounts(harness).split(',').map(Number);
  const owned = harnessSentinelCounts(harness).split(',').map(Number);
  if (exact[0] !== owned[0] || exact[1] !== owned[1]) {
    throw new Error(`ownership mismatch for harness ${harness.runId}: exact/owned principal=${exact[0]}/${owned[0]} thread=${exact[1]}/${owned[1]}`);
  }
  psql(`BEGIN;
DELETE FROM public.forum_threads WHERE id=${sqlLiteral(harness.sentinelThreadId)}::uuid AND title=${sqlLiteral(harness.marker)} AND "createdById"=${sqlLiteral(harness.marker)};
DELETE FROM public.forum_principals WHERE id=${sqlLiteral(harness.sentinelPrincipalId)}::uuid AND auth_subject=${sqlLiteral(harness.marker)} AND agent_id=${sqlLiteral(harness.marker)};
COMMIT;`);
}

// ---------------------------------------------------------------------------
// Kind-bound metadata validation against the prespawned expected identity
// ---------------------------------------------------------------------------

function parseValuesExact(output, names) {
  return Object.fromEntries(names.map((name) => {
    const matches = [...output.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))];
    assert(matches.length === 1, `output omitted or duplicated ${name}`);
    return [name, matches[0][1].trim()];
  }));
}

function parseFixtureMetadata(output) {
  const values = parseValuesExact(output, [
    'FIXTURE_RUN_ID', 'FIXTURE_OWNERSHIP_MARKER', 'FIXTURE_PRINCIPAL_ID',
    'FIXTURE_THREAD_ID', 'FIXTURE_FIRST_WATCH_ID', 'FIXTURE_SECOND_WATCH_ID',
  ]);
  const fixture = {
    runId: values.FIXTURE_RUN_ID,
    marker: values.FIXTURE_OWNERSHIP_MARKER,
    principalId: values.FIXTURE_PRINCIPAL_ID,
    threadId: values.FIXTURE_THREAD_ID,
    firstWatchId: values.FIXTURE_FIRST_WATCH_ID,
    secondWatchId: values.FIXTURE_SECOND_WATCH_ID,
  };
  for (const name of ['runId', 'principalId', 'threadId', 'firstWatchId', 'secondWatchId']) {
    if (!uuidPattern.test(fixture[name])) throw new Error(`invalid fixture metadata ${name}: ${fixture[name]}`);
  }
  if (fixture.marker !== `subscription-verifier:${fixture.runId}`) throw new Error(`fixture marker/run mismatch: ${fixture.marker}`);
  if (new Set([fixture.principalId, fixture.threadId, fixture.firstWatchId, fixture.secondWatchId]).size !== 4) {
    throw new Error('fixture metadata IDs are not distinct');
  }
  return fixture;
}

function parseHarnessMetadata(output) {
  const values = parseValuesExact(output, [
    'HARNESS_RUN_ID', 'HARNESS_OWNERSHIP_MARKER',
    'HARNESS_SENTINEL_PRINCIPAL_ID', 'HARNESS_SENTINEL_THREAD_ID',
  ]);
  const harness = {
    runId: values.HARNESS_RUN_ID,
    marker: values.HARNESS_OWNERSHIP_MARKER,
    sentinelPrincipalId: values.HARNESS_SENTINEL_PRINCIPAL_ID,
    sentinelThreadId: values.HARNESS_SENTINEL_THREAD_ID,
  };
  for (const name of ['runId', 'sentinelPrincipalId', 'sentinelThreadId']) {
    if (!uuidPattern.test(harness[name])) throw new Error(`invalid harness metadata ${name}: ${harness[name]}`);
  }
  if (harness.marker !== `subscription-verifier-harness:${harness.runId}`) throw new Error(`harness marker/run mismatch: ${harness.marker}`);
  if (harness.sentinelPrincipalId === harness.sentinelThreadId) throw new Error('harness sentinel metadata IDs are not distinct');
  return harness;
}

function parseHarnessChildMetadata(output) {
  const values = parseValuesExact(output, [
    'HARNESS_CHILD_FIXTURE_RUN_ID', 'HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER',
    'HARNESS_CHILD_FIXTURE_PRINCIPAL_ID', 'HARNESS_CHILD_FIXTURE_THREAD_ID',
    'HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID', 'HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID',
  ]);
  const fixture = {
    runId: values.HARNESS_CHILD_FIXTURE_RUN_ID,
    marker: values.HARNESS_CHILD_FIXTURE_OWNERSHIP_MARKER,
    principalId: values.HARNESS_CHILD_FIXTURE_PRINCIPAL_ID,
    threadId: values.HARNESS_CHILD_FIXTURE_THREAD_ID,
    firstWatchId: values.HARNESS_CHILD_FIXTURE_FIRST_WATCH_ID,
    secondWatchId: values.HARNESS_CHILD_FIXTURE_SECOND_WATCH_ID,
  };
  for (const name of ['runId', 'principalId', 'threadId', 'firstWatchId', 'secondWatchId']) {
    if (!uuidPattern.test(fixture[name])) throw new Error(`invalid harness child metadata ${name}: ${fixture[name]}`);
  }
  if (fixture.marker !== `subscription-verifier:${fixture.runId}`) throw new Error(`harness child marker/run mismatch: ${fixture.marker}`);
  if (new Set([fixture.principalId, fixture.threadId, fixture.firstWatchId, fixture.secondWatchId]).size !== 4) {
    throw new Error('harness child metadata IDs are not distinct');
  }
  return fixture;
}

function readHarnessChildPid(output) {
  const matches = [...output.matchAll(/^HARNESS_CHILD_PID=(\d+)$/gm)];
  assert(matches.length === 1, `output omitted or duplicated HARNESS_CHILD_PID`);
  return Number.parseInt(matches[0][1], 10);
}

function assertNoForeignPrefixes(output, prefixes, label) {
  const pattern = new RegExp(`^(${prefixes.join('|')})=`, 'm');
  if (pattern.test(output)) {
    throw new Error(`ambiguous metadata: ${label} output contained foreign-kind metadata prefixes`);
  }
}

function assertMatchesExpected(parsed, expected, label) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (parsed[field] !== expectedValue) {
      throw new Error(`${label} metadata field ${field} did not match the coordinator-expected identity: child=${parsed[field]} expected=${expectedValue}`);
    }
  }
}

function validateChildMetadata(record) {
  const output = record.getOutput();
  const exit = record.settled ? `exit=${record.settled.code}/${record.settled.signal}` : 'exit=pending';
  try {
    if (record.kind === 'VERIFIER') {
      assertNoForeignPrefixes(output, harnessMetadataPrefixes, 'verifier-kind');
      assertMatchesExpected(parseFixtureMetadata(output), {
        runId: record.identity.runId,
        marker: record.identity.marker,
        principalId: record.identity.principalId,
        threadId: record.identity.threadId,
        firstWatchId: record.identity.firstWatchId,
        secondWatchId: record.identity.secondWatchId,
      }, 'verifier');
    } else if (record.kind === 'CLEANUP_HARNESS') {
      assertNoForeignPrefixes(output, fixtureMetadataPrefixes, 'cleanup-harness-kind');
      assertMatchesExpected(parseHarnessMetadata(output), {
        runId: record.identity.runId,
        marker: record.identity.marker,
        sentinelPrincipalId: record.identity.sentinelPrincipalId,
        sentinelThreadId: record.identity.sentinelThreadId,
      }, 'harness');
      if (record.identity.child) {
        assertMatchesExpected(parseHarnessChildMetadata(output), {
          runId: record.identity.child.runId,
          marker: record.identity.child.marker,
          principalId: record.identity.child.principalId,
          threadId: record.identity.child.threadId,
          firstWatchId: record.identity.child.firstWatchId,
          secondWatchId: record.identity.child.secondWatchId,
        }, 'harness child');
      }
    } else {
      throw new Error(`unknown child kind: ${record.kind}`);
    }
  } catch (error) {
    recoveryErrors.push(new Error(`METADATA_VALIDATION=FAIL child=${record.kind} run=${record.identity.runId} ${exit}: ${error.message}`));
    console.error(`METADATA_VALIDATION=FAIL child=${record.kind} run=${record.identity.runId}`);
    return;
  }
  record.metadataValidated = true;
}

// ---------------------------------------------------------------------------
// Fail-closed recovery
// ---------------------------------------------------------------------------

function receiptCount(output, name) {
  return [...output.matchAll(new RegExp(`^${name}=YES$`, 'gm'))].length;
}

function captureCreationReceipts(record) {
  const output = record.getOutput();
  if (record.kind === 'VERIFIER') {
    const count = receiptCount(output, 'SETUP_COMMITTED');
    if (count > 1) recoveryErrors.push(new Error(`duplicate verifier creation receipt for run ${record.identity.runId}`));
    record.creationReceipt.verifierFixture = count === 1 || runCountsForRecovery(record.identity) !== '0,0,0,0';
  } else if (record.kind === 'CLEANUP_HARNESS') {
    const sentinelCount = receiptCount(output, 'HARNESS_SENTINEL_INSERT_COMMITTED');
    const childCount = receiptCount(output, 'HARNESS_CHILD_INSERT_COMMITTED');
    if (sentinelCount > 1) recoveryErrors.push(new Error(`duplicate harness sentinel creation receipt for run ${record.identity.runId}`));
    if (childCount > 1) recoveryErrors.push(new Error(`duplicate harness child creation receipt for run ${record.identity.runId}`));
    record.creationReceipt.harnessSentinel = sentinelCount === 1 || harnessSentinelIdCounts(record.identity) !== '0,0';
    record.creationReceipt.harnessChildFixture = Boolean(record.identity.child)
      && (childCount === 1 || runCountsForRecovery(record.identity.child) !== '0,0,0,0');
  }
}

function runRecoveryStep(label, action) {
  try {
    return action();
  } catch (error) {
    recoveryErrors.push(new Error(`${label} failed: ${error.message}`));
    return undefined;
  }
}

async function terminateChildProcessGroup(record) {
  const { child } = record;
  const label = `process-group termination for run ${record.identity.runId}`;
  let groupKillError = null;
  try {
    if (coordinatorFault === 'process-group-kill-failure') {
      throw Object.assign(new Error('injected process-group kill failure (test-only)'), { code: 'EPERM' });
    }
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') groupKillError = error;
  }
  if (!groupKillError && await waitBounded(record, 3_000)) return;
  console.error(`PROCESS_GROUP_BACKEND_FALLBACK=EXECUTED run=${record.identity.runId}`);
  runRecoveryStep(`${label} backend fallback`, () => terminateSessionsExact(sessionNamesFor(record)));
  await waitBounded(record, 3_000);
  try { child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') recoveryErrors.push(new Error(`${label} exact-pid kill failed: ${error.message}`)); }
  const closed = await waitBounded(record, 3_000);
  let sessionsLeft = null;
  runRecoveryStep(`${label} session check`, () => { sessionsLeft = countSessionsExact(sessionNamesFor(record)); });
  if (groupKillError || !closed || sessionsLeft !== '0') {
    recoveryErrors.push(new Error(`${label} could not be proven ended: groupKill=${groupKillError ? groupKillError.message : 'ok'} closed=${closed} sessionsLeft=${sessionsLeft}`));
  }
}

function runExternalCleanup(identity) {
  const label = `external cleanup for run ${identity.runId}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (coordinatorFault === 'external-cleanup-transient-failure' && attempt === 1) {
        throw new Error('injected transient external cleanup failure (test-only)');
      }
      if (coordinatorFault === 'external-cleanup-permanent-failure') {
        throw new Error('injected permanent external cleanup failure (test-only)');
      }
      externalCleanup(identity);
      return;
    } catch (error) {
      recoveryErrors.push(new Error(`${label} attempt ${attempt} failed: ${error.message}`));
    }
  }
}

function runFinalAssertion(label, action) {
  try {
    action();
  } catch (error) {
    finalAssertionErrors.push(new Error(`${label}: ${error.message}`));
  }
}

function finalAssertionGroup(passLabel, action) {
  const before = finalAssertionErrors.length;
  action();
  if (finalAssertionErrors.length === before && passLabel) console.log(passLabel);
}

function runFinalAssertions() {
  finalAssertionGroup('COORDINATOR_OWNED_ROWS_FINAL_ASSERTION=PASS', () => {
    for (const record of childRecords.values()) {
      const identity = record.kind === 'VERIFIER' ? record.identity : record.identity.child;
      const created = record.kind === 'VERIFIER'
        ? record.creationReceipt.verifierFixture
        : record.creationReceipt.harnessChildFixture;
      if (!identity || !created) continue;
      runFinalAssertion(`created owned IDs for run ${identity.runId}`, () => assertRunClean(identity));
    }
  });
  finalAssertionGroup('COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION=PASS', () => {
    for (const record of childRecords.values()) {
      if (record.kind !== 'CLEANUP_HARNESS' || !record.creationReceipt.harnessSentinel) continue;
      runFinalAssertion(`created harness sentinel IDs for run ${record.identity.runId}`, () => {
        assert(harnessSentinelIdCounts(record.identity) === '0,0', `harness sentinel exact-ID residue remained (${harnessSentinelIdCounts(record.identity)})`);
      });
    }
  });
  finalAssertionGroup('RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS', () => {
    runFinalAssertion('run-scoped application_name sessions', () => {
      assert(countSessionsExact(allApplicationNames) === '0', `run-scoped application_name sessions remained (${countSessionsExact(allApplicationNames)})`);
    });
  });
  finalAssertionGroup('COORDINATOR_BASELINE_FINAL_ASSERTION=PASS', () => {
    runFinalAssertion('exact five-table baseline restoration', () => {
      assert(exactBaselineDigest !== null, 'start-state five-table digest was never captured');
      const current = captureFiveTableDigest();
      assert(current === exactBaselineDigest, `exact five-table baseline digest changed: start=${exactBaselineDigest} final=${current}`);
    });
  });
  finalAssertionGroup('COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS', () => {
    runFinalAssertion('global five-table zero', () => assertGlobalZero('coordinator final assertion'));
  });
}

async function failClosedRecovery() {
  // 1. Terminate every still-running child through its exact process group,
  //    falling back to exact run-scoped backend termination and exact-pid kill.
  const running = [...childRecords.values()].filter(({ child }) => child.exitCode === null);
  for (const record of running) await terminateChildProcessGroup(record);
  await Promise.allSettled([...childRecords.values()].map(({ done }) => done));
  for (const record of childRecords.values()) captureCreationReceipts(record);
  // 2. Kind-bound metadata validation for every child against expected identity.
  for (const record of childRecords.values()) validateChildMetadata(record);
  // 3. Marker-qualified external recovery driven only by coordinator-held identity.
  for (const record of childRecords.values()) {
    const identity = record.kind === 'VERIFIER' ? record.identity : record.identity.child;
    if (!identity) continue;
    if (record === deliberateResidueRecord) {
      recoveryErrors.push(new Error(`DELIBERATE_RESIDUE_INJECTED: external cleanup intentionally skipped for run ${identity.runId} (test-only fault)`));
      continue;
    }
    runExternalCleanup(identity);
  }
  // 4. Harness sentinel recovery.
  for (const record of childRecords.values()) {
    if (record.kind !== 'CLEANUP_HARNESS') continue;
    runRecoveryStep(`harness sentinel recovery for run ${record.identity.runId}`, () => {
      if (coordinatorFault === 'sentinel-recovery-failure') throw new Error('injected sentinel recovery failure (test-only)');
      recoverHarnessSentinel(record.identity);
    });
  }
  // 5. Terminate any remaining coordinator-created sessions (exact names only)
  //    and any control-session psql processes.
  runRecoveryStep('run-scoped session termination', () => terminateSessionsExact(allApplicationNames));
  runRecoveryStep('run-scoped session termination wait', () => { psql('SELECT pg_catalog.pg_sleep(1);'); });
  for (const control of controlChildren) {
    try { control.kill('SIGKILL'); } catch (error) { recoveryErrors.push(new Error(`control child termination failed: ${error.message}`)); }
  }
  // 6. Baseline cleanup (errors propagate into the aggregate report).
  runRecoveryStep('baseline cleanup', () => cleanupBaseline());
  // 7. Mandatory final database assertions after recovery, on every path.
  runFinalAssertions();
}

function identityDump() {
  return {
    children: [...childRecords.values()].map((record) => {
      if (record.kind === 'VERIFIER') return { kind: record.kind, ...identityFields(record.identity), creationReceipt: { ...record.creationReceipt } };
      return {
        kind: record.kind,
        runId: record.identity.runId,
        marker: record.identity.marker,
        sentinelPrincipalId: record.identity.sentinelPrincipalId,
        sentinelThreadId: record.identity.sentinelThreadId,
        tamperedMarker: record.identity.tamperedMarker ?? null,
        creationReceipt: { ...record.creationReceipt },
        child: record.identity.child ? identityFields(record.identity.child) : null,
      };
    }),
    applicationNames: allApplicationNames,
    foreignFixtures: foreignFixtures.map((fixture) => ({ ...fixture })),
  };
}

// ---------------------------------------------------------------------------
// Full scenario (no coordinator fault injected)
// ---------------------------------------------------------------------------

async function runFullScenario() {
  seedBaseline();
  const exactBaselineRows = captureBaselineRows();
  assert(JSON.parse(exactBaselineRows).every((row) => row !== null), `baseline capture was incomplete: ${exactBaselineRows}`);

  const baselineNormal = startVerifierWithIdentity();
  const baselineNormalResult = await baselineNormal.done;
  assert(baselineNormalResult.code === 0, `baseline normal verifier failed:\n${baselineNormalResult.output}`);
  assert(captureBaselineRows() === exactBaselineRows, 'normal verifier changed exact five-table baseline');
  const baselineFault = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_FAULT: 'first-before-ready' });
  const baselineFaultResult = await baselineFault.done;
  assert(baselineFaultResult.code !== 0, 'baseline fault verifier unexpectedly succeeded');
  assert(captureBaselineRows() === exactBaselineRows, 'fault verifier changed exact five-table baseline');
  const baselineSignal = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_FAULT: 'signal-active' });
  await baselineSignal.waitFor('CONCURRENCY_LOCKS_READY');
  baselineSignal.child.kill('SIGTERM');
  const baselineSignalResult = await baselineSignal.done;
  assert(baselineSignalResult.code !== 0 || baselineSignalResult.signal, 'baseline signal verifier unexpectedly succeeded');
  assert(captureBaselineRows() === exactBaselineRows, 'signal verifier changed exact five-table baseline');
  cleanupBaseline();
  assertGlobalZero('parallel coordinator start');
  const parallelStartDigest = captureFiveTableDigest();
  assert(parallelStartDigest === exactBaselineDigest, 'five-table state changed across the baseline phase');
  exactBaselineDigest = parallelStartDigest;
  console.log('NONEMPTY_EXACT_BASELINE_PRESERVATION=PASS');
  console.log('LOOKALIKE_MARKER_BASELINE_PRESERVATION=PASS');

  const normalA = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  const normalB = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([normalA.waitFor('TEST_HOLD_AFTER_SETUP=READY'), normalB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  assert(runCountsForRecovery(normalA.identity) === '1,1,1,0', 'parallel normal A fixture was not concurrently present');
  assert(runCountsForRecovery(normalB.identity) === '1,1,1,0', 'parallel normal B fixture was not concurrently present');
  const [normalAResult, normalBResult] = await Promise.all([normalA.done, normalB.done]);
  assert(normalAResult.code === 0, `parallel normal A failed:\n${normalAResult.output}`);
  assert(normalBResult.code === 0, `parallel normal B failed:\n${normalBResult.output}`);
  assertDisjoint(normalA.identity, normalB.identity, 'parallel normal');
  assertRunClean(normalA.identity, 'parallel normal A');
  assertRunClean(normalB.identity, 'parallel normal B');

  for (const fault of ['first-before-ready', 'second-failure']) {
    const failing = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_FAULT: fault, SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
    const healthy = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
    await Promise.all([failing.waitFor('TEST_HOLD_AFTER_SETUP=READY'), healthy.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
    assert(runCountsForRecovery(failing.identity) === '1,1,1,0', `${fault}: failing fixture not concurrently present`);
    assert(runCountsForRecovery(healthy.identity) === '1,1,1,0', `${fault}: healthy fixture not concurrently present`);
    const [failedResult, healthyResult] = await Promise.all([failing.done, healthy.done]);
    assert(failedResult.code !== 0, `${fault}: failing verifier unexpectedly succeeded`);
    assert(healthyResult.code === 0, `${fault}: healthy verifier failed:\n${healthyResult.output}`);
    assertDisjoint(failing.identity, healthy.identity, fault);
    assertRunClean(failing.identity, `${fault} A`);
    assertRunClean(healthy.identity, `${fault} B`);
  }

  const termA = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_FAULT: 'signal-active' });
  const termB = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([termA.waitFor('CONCURRENCY_LOCKS_READY'), termB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  assert(runCountsForRecovery(termA.identity) === '1,1,1,0', 'parallel SIGTERM A fixture not concurrently present');
  assert(runCountsForRecovery(termB.identity) === '1,1,1,0', 'parallel SIGTERM B fixture not concurrently present');
  termA.child.kill('SIGTERM');
  const [termAResult, termBResult] = await Promise.all([termA.done, termB.done]);
  assert(termAResult.code !== 0 || termAResult.signal, 'parallel SIGTERM A unexpectedly succeeded');
  assert(termAResult.output.includes('CATCHABLE_SIGNAL_CLEANUP=PASS'), `parallel SIGTERM A cleanup absent:\n${termAResult.output}`);
  assert(termBResult.code === 0, `parallel SIGTERM B failed:\n${termBResult.output}`);
  assertDisjoint(termA.identity, termB.identity, 'parallel SIGTERM');
  assertRunClean(termA.identity, 'parallel SIGTERM A');
  assertRunClean(termB.identity, 'parallel SIGTERM B');

  const killA = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1' });
  const killB = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS: '2500' });
  await Promise.all([killA.waitFor('TEST_PAUSE_AFTER_SETUP=READY'), killB.waitFor('TEST_HOLD_AFTER_SETUP=READY')]);
  assert(runCountsForRecovery(killA.identity) === '1,1,1,0', 'parallel SIGKILL A fixture not concurrently present');
  assert(runCountsForRecovery(killB.identity) === '1,1,1,0', 'parallel SIGKILL B fixture not concurrently present');
  const controlSession = startControlSession();
  assert(await controlSession.waitVisible(), 'foreign control database session never became visible');
  killA.child.kill('SIGKILL');
  const [killAResult, killBResult] = await Promise.all([killA.done, killB.done]);
  assert(killAResult.signal === 'SIGKILL', `parallel SIGKILL A wrong exit: ${killAResult.code}/${killAResult.signal}`);
  assert(killBResult.code === 0, `parallel SIGKILL B failed:\n${killBResult.output}`);
  assertDisjoint(killA.identity, killB.identity, 'parallel SIGKILL');
  assertRunClean(killB.identity, 'parallel SIGKILL B');
  externalCleanup(killA.identity);
  assertRunClean(killA.identity, 'parallel SIGKILL A external recovery');
  assert(await controlSession.stillVisible(), 'marker-qualified external recovery terminated a foreign application_name session');
  console.log('OTHER_SESSION_PRESERVATION=PASS');
  await controlSession.terminate();

  const assertionHarness = startHarness(false, { SUBSCRIPTION_CLEANUP_HARNESS_FAULT: 'assertion' });
  const assertionResult = await assertionHarness.done;
  assert(assertionResult.code !== 0, 'injected harness assertion unexpectedly succeeded');
  assert(harnessSentinelCounts(assertionHarness.identity) === '0,0', 'harness assertion failure left sentinel residue');
  console.log('HARNESS_ASSERTION_FAILURE_CLEANUP=PASS');

  const termHarness = startHarness(true, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD: '1' });
  await termHarness.waitFor('HARNESS_PAUSE_WITH_CHILD=READY');
  termHarness.child.kill('SIGTERM');
  const termHarnessResult = await termHarness.done;
  assert(termHarnessResult.code !== 0 || termHarnessResult.signal, 'SIGTERM harness unexpectedly succeeded');
  assert(harnessSentinelCounts(termHarness.identity) === '0,0', 'SIGTERM harness left sentinel residue');
  assertRunClean(termHarness.identity.child, 'SIGTERM harness child recovery');
  console.log('HARNESS_SIGTERM_CLEANUP=PASS');

  const killHarness = startHarness(true, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD: '1' });
  await killHarness.waitFor('HARNESS_PAUSE_WITH_CHILD=READY');
  killHarness.child.kill('SIGKILL');
  const killHarnessResult = await killHarness.done;
  assert(killHarnessResult.signal === 'SIGKILL', `SIGKILL harness wrong exit: ${killHarnessResult.code}/${killHarnessResult.signal}`);
  assert(harnessSentinelCounts(killHarness.identity) === '1,1', 'SIGKILL harness residue was not exactly identifiable');
  assert(runCountsForRecovery(killHarness.identity.child) === '1,1,1,0', 'SIGKILL harness child residue was not exactly identifiable');
  const harnessChildPid = readHarnessChildPid(killHarness.getOutput());
  try { process.kill(harnessChildPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  externalCleanup(killHarness.identity.child);
  assertRunClean(killHarness.identity.child, 'external harness child SIGKILL recovery');
  recoverHarnessSentinel(killHarness.identity);
  assert(harnessSentinelCounts(killHarness.identity) === '0,0', 'external harness SIGKILL recovery failed');

  assertGlobalZero('parallel coordinator final');
}

// ---------------------------------------------------------------------------
// Compact fault scenarios for the coordinator failure-recovery suite
// ---------------------------------------------------------------------------

function seedForeignMismatchFixture(identity) {
  const marker = `foreign-mismatch:${identity.runId}`;
  const { principalId, threadId } = identity;
  psql(`BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES (${sqlLiteral(principalId)},${sqlLiteral(marker)},${sqlLiteral(marker)},now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES (${sqlLiteral(threadId)},${sqlLiteral(marker)},${sqlLiteral(marker)},'foreign',now(),now());
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${sqlLiteral(threadId)},${sqlLiteral(principalId)},'known',0,NULL,'runtime',now());
COMMIT;`);
  return { marker, principalId, threadId };
}

function foreignMismatchCounts(fixture) {
  return psql(`
SELECT
 (SELECT count(*) FROM public.forum_principals WHERE id=${sqlLiteral(fixture.principalId)}::uuid AND auth_subject=${sqlLiteral(fixture.marker)} AND agent_id=${sqlLiteral(fixture.marker)}),
 (SELECT count(*) FROM public.forum_threads WHERE id=${sqlLiteral(fixture.threadId)}::uuid AND title=${sqlLiteral(fixture.marker)} AND "createdById"=${sqlLiteral(fixture.marker)}),
 (SELECT count(*) FROM public.forum_read_states WHERE thread_id=${sqlLiteral(fixture.threadId)}::uuid AND principal_id=${sqlLiteral(fixture.principalId)}::uuid);
`, true).replaceAll('|', ',');
}

function tailOf(text) {
  return text.length <= 400 ? text : `...${text.slice(-400)}`;
}

async function killPausedChild(record, label) {
  await record.waitFor('TEST_PAUSE_AFTER_SETUP=READY');
  assert(runCountsForRecovery(record.identity) === '1,1,1,0', `${label}: fixture was not committed before kill`);
  record.child.kill('SIGKILL');
  await record.done;
}

async function runFaultScenario(fault) {
  switch (fault) {
    case 'child-pre-metadata-exit':
    case 'partial-metadata':
    case 'duplicate-metadata': {
      const verifierFault = {
        'child-pre-metadata-exit': 'pre-metadata-exit',
        'partial-metadata': 'partial-metadata',
        'duplicate-metadata': 'duplicate-metadata',
      }[fault];
      const broken = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_FAULT: verifierFault });
      const brokenResult = await broken.done;
      primaryError = new Error(`injected ${fault} child failed before usable metadata: exit=${brokenResult.code}/${brokenResult.signal}\n${tailOf(brokenResult.output)}`);
      const residue = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1' });
      await killPausedChild(residue, fault);
      break;
    }
    case 'forged-metadata': {
      for (const variant of ['wrong-run-id', 'wrong-marker', 'non-uuid', 'duplicate-ids', 'foreign-run']) {
        const forged = startVerifierWithIdentity({
          SUBSCRIPTION_VERIFIER_TEST_FAULT: 'forged-metadata',
          SUBSCRIPTION_VERIFIER_TEST_FORGED_VARIANT: variant,
          SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1',
        });
        await killPausedChild(forged, `forged ${variant}`);
      }
      break;
    }
    case 'mixed-metadata': {
      const mixed = startVerifierWithIdentity({
        SUBSCRIPTION_VERIFIER_TEST_FAULT: 'mixed-metadata',
        SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1',
      });
      await killPausedChild(mixed, 'mixed');
      break;
    }
    case 'process-group-kill-failure': {
      const held = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1' });
      await held.waitFor('TEST_PAUSE_AFTER_SETUP=READY');
      assert(runCountsForRecovery(held.identity) === '1,1,1,0', 'process-group-kill-failure: fixture was not committed');
      primaryError = new Error('injected coordinator failure with a running child');
      break;
    }
    case 'external-cleanup-transient-failure':
    case 'external-cleanup-permanent-failure':
    case 'deliberate-residue': {
      const held = startVerifierWithIdentity({ SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP: '1' });
      await killPausedChild(held, fault);
      if (fault === 'deliberate-residue') deliberateResidueRecord = held;
      break;
    }
    case 'marker-mismatch': {
      const probe = verifierIdentity();
      const foreign = seedForeignMismatchFixture(probe);
      foreignFixtures.push(foreign);
      try { externalCleanup(probe); } catch (error) { recoveryErrors.push(new Error(`MARKER_MISMATCH_DETECTED: ${error.message}`)); }
      const remaining = foreignMismatchCounts(foreign);
      assert(remaining === '1,1,1', `marker-mismatch probe deleted or altered foreign rows (${remaining})`);
      recoveryErrors.push(new Error(`MARKER_MISMATCH_DETECTED: recovery identity for (${foreign.threadId},${foreign.principalId}) did not match the foreign ownership marker; no rows were deleted and the mismatch is reported instead`));
      break;
    }
    case 'sentinel-marker-tamper': {
      const harness = startHarness(false, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_AFTER_SENTINEL: '1' });
      await harness.waitFor('HARNESS_PAUSE_AFTER_SENTINEL=READY');
      assert(harnessSentinelIdCounts(harness.identity) === '1,1', 'sentinel-marker-tamper: sentinel creation receipt was not visible');
      const foreignMarker = `foreign-sentinel:${harness.identity.runId}`;
      harness.identity.tamperedMarker = foreignMarker;
      psql(`BEGIN;
UPDATE public.forum_threads SET title=${sqlLiteral(foreignMarker)}, "createdById"=${sqlLiteral(foreignMarker)} WHERE id=${sqlLiteral(harness.identity.sentinelThreadId)}::uuid;
UPDATE public.forum_principals SET auth_subject=${sqlLiteral(foreignMarker)}, agent_id=${sqlLiteral(foreignMarker)} WHERE id=${sqlLiteral(harness.identity.sentinelPrincipalId)}::uuid;
COMMIT;`);
      harness.child.kill('SIGKILL');
      await harness.done;
      break;
    }
    case 'sentinel-recovery-failure': {
      const harness = startHarness(true, { SUBSCRIPTION_CLEANUP_HARNESS_PAUSE_WITH_CHILD: '1' });
      await harness.waitFor('HARNESS_PAUSE_WITH_CHILD=READY');
      assert(harnessSentinelCounts(harness.identity) === '1,1', 'sentinel-recovery-failure: sentinel was not present before kill');
      assert(runCountsForRecovery(harness.identity.child) === '1,1,1,0', 'sentinel-recovery-failure: child fixture was not present before kill');
      harness.child.kill('SIGKILL');
      await harness.done;
      break;
    }
    default:
      throw new Error(`unknown coordinator test fault: ${fault}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

try {
  assertGlobalZero('coordinator start');
  exactBaselineDigest = captureFiveTableDigest();
  if (coordinatorFault) await runFaultScenario(coordinatorFault);
  else await runFullScenario();
} catch (error) {
  primaryError = error;
} finally {
  await failClosedRecovery();
}

const failures = [primaryError, ...recoveryErrors, ...finalAssertionErrors].filter(Boolean);
if (failures.length > 0) {
  console.error('COORDINATOR_RESULT=NONZERO');
  console.error(`PRIMARY_ERROR=${primaryError ? primaryError.message : 'NONE'}`);
  recoveryErrors.forEach((error, index) => { console.error(`RECOVERY_ERRORS[${index}]=${error.message}`); });
  finalAssertionErrors.forEach((error, index) => { console.error(`FINAL_ASSERTION_ERRORS[${index}]=${error.message}`); });
  console.error(`COORDINATOR_EXPECTED_IDENTITY_DUMP=${JSON.stringify(identityDump())}`);
  const aggregate = new AggregateError(failures, 'subscription coordinator fail-closed report: body, recovery, and final assertion errors are preserved');
  console.error(aggregate.message);
  process.exit(1);
}

// Top-level success claims print only after the finally recovery completed with
// every mandatory final assertion passing and no collected error.
console.log('PARALLEL_VERIFIER_RUN_ISOLATION=PASS');
console.log('CROSS_RUN_DELETE_PROTECTION=PASS');
console.log('CROSS_RUN_SESSION_TERMINATION_PROTECTION=PASS');
console.log('GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR');
console.log('FIVE_TABLES_EMPTY=PASS');
console.log('HARNESS_SIGKILL_CLEANUP_GUARANTEED=NO');
console.log('HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE=PASS');
console.log('HARNESS_EXTERNAL_RECOVERY=PASS');
console.log('CHILD_KIND_BINDING=PASS');
console.log('SENTINEL_ID_ONLY_FINAL_ASSERTION=PASS');
console.log('CREATION_RECEIPT_TRACKING=PASS');
console.log('SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES');
console.log('SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS');
