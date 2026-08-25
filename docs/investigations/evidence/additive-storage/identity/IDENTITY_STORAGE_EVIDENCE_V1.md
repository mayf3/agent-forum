# IDENTITY_STORAGE_EVIDENCE_V1 — 身份 执行 acceptance evidence

Persistent acceptance evidence for the third serial Phase 2 additive-storage
workstream. This record proves additive identity storage readiness only. It does
not claim runtime identity cutover or full Contract conformance.

```text
TASK_NAME = 身份 执行
TASK_TYPE = 执行

SOURCE_COMMIT = d14b508d9c0c68e7a8102bb0962bd9acb89cdafb
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
RELATED_ADOPTED_DESIGNS =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
INV-AGENT-FORUM-ALIAS-PERMANENCE-AMENDMENT-V1
ALIAS_AMENDMENT_DISPOSITION = adopted
ALIAS_DELETE_SEAM = CLOSED_IN_BASE
PREFLIGHT_MODE = REUSE
GOVERNING_SPEC_GAP = NO
ADOPTED_DESIGN_GAP = NO
OWNER_DECISION_REQUIRED = NO

CONTRACTS =
CTR-ID-001
CTR-ID-002
CTR-ID-003
CTR-ID-004
CTR-ID-005
CTR-AUTHZ-001
CTR-AUTHZ-002
CTR-AUTHZ-003
CTR-AUTHZ-004
CTR-MIG-004
CTR-MIG-005
```

## 1. Serial lineage and generation

```text
PREVIOUS_MAIN = d14b508d9c0c68e7a8102bb0962bd9acb89cdafb
REMOTE_MAIN_AT_START = d14b508d9c0c68e7a8102bb0962bd9acb89cdafb
MAIN_DRIFT = NO
PREVIOUS_MIGRATION_COUNT = 13
PREVIOUS_MIGRATION_TIP = 20260823162405_add_forum_audit_events
PREVIOUS_MIGRATION_SET_SHA256 =
2d0b5bfa7eeffdab5a0ee33c025c9e83e7225e55324b59aecef5c949079fe41c
PREVIOUS_MIGRATION_SET_SHA256_METHOD = sha256 over the UTF-8 sorted listing
"<sha256(migration.sql)>  <migration_directory>\n", including the final newline

NEW_MIGRATION_ID = 20260825144043_add_forum_identity_storage
MIGRATION_GENERATION_METHOD =
npx prisma migrate dev --create-only --name add_forum_identity_storage
against disposable PostgreSQL 16.14 after deploying the exact 13-migration base;
then manual review and replacement of generated actor FKs with staged NOT VALID
SQL-021..SQL-028, individual VALIDATE CONSTRAINT statements, and manual addition
of SQL-018, SQL-019, SQL-020, and SQL-075
NEW_MIGRATION_CHECKSUM =
5c31e98576d7967bcafb745a45290ebb69dde7aa53ffedf60ba0cbc48e8f19ac
PRISMA_SCHEMA_HASH =
8400a3db7524629597477075db345ceccf0512832962ab41cea4d0631c8bddc4
TOTAL_MIGRATION_COUNT = 14
OLD_MIGRATION_BYTES_CHANGED = NO
MIGRATION_LINEAGE = SERIAL
PARALLEL_SCHEMA_AUTHORING_ALLOWED = NO
```

The pre-existing migration digest was recomputed independently from all 13
`migration.sql` byte streams and compared equal to the prior task value. No old
migration was modified, renamed, or deleted.

## 2. Source and disposable database boundary

```text
POSTGRES_VERSION = PostgreSQL 16.14 (disposable postgres:16-alpine and source)
SOURCE_APPLIED_MIGRATIONS = 11
SOURCE_APPLIED_MIGRATION_TIP = 20260807034800_add_forum_reports
SOURCE_FORUM_APP_ROLE_PRESENT = NO
SOURCE_APPLICATION_ROLE = forum (LOGIN, superuser, BYPASSRLS, CREATEROLE)
SOURCE_TRANSACTION_ISOLATION = REPEATABLE READ
SOURCE_TRANSACTION_READ_ONLY = on
SOURCE_DB_OPERATIONS = SELECT + pg_dump + ROLLBACK only
SOURCE_DB_WRITES = 0
PRODUCTION_DB_WRITES = 0
```

The source was inspected only in an explicit `REPEATABLE READ READ ONLY`
transaction and cloned with `pg_dump --format=custom --no-owner --no-privileges`.
No migration, DDL, role mutation, or DML was run against it.

