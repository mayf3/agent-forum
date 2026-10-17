import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SNAPSHOT_SQL,
  buildOptionCManifest,
  canonicalJson,
  parseArgs,
  serializeManifestJsonl,
} from './classify-option-c-inventory.mjs';

const metadata = {
  sourceRepository: 'mayf3/agent-forum',
  sourceCommit: 'source-sha',
  deployedCommit: 'deployed-sha',
  imageDigest: 'sha256:image',
  environment: 'fixture',
};

function fixture() {
  return {
    snapshotAt: '2026-09-01T01:00:00.000Z',
    captureEvidence: {
      transactionReadOnly: true,
      transactionIsolation: 'repeatable read',
      rollbackObserved: true,
    },
    migrations: [
      { name: '002_second', finishedAt: '2026-08-02T00:00:00.000Z' },
      { name: '001_first', finishedAt: '2026-08-01T00:00:00.000Z' },
    ],
    principals: [
      { id: 'p-id', authSubject: 'sub-id', agentId: 'agent-id', status: 'active' },
      { id: 'p-collision', authSubject: 'sub-collision', agentId: 'agent-collision', status: 'active' },
      { id: 'ambiguous-value', authSubject: 'sub-a', agentId: 'agent-a', status: 'active' },
      { id: 'p-ambiguous', authSubject: 'ambiguous-value', agentId: 'agent-b', status: 'active' },
      { id: 'p-inactive', authSubject: 'sub-inactive', agentId: 'agent-inactive', status: 'active' },
    ],
    participants: [
      {
        id: 'row-id', threadId: 'thread-1', agentId: 'p-id', role: 'creator', status: 'active',
        lastReadAt: null, joinedAt: '2026-08-01T00:00:00.000Z', leftAt: null,
        reviewWaivedAt: null, reviewWaivedById: null, reviewWaiverReason: null,
      },
      {
        id: 'row-collision-a', threadId: 'thread-2', agentId: 'p-collision', role: 'creator', status: 'active',
        lastReadAt: '2026-08-02T00:00:00.000Z', joinedAt: '2026-08-01T00:00:00.000Z', leftAt: null,
        reviewWaivedAt: null, reviewWaivedById: null, reviewWaiverReason: null,
      },
      {
        id: 'row-collision-b', threadId: 'thread-2', agentId: 'agent-collision', role: 'member', status: 'invited',
        lastReadAt: null, joinedAt: '2026-08-03T00:00:00.000Z', leftAt: null,
        reviewWaivedAt: '2026-08-04T00:00:00.000Z', reviewWaivedById: 'secret-waiver-actor',
        reviewWaiverReason: 'secret waiver reason',
      },
      {
        id: 'row-unresolved', threadId: 'thread-3', agentId: 'secret-unresolved-agent', role: 'member', status: 'invited',
        lastReadAt: null, joinedAt: '2026-08-01T00:00:00.000Z', leftAt: null,
        reviewWaivedAt: null, reviewWaivedById: null, reviewWaiverReason: null,
      },
      {
        id: 'row-ambiguous', threadId: 'thread-4', agentId: 'ambiguous-value', role: 'member', status: 'active',
        lastReadAt: null, joinedAt: '2026-08-01T00:00:00.000Z', leftAt: null,
        reviewWaivedAt: null, reviewWaivedById: null, reviewWaiverReason: null,
      },
      {
        id: 'row-inactive', threadId: 'thread-5', agentId: 'p-inactive', role: 'member', status: 'active',
        lastReadAt: null, joinedAt: '2026-08-01T00:00:00.000Z', leftAt: '2026-08-05T00:00:00.000Z',
        reviewWaivedAt: null, reviewWaivedById: null, reviewWaiverReason: null,
      },
    ],
    archivedThreads: [
      { id: 'archived-unknown', status: 'archived', resolvedAt: null, outcomeCount: 0 },
      { id: 'archived-needs-validation', status: 'archived', resolvedAt: '2026-08-01T00:00:00.000Z', outcomeCount: 1 },
    ],
  };
}

