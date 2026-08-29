# SUBSCRIPTION_STORAGE_EVIDENCE_V1 — 订阅 执行 acceptance evidence

Persistent acceptance evidence for the fourth serial Phase 2 additive-storage
workstream. This record proves additive subscription storage readiness only. It
does not claim runtime cutover or full runtime Contract conformance.

```text
TASK_NAME = 订阅 执行
TASK_TYPE = 执行

SOURCE_COMMIT = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
RELATED_ADOPTED_DESIGNS =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
INV-AGENT-FORUM-READ-STATE-MONOTONICITY-AMENDMENT-V1
READ_STATE_AMENDMENT_DISPOSITION = adopted
PREFLIGHT_MODE = REUSE
CHANGE_CLASS = NON_MECHANICAL
GOVERNING_SPEC_GAP = NO
ADOPTED_DESIGN_GAP = NO
OWNER_DECISION_REQUIRED = NO
IMPLEMENTATION_ALLOWED = YES

CONTRACTS =
CTR-AUTHZ-005
CTR-REVIEW-001
CTR-MIG-002
CTR-MIG-004
CTR-MIG-005
```

## 1. Serial lineage and generation

```text
PREVIOUS_MAIN = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
REMOTE_MAIN_AT_START = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
MAIN_DRIFT = NO
PREVIOUS_MIGRATION_COUNT = 14
PREVIOUS_MIGRATION_TIP = 20260825144043_add_forum_identity_storage
PREVIOUS_MIGRATION_SET_SHA256 =
aff434623f3665d8aec3e62bd6703312d63149dcaa24b6dfdef8430b60001702
PREVIOUS_MIGRATION_SET_SHA256_METHOD = SHA-256 over the complete UTF-8 listing,
sorted by migration directory, with each line exactly
"<sha256(migration.sql)>  <migration_directory>\n" and the final newline retained

NEW_MIGRATION_ID = 20260827004400_add_forum_subscription_storage
MIGRATION_GENERATION_METHOD =
npx prisma migrate dev --create-only --name add_forum_subscription_storage
against disposable PostgreSQL 16.14 after deploying the exact 14-migration base;
then manual review and append of SQL-029..SQL-040
NEW_MIGRATION_CHECKSUM =
cec5b7dc09550d68944687ffa6d3ec893679aee8037c1d4656532fe30f802305
PRISMA_SCHEMA_HASH =
7f4650010b31ee6286df7794c6df7d9ea5ecf022bbe791c2234a829892e8e3d1
SUBSCRIPTION_MIGRATION_COUNT = 1
TOTAL_MIGRATION_COUNT = 15
OLD_MIGRATION_BYTES_CHANGED = NO
MIGRATION_LINEAGE = SERIAL
PARALLEL_SCHEMA_AUTHORING_ALLOWED = NO
```

A Prisma drift probe against the fully migrated database generated an empty
migration only; the temporary empty probe directory was removed. Prisma did not
propose a second FK set or removal of the raw CHECKs, partial index, function, or
trigger.

```text
PRISMA_MIGRATION_DRIFT_REVIEW = PASS
```

## 2. Source and disposable database boundary

```text
POSTGRES_VERSION = PostgreSQL 16.14 on aarch64-unknown-linux-musl
SOURCE_APPLIED_MIGRATIONS = 11
SOURCE_APPLIED_MIGRATION_TIP = 20260807034800_add_forum_reports
SOURCE_FORUM_APP_ROLE_PRESENT = NO
SOURCE_APPLICATION_ROLE = forum (LOGIN, SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB)
SOURCE_TRANSACTION_ISOLATION = REPEATABLE READ
SOURCE_TRANSACTION_READ_ONLY = on
SOURCE_DB_OPERATIONS = SELECT + pg_dump + ROLLBACK only
SOURCE_DB_WRITES = 0
PRODUCTION_DB_WRITES = 0
```

The source database was inspected only in an explicit `REPEATABLE READ READ
ONLY` transaction and cloned with `pg_dump --format=custom --no-owner
--no-privileges`. No migration, DDL, DML, or role mutation was run against it.
The snapshot artifact itself is outside the repository and no source row is
included here.

Every disposable cluster had `forum_app` created before migration 13 with:

```text
LOGIN = NO
SUPERUSER = NO
BYPASSRLS = NO
CREATEROLE = NO
CREATEDB = NO
TABLE_OWNER = NO
```

The subscription migration creates or changes no database role.

## 3. Implemented additive storage

