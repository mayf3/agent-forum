# AUDIT_STORAGE_EVIDENCE_V1 — 证据 执行 acceptance evidence

Persistent acceptance evidence for the second serial Phase 2 additive-storage
workstream. Produced by the 证据 执行 task against the exact base commit below.
Nothing in this file claims runtime Contracts implemented or conformance
verified; Phase 2 evidence only proves additive storage structure readiness.

```text
TASK_NAME = 证据 执行
TASK_TYPE = 执行

SOURCE_COMMIT = 99b926ae6889e42e49f3ff2482aa745c9da410ef
STORAGE_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1 (disposition = adopted)
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1 (status = accepted)
MIGRATION_POLICY = INV-AGENT-FORUM-MIGRATION-OPTION-C-V1

CONTRACTS = CTR-ID-005, CTR-MIG-004, CTR-MIG-005, CTR-DELETE-003

PHASE = 2 — additive storage
IMPLEMENTATION_WORKSTREAM = 证据
PREFLIGHT_MODE = REUSE
SPEC_GAP = NO
OWNER_DECISION_REQUIRED = NO

POSTGRES_VERSION = PostgreSQL 16.14 (aarch64-unknown-linux-musl), disposable
                  postgres:16-alpine container; source is also 16.14.
PRISMA_VERSION = 5.22.0
```

## 1. Serial migration lineage

```text
PREVIOUS_MAIN = 99b926ae6889e42e49f3ff2482aa745c9da410ef
REMOTE_MAIN_AT_START = 99b926ae6889e42e49f3ff2482aa745c9da410ef
MAIN_DRIFT = NO

PREVIOUS_MIGRATION_COUNT = 12
PREVIOUS_MIGRATION_TIP = 20260822065412_add_forum_migration_foundation

PREVIOUS_MIGRATION_SET_SHA256 =
009cb3a16713b3c28f7cbfb59cbc97a840c992eb6be601715e3bb7de93cb70d7
PREVIOUS_MIGRATION_SET_SHA256_METHOD =
sha256 over the sorted listing "<sha256(migration.sql)>  <migration_dir_name>"
for the 12 pre-existing migrations (content-bound; not a name-only hash)

NEW_MIGRATION_ID = 20260823162405_add_forum_audit_events
MIGRATION_GENERATION_METHOD =
npx prisma migrate dev --create-only --name add_forum_audit_events
against a disposable PostgreSQL 16.14 dev database (forum_migrate owner),
followed by manual review and manual append of SQL-015..SQL-017

NEW_MIGRATION_CHECKSUM = f7b62f5444eef76800cd28966c3330870c059bb0f3e0597b6bfbc316cd2e490e
                        (sha256 of migration.sql; identical value recorded by
                         prisma in _prisma_migrations.checksum)
PRISMA_SCHEMA_HASH = 3ae54edf1906bc42f6b40decb3879200b3a7a97128ec7487f46a3f9d5e26f5b6
                    (sha256 of svc-forum/prisma/schema.prisma after the change)

TOTAL_MIGRATION_COUNT = 13
OLD_MIGRATION_BYTES_CHANGED = NO (git diff vs origin/main over the 12 old
                              migration directories is empty)

PARALLEL_SCHEMA_AUTHORING_ALLOWED = NO (B-LINEAGE-001 respected; no other
                                    schema workstream authored migrations)
NEXT_ALLOWED_WORKSTREAM = 证据 审计
```

## 2. Scope and phase boundary

Exactly one Prisma model, one physical table, and the three frozen raw SQL
objects were added:

```text
NEW_MODELS = 1 (ForumAuditEvent)
NEW_TABLES = 1 (forum_audit_events)
RAW_SQL_OBJECTS_IMPLEMENTED = 3
  SQL-015 forum_audit_events_provenance_ck   CHECK (provenance IN ('runtime','migration'))
  SQL-016 forum_audit_events_append_only_tg  BEFORE UPDATE OR DELETE row trigger
                                             EXECUTE public.forum_forbid_mutation()
                                             (function reused from the foundation
                                              migration; no second function created)
  SQL-017 revoke-forum-app-audit-mutation    GRANT SELECT, INSERT + REVOKE UPDATE,
                                             DELETE, TRUNCATE for forum_app

AUDIT_ROWS_CREATED = 0
RUNTIME_AUDIT_WRITER_IMPLEMENTED = NO
EXISTING_LOG_PIPELINE_CHANGED = NO
PRODUCT_RUNTIME_CODE_CHANGED = NO   (svc-forum/src/** untouched)
BACKFILLED_ROWS = 0
QUARANTINE_ROWS_IMPORTED = 0
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
AUTHORITY_SWITCH = NO
CUTOVER = NO
DEPLOYED = NO
SOURCE_DB_WRITES = 0 (source touched only read-only: pg_dump + SELECT)

PAYLOAD_BOUNDARY_RUNTIME_ENFORCEMENT = DEFERRED_TO_FUTURE_WRITER
PAYLOAD_ALLOWLIST_DB_ENFORCED = NO (no SQL-018, no runtime validator added; the
 storage layer cannot bound payload content and this task does not claim it)
```