Before applying the historical audit migration to each disposable database, the
test cluster contained a pre-created `forum_app` role with:

```text
LOGIN = NO
SUPERUSER = NO
BYPASSRLS = NO
CREATEROLE = NO
CREATEDB = NO
TABLE_OWNER = NO
```

The identity migration neither creates nor modifies any database role.

## 3. Implemented additive storage

```text
IDENTITY_MODELS = 1
IDENTITY_TABLES = 1
NEW_MODEL = ForumPrincipalAlias
NEW_TABLE = public.forum_principal_aliases
ALIAS_ROWS = 0
ALIASES_IMPORTED = 0
BACKFILLED_ROWS = 0

ADDITIVE_COLUMNS = 13
ADDITIVE_COLUMNS_WITH_DEFAULT = 0
NEW_COLUMNS_ALL_NULL = PASS
PRINCIPAL_FKS = 8
EIGHT_FK_CATALOG_BINDINGS = PASS
EIGHT_FK_VALIDATED = PASS
RAW_SQL_OBJECTS = 12
RAW_SQL_OBJECTS_IMPLEMENTED = 12
SQL_018_TO_028_COMPLETE = PASS
SQL_075_COMPLETE = PASS
SQL_029 = forum_watch_subscriptions_state_ck (not reused; not implemented here)
ALIAS_ROW_ID_IMMUTABILITY = NOT_REQUIRED_BY_ADOPTED_DESIGN
```

The 13 columns are exactly the adopted nullable, no-default columns on
`forum_threads`, `forum_messages`, `forum_thread_views`, `forum_outcomes`,
`forum_context_snapshots`, `forum_reports`, and `forum_reactions`. The eight
named Principal FKs use `NOT VALID`, are individually validated, and finish
with `convalidated=true`, `ON DELETE RESTRICT`, and `ON UPDATE RESTRICT`.
No ninth actor FK exists.

## 4. Identity verifier and behavioral evidence

Added `svc-forum/scripts/verify-identity-storage.mjs` and package script
`verify:identity-storage`. It has no new runtime dependency.

Verifier controls:

```text
NO_DATABASE_URL = EXIT 2 (fail closed)
DISPOSABLE_DATABASE_ONLY_WARNING = PRESENT
ON_ERROR_STOP = ON
LOCK_TIMEOUT = 5s
STATEMENT_TIMEOUT = 60s
TEST_ROWS = TRANSACTION ONLY
FINAL_TRANSACTION_RESULT = ROLLBACK
ALIAS_ROWS_BEFORE = 0
ALIAS_ROWS_AFTER = 0
UNEXPECTED_SQLSTATE = VERIFIER FAILURE
CATALOG_BINDING = schema + exact relation OID + exact function OID + definition
DECOY_RESISTANCE = PASS
```

Executed successfully on the clean-apply, migrated snapshot-clone, and
failure-retry databases:

```text
ALIAS_NAMESPACE_CHECK = PASS
  auth_subject = ACCEPT
  agent_id = ACCEPT
  other = 23514
  NULL = 23502

ALIAS_UPDATE_PROTECTION = PASS
  principal_id / namespace / value / first_seen_at / created_at = 55000
ALIAS_RETIREMENT_TRANSITIONS = PASS
  NULL→timestamp = ACCEPT
  timestamp→same timestamp = ACCEPT
  timestamp→NULL = 55000
  timestamp→different timestamp = 55000
ALIAS_DELETE_PROTECTION = PASS (55000)
ALIAS_TRUNCATE_PROTECTION = PASS (55000)
TRUNCATE_CASCADE_PROTECTION = PASS (55000)
ALIAS_REUSE_PROTECTION = PASS (23505, including retired alias)
ON_CONFLICT_OWNER_OR_VALUE_CHANGE = PASS (55000)
MERGE_UPDATE = PASS (55000)
MERGE_DELETE = PASS (55000)
ALIAS_PRINCIPAL_DELETE_RESTRICT = PASS (23503)
ORIGINAL_ALIAS_REMAINS_AFTER_REJECTIONS = PASS

SQL_020_TGTYPE = 27
SQL_020_INSERT_BIT = 0
SQL_020_EXACT_FUNCTION_OID = PASS
SQL_075_TGTYPE = 34
SQL_075_EXACT_FUNCTION_OID = PASS
SQL_019_SINGLE_PUBLIC_NOARG_TRIGGER_FUNCTION = PASS
NO_SECOND_SAME_NAME_FUNCTION_OR_TRIGGER = PASS
WRONG_SCHEMA_DECOY = REJECTED
WRONG_TARGET_DECOY = REJECTED
WRONG_FUNCTION_OID_DECOY = REJECTED
EIGHT_FK_INVALID_NON_NULL = 23503
EIGHT_FK_NULL_ACCEPTED = PASS
DB_OWNER_OR_SUPERUSER_ADVERSARIAL_DISABLE_OR_DROP = OUT_OF_SCOPE
```