```text
SUBSCRIPTION_MODELS = 5
SUBSCRIPTION_TABLES = 5
NEW_FKS = 15
FIFTEEN_FK_CATALOG_BINDINGS = PASS
FK_DELETE_ACTION = RESTRICT
FK_UPDATE_ACTION = RESTRICT
RAW_SQL_OBJECTS = 12
RAW_SQL_OBJECTS_IMPLEMENTED = 12
SQL_029_TO_040_COMPLETE = PASS
RAW_SQL_OBJECT_COUNT_REPOSITORY = 75 (adopted registry SQL-001..SQL-075)

PARTICIPATION_ROWS = 0
WATCH_ROWS = 0
READ_STATE_ROWS = 0
MENTION_ROWS = 0
NOTIFICATION_ROWS = 0
BACKFILLED_ROWS = 0
```

The new models/tables are exactly:

- `ForumParticipation` / `public.forum_participations`
- `ForumWatchSubscription` / `public.forum_watch_subscriptions`
- `ForumReadState` / `public.forum_read_states`
- `ForumMention` / `public.forum_mentions`
- `ForumNotificationFact` / `public.forum_notification_facts`

`ForumThreadMessage.mentions String[]` remains unchanged. No old Participant row,
Mention, Notification, Watch, or Read fact was imported.

## 4. Verifier and catalog evidence

Added `svc-forum/scripts/verify-subscription-storage.mjs` and package script
`verify:subscription-storage`, with no dependency change.

```text
NO_DATABASE_URL = EXIT 2
DISPOSABLE_DATABASE_ONLY_WARNING = PRESENT
ON_ERROR_STOP = ON
LOCK_TIMEOUT = 5s
STATEMENT_TIMEOUT = 60s
MAIN_BEHAVIOR_TRANSACTION_RESULT = ROLLBACK
UNEXPECTED_SQLSTATE = VERIFIER FAILURE
CATALOG_BINDING = exact public schema + relation OID + definition + function OID
WRONG_SCHEMA_DECOY = REJECTED
WRONG_TARGET_DECOY = REJECTED
WRONG_FUNCTION_OID_DECOY = REJECTED
NEW_TABLES = 5
NEW_FKS = 15
RAW_SQL_OBJECTS = 12
```

The ordinary behavior and decoy probes run in one transaction and finish with
`ROLLBACK`. Every transaction-only fixture ID, unique parent label, event key,
and decoy schema is run-unique. Because catalog decoy probes temporarily rename
shared public objects, only the rollback-only main transaction is serialized by
a fixed transaction-scoped advisory lock; the later two-session probes remain
parallel across verifier processes. The two-session concurrency probes
necessarily expose a committed synthetic parent fixture and winning transaction
to the waiting session. They run only on disposable databases.

Each verifier captures an exact JSONB baseline of every non-verifier-owned row in
the five tables, proves that baseline unchanged after cleanup, and asserts zero
only for its own exact fixture IDs. Rows whose exact Principal and Thread parent
markers identify another valid verifier run are excluded from the baseline and
are neither treated as contamination nor deleted. Global five-table zero is
owned only by the external coordinator before all parallel runs and after every
run or external recovery completes. Setup commits Principal, Thread, and
ReadState atomically; cleanup deletes only exact IDs whose parent markers prove
ownership. Catchable failures and signals receive best-effort cleanup. SIGKILL,
host crash, forced container deletion, and a permanent database outage cannot
guarantee finally or signal-handler execution. Any SIGKILL residue remains
safely identifiable by its unique ownership marker.

```text
CONCURRENCY_FIXTURE_IDENTITY = UNIQUE_PER_RUN
CONCURRENCY_FIXTURE_OWNERSHIP = MARKER_VERIFIED
SETUP_ATOMICITY = PASS
SETUP_CONFLICT_NONDESTRUCTIVE = PASS
CLEANUP_OWNERSHIP_VERIFIED = PASS
PREEXISTING_ROWS_PRESERVED = PASS
CLEANUP_IDEMPOTENT_FOR_OWNED_FIXTURES = PASS
CATCHABLE_SIGNAL_CLEANUP = BEST_EFFORT_PASS
CLEANUP_REENTRANCY_GUARD = PASS
SIGKILL_CLEANUP_GUARANTEED = NO
HOST_CRASH_CLEANUP_GUARANTEED = NO
CONCURRENCY_FIXTURE_CLEANUP = CLEANUP_BEST_EFFORT_DISPOSABLE_ONLY
SIGKILL_RESIDUE_OWNERSHIP_IDENTIFIABLE = PASS
```

Exact catalog results:

```text
FIVE_EXACT_TABLE_SHAPES = PASS
FIFTEEN_VALIDATED_FKS_RESTRICT_RESTRICT = PASS
FOUR_BUSINESS_KEYS = PASS
WATCH_PARTIAL_UNIQUE_COUNT = 1
SQL_038_SINGLE_PUBLIC_NOARG_TRIGGER_FUNCTION = PASS
SQL_039_EXACT_FUNCTION_OID = PASS
SQL_039_ENABLED_NONINTERNAL = PASS
SQL_039_TIMING = BEFORE
SQL_039_LEVEL = ROW
SQL_039_EVENTS = UPDATE_ONLY
```

