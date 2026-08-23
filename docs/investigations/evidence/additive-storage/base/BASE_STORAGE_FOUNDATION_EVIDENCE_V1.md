# BASE_STORAGE_FOUNDATION_EVIDENCE_V1

```text
TASK_NAME = 基座 执行（R1 修订）
TASK_TYPE = 执行

SOURCE_COMMIT = c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d
AMENDMENT_PRIOR_HEAD = 5e363df06d68023e9d743e9767924a90acae563b
AMENDMENT_FOR = AF-BASE-AUDIT-PR8-R1-5E363DF
AMENDMENT_BLOCKERS_ADDRESSED = B-FK-001, B-VERIFIER-001
STORAGE_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
CONTRACTS = CTR-MIG-001, CTR-MIG-004, CTR-MIG-005
PHASE = 2 — additive storage
IMPLEMENTATION_WORKSTREAM = 基座

POSTGRES_VERSION = 16.14
PREVIOUS_MIGRATION_COUNT = 11
PREVIOUS_MIGRATION_TIP = 20260807034800_add_forum_reports
PREVIOUS_MIGRATION_SET_SHA256 = aff8a071161907a698012590b48ac1224e8b0d7c88fe99ad71dddf788eb51365
NEW_MIGRATION_ID = 20260822065412_add_forum_migration_foundation
NEW_MIGRATION_CHECKSUM = 5ebfc3779625decf58683254aa5bf887d6742181d4fc638cd0e6b44f286bcfa2
PRISMA_SCHEMA_HASH = 22e24942d685bbafc84f2a4fb2652fb20ce2dcfbf6890910f55733736dc8ca1f
VERIFIER_SHA256 = c62f332ca58d9b80bb0b612d647b8d2adeed8ab58c0e0a900928135136dbaca9

CLEAN_DB_APPLY = PASS
CURRENT_SNAPSHOT_APPLY = PASS
SECOND_DEPLOY_NOOP = PASS
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
EXISTING_BUSINESS_ROWS_CHANGED = NO
NEW_TABLE_EMPTY_ASSERTION = PASS
NO_BACKFILL_ASSERTION = PASS
NO_DUAL_WRITE_ASSERTION = PASS

CLEAN_APPLY_STARTED_AT = 2026-08-23T13:39:56Z
CLEAN_APPLY_FINISHED_AT = 2026-08-23T13:39:57Z
SNAPSHOT_APPLY_STARTED_AT = 2026-08-23T13:35:21Z
SNAPSHOT_APPLY_FINISHED_AT = 2026-08-23T13:35:21Z

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

## 0. Amendment record (R1)

This file was amended for PR #8 after the independent audit
`AF-BASE-AUDIT-PR8-R1-5E363DF` reported blockers `B-FK-001` and
`B-VERIFIER-001`. The prior head `5e363df` shipped six foundation foreign
keys with `ON DELETE RESTRICT ON UPDATE CASCADE` and a name-count catalog
verifier. That prior head never verified `ON UPDATE RESTRICT` behavior, and
nothing in the earlier revision of this record should be read as such a
claim. This amendment:

1. changes all six foundation FKs to `ON DELETE RESTRICT ON UPDATE RESTRICT`
   in both `prisma/schema.prisma` and the single foundation `migration.sql`
   (no second migration was created; the PR is unmerged, so the existing
   foundation migration file was revised in place);
2. rewrites `scripts/verify-migration-foundation.mjs` from name counting to
   exact catalog binding plus executable decoy resistance;
3. adds six real parent-ID mutation negative tests requiring SQLSTATE
   `23503` from the FK action itself.

```text
B_FK_001_IMPLEMENTATION_CANDIDATE = COMPLETE
B_VERIFIER_001_IMPLEMENTATION_CANDIDATE = COMPLETE
PRISMA_ON_UPDATE_RESTRICT_COUNT = 6
MIGRATION_ON_UPDATE_RESTRICT_COUNT = 6
IMPLEMENTATION_AMENDMENT_COMPLETE = YES
INDEPENDENT_REAUDIT_REQUIRED = YES
```

Whether the two blockers are actually closed is a judgment reserved for a
new independent audit Agent against the new amendment head. This record does
not claim `BLOCKERS_CLOSED`, `AUDIT_ACCEPT`, or `MERGE_ALLOWED`.

## 1. Coordinates and safety boundary

The amendment worktree was created detached from
`origin/agent/forum-migration-foundation-v1` at
`5e363df06d68023e9d743e9767924a90acae563b` with `origin/main` at
`c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d`. Governance verification
(before and after the amendment work) returned:

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

The existing local source database at `127.0.0.1:5434/svc_forum` was accessed
only by a `REPEATABLE READ READ ONLY` transaction (which reported
`transaction_read_only=on`) and by `pg_dump`. No migration, DDL, or DML was
executed against that source. The snapshot dump was restored only into a
disposable PostgreSQL database. The dump itself was temporary, is not
committed, and no source row or sensitive payload appears in this record.

```text
SOURCE_SNAPSHOT_DUMP_SHA256 = ed94b3219d34078e31fa7bc3e1b2fa65174936583a6d5f11e597bd21a3c73b1c
SOURCE_APPLIED_MIGRATIONS = 11
SOURCE_OLD_MIGRATION_SET_COMPLETE = YES
```

This round's snapshot is a fresh capture; compared with the prior
foundation round the source contains one additional `forum_principals` row
(91 versus 90) from ordinary local activity between rounds. All other
business tables matched the prior counts. The source remains local-only and
is not described as production.

The previous migration-set digest is a stable SHA-256 over the sorted 11
repository-root-relative `migration.sql` paths and bytes, each length-prefixed
(8-byte big-endian) before hashing. The identical method over the amendment
worktree reproduces `aff8a071161907a698012590b48ac1224e8b0d7c88fe99ad71dddf788eb51365`,
equal to the value recorded before the amendment, and all 11 files are
byte-identical to `5e363df`. No prior migration was changed, renamed, or
removed.

## 2. Schema and migration result

Exactly these structures were added by the single foundation migration:

- `MigrationRun` → `forum_migration_runs`
- `MigrationLegacyEvidence` → `forum_migration_legacy_evidence`
- `MigrationFieldDecision` → `forum_migration_field_decisions`
- `MigrationQuarantine` → `forum_migration_quarantines`
- `MigrationValidationResult` → `forum_migration_validation_results`

The only existing-model additions are the Prisma reverse relation fields
required for the two nullable `ForumPrincipal` relations. No existing
physical business column or runtime path changed.

```text
SCHEMA_DIFF_BEFORE_AFTER = five new tables; five PKs; five UNIQUE indexes; six FKs ON DELETE RESTRICT ON UPDATE RESTRICT; eight named CHECKs; two trigger functions; four triggers
NO_EXISTING_TABLE_DDL = YES
NO_TABLE_REWRITE = YES
MIGRATION_SQL_INSERT_UPDATE_DELETE_COPY = 0
MIGRATION_COUNT_BEFORE = 11
MIGRATION_COUNT_AFTER = 12
OLD_MIGRATION_BYTES_CHANGED = NO
```

## 3. Clean database apply and migration history

A fresh disposable PostgreSQL 16.14 database received all 11 old migrations
and the one amended migration through `prisma migrate deploy`.

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
migration directory with an injected invalid trailing statement
(`ALTER TABLE nonexistent_rehearsal_table ...`). Initial deploy returned
rc=1 with the failed migration recorded unfinished. The failed migration was
marked rolled back (`prisma migrate resolve --rolled-back`), the exact
committed migration SQL was restored, and deploy plus the complete foundation
verifier then passed.

```text
MIGRATION_FAILURE_INJECTION_RC = 1
MIGRATION_FAILURE_RETRY = PASS
MIGRATION_RERUN_RESULT = PASS (failure/resolve/retry plus second-deploy no-op)
```

## 4. Current-snapshot apply and unchanged business data

The read-only source dump was restored into a disposable PostgreSQL 16.14
database. Before apply, all 11 old migration records were present. Only
`20260822065412_add_forum_migration_foundation` was pending and applied.

Stable summaries use table row count plus an order-independent digest of
each row's JSON representation (md5 over the lexicographically sorted
per-row md5 of `row_to_json`). Before and after summaries were
byte-identical:

| Existing business table | Rows before | Rows after | Stable hash before/after |
|---|---:|---:|---|
| `forum_context_snapshots` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_messages` | 607 | 607 | `7585bffbe12212a524497cec305e7457` |
| `forum_outcomes` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_participants` | 389 | 389 | `0c07d44f9a796bd8f0a87d8cfcd6fd05` |
| `forum_principals` | 91 | 91 | `4cac3962938ba4f53fac2852df9a5d46` |
| `forum_reactions` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_reports` | 0 | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `forum_thread_views` | 79 | 79 | `74a00f14033d5b48781eb4e7ae66a119` |
| `forum_threads` | 90 | 90 | `a6943a1568dcad41ba34c96604064be8` |

