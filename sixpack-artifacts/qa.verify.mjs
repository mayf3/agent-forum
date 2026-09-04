#!/usr/bin/env node

// Executable QA automation for AF-VERIFIER-1. Database execution is deliberately
// gated by an explicit disposable-target acknowledgement and two distinct URLs.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const service = join(root, 'svc-forum');
const requiredReports = ['cleaner.report.md', 'architect.report.md', 'hardender.report.md'];
const requiredCommands = new Map([
  ['test:subscription-verifier-cleanup', 'node scripts/test-subscription-verifier-cleanup.mjs'],
  ['test:subscription-verifier-parallel-isolation', 'node scripts/test-subscription-verifier-parallel-isolation.mjs'],
  ['test:subscription-coordinator-failure-recovery', 'node scripts/test-subscription-coordinator-failure-recovery.mjs'],
]);
const expectedStageSubjects = [
  'sixpack(specifier): af-verifier-1',
  'sixpack(coder): af-verifier-1',
  'sixpack(cleaner): af-verifier-1',
  'sixpack(architect): af-verifier-1',
  'sixpack(hardender): af-verifier-1',
];
const productCoreMarkers = [
  'FIVE_EXACT_TABLE_SHAPES=PASS',
  'FIFTEEN_VALIDATED_FKS_RESTRICT_RESTRICT=PASS',
  'FOUR_BUSINESS_KEYS_AND_WATCH_PARTIAL_UNIQUE=PASS',
  'SQL_029_THROUGH_SQL_040_EXACT_CATALOG=PASS',
  'TRANSACTIONAL_BEHAVIOR_AND_SQLSTATES=PASS',
  'PER_RUN_MAIN_FIXTURE_CLEAN=PASS',
  'BASELINE_PRESERVATION=PASS',
  'CLEANUP_OWNERSHIP_VERIFIED=PASS',
  'PER_RUN_FIXTURE_CLEAN=PASS',
  'SUBSCRIPTION_STORAGE=PASS',
];
const commandExpectations = new Map([
  ['test:subscription-verifier-cleanup', {
    markers: [
      'EARLY_EXIT_ERROR_PRESERVATION=PASS', 'FIXTURE_PARSE_ERROR_CONTROLLED=PASS',
      'FIXED_UUID_REGRESSION_TEST=PASS', 'SETUP_CONFLICT_NONDESTRUCTIVE=PASS',
      'POST_COMMIT_ACK_FAILURE_CLEANUP=PASS', 'CLEANUP_RETRY_AFTER_TRANSIENT_FAILURE=PASS',
      'FIRST_SESSION_FAILURE_CLEANUP=PASS', 'FIRST_SESSION_AFTER_READY_CLEANUP=PASS',
      'SECOND_SESSION_FAILURE_CLEANUP=PASS', 'LOCK_TIMEOUT_CLEANUP=PASS',
      'STATEMENT_TIMEOUT_CLEANUP=PASS', 'SIGINT_CLEANUP=PASS', 'SIGTERM_CLEANUP=PASS',
      'SIGHUP_CLEANUP=PASS', 'UNCAUGHT_EXCEPTION_CLEANUP=PASS',
      'UNHANDLED_REJECTION_CLEANUP=PASS', 'SIGKILL_BOUNDARY_TEST=PASS',
      'SIGKILL_RESIDUE_OWNERSHIP_IDENTIFIABLE=PASS', 'PREEXISTING_PARENT_PRESERVATION=PASS',
      'CLEANUP_IDEMPOTENT_FOR_OWNED_FIXTURES=PASS', 'HARNESS_FINALLY_REACHED=PASS',
      'HARNESS_OWNED_SENTINEL_CLEANUP=PASS', 'SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS',
    ],
    terminalPrerequisite: 'HARNESS_OWNED_SENTINEL_CLEANUP=PASS',
    overall: 'SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS',
  }],
  ['test:subscription-verifier-parallel-isolation', {
    markers: [
      'NONEMPTY_EXACT_BASELINE_PRESERVATION=PASS', 'LOOKALIKE_MARKER_BASELINE_PRESERVATION=PASS',
      'OTHER_SESSION_PRESERVATION=PASS', 'HARNESS_ASSERTION_FAILURE_CLEANUP=PASS',
      'HARNESS_SIGTERM_CLEANUP=PASS', 'PARALLEL_VERIFIER_RUN_ISOLATION=PASS',
      'CROSS_RUN_DELETE_PROTECTION=PASS', 'CROSS_RUN_SESSION_TERMINATION_PROTECTION=PASS',
      'GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR', 'FIVE_TABLES_EMPTY=PASS',
      'HARNESS_SIGKILL_CLEANUP_GUARANTEED=NO', 'HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE=PASS',
      'HARNESS_EXTERNAL_RECOVERY=PASS', 'CHILD_KIND_BINDING=PASS',
      'SENTINEL_ID_ONLY_FINAL_ASSERTION=PASS', 'CREATION_RECEIPT_TRACKING=PASS',
      'COORDINATOR_OWNED_ROWS_FINAL_ASSERTION=PASS',
      'COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION=PASS',
      'RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS', 'COORDINATOR_BASELINE_FINAL_ASSERTION=PASS',
      'COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS', 'SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES',
      'SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS',
    ],
    terminalPrerequisite: 'SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES',
    overall: 'SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS',
  }],
  ['test:subscription-coordinator-failure-recovery', {
    markers: [
      'CHILD_PRE_METADATA_EXIT_RECOVERY=PASS', 'PARTIAL_METADATA_REJECTED=PASS',
      'DUPLICATE_METADATA_REJECTED=PASS', 'AMBIGUOUS_OUTPUT_REJECTED=PASS',
      'FORGED_METADATA_REJECTED=PASS', 'PROCESS_GROUP_KILL_FAILURE_PROPAGATION=PASS',
      'TRANSIENT_CLEANUP_FAILURE_RECOVERED_WITH_RETRY=PASS',
      'PERMANENT_CLEANUP_FAILURE_PROPAGATED=PASS', 'MARKER_MISMATCH_NO_CROSS_MARKER_DELETE=PASS',
      'MARKER_MISMATCH_FAIL_CLOSED=PASS', 'SENTINEL_RECOVERY_FAILURE_PROPAGATED=PASS',
      'DELIBERATE_RESIDUE_CAUGHT_BY_FINAL_ASSERTION=PASS', 'FAULT_SUITE_SIGTERM_CLEANUP=PASS',
      'FAULT_SUITE_OUTPUT_PARSE_FAILURE_CLEANUP=PASS', 'FAULT_SUITE_ASSERTION_FAILURE_CLEANUP=PASS',
      'FAULT_SUITE_COORDINATOR_TIMEOUT_CLEANUP=PASS', 'COORDINATOR_PARSE_FAILURE_PROPAGATION=PASS',
      'COORDINATOR_RECOVERY_FAILURE_PROPAGATION=PASS', 'COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS',
      'COORDINATOR_BASELINE_FINAL_ASSERTION=PASS', 'RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS',
      'PRIMARY_ERROR_PRESERVED=PASS', 'RECOVERY_ERROR_PRESERVED=PASS',
      'COMBINED_ERROR_REPORTING=PASS', 'CHILD_KIND_BINDING=PASS',
      'FAULT_SUITE_IDENTITY_AUTHORITY=PRESPAWN_EXPECTED_IDENTITY', 'FAULT_SUITE_TOP_LEVEL_FINALLY=PASS',
      'FAULT_SUITE_PRIMARY_ERROR_PRESERVED=PASS', 'FAULT_SUITE_CLEANUP_ERROR_PRESERVED=PASS',
      'FAULT_SUITE_COMBINED_ERROR_REPORTING=PASS', 'FAULT_SUITE_BASELINE_FINAL_ASSERTION=PASS',
      'FAULT_SUITE_OWNED_ID_FINAL_ASSERTION=PASS', 'FAULT_SUITE_SESSION_FINAL_ASSERTION=PASS',
      'FAULT_SUITE_SIGKILL_CLEANUP_GUARANTEED=NO', 'FOREIGN_MARKER_NOT_DELETED_BY_COORDINATOR=PASS',
      'FAULT_SUITE_TAMPERED_FIXTURE_RECOVERED=PASS',
      'SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS',
    ],
    terminalPrerequisite: 'FAULT_SUITE_SESSION_FINAL_ASSERTION=PASS',
    overall: 'SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS',
  }],
]);
const targetTables = [
  'forum_participations',
  'forum_watch_subscriptions',
  'forum_read_states',
  'forum_mentions',
  'forum_notification_facts',
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    const digest = createHash('sha256').update(output).digest('hex');
    fail(`${command} failed (exit=${result.status}, output_sha256=${digest})`);
  }
  return output;
}