## 5. Behavioral acceptance

The verifier passed on the clean database, migrated current snapshot clone, and
failure/retry database.

```text
PARTICIPATION_CONSTRAINTS = PASS
  known / partial / unknown = ACCEPT
  runtime / migration = ACCEPT
  invalid fact_state / provenance = 23514
  duplicate(thread,principal) = 23505
  invalid thread / principal / evidence FK = 23503
  presentation fields create no runtime or authority path

WATCH_CONSTRAINTS = PASS
WATCH_ONE_ACTIVE = PASS
  active + ended_at NULL = ACCEPT
  inactive + ended_at timestamp = ACCEPT
  started_at NULL = ACCEPT
  source=unknown + provenance=migration = ACCEPT
  invalid state / source / provenance = 23514
  invalid interval shapes = 23514
  second active = 23505
  invalid thread / principal / evidence FK = 23503
  multiple inactive intervals = ACCEPT
  ended active followed by new active = ACCEPT
  concurrent second active = one winner; loser 23505

READ_STATE_SHAPE = PASS
  unknown + NULL/NULL = ACCEPT
  known + 0/NULL = ACCEPT
  known + positive/time = ACCEPT
  invalid shape/state/provenance = 23514

READ_STATE_TRANSITION_MATRIX = PASS
UNKNOWN_TO_UNKNOWN = PASS
UNKNOWN_TO_KNOWN = PASS
KNOWN_TO_UNKNOWN_PROTECTION = PASS (23514 for known(0) and known(>0))
KNOWN_CURSOR_DECREASE_PROTECTION = PASS (23514)
KNOWN_CURSOR_SAME_OR_HIGHER = PASS
ON_CONFLICT_GUARD = PASS (23514)
MERGE_UPDATE_GUARD = PASS (23514)
CONCURRENT_CURSOR_MONOTONICITY = PASS (final cursor 10; cursor 5 rejected 23514)
LAST_READ_AT_MONOTONICITY_CHANGED = NO
KNOWN_SAME_CURSOR_EARLIER_LAST_READ_AT = ACCEPT
READ_STATE_PHYSICAL_DELETE_POLICY = UNSPECIFIED
READ_STATE_TRUNCATE_POLICY = UNSPECIFIED
READ_STATE_KEY_MUTATION_POLICY = UNSPECIFIED
RUNTIME_CAS_IMPLEMENTED = NO
RUNTIME_CAS_DEFERRED = YES

MENTION_CONSTRAINTS = PASS
  duplicate(message,mentioned principal) = 23505
  invalid message / principal FK = 23503

NOTIFICATION_CONSTRAINTS = PASS
  mention / watch / reaction = ACCEPT
  invalid reason = 23514
  duplicate(recipient,source_event_key) = 23505
  invalid recipient / thread / message / reaction FK = 23503
```

Mention and Notification create no Review, Watch, task, workflow, or authority
side effect. No frozen-but-unadopted reason-specific shape CHECK was added.

### 5.1 Concurrency fixture cleanup amendment

`test:subscription-verifier-cleanup` ran against a newly created disposable
PostgreSQL 16 database after all 15 repository migrations. It preseeded the old
fixed Principal and Thread UUIDs, injected setup and child-session failures,
exercised database timeouts, and sent real process signals. Every preservation
assertion bound exact fixture IDs to all applicable parent ownership fields; no
source database was used.

```text
BLOCKER_AMENDMENT_IMPLEMENTED = YES
INDEPENDENT_REAUDIT_REQUIRED = YES

FIXED_UUID_REGRESSION_TEST = PASS
SETUP_COLLISION_TEST = PASS
POST_COMMIT_ACK_FAILURE_CLEANUP = PASS
CLEANUP_RETRY_AFTER_TRANSIENT_FAILURE = PASS
FIRST_SESSION_FAILURE_CLEANUP = PASS
FIRST_SESSION_AFTER_READY_CLEANUP = PASS
SECOND_SESSION_FAILURE_CLEANUP = PASS
LOCK_TIMEOUT_CLEANUP = PASS
STATEMENT_TIMEOUT_CLEANUP = PASS
SIGTERM_CLEANUP = PASS
SIGKILL_BOUNDARY_TEST = PASS
PREEXISTING_PARENT_PRESERVATION = PASS
```

