# BASE_STORAGE_FOUNDATION_EVIDENCE_V1

```text
TASK_NAME = 基座 执行
TASK_TYPE = 执行

SOURCE_COMMIT = c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d
STORAGE_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
CONTRACTS = CTR-MIG-001, CTR-MIG-004, CTR-MIG-005
PHASE = 2 — additive storage
IMPLEMENTATION_WORKSTREAM = 基座

POSTGRES_VERSION = 16.14
PREVIOUS_MIGRATION_COUNT = 11
PREVIOUS_MIGRATION_TIP = 20260807034800_add_forum_reports
PREVIOUS_MIGRATION_SET_SHA256 = aff8a071161907a698012590b48ac1224e8b0d7c88fe99ad71dddf788eb51365
NEW_MIGRATION_ID = 20260822065412_add_forum_migration_foundation
NEW_MIGRATION_CHECKSUM = 526ea892b931c030086cd445f0d61471873bfd42213579d98be905e137a87cdd
PRISMA_SCHEMA_HASH = 8ca7e3b3a691ff062b1e48bc718f0313c80f92bd57054d88bc9ceb85cfc2a6c6
MIGRATION_GENERATION_METHOD = npx prisma migrate dev --name add_forum_migration_foundation --create-only against disposable PostgreSQL 16

CLEAN_DB_APPLY = PASS
CURRENT_SNAPSHOT_APPLY = PASS
SECOND_DEPLOY_NOOP = PASS
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
EXISTING_BUSINESS_ROWS_CHANGED = NO
NEW_TABLE_EMPTY_ASSERTION = PASS
NO_BACKFILL_ASSERTION = PASS
NO_DUAL_WRITE_ASSERTION = PASS

APPLY_STARTED_AT = 2026-08-22T07:09:04Z
APPLY_FINISHED_AT = 2026-08-22T07:09:04Z
SNAPSHOT_APPLY_STARTED_AT = 2026-08-22T07:09:06Z
SNAPSHOT_APPLY_FINISHED_AT = 2026-08-22T07:09:06Z

AUTHORITATIVE_SOURCE_DB_WRITES = 0
DISPOSABLE_TEST_DB_WRITES = ALLOWED
PRODUCTION_DB_WRITES = 0

MIGRATION_FOUNDATION_MODELS = 5
MIGRATION_FOUNDATION_TABLES = 5
RAW_SQL_OBJECTS_IMPLEMENTED = 14
SQL_001_TO_014_COMPLETE = PASS

BACKFILLED_ROWS = 0
QUARANTINE_ROWS_IMPORTED = 0
LEGACY_ROWS_MODIFIED = 0
CANONICAL_AUTHORITY_FACTS_CREATED = 0
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
AUTHORITY_SWITCH = NO
CUTOVER = NO
DESTRUCTIVE_CLEANUP = NO
PRODUCT_RUNTIME_CODE_CHANGED = NO
```

## 1. Coordinates and safety boundary

The implementation worktree was created from exact `origin/main` commit
`c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d`. Governance verification returned:

```text
vendored governance bytes match governance.lock.json and adoption is accepted

PREFLIGHT_MODE = REUSE
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
STORAGE_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
STORAGE_DESIGN_DISPOSITION = adopted
IMPLEMENTATION_AUTHORITY = contracts
SPEC_GAP = NO
OWNER_DECISION_REQUIRED = NO
```

The existing local database at `127.0.0.1:5434/svc_forum` was accessed only by a
`REPEATABLE READ READ ONLY` transaction and `pg_dump`. The transaction reported
`transaction_read_only=on`. No migration, DDL, or DML was executed against that
source. The snapshot dump was restored only into a disposable PostgreSQL
container. The dump itself was temporary, is not committed, and no source row or
sensitive payload appears in this record.