```text
ROW_COUNTS_BEFORE_AFTER = IDENTICAL
OLD_TABLE_HASHES_BEFORE_AFTER = IDENTICAL
EXISTING_BUSINESS_ROWS_CHANGED = NO
```

Existing relation filenodes were also identical before and after the
migration apply:

| Existing relation | relfilenode before | relfilenode after |
|---|---:|---:|
| `forum_context_snapshots` | 27739 | 27739 |
| `forum_messages` | 27746 | 27746 |
| `forum_outcomes` | 27755 | 27755 |
| `forum_participants` | 27761 | 27761 |
| `forum_principals` | 27769 | 27769 |
| `forum_reactions` | 27780 | 27780 |
| `forum_reports` | 27786 | 27786 |
| `forum_thread_views` | 27793 | 27793 |
| `forum_threads` | 27799 | 27799 |

```text
RELATION_FILENODE_BEFORE_AFTER = UNCHANGED_FOR_ALL_EXISTING_BUSINESS_TABLES
CURRENT_SNAPSHOT_APPLY = PASS
```

## 5. Exact catalog binding, FK mutation, and decoy verification

The explicit verifier is:

```text
npm run verify:migration-foundation
```

It uses `psql`, pins a safe session `search_path`, exits nonzero on
failure, creates all test rows inside one test transaction, and rolls the
transaction back before asserting final emptiness and trigger re-enablement.
It was run successfully on clean, snapshot-clone, and failure-retry
databases (90 PASS assertions per run).