SIGINT, SIGTERM, and SIGHUP were each delivered to a separate verifier after
`SETUP_COMMITTED=YES` while both psql concurrency children were active. Each
handler blocked new child starts, terminated and joined only that run's children
with bounded SIGKILL escalation, then exited nonzero after ownership-safe
cleanup. Independent uncaught-exception and unhandled-rejection injections used
the same guarded termination path. SIGKILL was delivered at the post-setup idle
boundary; as expected, neither `finally` nor a signal handler ran, and the
committed Principal, Thread, and ReadState remained. The harness proved the
Principal and Thread held the exact unique marker and that ReadState referenced
those marked parents by the exact run IDs. It then removed the residue externally
with marker-qualified predicates, repeated the same cleanup safely, and left
unrelated preexisting parents unchanged. This is a tested boundary, not a
SIGKILL cleanup guarantee.

### 5.2 R3 parallel isolation and fault-harness amendment

The R3 amendment ran against a newly created PostgreSQL 16 disposable database
with all 15 repository migrations. The external coordinator alone asserted
five-table global zero before starting any parallel verifier and after every
verifier, signal case, SIGKILL recovery, and harness recovery completed. It ran
two normal verifiers concurrently; first-session and second-session failure
verifiers beside a normal verifier; a SIGTERM verifier beside a normal verifier;
and a SIGKILL verifier beside a normal verifier. Every pair had distinct run
IDs, markers, committed fixture IDs, and transaction-only fixture IDs.

The cleanup harness now records a unique harness run and marker, parses child
metadata in a controlled close result, preserves raw stdout/stderr plus child
code and signal, and always reaches marker-qualified top-level cleanup for
catchable failures. An invalid test-only UUID proved that the original early
verifier error remains visible together with the controlled metadata parse
error. Harness assertion failure and SIGTERM removed the harness sentinel.
Harness SIGKILL deliberately left an exactly identifiable sentinel and a known
child verifier's marked Principal, Thread, and ReadState. The external
coordinator used the emitted harness run/marker and child fixture metadata to
terminate the orphan child, recover the child fixture by its exact marker, and
remove the sentinel by exact IDs plus exact harness marker; no claim is made that
a killed harness can run its own finally block.

```text
BLOCKER_AMENDMENT_ROUND = R3
R2_BLOCKER_AMENDMENTS_IMPLEMENTED = YES
INDEPENDENT_R3_REAUDIT_REQUIRED = YES

PARALLEL_VERIFIER_RUN_ISOLATION = PASS
CROSS_RUN_DELETE_PROTECTION = PASS
CROSS_RUN_SESSION_TERMINATION_PROTECTION = PASS
PER_RUN_GLOBAL_ZERO_ASSUMPTION_REMOVED = YES
MAIN_FIXTURE_IDENTITY = UNIQUE_PER_RUN
PER_RUN_FIXTURE_CLEAN = PASS
OWNED_ROWS_AFTER_CLEANUP = 0
BASELINE_CAPTURE = EXACT
BASELINE_PRESERVATION = PASS
BASELINE_ROWS_PRESERVED = PASS
NONEMPTY_EXACT_BASELINE_PRESERVATION = PASS
LOOKALIKE_MARKER_BASELINE_PRESERVATION = PASS
PARALLEL_FIXTURE_OVERLAP_BARRIER = PASS
COORDINATOR_FAILURE_RECOVERY = MARKER_QUALIFIED
GLOBAL_ZERO_ASSERTION_OWNER = EXTERNAL_COORDINATOR

EARLY_EXIT_ERROR_PRESERVATION = PASS
FIXTURE_PARSE_ERROR_CONTROLLED = PASS
HARNESS_FINALLY_REACHED = PASS
SIGINT_CLEANUP = PASS
SIGTERM_CLEANUP = PASS
SIGHUP_CLEANUP = PASS
UNCAUGHT_EXCEPTION_CLEANUP = PASS
UNHANDLED_REJECTION_CLEANUP = PASS
HARNESS_SIGKILL_CLEANUP_GUARANTEED = NO
HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE = PASS
HARNESS_EXTERNAL_RECOVERY = PASS

SUBSCRIPTION_CATALOG_REGRESSION = PASS
SUBSCRIPTION_BEHAVIOR_REGRESSION = PASS
WATCH_CONCURRENCY_REGRESSION = PASS
READ_CURSOR_CONCURRENCY_REGRESSION = PASS
FIVE_TABLES_EMPTY = PASS

CONCURRENCY_FIXTURE_CLEANUP = CLEANUP_BEST_EFFORT_DISPOSABLE_ONLY
SIGKILL_CLEANUP_GUARANTEED = NO
HOST_CRASH_CLEANUP_GUARANTEED = NO
```

This amendment does not claim that the blockers are independently closed, does
not change the R2 `REQUEST_CHANGES` verdict, and does not authorize merge.

