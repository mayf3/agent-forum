#!/usr/bin/env node

// Database-free mutation checks for the subscription hardening property test.
// Mutants are applied only to isolated copies under svc-forum and are removed
// before exit. This is an internal hardener check, not a package command or QA
// entrypoint.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptsDirectory, '..');
const architectureFile = 'test-subscription-hardening-architecture.mjs';

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`mutation target must occur exactly once: ${before}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const mutants = [
  {
    name: 'cleanup_dependency_reversed',
    file: 'scripts/test-subscription-verifier-cleanup.mjs',
    mutate: (source) => replaceOnce(source, "new URL('./verify-subscription-storage.mjs', import.meta.url)", "new URL('./test-subscription-verifier-parallel-isolation.mjs', import.meta.url)"),
  },
  {
    name: 'fault_suite_dependency_broadened',
    file: 'scripts/test-subscription-coordinator-failure-recovery.mjs',
    mutate: (source) => `${source}\nconst mutationDependency = new URL('./test-subscription-verifier-cleanup.mjs', import.meta.url);\n`,
  },
  {
    name: 'cleanup_claims_global_ownership',
    file: 'scripts/test-subscription-verifier-cleanup.mjs',
    mutate: (source) => `${source}\nconst mutationGlobalClaim = 'FIVE_TABLES_EMPTY=PASS';\n`,
  },
  {
    name: 'third_party_import_added',
    file: 'scripts/test-subscription-verifier-cleanup.mjs',
    mutate: (source) => `import 'mutation-third-party';\n${source}`,
  },
  {
    name: 'entrypoint_api_exported',
    file: 'scripts/test-subscription-verifier-cleanup.mjs',
    mutate: (source) => `${source}\nexport const mutationApi = true;\n`,
  },
  {
    name: 'coordinator_ownership_log_removed',
    file: 'scripts/test-subscription-verifier-parallel-isolation.mjs',
    mutate: (source) => replaceOnce(source, "console.log('GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR');", "// GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR"),
  },
  ...[
    ['cleanup_overall_pass_removed', 'scripts/test-subscription-verifier-cleanup.mjs', 'SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS'],
    ['coordinator_overall_pass_removed', 'scripts/test-subscription-verifier-parallel-isolation.mjs', 'SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'],
    ['fault_suite_overall_pass_removed', 'scripts/test-subscription-coordinator-failure-recovery.mjs', 'SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS'],
  ].map(([name, file, marker]) => ({
    name,
    file,
    mutate: (source) => replaceOnce(source, `console.log('${marker}');`, `// ${marker}`),
  })),
  {
    name: 'cleanup_pass_moved_before_finally_marker',
    file: 'scripts/test-subscription-verifier-cleanup.mjs',
    mutate: (source) => replaceOnce(
      source,
      "console.log('HARNESS_OWNED_SENTINEL_CLEANUP=PASS');\nconsole.log('SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS');",
      "console.log('SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS');\nconsole.log('HARNESS_OWNED_SENTINEL_CLEANUP=PASS');",
    ),
  },
  {
    name: 'package_command_redirected',
    file: 'package.json',
    mutate: (source) => replaceOnce(source, 'node scripts/test-subscription-verifier-cleanup.mjs', 'node scripts/test-subscription-verifier-parallel-isolation.mjs'),
  },
  {
    name: 'extra_hardening_command_exposed',
    file: 'package.json',
    mutate: (source) => replaceOnce(source, '"test:subscription-verifier-cleanup":', '"test:subscription-mutation-leak": "node mutation.js",\n    "test:subscription-verifier-cleanup":'),
  },
  {
    name: 'private_control_leaked_to_runtime',
    file: 'src/app.ts',
    mutate: (source) => `${source}\nconst mutationLeak = 'SUBSCRIPTION_VERIFIER_TEST_FAULT';\n`,
  },
];

function makeCandidate() {
  const candidate = mkdtempSync(join(packageDirectory, '.subscription-hardening-mutation-'));
  cpSync(join(packageDirectory, 'package.json'), join(candidate, 'package.json'));
  for (const directory of ['scripts', 'src', 'prisma']) {
    cpSync(join(packageDirectory, directory), join(candidate, directory), { recursive: true });
  }
  return candidate;
}

function runArchitecture(candidate) {
  return spawnSync(process.execPath, [join(candidate, 'scripts', architectureFile)], {
    encoding: 'utf8',
    env: { ...process.env, SUBSCRIPTION_STORAGE_DATABASE_URL: '', DATABASE_URL: '' },
  });
}

const baseline = makeCandidate();
try {
  const result = runArchitecture(baseline);
  if (result.status !== 0) throw new Error(`mutation baseline failed:\n${result.stdout}${result.stderr}`);
} finally {
  rmSync(baseline, { recursive: true, force: true });
}

for (const mutant of mutants) {
  const candidate = makeCandidate();
  try {
    const path = join(candidate, mutant.file);
    writeFileSync(path, mutant.mutate(readFileSync(path, 'utf8')));
    const result = runArchitecture(candidate);
    if (result.status === 0) throw new Error(`${mutant.name} survived`);
    console.log(`MUTANT_${mutant.name.toUpperCase()}=KILLED`);
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}

console.log(`SUBSCRIPTION_HARDENING_MUTATION_SCORE=${mutants.length}/${mutants.length}`);
console.log('SUBSCRIPTION_HARDENING_MUTATIONS=PASS');