### 5.1 Exact catalog binding (B-VERIFIER-001)

A repeatable `pg_temp.assert_foundation_catalog()` binds every foundation
object by schema, target relation, object type, definition, function
identity, and trigger event mask through `pg_namespace`/`pg_class`/
`pg_constraint`/`pg_proc`/`pg_trigger` joins, `to_regclass`, and
`to_regprocedure` — never by bare name counts and never through the caller
`search_path`:

- eight CHECK constraints: `schema=public`, exact target table, exact
  `conname`, `contype='c'`, and whitespace-normalized
  `pg_get_constraintdef` equal to the exact expected definition;
- six FKs: `schema=public` on both sides, exact child table and ordered
  child columns, exact parent table and ordered parent columns,
  `contype='f'`, `confdeltype='r'`, `confupdtype='r'`, exact name;
- two functions: `namespace=public`, exact name, empty identity arguments,
  `prokind='f'`, return type `trigger`, language `plpgsql`;
- four triggers: non-internal, exact relation OID, exact function OID,
  `tgtype=27` (row-level BEFORE with exactly UPDATE and DELETE events, no
  INSERT/TRUNCATE), and enabled (`tgenabled='O'`).

```text
PUBLIC_SCHEMA_BINDING = PASS
CHECK_CONSTRAINT_EXACT_BINDING = PASS
FUNCTION_EXACT_BINDING = PASS
TRIGGER_EXACT_BINDING = PASS
SIX_FK_DELETE_ACTIONS = RESTRICT
SIX_FK_UPDATE_ACTIONS = RESTRICT
SIX_FK_COLUMN_BINDINGS = PASS
SIX_FK_PARENT_BINDINGS = PASS
CATALOG_EXACT_BINDING_REVIEW = PASS
```

### 5.2 Six FK parent-ID mutation tests (B-FK-001)

Each test creates an independent parent row and an independent child row
that references that parent only through the target FK, mutates the parent
primary key, and requires SQLSTATE `23503` from the `ON UPDATE RESTRICT`
action itself, then confirms the parent kept its original ID and the child
kept its original FK value. Where the parent table carries its own
user-defined mutation trigger (`forum_migration_runs_sealed_guard_tg`,
`forum_migration_legacy_evidence_append_only_tg`), only that named user
trigger is disabled for the single UPDATE and immediately re-enabled; the
verifier asserts internal FK triggers stay enabled and no global bypass
(`DISABLE TRIGGER ALL`, `session_replication_role`, etc.) is used.

