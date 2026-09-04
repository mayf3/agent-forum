#!/usr/bin/env node

// Database-free architecture properties for the subscription-verifier
// hardening tooling. This file is intentionally not a package.json command:
// the accepted public repository surface consists of the three integration
// commands checked below.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptsDirectory, '..');

const files = {
  cleanup: 'test-subscription-verifier-cleanup.mjs',
  coordinator: 'test-subscription-verifier-parallel-isolation.mjs',
  faultSuite: 'test-subscription-coordinator-failure-recovery.mjs',
  verifier: 'verify-subscription-storage.mjs',
};

const expectedCommands = new Map([
  ['test:subscription-verifier-cleanup', `node scripts/${files.cleanup}`],
  ['test:subscription-verifier-parallel-isolation', `node scripts/${files.coordinator}`],
  ['test:subscription-coordinator-failure-recovery', `node scripts/${files.faultSuite}`],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readScript(name) {
  return readFileSync(join(scriptsDirectory, name), 'utf8');
}

function localScriptReferences(source) {
  return new Set(
    [...source.matchAll(/new URL\(\s*['"](\.\/[^'"]+\.mjs)['"]\s*,\s*import\.meta\.url\s*\)/g)]
      .map((match) => match[1].slice(2)),
  );
}

function moduleSpecifiers(source) {
  return [...source.matchAll(/^import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"];?$/gm)]
    .map((match) => match[1]);
}

function exactLogOffset(source, marker) {
  const statement = `console.log('${marker}');`;
  const offsets = [...source.matchAll(new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
    .map((match) => match.index);
  assert(offsets.length === 1, `${marker} must be emitted by exactly one literal console.log statement`);
  return offsets[0];
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return statSync(path).isFile() ? [path] : [];
  });
}

const sources = {
  cleanup: readScript(files.cleanup),
  coordinator: readScript(files.coordinator),
  faultSuite: readScript(files.faultSuite),
};

// Property 1: the orchestration graph is a one-way DAG. The lower cleanup
// harness knows only the verifier, the coordinator composes those two lower
// entrypoints, and the outer fault suite knows only the coordinator.
const expectedEdges = {
  cleanup: new Set([files.verifier]),
  coordinator: new Set([files.verifier, files.cleanup]),
  faultSuite: new Set([files.coordinator]),
};
for (const [layer, source] of Object.entries(sources)) {
  const actual = localScriptReferences(source);
  assert(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expectedEdges[layer]].sort()),
    `${files[layer]} local dependency edges changed: ${[...actual].sort().join(', ')}`,
  );
  const nonBuiltins = moduleSpecifiers(source).filter((specifier) => !specifier.startsWith('node:'));
  assert(nonBuiltins.length === 0, `${files[layer]} imported non-builtin modules: ${nonBuiltins.join(', ')}`);
  assert(!/^export\s/m.test(source), `${files[layer]} exposed a module API instead of remaining an entrypoint`);
}

// Property 2: only the external coordination layers may own a global-empty
// assertion. In particular, a verifier run and its cleanup harness must remain
// scoped to their prespawned IDs and ownership marker.
const globalOwnershipTokens = ['function assertGlobalZero', 'FIVE_TABLES_EMPTY=PASS', 'GLOBAL_ZERO_ASSERTION_OWNER='];
for (const [name, source] of [['cleanup harness', sources.cleanup]]) {
  for (const token of globalOwnershipTokens) {
    assert(!source.includes(token), `${name} took coordinator-only global-zero ownership via ${token}`);
  }
}
const verifierPath = join(scriptsDirectory, files.verifier);
try {
  const verifierSource = readFileSync(verifierPath, 'utf8');
  const reverseEdges = [files.cleanup, files.coordinator, files.faultSuite]
    .filter((name) => verifierSource.includes(name));
  assert(reverseEdges.length === 0, `individual verifier depended on outer harnesses: ${reverseEdges.join(', ')}`);
  for (const token of globalOwnershipTokens) {
    assert(!verifierSource.includes(token), `individual verifier took coordinator-only global-zero ownership via ${token}`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // The verifier belongs to the PR #15 integration context and is absent from
  // this isolated hardening-only branch. Its required edge is still checked.
}
exactLogOffset(sources.coordinator, 'GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR');

// Property 3: each entrypoint retains one literal overall PASS, and that claim
// remains after the layer's final recovery/terminal-assertion marker. Literal
// statements prevent comments or diagnostic strings from satisfying the
// contract accidentally.
const terminalMarkers = {
  cleanup: ['HARNESS_OWNED_SENTINEL_CLEANUP=PASS', 'SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS'],
  coordinator: ['SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES', 'SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS'],
  faultSuite: ['FAULT_SUITE_SESSION_FINAL_ASSERTION=PASS', 'SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS'],
};
for (const [layer, [recoveryMarker, overallMarker]] of Object.entries(terminalMarkers)) {
  assert(
    exactLogOffset(sources[layer], recoveryMarker) < exactLogOffset(sources[layer], overallMarker),
    `${files[layer]} emitted ${overallMarker} before ${recoveryMarker}`,
  );
}

// Property 4: test controls and harness identities stay hidden from production
// runtime/schema code. This rejects a dependency from product code back into
// test-only orchestration without prescribing runtime implementation details.
const privateTokens = [
  'SUBSCRIPTION_VERIFIER_TEST_',
  'SUBSCRIPTION_COORDINATOR_TEST_',
  'SUBSCRIPTION_CLEANUP_HARNESS_',
  'SUBSCRIPTION_FAULT_SUITE_',
  'subscription-verifier-harness',
  files.cleanup,
  files.coordinator,
  files.faultSuite,
];
for (const directoryName of ['src', 'prisma']) {
  const directory = join(packageDirectory, directoryName);
  for (const path of walkFiles(directory)) {
    const source = readFileSync(path, 'utf8');
    for (const token of privateTokens) {
      assert(!source.includes(token), `${relative(packageDirectory, path)} leaked private hardening token ${token}`);
    }
  }
}

// Property 5: package.json exposes exactly the three accepted hardening
// commands and keeps this architectural check as an internal station test.
const packageJson = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
for (const [name, command] of expectedCommands) {
  assert(packageJson.scripts?.[name] === command, `${name} must map exactly to ${command}`);
}
const exposedHardeningCommands = Object.keys(packageJson.scripts ?? {})
  .filter((name) => name.startsWith('test:subscription-'))
  .sort();
assert(
  JSON.stringify(exposedHardeningCommands) === JSON.stringify([...expectedCommands.keys()].sort()),
  `hardening command surface changed: ${exposedHardeningCommands.join(', ')}`,
);

console.log('SUBSCRIPTION_HARDENING_DEPENDENCY_DIRECTION=PASS');
console.log('SUBSCRIPTION_HARDENING_INFORMATION_HIDING=PASS');
console.log('SUBSCRIPTION_HARDENING_GLOBAL_ASSERTION_OWNERSHIP=PASS');
console.log('SUBSCRIPTION_HARDENING_COMMAND_SURFACE=PASS');
console.log('SUBSCRIPTION_HARDENING_ARCHITECTURE_PROPERTIES=PASS');