test('snapshot SQL hard-binds repeatable-read, read-only, guard, and rollback', () => {
  assert.match(SNAPSHOT_SQL, /ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(SNAPSHOT_SQL, /current_setting\('transaction_read_only'\)/);
  assert.match(SNAPSHOT_SQL, /current_setting\('transaction_isolation'\)/);
  assert.match(SNAPSHOT_SQL, /ROLLBACK;/);
  assert.doesNotMatch(SNAPSHOT_SQL, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
});

test('classifies unique, collision, unresolved, and multiple-match rows without guessing', () => {
  const manifest = buildOptionCManifest(fixture(), metadata);
  assert.deepEqual(manifest.counts.participantMappings, { unique: 4, unresolved: 1, multiple: 1 });
  assert.equal(manifest.counts.participantCollisionGroups, 1);
  assert.equal(manifest.counts.participantCollisionRows, 2);
  assert.deepEqual(manifest.counts.participantClassifications, {
    ambiguous: 3,
    deterministic: 2,
    unprovable: 1,
  });
  assert.deepEqual(manifest.counts.participantQuarantines, {
    other: 1,
    participant_collision: 2,
    unresolved_participant: 1,
  });
  assert.equal(manifest.counts.totalQuarantineCandidates, 6);
  assert.equal(manifest.validation.result, 'pass');
});

test('collision keeps current Watch when rows agree but fails closed for Read and Review', () => {
  const manifest = buildOptionCManifest(fixture(), metadata);
  const group = manifest.participantGroups.find((entry) => entry.sourceRowReferences.length === 2);
  const decisions = Object.fromEntries(group.fieldDecisions.map((entry) => [entry.fieldName, entry]));
  assert.deepEqual(decisions.watchCurrentState.selectedValue, {
    state: 'active', source: 'unknown', provenance: 'migration',
  });
  assert.equal(decisions.watchCurrentState.classification, 'deterministic');
  assert.equal(decisions.presentationRole.classification, 'ambiguous');
  assert.equal(decisions.presentationStatus.classification, 'ambiguous');
  assert.equal(decisions.joinedAt.classification, 'ambiguous');
  assert.equal(decisions.readState.classification, 'unprovable');
  assert.equal(decisions.readState.selectedValue, null);
  assert.equal(decisions.reviewOrWaiver.classification, 'unprovable');
  assert.equal(decisions.reviewOrWaiver.selectedValue, null);
  assert.equal(decisions.watchCurrentState.sourceProvenance, 'forum_participants.leftAt');
  assert.equal(decisions.watchCurrentState.decidedByPolicy, 'INV-AGENT-FORUM-MIGRATION-OPTION-C-V1');
});

test('inactive Watch decision does not invent an interval origin or start time', () => {
  const manifest = buildOptionCManifest(fixture(), metadata);
  const inactive = manifest.participantGroups.find((entry) =>
    entry.fieldDecisions.some((decision) =>
      decision.fieldName === 'watchCurrentState' && decision.selectedValue?.state === 'inactive',
    ),
  );
  const decision = inactive.fieldDecisions.find((entry) => entry.fieldName === 'watchCurrentState');
  assert.deepEqual(decision.selectedValue, {
    state: 'inactive', source: 'unknown', provenance: 'migration',
  });
  assert.equal('startedAt' in decision.selectedValue, false);
});

test('manifest contains no raw identifiers or waiver text', () => {
  const text = JSON.stringify(buildOptionCManifest(fixture(), metadata));
  for (const forbidden of [
    'row-unresolved', 'thread-3', 'secret-unresolved-agent', 'p-collision',
    'agent-collision', 'secret-waiver-actor', 'secret waiver reason', 'archived-unknown',
  ]) {
    assert.equal(text.includes(forbidden), false, `manifest leaked ${forbidden}`);
  }
});

test('classification identity is stable across input order and observation time', () => {
  const first = fixture();
  const second = fixture();
  second.snapshotAt = '2026-09-01T02:00:00.000Z';
  second.principals.reverse();
  second.participants.reverse();
  second.archivedThreads.reverse();
  second.migrations.reverse();
  const left = buildOptionCManifest(first, metadata);
  const right = buildOptionCManifest(second, metadata);
  assert.equal(left.metadata.datasetId, right.metadata.datasetId);
  assert.equal(left.metadata.classificationHash, right.metadata.classificationHash);
  assert.equal(left.metadata.rerunIdentity, right.metadata.rerunIdentity);
  assert.notEqual(left.metadata.snapshotAt, right.metadata.snapshotAt);
});

test('a source-row change changes dataset and classification identity', () => {
  const left = buildOptionCManifest(fixture(), metadata);
  const changed = fixture();
  changed.participants[0].status = 'responded';
  const right = buildOptionCManifest(changed, metadata);
  assert.notEqual(left.metadata.datasetId, right.metadata.datasetId);
  assert.notEqual(left.metadata.classificationHash, right.metadata.classificationHash);
  assert.notEqual(left.metadata.rerunIdentity, right.metadata.rerunIdentity);
});

test('rejects duplicate source identifiers instead of silently collapsing evidence', () => {
  const invalid = fixture();
  invalid.participants.push({ ...invalid.participants[0] });
  assert.throws(
    () => buildOptionCManifest(invalid, metadata),
    /duplicate or empty participant id/,
  );
});

test('rejects snapshots without verified read-only rollback capture evidence', () => {
  const invalid = fixture();
  delete invalid.captureEvidence;
  assert.throws(
    () => buildOptionCManifest(invalid, metadata),
    /lacks verified repeatable-read, read-only, rollback capture evidence/,
  );
});

test('canonical JSON is insensitive to object key order', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test('persisted JSONL has one manifest header and one line per redacted record', () => {
  const manifest = buildOptionCManifest(fixture(), metadata);
  const lines = serializeManifestJsonl(manifest).trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines[0].recordType, 'manifest');
  assert.equal(lines.filter((line) => line.recordType === 'participant').length, 6);
  assert.equal(lines.filter((line) => line.recordType === 'participantGroup').length, 3);
  assert.equal(lines.filter((line) => line.recordType === 'archivedThread').length, 2);
  assert.equal(lines.some((line) => JSON.stringify(line).includes('secret-unresolved-agent')), false);
});

test('CLI accepts only explicit bounded metadata and summary option', () => {
  assert.deepEqual(parseArgs([
    '--source-repository', 'owner/repo',
    '--source-commit', 'a',
    '--deployed-commit', 'b',
    '--image-digest', 'sha256:c',
    '--environment', 'local',
    '--output', 'manifest.json',
    '--summary',
  ]), {
    sourceRepository: 'owner/repo',
    sourceCommit: 'a',
    deployedCommit: 'b',
    imageDigest: 'sha256:c',
    environment: 'local',
    output: 'manifest.json',
    summary: true,
  });
  assert.throws(() => parseArgs(['--database-url', 'secret']), /Unknown option/);
  assert.throws(() => parseArgs(['--source-commit']), /Missing value/);
});