### 5.3 R4 fail-closed coordinator recovery amendment

The R4 amendment implemented a candidate fix for the single R3 blocker
`BLOCKER-SUB-COORDINATOR-FAILURE-RECOVERY-004` in the external coordinator and
its evidence; the subsequent independent R4 audit found two remaining verifier
correctness blockers, so this section does not claim closure. It changed no migration, schema, or runtime code. The coordinator
is now the recovery identity authority (`COORDINATOR_IDENTITY_AUTHORITY =
PRESPAWN_EXPECTED_IDENTITY`): before spawning any child it generates and holds
the child kind (`VERIFIER` / `CLEANUP_HARNESS`), fixture run ID, Principal /
Thread / first and second Watch IDs, ownership marker, expected
`application_name` values, harness run ID, harness sentinel IDs, and harness
ownership marker, and passes them to children through explicit test-only
environment variables (`SUBSCRIPTION_VERIFIER_COORDINATOR_*`,
`SUBSCRIPTION_CLEANUP_HARNESS_COORDINATOR_*`). The independent verifier and
harness execution paths still default to their own `randomUUID` identities.

Child stdout metadata is now used only for validation: each field must appear
exactly once, be a well-formed UUID where applicable, bind marker to run ID,
keep fixture IDs distinct, never mix verifier and harness metadata prefixes,
and equal the coordinator-expected identity field for field. Missing, partial,
duplicated, forged (wrong run ID, wrong marker, non-UUID, duplicate IDs,
foreign-run IDs), or mixed-kind metadata records `METADATA_VALIDATION = FAIL`
and forces a nonzero exit, while the coordinator still performs
marker-qualified recovery from its own prespawned expected identity.

All silent recovery catches were removed. The coordinator collects
`PRIMARY_ERROR`, `RECOVERY_ERRORS[]`, and `FINAL_ASSERTION_ERRORS[]` into an
`AggregateError`-style report; any collected error forces a nonzero exit;
external cleanup retries once; later cleanup errors never replace the primary
test error and the primary error never masks cleanup failures. Top-level
success claims print only after every child has exited, every expected fixture
is marker-recovered, every harness sentinel is recovered, baseline cleanup
completed, the exact baseline is restored, the global five-table final
assertion passes, no run-scoped database backend residue remains, and no
recovery error exists (`SUCCESS_LOG_AFTER_FINAL_RECOVERY = YES`).

The `finally` block now always executes database-backed final assertions on
every path: per-child owned ReadState / Watch / Thread / Principal rows = 0,
harness sentinel rows = 0, known harness child residue = 0, coordinator-created
`application_name` sessions = 0, exact five-table baseline restoration (PK set
plus stable content digest compared byte-for-byte with the start-state digest),
and global zero of the five subscription tables. Process-group kill failure now
escalates through exact run-scoped `application_name` backend termination and an
exact-pid kill, verifies the child/backend actually ended, and propagates any
failure; unknown verifier sessions are never matched by broad regex, and a
live foreign control session is proven preserved across recovery
(`OTHER_SESSION_PRESERVATION = PASS`).

A new fault suite `test:subscription-coordinator-failure-recovery` ran against
the same disposable PostgreSQL 16.14 database and drove the real coordinator
through one injected failure per case: child pre-metadata exit; partial
metadata; duplicate metadata; mixed-kind output; forged metadata in five
variants; injected process-group kill failure with backend fallback; transient
external cleanup failure recovered by retry; permanent external cleanup
failure; marker mismatch against a foreign-marked fixture; sentinel recovery
failure; and a deliberately skipped child cleanup. Every case exited nonzero
with the original error preserved, never printed a global-zero PASS while
residue existed, never deleted foreign-marker rows, and left a recoverable,
exactly-identified end state.