```text
SOURCE_SNAPSHOT_DUMP_SHA256 = ff99a555e7819cd7e716a1d2b056221ba8eadc0b7fa22711bd0a54b1d4e4bb91
SOURCE_APPLIED_MIGRATIONS = 11
SOURCE_OLD_MIGRATION_SET_COMPLETE = YES
```

The previous migration-set digest is stable SHA-256 over the sorted 11 relative
`migration.sql` paths and bytes, each length-prefixed before hashing. No prior
migration was changed, renamed, or removed.

## 2. Schema and migration result

Exactly these structures were added:

- `MigrationRun` → `forum_migration_runs`
- `MigrationLegacyEvidence` → `forum_migration_legacy_evidence`
- `MigrationFieldDecision` → `forum_migration_field_decisions`
- `MigrationQuarantine` → `forum_migration_quarantines`
- `MigrationValidationResult` → `forum_migration_validation_results`

The only existing-model additions are the Prisma reverse relation fields required
for the two nullable `ForumPrincipal` relations. No existing physical business
column or runtime path changed.

```text
SCHEMA_DIFF_BEFORE_AFTER = five new tables; five PKs; five UNIQUE indexes; six RESTRICT FKs; eight named CHECKs; two trigger functions; four triggers
NO_EXISTING_TABLE_DDL = YES
NO_TABLE_REWRITE = YES
MIGRATION_SQL_INSERT_UPDATE_DELETE_COPY = 0
MIGRATION_COUNT_BEFORE = 11
MIGRATION_COUNT_AFTER = 12
```

The schema-only dump diff contains the five new tables and their associated
constraints, indexes, functions, and triggers. The apparent schema-dump line
count also includes `pg_dump` ordering/context changes; no old business-table
shape changed.

## 3. Clean database apply and migration history

A fresh disposable PostgreSQL 16.14 database received all 11 old migrations and
the one new migration through `prisma migrate deploy`.

```text
CLEAN_DB_APPLY = PASS
CLEAN_APPLIED_MIGRATIONS = 12
SECOND_DEPLOY_RESULT = No pending migrations to apply.
SECOND_DEPLOY_NOOP = PASS
PRISMA_MIGRATE_STATUS_RESULT = Database schema is up to date!
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
```

A separate disposable failure/retry rehearsal used a temporary copy of the
migration directory with an injected invalid trailing statement. Initial deploy
returned rc=1. The failed migration was marked rolled back, the exact committed
migration SQL was restored, and deploy plus the complete foundation verifier
then passed.

```text
MIGRATION_FAILURE_INJECTION_RC = 1
MIGRATION_FAILURE_RETRY = PASS
MIGRATION_RERUN_RESULT = PASS (failure/resolve/retry plus second-deploy no-op)
```

## 4. Current-snapshot apply and unchanged business data

The read-only source dump was restored into a second disposable PostgreSQL 16.14
database. Before apply, all 11 old migration records were present. Only
`20260822065412_add_forum_migration_foundation` was pending and applied.

Stable summaries use table row count plus an order-independent digest of each
row's JSON representation. Before and after summaries were byte-identical:

| Existing business table | Rows before | Rows after | Stable hash before/after |
|---|---:|---:|---|
| `forum_context_snapshots` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_messages` | 607 | 607 | `7585bffbe12212a524497cec305e7457` |
| `forum_outcomes` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_participants` | 389 | 389 | `0c07d44f9a796bd8f0a87d8cfcd6fd05` |
| `forum_principals` | 90 | 90 | `1756c963e85069a27c1f8120f5fde173` |
| `forum_reactions` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_reports` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_thread_views` | 79 | 79 | `74a00f14033d5b48781eb4e7ae66a119` |
| `forum_threads` | 90 | 90 | `a6943a1568dcad41ba34c96604064be8` |

```text
ROW_COUNTS_BEFORE_AFTER = IDENTICAL
OLD_TABLE_HASHES_BEFORE_AFTER = IDENTICAL
EXISTING_BUSINESS_ROWS_CHANGED = NO
```

Existing relation filenodes were also byte-identical before and after:

| Existing relation | relfilenode before | relfilenode after |
|---|---:|---:|
| `forum_context_snapshots` | 16396 | 16396 |
| `forum_messages` | 16403 | 16403 |
| `forum_outcomes` | 16412 | 16412 |
| `forum_participants` | 16418 | 16418 |
| `forum_principals` | 16426 | 16426 |
| `forum_reactions` | 16437 | 16437 |
| `forum_reports` | 16443 | 16443 |
| `forum_thread_views` | 16450 | 16450 |
| `forum_threads` | 16456 | 16456 |

```text
RELATION_FILENODE_BEFORE_AFTER = UNCHANGED_FOR_ALL_EXISTING_BUSINESS_TABLES
CURRENT_SNAPSHOT_APPLY = PASS
```

## 5. Constraint, state-machine, trigger, and FK verification

The explicit verifier is:

```text
npm run verify:migration-foundation
```

It uses `psql`, exits nonzero on failure, creates all test rows inside one test
transaction, and rolls the transaction back before asserting final emptiness.
It was run successfully on clean, snapshot-clone, and failure-retry databases.

| Verification | Result |
|---|---|
| SQL-001..SQL-008 exact named CHECKs present | PASS |
| SQL-009 and SQL-013 exact named functions present | PASS |
| SQL-010..012 and SQL-014 exact named triggers present | PASS |
| invalid MigrationRun status | REJECT (`23514`) |
| attempt `0` / negative | REJECT (`23514`) |
| duplicate run identity + attempt | REJECT (`23505`) |
| every adopted legal state transition | ACCEPT |
| planned→validated / planned→sealed | REJECT (`23514`) |
| running→planned / validated→running | REJECT (`23514`) |
| sealed / failed / rolled_back update | REJECT (`55000`) |
| every immutable MigrationRun field rewrite (`id`, source/target commits and schema revisions, environment, dataset, snapshot, policy, phase, run identity, attempt, started/created times) during a legal transition | REJECT (`55000`) |
| terminal MigrationRun delete | REJECT (`55000`) |
| invalid LegacyEvidence classification | REJECT (`23514`) |
| duplicate source reference within run | REJECT (`23505`) |
| LegacyEvidence update/delete | REJECT (`55000`) |
| invalid FieldDecision classification | REJECT (`23514`) |
| deterministic + NULL | ACCEPT |
| deterministic + non-NULL | ACCEPT |
| ambiguous + NULL | ACCEPT |
| ambiguous + non-NULL | REJECT (`23514`) |
| unprovable + NULL | ACCEPT |
| unprovable + non-NULL | REJECT (`23514`) |
| duplicate evidence + field | REJECT (`23505`) |
| FieldDecision update/delete | REJECT (`55000`) |
| invalid quarantine category/status | REJECT (`23514`) |
| duplicate quarantine for evidence | REJECT (`23505`) |
| hard-coded `185` constraint | ABSENT |
| invalid validation result | REJECT (`23514`) |
| duplicate run + check | REJECT (`23505`) |
| ValidationResult update/delete | REJECT (`55000`) |
| six invalid child FK rows | REJECT (`23503`) |
| referenced Principal delete | REJECT (`23503`) |
| all six FK catalog delete actions | RESTRICT |

```text
FIELD_DECISION_CHECK_TRUTH_TABLE = PASS
MIGRATION_RUN_STATE_MACHINE = PASS
FOREIGN_KEY_REVIEW = PASS
```

### MigrationRun delete advisory

The adopted SQL-013 DELETE branch and `RETURN NEW` behavior were preserved.
The implementation additionally enumerates `id`, both schema revisions, and
`created_at` in the immutable-field comparison so the executable guard satisfies
the adopted L.1 rule that only `status`, `finished_at`, and
`rollback_reference` may change. PostgreSQL supplies `NEW=NULL` to a `BEFORE
DELETE` row trigger; therefore `RETURN NEW` silently suppresses a non-terminal
delete instead of raising an error. No tested run was actually deleted.

