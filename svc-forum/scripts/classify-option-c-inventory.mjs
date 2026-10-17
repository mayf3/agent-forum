#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const POLICY_ID = 'INV-AGENT-FORUM-MIGRATION-OPTION-C-V1';

export const SNAPSHOT_SQL = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_setting('transaction_read_only');
SELECT current_setting('transaction_isolation');
SELECT json_build_object(
  'snapshotAt', transaction_timestamp(),
  'migrations', COALESCE((
    SELECT json_agg(json_build_object(
      'name', migration_name,
      'finishedAt', finished_at
    ) ORDER BY migration_name)
    FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ), '[]'::json),
  'principals', COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'authSubject', auth_subject,
      'agentId', agent_id,
      'status', status
    ) ORDER BY id)
    FROM public.forum_principals
  ), '[]'::json),
  'participants', COALESCE((
    SELECT json_agg(json_build_object(
      'id', id,
      'threadId', "threadId",
      'agentId', "agentId",
      'role', role,
      'status', status,
      'lastReadAt', "lastReadAt",
      'joinedAt', "joinedAt",
      'leftAt', "leftAt",
      'reviewWaivedAt', "reviewWaivedAt",
      'reviewWaivedById', "reviewWaivedById",
      'reviewWaiverReason', "reviewWaiverReason"
    ) ORDER BY id)
    FROM public.forum_participants
  ), '[]'::json),
  'archivedThreads', COALESCE((
    SELECT json_agg(json_build_object(
      'id', t.id,
      'status', t.status,
      'resolvedAt', t."resolvedAt",
      'outcomeCount', (
        SELECT count(*)
        FROM public.forum_outcomes o
        WHERE o."threadId" = t.id
      )
    ) ORDER BY t.id)
    FROM public.forum_threads t
    WHERE t.status = 'archived'
  ), '[]'::json)
)::text;
ROLLBACK;
\echo __OPTION_C_ROLLBACK_COMPLETE__
`;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashReference(namespace, value) {
  if (value === null || value === undefined) return null;
  return `sha256:${sha256(`${namespace}\0${String(value)}`)}`;
}

function normalizeNullable(value) {
  return value === undefined ? null : value;
}

function normalizeSnapshot(snapshot) {
  const migrations = [...(snapshot.migrations ?? [])]
    .map((row) => ({ name: row.name, finishedAt: normalizeNullable(row.finishedAt) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const principals = [...(snapshot.principals ?? [])]
    .map((row) => ({
      id: row.id,
      authSubject: row.authSubject,
      agentId: normalizeNullable(row.agentId),
      status: row.status,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const participants = [...(snapshot.participants ?? [])]
    .map((row) => ({
      id: row.id,
      threadId: row.threadId,
      agentId: row.agentId,
      role: row.role,
      status: row.status,
      lastReadAt: normalizeNullable(row.lastReadAt),
      joinedAt: row.joinedAt,
      leftAt: normalizeNullable(row.leftAt),
      reviewWaivedAt: normalizeNullable(row.reviewWaivedAt),
      reviewWaivedById: normalizeNullable(row.reviewWaivedById),
      reviewWaiverReason: normalizeNullable(row.reviewWaiverReason),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const archivedThreads = [...(snapshot.archivedThreads ?? [])]
    .map((row) => ({
      id: row.id,
      status: row.status,
      resolvedAt: normalizeNullable(row.resolvedAt),
      outcomeCount: Number(row.outcomeCount),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  assertUnique(migrations, 'name', 'migration');
  assertUnique(principals, 'id', 'principal');
  assertUnique(participants, 'id', 'participant');
  assertUnique(archivedThreads, 'id', 'archived thread');

  return { migrations, principals, participants, archivedThreads };
}

function assertUnique(rows, field, label) {
  const seen = new Set();
  for (const row of rows) {
    if (!row[field] || seen.has(row[field])) {
      throw new Error(`Invalid snapshot: duplicate or empty ${label} ${field}`);
    }
    seen.add(row[field]);
  }
}

function matchingPrincipals(participant, principals) {
  const candidates = new Map();
  for (const principal of principals) {
    const namespaces = [];
    if (principal.id === participant.agentId) namespaces.push('id');
    if (principal.authSubject === participant.agentId) namespaces.push('authSubject');
    if (principal.agentId === participant.agentId) namespaces.push('agentId');
    if (namespaces.length > 0) {
      candidates.set(principal.id, { principal, namespaces: namespaces.sort() });
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.principal.id.localeCompare(right.principal.id),
  );
}

function decideExact(fieldName, sourceColumn, values) {
  const normalized = values.map(normalizeNullable);
  const first = canonicalJson(normalized[0]);
  const exact = normalized.every((value) => canonicalJson(value) === first);
  return {
    fieldName,
    classification: exact ? 'deterministic' : 'ambiguous',
    sourceValues: normalized,
    selectedValue: exact ? normalized[0] : null,
    reasonCode: exact ? 'all_source_values_exactly_equal' : 'conflicting_source_values',
    sourceProvenance: `forum_participants.${sourceColumn}`,
    decidedByPolicy: POLICY_ID,
  };
}

function decideFields(rows) {
  const watchStates = rows.map((row) => (row.leftAt === null ? 'active' : 'inactive'));
  const watchExact = watchStates.every((state) => state === watchStates[0]);
  const waiverSignals = rows.map((row) => ({
    waivedAt: row.reviewWaivedAt,
    waivedByHash: hashReference('review-waived-by', row.reviewWaivedById),
    reasonHash: hashReference('review-waiver-reason', row.reviewWaiverReason),
  }));

  return [
    decideExact('presentationRole', 'role', rows.map((row) => row.role)),
    decideExact('presentationStatus', 'status', rows.map((row) => row.status)),
    decideExact('joinedAt', 'joinedAt', rows.map((row) => row.joinedAt)),
    {
      fieldName: 'participationLeftAt',
      classification: 'unprovable',
      sourceValues: rows.map((row) => row.leftAt),
      selectedValue: null,
      reasonCode: 'legacy_left_at_only_proves_current_watch_state',
      sourceProvenance: 'forum_participants.leftAt',
      decidedByPolicy: POLICY_ID,
    },
    {
      fieldName: 'watchCurrentState',
      classification: watchExact ? 'deterministic' : 'ambiguous',
      sourceValues: watchStates,
      selectedValue: watchExact
        ? { state: watchStates[0], source: 'unknown', provenance: 'migration' }
        : null,
      reasonCode: watchExact
        ? 'all_source_rows_agree_on_current_watch_state'
        : 'conflicting_current_watch_state',
      sourceProvenance: 'forum_participants.leftAt',
      decidedByPolicy: POLICY_ID,
    },
    {
      fieldName: 'readState',
      classification: 'unprovable',
      sourceValues: rows.map((row) => ({ lastReadAt: row.lastReadAt })),
      selectedValue: null,
      reasonCode: 'legacy_timestamp_has_no_proven_sequence_cursor',
      sourceProvenance: 'forum_participants.lastReadAt',
      decidedByPolicy: POLICY_ID,
    },
    {
      fieldName: 'reviewOrWaiver',
      classification: 'unprovable',
      sourceValues: waiverSignals,
      selectedValue: null,
      reasonCode: 'historical_review_backfill_forbidden',
      sourceProvenance: 'forum_participants.reviewWaivedAt|reviewWaivedById|reviewWaiverReason',
      decidedByPolicy: POLICY_ID,
    },
  ];
}

function participantEvidence(row, candidateInfo, groupInfo) {
  let classification;
  let quarantine;
  if (candidateInfo.length === 0) {
    classification = 'unprovable';
    quarantine = {
      category: 'unresolved_participant',
      reasonCode: 'no_direct_principal_match',
      authorityEffect: 'blocks_identity_and_authority_sensitive_projection',
    };
  } else if (candidateInfo.length > 1) {
    classification = 'ambiguous';
    quarantine = {
      category: 'other',
      reasonCode: 'multiple_direct_principal_matches',
      authorityEffect: 'blocks_identity_and_authority_sensitive_projection',
    };
  } else if (groupInfo.sourceRows.length > 1) {
    classification = 'ambiguous';
    quarantine = {
      category: 'participant_collision',
      reasonCode: 'multiple_source_rows_for_canonical_pair',
      authorityEffect: 'blocks_ambiguous_participation_fields',
    };
  } else {
    classification = 'deterministic';
    quarantine = null;
  }

  return {
    sourceTable: 'forum_participants',
    sourceRowReference: hashReference('forum-participant-reference', row.id),
    sourceRowHash: hashReference('forum-participant-row', canonicalJson(row)),
    threadReference: hashReference('forum-thread-reference', row.threadId),
    sourceIdentity: {
      valueHash: hashReference('forum-participant-agent-id', row.agentId),
      namespaces: [...new Set(candidateInfo.flatMap((entry) => entry.namespaces))].sort(),
    },
    candidatePrincipals: candidateInfo.map((entry) => ({
      principalReference: hashReference('forum-principal-reference', entry.principal.id),
      mappingEvidence: entry.namespaces,
    })),
    canonicalGroupReference: groupInfo.groupReference,
    classification,
    quarantine,
    immutableLegacyEvidenceReference: hashReference('legacy-evidence', `forum_participants\0${row.id}`),
  };
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function buildOptionCManifest(inputSnapshot, metadata) {
  for (const field of ['sourceRepository', 'sourceCommit', 'deployedCommit', 'imageDigest', 'environment']) {
    if (!metadata?.[field]) throw new Error(`Missing required metadata: ${field}`);
  }
  const captureEvidence = inputSnapshot.captureEvidence;
  if (
    captureEvidence?.transactionReadOnly !== true
    || captureEvidence?.transactionIsolation !== 'repeatable read'
    || captureEvidence?.rollbackObserved !== true
  ) {
    throw new Error('Snapshot lacks verified repeatable-read, read-only, rollback capture evidence');
  }

  const snapshot = normalizeSnapshot(inputSnapshot);
  const datasetPayload = {
    migrations: snapshot.migrations,
    principals: snapshot.principals,
    participants: snapshot.participants,
    archivedThreads: snapshot.archivedThreads,
  };
  const datasetId = sha256(canonicalJson(datasetPayload));
  const schemaSetHash = sha256(canonicalJson(snapshot.migrations));
  const schemaRevision = snapshot.migrations.at(-1)?.name ?? 'none';

  const candidateByParticipant = new Map();
  const groupRows = new Map();
  for (const participant of snapshot.participants) {
    const candidates = matchingPrincipals(participant, snapshot.principals);
    candidateByParticipant.set(participant.id, candidates);
    if (candidates.length === 1) {
      const key = `${participant.threadId}\0${candidates[0].principal.id}`;
      const rows = groupRows.get(key) ?? [];
      rows.push(participant);
      groupRows.set(key, rows);
    }
  }

  const groups = [...groupRows.entries()]
    .map(([key, sourceRows]) => {
      const [threadId, principalId] = key.split('\0');
      const sortedRows = [...sourceRows].sort((left, right) => left.id.localeCompare(right.id));
      return {
        key,
        groupReference: hashReference('canonical-participation-group', key),
        threadReference: hashReference('forum-thread-reference', threadId),
        principalReference: hashReference('forum-principal-reference', principalId),
        sourceRows: sortedRows,
        sourceRowReferences: sortedRows.map((row) =>
          hashReference('forum-participant-reference', row.id),
        ),
        classification: sortedRows.length === 1 ? 'deterministic' : 'ambiguous',
        fieldDecisions: decideFields(sortedRows),
      };
    })
    .sort((left, right) => left.groupReference.localeCompare(right.groupReference));
  const groupByParticipant = new Map();
  for (const group of groups) {
    for (const row of group.sourceRows) groupByParticipant.set(row.id, group);
  }

  const participantRecords = snapshot.participants.map((row) => {
    const candidates = candidateByParticipant.get(row.id);
    const group = groupByParticipant.get(row.id) ?? {
      sourceRows: [row],
      groupReference: null,
    };
    return participantEvidence(row, candidates, group);
  });

  const archivedThreadRecords = snapshot.archivedThreads.map((row) => {
    const directlyUnknown = row.resolvedAt === null && row.outcomeCount === 0;
    return {
      sourceTable: 'forum_threads',
      sourceRowReference: hashReference('forum-thread-reference', row.id),
      sourceRowHash: hashReference('forum-archived-thread-row', canonicalJson(row)),
      visibilityDecision: { classification: 'deterministic', selectedValue: 'archived' },
      discussionStateDecision: directlyUnknown
        ? {
            classification: 'unprovable',
            selectedValue: null,
            reasonCode: 'no_direct_historical_finality_evidence',
          }
        : {
            classification: 'ambiguous',
            selectedValue: null,
            reasonCode: 'separate_authoritative_lifecycle_validation_required',
          },
      classification: directlyUnknown ? 'unprovable' : 'ambiguous',
      quarantine: {
        category: 'archived_lifecycle_unknown',
        reasonCode: directlyUnknown
          ? 'archived_without_resolved_metadata_or_outcome'
          : 'archived_requires_authoritative_lifecycle_validation',
        authorityEffect: 'blocks_discussion_state_and_finalization_projection',
      },
      immutableLegacyEvidenceReference: hashReference('legacy-evidence', `forum_threads\0${row.id}`),
    };
  });

  const publicGroups = groups.map(({ key: _key, sourceRows: _sourceRows, ...group }) => group);
  const fieldDecisions = publicGroups.flatMap((group) => group.fieldDecisions);
  const participantQuarantines = participantRecords.filter((row) => row.quarantine !== null);
  const collisionGroups = publicGroups.filter((group) => group.sourceRowReferences.length > 1);
  const uniqueMappings = [...candidateByParticipant.values()].filter((rows) => rows.length === 1).length;
  const zeroMappings = [...candidateByParticipant.values()].filter((rows) => rows.length === 0).length;
  const multipleMappings = [...candidateByParticipant.values()].filter((rows) => rows.length > 1).length;

  const counts = {
    principals: snapshot.principals.length,
    participants: snapshot.participants.length,
    participantMappings: {
      unique: uniqueMappings,
      unresolved: zeroMappings,
      multiple: multipleMappings,
    },
    canonicalGroups: publicGroups.length,
    participantCollisionGroups: collisionGroups.length,
    participantCollisionRows: collisionGroups.reduce(
      (total, group) => total + group.sourceRowReferences.length,
      0,
    ),
    participantClassifications: countBy(participantRecords, (row) => row.classification),
    participantQuarantines: countBy(participantQuarantines, (row) => row.quarantine.category),
    fieldDecisions: countBy(fieldDecisions, (row) => row.classification),
    archivedThreads: snapshot.archivedThreads.length,
    archivedLifecycleUnknownRows: archivedThreadRecords.length,
    totalQuarantineCandidates: participantQuarantines.length + archivedThreadRecords.length,
  };

  const validationErrors = [];
  if (participantRecords.length !== snapshot.participants.length) {
    validationErrors.push('participant_row_reconciliation_failed');
  }
  if (uniqueMappings + zeroMappings + multipleMappings !== snapshot.participants.length) {
    validationErrors.push('participant_mapping_reconciliation_failed');
  }
  if (counts.participantCollisionRows > uniqueMappings) {
    validationErrors.push('collision_rows_exceed_unique_principal_mappings');
  }

  const classificationPayload = {
    policyId: POLICY_ID,
    datasetId,
    participantRecords,
    participantGroups: publicGroups,
    archivedThreadRecords,
    counts,
    validationErrors,
  };
  const classificationHash = sha256(canonicalJson(classificationPayload));
  const rerunIdentity = sha256(
    canonicalJson({
      policyId: POLICY_ID,
      datasetId,
      sourceCommit: metadata.sourceCommit,
      deployedCommit: metadata.deployedCommit,
      schemaSetHash,
      classificationHash,
    }),
  );

  return {
    format: 'agent-forum-option-c-inventory-v1',
    policyId: POLICY_ID,
    metadata: {
      ...metadata,
      snapshotAt: inputSnapshot.snapshotAt,
      sourceSchemaRevision: schemaRevision,
      sourceSchemaMigrationCount: snapshot.migrations.length,
      sourceSchemaSetHash: schemaSetHash,
      datasetId,
      classificationHash,
      rerunIdentity,
      transactionIsolation: captureEvidence.transactionIsolation,
      transactionReadOnly: captureEvidence.transactionReadOnly,
      rollbackObserved: captureEvidence.rollbackObserved,
      rollbackReference: 'psql-explicit-rollback-marker',
      databaseWrites: 0,
    },
    counts,
    validation: {
      result: validationErrors.length === 0 ? 'pass' : 'fail',
      errors: validationErrors,
      blockedAuthoritySensitiveEffects: participantQuarantines.length + archivedThreadRecords.length,
    },
    participantRecords,
    participantGroups: publicGroups,
    archivedThreadRecords,
  };
}

function redactDiagnostic(value) {
  return String(value)
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[redacted]@')
    .replace(/password=[^\s]+/gi, 'password=[redacted]');
}

function postgresEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('OPTION_C_INVENTORY_DATABASE_URL must use postgres:// or postgresql://');
  }
  const environment = {
    ...process.env,
    PGHOST: decodeURIComponent(parsed.hostname),
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGAPPNAME: 'agent-forum-option-c-inventory-read-only',
    PGCONNECT_TIMEOUT: '10',
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  delete environment.OPTION_C_INVENTORY_DATABASE_URL;
  return environment;
}

export function captureReadOnlySnapshot({ databaseUrl, psqlBin = 'psql' }) {
  if (!databaseUrl) {
    throw new Error('Set OPTION_C_INVENTORY_DATABASE_URL explicitly; DATABASE_URL fallback is forbidden');
  }
  const result = spawnSync(
    psqlBin,
    ['-X', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1'],
    {
      env: postgresEnvironment(databaseUrl),
      input: SNAPSHOT_SQL,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 90_000,
    },
  );
  if (result.error) throw new Error(`psql failed: ${redactDiagnostic(result.error.message)}`);
  if (result.status !== 0) {
    throw new Error(`read-only snapshot failed: ${redactDiagnostic(result.stderr).trim()}`);
  }
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines[0] !== 'on') throw new Error('database did not confirm transaction_read_only=on');
  if (lines[1] !== 'repeatable read') {
    throw new Error('database did not confirm transaction_isolation=repeatable read');
  }
  if (lines.at(-1) !== '__OPTION_C_ROLLBACK_COMPLETE__') {
    throw new Error('read-only snapshot did not confirm ROLLBACK completion');
  }
  const jsonText = lines.slice(2, -1).join('\n');
  return {
    ...JSON.parse(jsonText),
    captureEvidence: {
      transactionReadOnly: true,
      transactionIsolation: 'repeatable read',
      rollbackObserved: true,
    },
  };
}

function usage() {
  return `Usage:
  OPTION_C_INVENTORY_DATABASE_URL=postgresql://... node scripts/classify-option-c-inventory.mjs \\
    --source-repository <owner/repo> --source-commit <sha> \\
    --deployed-commit <sha> --image-digest <digest> --environment <name> \\
    [--summary] [--output <new-file>]