```text
BLOCKER_AMENDMENT_ROUND = R4
R3_BLOCKER_AMENDMENT_IMPLEMENTED = YES
INDEPENDENT_R4_REAUDIT_REQUIRED = YES

COORDINATOR_IDENTITY_AUTHORITY = PRESPAWN_EXPECTED_IDENTITY
COORDINATOR_PARSE_FAILURE_PROPAGATION = PASS
COORDINATOR_RECOVERY_FAILURE_PROPAGATION = PASS
COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION = PASS
COORDINATOR_BASELINE_FINAL_ASSERTION = PASS
RUN_SCOPED_SESSION_FINAL_ASSERTION = PASS
COORDINATOR_OWNED_ROWS_FINAL_ASSERTION = PASS
R4_COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION = UNSUPPORTED_MARKER_QUALIFIED_ONLY
PROCESS_GROUP_KILL_FAILURE_PROPAGATION = PASS
OTHER_SESSION_PRESERVATION = PASS
CHILD_KIND_BINDING = PASS
AMBIGUOUS_OUTPUT_REJECTED = PASS
PRIMARY_ERROR_PRESERVED = PASS
RECOVERY_ERROR_PRESERVED = PASS
COMBINED_ERROR_REPORTING = PASS
SILENT_RECOVERY_CATCHES = REMOVED
SUCCESS_LOG_AFTER_FINAL_RECOVERY = YES

CHILD_PRE_METADATA_EXIT_RECOVERY = PASS
PARTIAL_METADATA_REJECTED = PASS
DUPLICATE_METADATA_REJECTED = PASS
FORGED_METADATA_REJECTED = PASS
TRANSIENT_CLEANUP_FAILURE_RECOVERED_WITH_RETRY = PASS
PERMANENT_CLEANUP_FAILURE_PROPAGATED = PASS
MARKER_MISMATCH_NO_CROSS_MARKER_DELETE = PASS
SENTINEL_RECOVERY_FAILURE_PROPAGATED = PASS
DELIBERATE_RESIDUE_CAUGHT_BY_FINAL_ASSERTION = PASS
SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS = PASS

PARALLEL_VERIFIER_RUN_ISOLATION = PASS
CROSS_RUN_DELETE_PROTECTION = PASS
CROSS_RUN_SESSION_TERMINATION_PROTECTION = PASS
PER_RUN_GLOBAL_ZERO_ASSUMPTION_REMOVED = YES
MAIN_FIXTURE_IDENTITY = UNIQUE_PER_RUN
BASELINE_CAPTURE = EXACT
BASELINE_PRESERVATION = PASS
NONEMPTY_EXACT_BASELINE_PRESERVATION = PASS
LOOKALIKE_MARKER_BASELINE_PRESERVATION = PASS
EARLY_EXIT_ERROR_PRESERVATION = PASS
FIXTURE_PARSE_ERROR_CONTROLLED = PASS
SIGINT_CLEANUP = PASS
SIGTERM_CLEANUP = PASS
SIGHUP_CLEANUP = PASS
UNCAUGHT_EXCEPTION_CLEANUP = PASS
UNHANDLED_REJECTION_CLEANUP = PASS
HARNESS_SIGKILL_CLEANUP_GUARANTEED = NO
HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE = PASS
HARNESS_EXTERNAL_RECOVERY = PASS

SUBSCRIPTION_CATALOG_REGRESSION = PASS
SUBSCRIPTION_BEHAVIOR_REGRESSION = PASS
WATCH_CONCURRENCY_REGRESSION = PASS
READ_CURSOR_CONCURRENCY_REGRESSION = PASS
FIVE_TABLES_EMPTY = PASS

SIGKILL_CLEANUP_GUARANTEED = NO
HOST_CRASH_CLEANUP_GUARANTEED = NO
```

`HARNESS_EXTERNAL_RECOVERY = PASS` remains an amendment candidate that is only
recorded because the fail-closed coordinator demonstrated it in this round. This
amendment does not claim `BLOCKER_CLOSED = YES`, does not change the R3
`REQUEST_CHANGES` verdict, and does not authorize merge; an independent R4
re-audit is required.

### 5.4 R5 sentinel terminal assertion and fault-suite self-cleanup amendment

The R5 amendment separates cleanup authorization from terminal existence. Normal
coordinator recovery remains marker-qualified by prespawned expected IDs and
ownership markers. After child processes are joined, the coordinator records an
atomic creation receipt from an exactly-once child acknowledgement or direct
marker-qualified database observation. Only identities proven created by this
run receive an ID-only terminal assertion. Thus marker tampering cannot authorize
deletion, but it also cannot hide a coordinator-created row from the terminal
check.

The real marker-tamper fault case committed a harness sentinel, changed the exact
Principal and Thread IDs to a known foreign marker, and killed the harness.
Marker-qualified coordinator cleanup rejected the ownership mismatch and deleted
nothing. The receipt-gated ID-only assertion detected both surviving IDs, forced
a nonzero coordinator result, and suppressed sentinel, success-ordering, and
overall PASS claims. The parent fault suite then used its prespawn plan, exact
initial absence, and known injected marker to remove only its test-owned rows.

The fault suite is now the prespawn identity authority for every case. Each case
has controlled primary-error, cleanup-error, and final-assertion collections and
unconditional per-case `finally`; the suite has a second top-level `finally`.
Cleanup no longer depends on parsing the coordinator diagnostic dump. Controlled
self-failures covered coordinator-output parse failure, suite assertion failure,
coordinator timeout, marker tamper, and a SIGTERM worker. Every path terminated
exact process groups/sessions, restored the exact five-table baseline, removed
all prespawned IDs, and proved no case-owned backend remained. SIGKILL remains an
honest external-recovery boundary rather than a self-cleanup guarantee.