Column shape matches §8.3 K exactly (verified column-by-column by the
verifier, including `payload jsonb NOT NULL DEFAULT '{}'::jsonb` and
`created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`). The only
existing-model edits are the two required reverse relation fields
(`ForumPrincipal.auditEvents`, `ForumThread.auditEvents`). `authSubject`,
`agentId`, and `clientId` are stored as non-authoritative authentication
snapshots per CTR-ID-005; `actorPrincipalId` remains the only authority
reference. `actor` NULL is legal only for system migration/constraint events
that must be explained by `provenance`.

## 3. Role boundary (CTR-MIG-004 additive rollback safety)

Read-only source inspection (no role or DDL change on source):

```text
SOURCE_FORUM_APP_ROLE_PRESENT = NO
SOURCE_APPLICATION_ROLE = forum (LOGIN, superuser)
SOURCE_FORUM_APP_SEPARATION_TODAY = NO
ROLE_BOUNDARY_IMPLEMENTABLE = YES
```

Honest notes:

- The source database does not yet contain `forum_app`, and the current
  deployment connects as a superuser. Deploying this migration to source will
  require the DB owner to pre-create a minimal `forum_app` role first — the
  migration itself never creates, alters, or owns any role and fails closed
  (SQLSTATE 42704 on the GRANT) when the role is absent.
- The disposable verification environment pre-created, per the accepted design:
  `forum_migrate` (LOGIN, CREATEDB, migration/table owner) and `forum_app`
  (NOLOGIN, no superuser/bypassrls/createrole/createdb).
- Table owner and superuser can bypass grants (including TRUNCATE, which the
  row-level SQL-016 trigger does not cover). This phase does not claim
  adversarial protection against the DB owner; acceptance verifies BOTH the
  grants and the trigger, and the trigger rejects UPDATE/DELETE even for the
  owner and superuser (SQLSTATE 55000).

## 4. Database verification (all on disposable PostgreSQL 16.14)

```text
CLEAN_DB_APPLY = PASS              (13/13 migrations on a fresh database)
SECOND_DEPLOY_NOOP = PASS          ("No pending migrations to apply.")
MIGRATION_STATUS = UP_TO_DATE      (prisma migrate status, clean + clone)
MIGRATION_HISTORY_CONSISTENCY = PASS (13 finished, none rolled back, on all
                                      three verification databases)

CURRENT_SNAPSHOT_APPLY = PASS
```

Current-snapshot clone: the source (still at 11 applied migrations) was dumped
read-only (`pg_dump -Fc`) and restored into a disposable clone owned by
`forum_migrate`; the clone then sequentially applied the foundation migration
(12th) and this audit migration (13th). This does NOT mean the source itself
has the foundation deployed.

All nine existing business tables were byte-identical before and after the
apply (row counts plus order-independent md5-of-row_to_json digests), and every
pre-existing relation filenode was unchanged; only new tables appeared:

| Existing business table | Rows | Stable hash before/after | Filenode before/after |
|---|---:|---|---|
| `forum_context_snapshots` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | unchanged |
| `forum_messages` | 607 | `7585bffbe12212a524497cec305e7457` | unchanged |
| `forum_outcomes` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | unchanged |
| `forum_participants` | 389 | `0c07d44f9a796bd8f0a87d8cfcd6fd05` | unchanged |
| `forum_principals` | 92 | `0b9d4448c25a2fc28dea8cea2bc5ae47` | unchanged |
| `forum_reactions` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | unchanged |
| `forum_reports` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | unchanged |
| `forum_thread_views` | 79 | `74a00f14033d5b48781eb4e7ae66a119` | unchanged |
| `forum_threads` | 90 | `a6943a1568dcad41ba34c96604064be8` | unchanged |

```text
EXISTING_BUSINESS_ROWS_CHANGED = NO
EXISTING_BUSINESS_HASHES_CHANGED = NO
RELATION_FILENODES_CHANGED = NO (new tables only: forum_audit_events + the
                                five foundation tables created by migration 12)
AUDIT_TABLE_EMPTY = PASS (0 rows before and after every verification run)
```

Failure/retry rehearsal (temporary migration-directory copy, invalid trailing
`ALTER TABLE nonexistent_rehearsal_table ...` injected):

```text
MIGRATION_FAILURE_INJECTION_RC = nonzero (SQLSTATE 42P01)
FAILED_MIGRATION_RECORDED = unfinished row in _prisma_migrations
MIGRATION_FAILURE_RETRY = PASS (migrate resolve --rolled-back, exact committed
                              SQL restored, deploy succeeded, verifier passed)
MIGRATION_RERUN_RESULT = PASS (deploy + second-deploy no-op on all databases)
```

## 5. Explicit verifier

```text
VERIFIER = svc-forum/scripts/verify-audit-evidence-storage.mjs
NPM_SCRIPT = verify:audit-evidence-storage (node only; no new dependency)
VERIFIER_RUNS = clean apply DB, snapshot-clone DB, failure-retry DB
VERIFIER_RESULT = exit 0, 36 PASS assertions per run
```