## 5. Clean, snapshot, rerun, and legacy-data evidence

A fresh disposable PostgreSQL 16.14 cluster was used. `forum_app` was created
before migration 13. Final migration bytes were then verified as follows:

```text
CLEAN_DB_APPLY = PASS (all 14 migrations)
CURRENT_SNAPSHOT_APPLY = PASS (source 11 → repository 14)
SECOND_DEPLOY_NOOP = PASS
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
FAILURE_RETRY_REHEARSAL = PASS
FOUNDATION_VERIFIER_NO_REGRESSION = PASS
AUDIT_STORAGE_VERIFIER_NO_REGRESSION = PASS
```

Failure/retry used an isolated copy of the migration directory and a fresh
database. An intentionally invalid final statement made the identity migration
fail; it was marked rolled back with Prisma, replaced by the exact repository
migration bytes, redeployed, and finished up to date. The successful final
migration checksum stored in `_prisma_migrations` equals the repository SHA-256
on clean, snapshot-clone, and retry databases.

Legacy comparisons used only the columns present before identity migration,
never whole-row JSON containing the 13 new NULL columns. Per-table count and
canonical JSONB row digests were captured before and after for:

```text
forum_context_snapshots  rows=0
forum_messages           rows=607
forum_outcomes           rows=0
forum_participants       rows=389
forum_principals         rows=94
forum_reactions          rows=0
forum_reports            rows=0
forum_thread_views       rows=80
forum_threads            rows=90
```

```text
ROW_COUNTS_CHANGED = NO
LEGACY_COLUMN_VALUES_CHANGED = NO
RELATION_FILENODES_CHANGED = NO
NO_TABLE_REWRITE = PASS
NEW_COLUMNS_ALL_NULL = PASS
ALIAS_ROWS = 0
AUDIT_ROWS = 0
MIGRATION_EVIDENCE_ROWS = 0
```

## 6. Tooling and old-application compatibility

Executed in `svc-forum`:

```text
npm ci = PASS
npm run prisma:generate = PASS
npm run typecheck = PASS
npm run build = PASS
npm test = PASS
```

The exact previous-main source `d14b508d9c0c68e7a8102bb0962bd9acb89cdafb`
was independently extracted, installed, generated, typechecked, built, and
fully tested. Its built application was started against the final migrated
snapshot clone:

```text
OLD_APPLICATION_COMMIT = d14b508d9c0c68e7a8102bb0962bd9acb89cdafb
OLD_APPLICATION_HEALTH_HTTP = 200
OLD_APPLICATION_DB = connected
OLD_APPLICATION_COMPATIBILITY = PASS
OLD_APP_ALIAS_READS = 0
OLD_APP_ALIAS_WRITES = 0
OLD_APP_NEW_COLUMN_WRITES = 0
OLD_APP_AUDIT_WRITES = 0
OLD_APP_CONTINUES_LEGACY_IDENTITY_FIELDS = YES
```

After startup and health verification, Alias, Audit, and Migration evidence
tables remained empty and all 13 additive columns remained NULL.

## 7. Scope and close-out

```text
RUNTIME_IDENTITY_RESOLVER_CHANGED = NO
RUNTIME_ACTOR_WRITER_CHANGED = NO
AUTH_MIDDLEWARE_CHANGED = NO
PERMISSION_CHECK_CHANGED = NO
RUNTIME_ROUTE_OR_DATA_ACCESS_CHANGED = NO
DUAL_READ = NO
DUAL_WRITE = NO
AUTHORITY_SWITCH = NO
CUTOVER = NO
CLEANUP = NO
DEPLOYED = NO
MERGED = NO
ALIASES_IMPORTED = 0
BACKFILLED_ROWS = 0
SOURCE_DB_WRITES = 0
PRODUCTION_DB_WRITES = 0
NEXT_TASK = 身份 审计
```

No password, token, Authorization header, secret, or raw sensitive legacy row
is stored in this evidence record. UUIDs used by the verifier are synthetic.