function git(...args) {
  return run('git', args).trim();
}

function assertMarkers(output, markers, label) {
  for (const marker of markers) {
    if (!output.split(/\r?\n/).some((line) => line.trim() === marker)) {
      fail(`${label} omitted required terminal marker: ${marker}`);
    }
  }
}

function assertOverallMarkerOrdering(output, prerequisite, overall, label) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const occurrences = lines.filter((line) => line === overall).length;
  if (occurrences !== 1) fail(`${label} emitted its overall marker ${occurrences} times`);
  if (lines.lastIndexOf(overall) <= lines.lastIndexOf(prerequisite)) {
    fail(`${label} emitted overall PASS before terminal recovery/assertion evidence`);
  }
}

function assertEmptyTerminalState(databaseUrl) {
  const psqlEnv = { ...process.env, PGDATABASE: databaseUrl };
  const tableSql = targetTables
    .map((table) => `SELECT '${table}=' || count(*) FROM public.${table};`)
    .join('\n');
  const output = run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', tableSql], { env: psqlEnv });
  const counts = new Map(output.trim().split(/\r?\n/).map((line) => line.trim().split('=')));
  for (const table of targetTables) {
    if (counts.get(table) !== '0') fail(`terminal table assertion failed for ${table}`);
  }

  const sessions = run('psql', [
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--command', "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'subscription-verifier:%' OR application_name LIKE 'subscription-verifier-harness:%';",
  ], { env: psqlEnv }).trim();
  if (sessions !== '0') fail(`terminal run-scoped session assertion failed (count=${sessions})`);
}