The database URL must be supplied through the dedicated environment variable.
The command uses REPEATABLE READ + READ ONLY and finishes with ROLLBACK.`;
}

export function parseArgs(argv) {
  const parsed = { summary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--summary') {
      parsed.summary = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const key = {
      '--source-repository': 'sourceRepository',
      '--source-commit': 'sourceCommit',
      '--deployed-commit': 'deployedCommit',
      '--image-digest': 'imageDigest',
      '--environment': 'environment',
      '--output': 'output',
    }[argument];
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function summaryOf(manifest) {
  return {
    format: manifest.format,
    policyId: manifest.policyId,
    metadata: manifest.metadata,
    counts: manifest.counts,
    validation: manifest.validation,
  };
}

export function serializeManifestJsonl(manifest) {
  const lines = [
    {
      recordType: 'manifest',
      format: manifest.format,
      policyId: manifest.policyId,
      metadata: manifest.metadata,
      counts: manifest.counts,
      validation: manifest.validation,
    },
    ...manifest.participantRecords.map((record) => ({ recordType: 'participant', ...record })),
    ...manifest.participantGroups.map((record) => ({ recordType: 'participantGroup', ...record })),
    ...manifest.archivedThreadRecords.map((record) => ({ recordType: 'archivedThread', ...record })),
  ];
  return `${lines.map((line) => canonicalJson(line)).join('\n')}\n`;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const snapshot = captureReadOnlySnapshot({
      databaseUrl: process.env.OPTION_C_INVENTORY_DATABASE_URL,
      psqlBin: process.env.OPTION_C_PSQL_BIN,
    });
    const manifest = buildOptionCManifest(snapshot, {
      sourceRepository: args.sourceRepository,
      sourceCommit: args.sourceCommit,
      deployedCommit: args.deployedCommit,
      imageDigest: args.imageDigest,
      environment: args.environment,
    });
    if (args.output) {
      const outputPath = resolve(args.output);
      writeFileSync(outputPath, serializeManifestJsonl(manifest), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      console.log(JSON.stringify({ ...summaryOf(manifest), outputPath }, null, 2));
    } else {
      console.log(JSON.stringify(args.summary ? summaryOf(manifest) : manifest, null, 2));
    }
    if (manifest.validation.result !== 'pass') process.exitCode = 1;
  } catch (error) {
    console.error(redactDiagnostic(error instanceof Error ? error.message : error));
    console.error(usage());
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