```text
TEST_FK_UPDATE_01 forum_migration_runs.id <- forum_migration_legacy_evidence.migration_run_id = PASS [23503]
TEST_FK_UPDATE_02 forum_principals.id <- forum_migration_legacy_evidence.candidate_principal_id = PASS [23503]
TEST_FK_UPDATE_03 forum_migration_legacy_evidence.id <- forum_migration_field_decisions.legacy_evidence_id = PASS [23503]
TEST_FK_UPDATE_04 forum_migration_legacy_evidence.id <- forum_migration_quarantines.legacy_evidence_id = PASS [23503]
TEST_FK_UPDATE_05 forum_principals.id <- forum_migration_quarantines.resolved_by_principal_id = PASS [23503]
TEST_FK_UPDATE_06 forum_migration_runs.id <- forum_migration_validation_results.migration_run_id = PASS [23503]

SIX_FK_PARENT_ID_MUTATION_TESTS = PASS
SIX_FK_UPDATE_SQLSTATE = 23503
PARENT_CHILD_VALUES_UNCHANGED = PASS
```

Negative control: against a disposable database carrying the prior head's
`ON UPDATE CASCADE` migration, the rewritten verifier fails
(`FK exact binding failed ... confupdtype=r ... found 0`, rc=3), and the
mutation-test logic independently fails because the parent-ID update is
rejected by the cascaded child write hitting the append-only trigger with
SQLSTATE `55000` — not `23503` — which the test rejects. Under CASCADE with
no append-only child trigger the update would simply succeed and cascade.
Both verification layers therefore detect the prior head's behavior.

### 5.3 Decoy resistance tests (B-VERIFIER-001)

Inside the same transaction, a decoy schema `af_decoy` plants same-named
objects: a same-name CHECK with a different definition (wrong schema), a
same-name FK between wrong tables (wrong schema and target), a same-name
function (wrong schema), a same-name trigger on a wrong table, and a
same-name trigger on the real table rebound to the decoy function. With all
decoys present, the exact assertion still passes. Each real object is then
temporarily renamed, removed, or misbound inside a `SAVEPOINT` — leaving
only the decoy — and the assertion must fail; `ROLLBACK TO SAVEPOINT`
restores the real structure and the assertion passes again. The decoy
schema is dropped explicitly and asserted absent after rollback.

```text
DECOY_01 wrong-schema same-name CHECK cannot substitute = PASS (assertion failed as required)
DECOY_02 wrong-schema wrong-target same-name FK cannot substitute = PASS (assertion failed as required)
DECOY_03 wrong-schema same-name function cannot substitute = PASS (assertion failed as required)
DECOY_04 wrong-table same-name trigger cannot substitute = PASS (assertion failed as required)
DECOY_05 trigger bound to wrong function cannot substitute = PASS (assertion failed as required)

WRONG_SCHEMA_DECOY_TEST = PASS
WRONG_TARGET_DECOY_TEST = PASS
WRONG_FUNCTION_BINDING_DECOY_TEST = PASS
DECOY_CANNOT_SUBSTITUTE_FOR_REAL_OBJECT = PASS
DECOY_RESIDUE = NONE
```

### 5.4 Behavioral regression matrix (unchanged semantics)

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
| all six FK catalog update actions | RESTRICT |

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

This advisory is out of scope for the R1 amendment and was not rewritten.

## 6. Empty-structure and phase boundary assertions

After each verifier transaction rolled back, all five counts were zero:

```text
forum_migration_runs = 0
forum_migration_legacy_evidence = 0
forum_migration_field_decisions = 0
forum_migration_quarantines = 0
forum_migration_validation_results = 0

NEW_TABLE_EMPTY_ASSERTION = PASS
TRIGGERS_ENABLED_AFTER_ROLLBACK = PASS
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

Because this DDL completed below the polling resolution, no claim is made that
an in-flight catalog lock was sampled. The DDL shape and unchanged old filenodes are
the durable evidence that no existing business relation was rewritten.

## 8. Old application compatibility and rollback

The exact prior application source at
`c99e17e6ad5f09db80cb8e6ee4823c0b87aaf57d` was built with its prior Prisma
schema/client and started against the migrated current-snapshot clone. Its
`GET /api/health` returned HTTP 200 with `db=connected`.

The amendment worktree also passed:

```text
npm ci = PASS
npm run prisma:generate = PASS
npx prisma validate = PASS
npx prisma format --check = reports the same pre-existing formatting drift as the prior head; no unrelated reformatting was introduced
npm run typecheck = PASS
npm run build = PASS
npm test = PASS (294 tests, 294 pass, 0 fail) against a disposable migrated database
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

This evidence establishes only the Phase-2 additive migration foundation and
its R1 amendment. It does not claim backfill, production-shaped validation,
dual-read comparison, runtime Contract conformance, cutover readiness,
deployment, or production conformance. The source dataset is local-only and
is not described as production. Blocker closure for `B-FK-001` and
`B-VERIFIER-001` requires a fresh independent audit of the new amendment
head; this record claims implementation completeness only.