Behavior (mirrors the foundation verifier's B-VERIFIER-001 bar): fails closed
without `AUDIT_EVIDENCE_STORAGE_DATABASE_URL`/`DATABASE_URL`; demands a
disposable database; `ON_ERROR_STOP`; `lock_timeout=5s`,
`statement_timeout=60s`; requires the audit table empty on entry; runs every
test row inside one transaction that ends in `ROLLBACK`; asserts emptiness and
guard integrity after rollback; treats any unexpected SQLSTATE as verifier
failure; and binds catalog objects by schema + relation + object identity +
normalized definition + function OID + trigger event mask (tgtype 27 = ROW +
BEFORE + UPDATE + DELETE, no INSERT/TRUNCATE), never by name counting.

Decoy-resistance is proven: same-name CHECK/trigger in a foreign schema and a
trigger rebound to a wrong function cannot substitute for the real objects,
and renaming the real objects makes the assertion fail while decoys remain.

All §13 negative/permission checks passed:

| # | Test | Result |
|---|---|---|
| 1 | invalid provenance (`backfill`) | REJECT 23514 |
| 1b | provenance `NULL` | REJECT 23502 (NOT NULL) |
| 1c | provenance `runtime` / `migration` | ACCEPT |
| 2 | invalid actor principal FK | REJECT 23503 |
| 3 | invalid thread FK | REJECT 23503 |
| 4 | audit UPDATE as table owner | REJECT 55000 |
| 4b | audit UPDATE as superuser | REJECT 55000 |
| 5 | audit DELETE as table owner | REJECT 55000 |
| 6 | forum_app INSERT | PASS |
| 7 | forum_app SELECT | PASS |
| 8 | forum_app UPDATE | DENIED 42501 |
| 9 | forum_app DELETE | DENIED 42501 |
| 10 | forum_app TRUNCATE | DENIED 42501 |
| 11 | forum_app DISABLE TRIGGER | DENIED 42501 |
| 12 | forum_app ALTER TABLE | DENIED 42501 |
| 13 | forum_app not table owner | PASS (owner is the migration owner) |
| 14 | PUBLIC mutation privileges | NONE (catalog ACL + fresh probe role: UPDATE/DELETE/TRUNCATE all 42501) |
| 15 | migration owner separated from forum_app | YES |
| 16 | SQL-015/016/017 bound to public.forum_audit_events | PASS (exact catalog binding) |

forum_app's explicit ACL on `public.forum_audit_events` is exactly
`[INSERT, SELECT]`. The verifier also re-ran the foundation verifier on the
snapshot clone: SQL-001..SQL-014 still pass (90 assertions) — no regression to
the 基座 workstream.

## 6. Build, suite, and old application compatibility

Executed in the worktree (new code):

```text
PRISMA_GENERATE = PASS
TYPECHECK = PASS (tsc --noEmit)
BUILD = PASS (tsc)
TEST_SUITE = PASS (294/294, in-memory mocks; existing stderr audit logging
            observed and unchanged — it is NOT dual-written to the database)
```

Old application compatibility — the exact previous main
`99b926ae6889e42e49f3ff2482aa745c9da410ef` extracted with `git archive`
(no working-tree contamination), built, and started against the migrated
snapshot clone:

```text
OLD_NPM_CI = PASS
OLD_PRISMA_GENERATE = PASS
OLD_TYPECHECK = PASS
OLD_BUILD = PASS
OLD_TEST_SUITE = PASS (294/294)
OLD_APP_HEALTH = {"ok":true,"service":"svc-forum","db":"connected"}
OLD_APPLICATION_COMPATIBILITY = PASS
OLD_READ_PATH_CHANGED = NO
OLD_WRITE_PATH_CHANGED = NO
OLD_APP_WROTE_AUDIT_ROWS = 0 (forum_audit_events stayed empty through startup,
                             health, and read requests; the old client has no
                             ForumAuditEvent model)
```

## 7. Boundary close-out

```text
SQL_015_TO_017_COMPLETE = PASS
PROVENANCE_CHECK = PASS
APPEND_ONLY_TRIGGER = PASS
FORUM_APP_SELECT = PASS
FORUM_APP_INSERT = PASS
FORUM_APP_UPDATE = DENIED
FORUM_APP_DELETE = DENIED
FORUM_APP_TRUNCATE = DENIED
PUBLIC_MUTATION_PRIVILEGES = NONE
TABLE_OWNER_SEPARATED_FROM_FORUM_APP = YES
STDERR_TO_DATABASE_DUAL_WRITE = NO
AUDIT_ROWS_BACKFILLED = 0
BACKFILL = NO
MERGED = NO
DEPLOYED = NO

NEXT_TASK = 证据 审计
```

No password, token, Authorization header, secret, or raw sensitive legacy row
is stored in this evidence file. Test UUIDs and digests above are synthetic.