function assertEmittedIdentityAbsence(databaseUrl, output) {
  const ids = { forum_principals: new Set(), forum_threads: new Set(), forum_watch_subscriptions: new Set() };
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z][A-Z0-9_]+_(?:PRINCIPAL|THREAD|(?:FIRST_|SECOND_)?WATCH)_ID)=([0-9a-f-]+)$/i);
    if (!match) continue;
    const [, key, value] = match;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      fail(`public command emitted an invalid UUID for ${key}`);
    }
    if (key.includes('PRINCIPAL_ID')) ids.forum_principals.add(value);
    else if (key.includes('THREAD_ID')) ids.forum_threads.add(value);
    else ids.forum_watch_subscriptions.add(value);
  }

  const checks = [];
  for (const [table, values] of Object.entries(ids)) {
    if (!values.size) continue;
    const literals = [...values].map((value) => `'${value}'::uuid`).join(', ');
    checks.push(`SELECT '${table}=' || count(*) FROM public.${table} WHERE id IN (${literals});`);
  }
  if (!checks.length) return;
  const psqlEnv = { ...process.env, PGDATABASE: databaseUrl };
  const result = run('psql', [
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--command', checks.join('\n'),
  ], { env: psqlEnv });
  for (const line of result.trim().split(/\r?\n/)) {
    const [table, count] = line.trim().split('=');
    if (count !== '0') fail(`emitted identity residue remained in ${table} (count=${count})`);
  }
}

function verifyHandoff(candidateRef) {
  for (const name of ['BEHAVIOR_SPEC.md', 'QA_PROCEDURE.md']) {
    if (!existsSync(join(root, name))) fail(`missing accepted authority artifact: ${name}`);
  }
  for (const name of requiredReports) {
    if (!existsSync(join(root, 'sixpack-artifacts', name))) fail(`missing stage report: ${name}`);
  }

  const pkg = JSON.parse(readFileSync(join(service, 'package.json'), 'utf8'));
  const exposed = Object.entries(pkg.scripts ?? {}).filter(([name]) => name.startsWith('test:subscription-'));
  if (exposed.length !== requiredCommands.size) fail('hardening command manifest has an unexpected size');
  for (const [name, target] of requiredCommands) {
    if (pkg.scripts?.[name] !== target) fail(`hardening command manifest mismatch: ${name}`);
    const script = target.replace(/^node /, '');
    if (!existsSync(join(service, script))) fail(`hardening command target missing: ${script}`);
  }

  const specifier = git('log', '--format=%H', '--grep=^sixpack(specifier): af-verifier-1$', '-1', candidateRef);
  if (!specifier) fail('specifier handoff commit not found');
  const stageSubjects = git('log', '--format=%s', '--reverse', `${specifier}^..${candidateRef}`).split(/\r?\n/);
  if (stageSubjects.length !== expectedStageSubjects.length || stageSubjects.some((subject, index) => subject !== expectedStageSubjects[index])) {
    fail('pipeline stage ancestry/order does not match the required five-stage handoff');
  }
  const changed = git('diff', '--name-only', `${specifier}^..${candidateRef}`).split(/\r?\n/).filter(Boolean);
  const forbidden = changed.filter((path) => path.startsWith('svc-forum/src/') || path.startsWith('svc-forum/prisma/') || path === 'svc-forum/deploy.yaml');
  if (forbidden.length) fail(`scope violation in terminal candidate: ${forbidden.join(', ')}`);
  run('git', ['diff', '--check', `${specifier}^..${candidateRef}`]);
}