```text
BLOCKER_AMENDMENT_ROUND = R5
R4_BLOCKER_AMENDMENTS_IMPLEMENTED = YES
INDEPENDENT_R5_REAUDIT_REQUIRED = YES

SENTINEL_ID_ONLY_FINAL_ASSERTION = PASS
CREATION_RECEIPT_TRACKING = PASS
MARKER_MISMATCH_FAIL_CLOSED = PASS
FOREIGN_MARKER_NOT_DELETED_BY_COORDINATOR = PASS
FAULT_SUITE_TAMPERED_FIXTURE_RECOVERED = PASS

FAULT_SUITE_IDENTITY_AUTHORITY = PRESPAWN_EXPECTED_IDENTITY
FAULT_SUITE_TOP_LEVEL_FINALLY = PASS
FAULT_SUITE_SELF_FAILURE_CLEANUP = PASS
FAULT_SUITE_PRIMARY_ERROR_PRESERVED = PASS
FAULT_SUITE_CLEANUP_ERROR_PRESERVED = PASS
FAULT_SUITE_COMBINED_ERROR_REPORTING = PASS
FAULT_SUITE_BASELINE_FINAL_ASSERTION = PASS
FAULT_SUITE_OWNED_ID_FINAL_ASSERTION = PASS
FAULT_SUITE_SESSION_FINAL_ASSERTION = PASS
FAULT_SUITE_SIGTERM_CLEANUP = PASS
FAULT_SUITE_SIGKILL_CLEANUP_GUARANTEED = NO

COORDINATOR_PARSE_FAILURE_PROPAGATION = PASS
COORDINATOR_RECOVERY_FAILURE_PROPAGATION = PASS
COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION = PASS
COORDINATOR_BASELINE_FINAL_ASSERTION = PASS
PROCESS_GROUP_KILL_FAILURE_PROPAGATION = PASS
CHILD_KIND_BINDING = PASS
SUCCESS_LOG_AFTER_FINAL_RECOVERY = YES

PARALLEL_VERIFIER_RUN_ISOLATION = PASS
FIVE_TABLES_EMPTY = PASS
SIGKILL_CLEANUP_GUARANTEED = NO
HOST_CRASH_CLEANUP_GUARANTEED = NO
```

These are R5 amendment self-test results only. They do not claim any blocker is
independently closed, do not change `SUBSCRIPTION_STORAGE_REVIEW` to `ACCEPT`, do
not make the PR ready, and do not authorize merge.

## 6. Clean, snapshot, rerun, and legacy-data evidence

```text
CLEAN_DB_APPLY = PASS (all 15 migrations)
CURRENT_SNAPSHOT_APPLY = PASS (source 11 -> repository 15)
SOURCE_TO_REPOSITORY_MIGRATIONS_APPLIED =
20260822065412_add_forum_migration_foundation
20260823162405_add_forum_audit_events
20260825144043_add_forum_identity_storage
20260827004400_add_forum_subscription_storage
SECOND_DEPLOY_NOOP = PASS
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
FAILURE_RETRY_REHEARSAL = PASS
```

Failure/retry used an isolated migration copy and a fresh database. An injected
invalid final statement made the subscription migration fail. It was marked
rolled back with Prisma, replaced by the exact repository migration bytes, and
redeployed successfully. The final stored checksum on clean, snapshot-clone,
and retry databases equals the repository checksum.

Legacy comparison covered the original columns of all nine source business
tables. Before/after row counts, canonical JSONB projection digests, relation
filenodes, and table shapes were stable.

```text
SOURCE_SNAPSHOT_ROWS =
forum_context_snapshots=0
forum_messages=607
forum_outcomes=0
forum_participants=389
forum_principals=98
forum_reactions=0
forum_reports=0
forum_thread_views=81
forum_threads=90

ROW_COUNTS_CHANGED = NO
LEGACY_COLUMN_VALUES_CHANGED = NO
RELATION_FILENODES_CHANGED = NO
NO_EXISTING_TABLE_REWRITE = PASS
EXISTING_TABLE_REWRITE = NO
FIVE_TABLES_EMPTY = PASS
```

Existing verifier results:

```text
FOUNDATION_VERIFIER_NO_REGRESSION = PASS (final migrated snapshot clone)
AUDIT_STORAGE_VERIFIER_NO_REGRESSION = PASS (final migrated snapshot clone)
IDENTITY_STORAGE_VERIFIER_NO_REGRESSION = PASS (exact 14-migration predecessor database)
IDENTITY_VERIFIER_LINEAGE = PHASE_EXACT_PREDECESSOR_EVIDENCE
```