```text
PLANNED_RUN_DELETE_BEHAVIOR = SILENTLY_SUPPRESSED
RUNNING_RUN_DELETE_BEHAVIOR = SILENTLY_SUPPRESSED
TERMINAL_RUN_DELETE_BEHAVIOR = REJECTED
MIGRATION_RUN_DELETE_BEHAVIOR = planned/running silently suppressed; terminal rejected; no run deleted
DESIGN_EXECUTION_DRIFT = NO
SQL_013_LITERAL_BODY_DELTA = immutable comparison completed for id, schema revisions, and created_at to satisfy adopted L.1 semantics
NON_BLOCKING_IMPLEMENTATION_DEBT = non-terminal DELETE is silently suppressed rather than explicitly rejected
```

This record does not expand scope or change the adopted state machine.

## 6. Empty-structure and phase boundary assertions

After each verifier transaction rolled back, all five counts were zero:

```text
forum_migration_runs = 0
forum_migration_legacy_evidence = 0
forum_migration_field_decisions = 0
forum_migration_quarantines = 0
forum_migration_validation_results = 0

NEW_TABLE_EMPTY_ASSERTION = PASS
NO_BACKFILL_ASSERTION = PASS
NO_DUAL_WRITE_ASSERTION = PASS
```

No local count such as 185 appears in a hard constraint. No inventory row,
quarantine row, principal, participant, review fact, finalization, tombstone, or
other authority fact was imported.

## 7. Lock and DDL observations

The clean apply completed in approximately one second. Only new relations were
created; no old table was altered and all old relation filenodes remained stable.
No waiting or blocking PID was observed after apply, and no lock remained on the
five new tables when sampled.

```text
LOCK_TIMEOUT = migration deploy session default 0; verifier session 5s
STATEMENT_TIMEOUT = migration deploy session default 0; verifier session 60s
PG_LOCKS_OBSERVATION = no waiting/blocking PID and no retained relation lock observed after apply
DDL_SCOPE = CREATE five empty tables + new-table indexes/FKs/CHECKs/functions/triggers
TABLE_REWRITE_OBSERVED = NO
```

Because this DDL completed below the polling resolution, no claim is made that an
in-flight catalog lock was sampled. The DDL shape and unchanged old filenodes are
the durable evidence that no existing business relation was rewritten.

## 8. Old application compatibility and rollback

The exact prior application source at
`c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d` was built with its prior Prisma
schema/client and started against the migrated current-snapshot clone. Its
`GET /api/health` returned HTTP 200 with `db=connected`.

The implementation worktree also passed:

```text
npm ci = PASS
npm run prisma:generate = PASS
npm run typecheck = PASS
npm run build = PASS
npm test = PASS (294 tests, 294 pass, 0 fail)
```

```text
PRISMA_GENERATE = PASS
TYPECHECK = PASS
BUILD = PASS
TEST_SUITE = PASS
OLD_APPLICATION_COMPATIBILITY = PASS
OLD_READ_PATH_CHANGED = NO
OLD_WRITE_PATH_CHANGED = NO
APPLICATION_DOWNGRADE_RESULT = PASS (exact source commit application health on migrated snapshot clone)
```

Rollback follows the adopted additive plan: restore/run the prior application
path and retain the five empty tables, constraints, triggers, and future evidence.
No destructive down migration is used.

```text
ROLLBACK_REFERENCE = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1 §11, D01/D14/D16; CTR-MIG-004
ROLLBACK_SCHEMA_ACTION = retain additive foundation structures
ROLLBACK_APPLICATION_PATH = prior application remains compatible and healthy
```

## 9. Evidence limits

This evidence establishes only the Phase-2 additive migration foundation. It does
not claim backfill, production-shaped validation, dual-read comparison, runtime
Contract conformance, cutover readiness, deployment, or production conformance.
The source dataset is local-only and is not described as production.