function resolveCandidateRef() {
  const headSubject = git('log', '-1', '--format=%s', 'HEAD');
  if (headSubject !== 'sixpack(qa): af-verifier-1') return 'HEAD';
  const qaDelta = git('diff', '--name-only', 'HEAD^..HEAD').split(/\r?\n/).filter(Boolean);
  const allowed = new Set(['sixpack-artifacts/qa.report.md', 'sixpack-artifacts/qa.verify.mjs']);
  if (qaDelta.some((path) => !allowed.has(path))) fail('QA commit contains files outside the QA-owned artifact boundary');
  return 'HEAD^';
}

function runRound(databaseUrl, round) {
  const env = {
    ...process.env,
    SUBSCRIPTION_STORAGE_DATABASE_URL: databaseUrl,
    // Prisma reads DATABASE_URL, while verifier tooling prefers the dedicated
    // variable. Point both at the same explicitly confirmed disposable target.
    DATABASE_URL: databaseUrl,
  };

  run('npm', ['run', 'prisma:migrate'], { cwd: service, env });
  const productOutput = run('npm', ['run', 'verify:subscription-storage'], { cwd: service, env });
  assertMarkers(productOutput, productCoreMarkers, 'verify:subscription-storage');
  for (const name of requiredCommands.keys()) {
    const output = run('npm', ['run', name], { cwd: service, env });
    const expectation = commandExpectations.get(name);
    assertMarkers(output, expectation.markers, name);
    assertOverallMarkerOrdering(output, expectation.terminalPrerequisite, expectation.overall, name);
    assertEmptyTerminalState(databaseUrl);
    assertEmittedIdentityAbsence(databaseUrl, output);
  }
  console.log(`AFV_QA_ROUND_${round}=PASS`);
}

try {
  const repositoryHead = git('rev-parse', 'HEAD^{commit}');
  const candidateRef = resolveCandidateRef();
  const startHead = git('rev-parse', `${candidateRef}^{commit}`);
  const startTree = git('rev-parse', `${candidateRef}^{tree}`);
  const startTrackedStatus = git('status', '--porcelain=v1', '--untracked-files=no');

  console.log(`AFV_QA_CANDIDATE_HEAD=${startHead}`);
  console.log(`AFV_QA_CANDIDATE_TREE=${startTree}`);
  if (startTrackedStatus) fail('terminal candidate has tracked worktree modifications');
  verifyHandoff(candidateRef);
  console.log('AFV_QA_HANDOFF_MANIFEST=PASS');

  run('node', ['scripts/test-subscription-hardening-architecture.mjs'], { cwd: service });
  run('node', ['scripts/test-subscription-hardening-mutations.mjs'], { cwd: service });

  if (process.env.QA_DISPOSABLE_DATABASES_CONFIRMED !== 'YES') {
    fail('set QA_DISPOSABLE_DATABASES_CONFIRMED=YES only after provisioning two disposable PostgreSQL databases');
  }
  const databases = [process.env.QA_SUBSCRIPTION_DATABASE_URL_RUN_1, process.env.QA_SUBSCRIPTION_DATABASE_URL_RUN_2];
  if (databases.some((value) => !value)) fail('both QA_SUBSCRIPTION_DATABASE_URL_RUN_1 and QA_SUBSCRIPTION_DATABASE_URL_RUN_2 are required');
  if (databases[0] === databases[1]) fail('the two repeatability rounds must use distinct freshly provisioned databases');
  if (!existsSync(join(service, 'scripts', 'verify-subscription-storage.mjs'))) fail('product-core subscription verifier is absent');

  run('npm', ['ci'], { cwd: service });
  run('npm', ['run', 'prisma:generate'], { cwd: service });
  run('npm', ['run', 'typecheck'], { cwd: service });
  run('npm', ['run', 'build'], { cwd: service });
  run('npm', ['test'], { cwd: service });

  runRound(databases[0], 1);
  runRound(databases[1], 2);

  if (git('rev-parse', `${candidateRef}^{commit}`) !== startHead || git('rev-parse', `${candidateRef}^{tree}`) !== startTree) {
    fail('candidate head/tree changed during QA');
  }
  if (git('rev-parse', 'HEAD^{commit}') !== repositoryHead) fail('repository HEAD changed during QA');
  if (git('status', '--porcelain=v1', '--untracked-files=no') !== startTrackedStatus) fail('tracked worktree changed during QA');
  console.log('AFV_QA_TERMINAL_CANDIDATE_UNCHANGED=PASS');
  console.log('AFV_QA_FINAL=PASS');
} catch (error) {
  console.error(`AFV_QA_FINAL=BLOCKED: ${error.message}`);
  process.exitCode = 1;
}