The identity verifier intentionally contains the prior-workstream serial-lineage
sentinel that rejects the future `forum_watch_subscriptions` table, so its exact
unchanged script was executed successfully against the exact 14-migration
predecessor. On the 15-migration database it exits only at that expected sentinel,
not at any identity catalog or behavior assertion. The subscription verifier
then validates the new SQL-029 boundary on every final database.

## 7. DDL lock and rewrite evidence

```text
APPLY_STARTED_AT = 2026-08-27T00:45:06Z
APPLY_FINISHED_AT = 2026-08-27T00:45:07Z
LOCK_TIMEOUT = 5s (verification sessions)
STATEMENT_TIMEOUT = 60s (verification sessions)
PG_LOCKS_RELEVANT_BEFORE = 0
PG_LOCKS_RELEVANT_AFTER = 0
WAITING_OR_BLOCKING_PID = NONE OBSERVED
WAL_BEFORE = 0/2DD7CE0
WAL_AFTER = 0/2E36408
WAL_DELTA_BYTES = 386856
PARENT_RELATION_FILENODES_CHANGED = NO
EXISTING_ROW_COUNTS_OR_DIGESTS_CHANGED = NO
MIGRATION_FAILURE_RETRY_REFERENCE = isolated subscription_retry rehearsal
EXISTING_TABLE_REWRITE = NO
```

The migration creates only new relations plus their constraints/index/function/
trigger. Existing parent relation filenodes for threads, principals, messages,
reactions, and migration legacy evidence were identical before and after.

## 8. Tooling and old-application compatibility

Executed in `svc-forum`:

```text
npm ci = PASS
npm run prisma:generate = PASS
npm run typecheck = PASS
npm run build = PASS
npm test = PASS
npm run verify:subscription-storage = PASS
npm run test:subscription-verifier-cleanup = PASS
npm run test:subscription-verifier-parallel-isolation = PASS
npm run test:subscription-coordinator-failure-recovery = PASS
TESTS = 294
SUITES = 39
PASSED = 294
FAILED = 0
```

The exact previous-main source was separately archived and built, then started
against the fully migrated current snapshot clone.

```text
OLD_APPLICATION_COMMIT = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
OLD_APPLICATION_HEALTH_HTTP = 200
OLD_APPLICATION_DB = connected
OLD_APPLICATION_COMPATIBILITY = PASS
OLD_APP_NEW_TABLE_SEQ_SCANS = 0
OLD_APP_NEW_TABLE_INDEX_SCANS = 0
OLD_APP_NEW_TABLE_INSERTS = 0
OLD_APP_NEW_TABLE_UPDATES = 0
OLD_APP_NEW_TABLE_DELETES = 0
```

All five new tables remained empty. The old application continues to use the
legacy Participant, Watch, Read, Mention-array, and notification derivation
paths.

## 9. Scope and close-out

```text
RUNTIME_WATCH_PATH_CHANGED = NO
RUNTIME_READ_PATH_CHANGED = NO
RUNTIME_NOTIFICATION_PATH_CHANGED = NO
RUNTIME_MENTION_PATH_CHANGED = NO
RUNTIME_REVIEW_PATH_CHANGED = NO
PARTICIPANT_BACKFILL = NO
MENTION_IMPORT = NO
NOTIFICATION_IMPORT = NO
BACKFILLED_ROWS = 0
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
AUTHORITY_SWITCH = NO
CUTOVER = NO
CLEANUP = NO
DEPLOYED = NO
MERGED = NO
SOURCE_DB_WRITES = 0
PRODUCTION_DB_WRITES = 0
PRODUCT_MIGRATION_CHANGED = NO
SCHEMA_CHANGED = NO
RUNTIME_CODE_CHANGED = NO
RUNTIME_SCOPE_CREEP = NO
BLOCKER_AMENDMENT_IMPLEMENTED = YES
R2_BLOCKER_AMENDMENTS_IMPLEMENTED = YES
R3_BLOCKER_AMENDMENT_IMPLEMENTED = YES
R4_BLOCKER_AMENDMENTS_IMPLEMENTED = YES
INDEPENDENT_REAUDIT_REQUIRED = YES
INDEPENDENT_R3_REAUDIT_REQUIRED = YES
INDEPENDENT_R4_REAUDIT_REQUIRED = YES
INDEPENDENT_R5_REAUDIT_REQUIRED = YES
MERGE_ALLOWED = NO
NEXT_TASK = 复审 审计
```

No password, token, Authorization header, secret, or raw sensitive legacy row is
stored in this evidence record. UUIDs in the verifier are synthetic.
