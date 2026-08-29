# SUBSCRIPTION_STORAGE_EVIDENCE_V1 — Product core acceptance evidence

This record is the deliberately reduced product-core evidence split from source
PR #13. It covers additive subscription storage only. Advanced verifier
hardening is excluded and is neither product scope nor a product acceptance
blocker.

```text
TASK_NAME = 订阅 执行 — Product core split
TASK_TYPE = 执行
SOURCE_PR = #13
SOURCE_BASE = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
SOURCE_HEAD = ae037012568183810d00702d7c3d4d888b8a2a9a
OWNER_DECISION = SPLIT_PRODUCT_AND_ADVANCED_TOOLING
R5_FINAL_REVIEW = ACCEPT_WITH_TOOLING_DEBT
HARD_PRODUCT_BLOCKERS = NONE
ADVANCED_TOOLING_EXCLUDED_FROM_PRODUCT_PR = YES
ADVANCED_TOOLING_DOES_NOT_BLOCK_PRODUCT_ACCEPTANCE = YES
RUNTIME_CUTOVER = NO
BACKFILL = NO
DEPLOYMENT = NO
```

## 1. Governing authority and lineage

```text
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
RELATED_ADOPTED_DESIGNS =
  INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
  INV-AGENT-FORUM-READ-STATE-MONOTONICITY-AMENDMENT-V1
READ_STATE_AMENDMENT_DISPOSITION = adopted
SOURCE_MAIN = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
PREVIOUS_MIGRATION_COUNT = 14
PREVIOUS_MIGRATION_TIP = 20260825144043_add_forum_identity_storage
PREVIOUS_MIGRATION_SET_SHA256 = aff434623f3665d8aec3e62bd6703312d63149dcaa24b6dfdef8430b60001702
NEW_MIGRATION_ID = 20260827004400_add_forum_subscription_storage
SUBSCRIPTION_MIGRATION_COUNT = 1
TOTAL_MIGRATION_COUNT = 15
MIGRATION_LINEAGE = SERIAL
```

Exact product blobs retained from `SOURCE_HEAD`:

```text
PRISMA_SCHEMA_SHA256 = 7f4650010b31ee6286df7794c6df7d9ea5ecf022bbe791c2234a829892e8e3d1
SUBSCRIPTION_MIGRATION_SHA256 = cec5b7dc09550d68944687ffa6d3ec893679aee8037c1d4656532fe30f802305
CORE_VERIFIER_SHA256 = 31b88ab909569a18a19a39c5540969af3cb3dbd22a579a9a28d5413258235fb5
SCHEMA_BLOB_UNCHANGED_FROM_SOURCE_HEAD = YES
MIGRATION_BLOB_UNCHANGED_FROM_SOURCE_HEAD = YES
CORE_VERIFIER_BLOB_UNCHANGED_FROM_SOURCE_HEAD = YES
```

## 2. Additive storage shape

```text
SUBSCRIPTION_MODELS = 5
SUBSCRIPTION_TABLES = 5
NEW_FKS = 15
FK_DELETE_ACTION = RESTRICT
FK_UPDATE_ACTION = RESTRICT
FIFTEEN_FK_CATALOG_BINDINGS = PASS
RAW_SQL_OBJECTS = 12
SQL_029_TO_040_COMPLETE = PASS
```

The five model/table pairs are:

- `ForumParticipation` / `public.forum_participations`
- `ForumWatchSubscription` / `public.forum_watch_subscriptions`
- `ForumReadState` / `public.forum_read_states`
- `ForumMention` / `public.forum_mentions`
- `ForumNotificationFact` / `public.forum_notification_facts`

The migration implements SQL-029 through SQL-040 and exactly 15 new foreign
keys, all `ON DELETE RESTRICT ON UPDATE RESTRICT`.

## 3. Core behavior acceptance

```text
PARTICIPATION_CONSTRAINTS = PASS
PARTICIPATION_KNOWN_PARTIAL_UNKNOWN = PASS
WATCH_CONSTRAINTS = PASS
WATCH_ONE_ACTIVE = PASS

READ_STATE_SHAPE = PASS
UNKNOWN_TO_UNKNOWN = PASS
UNKNOWN_TO_KNOWN = PASS
KNOWN_TO_UNKNOWN_REJECTION = PASS (23514)
KNOWN_CURSOR_DECREASE_REJECTION = PASS (23514)
KNOWN_CURSOR_SAME_OR_HIGHER = PASS
LAST_READ_AT_MONOTONICITY_CHANGED = NO

MENTION_CONSTRAINTS = PASS
MENTION_DUPLICATE_REJECTION = PASS (23505)
MENTION_FOREIGN_KEY_REJECTION = PASS (23503)
NOTIFICATION_CONSTRAINTS = PASS
NOTIFICATION_REASON_CONSTRAINT = PASS
NOTIFICATION_DUPLICATE_REJECTION = PASS (23505)
NOTIFICATION_FOREIGN_KEY_REJECTION = PASS (23503)
```

Participation and Watch preserve the adopted fact-state, provenance, interval,
and one-active rules. ReadState preserves the adopted shape and transition
matrix: unknown may become known, while known-to-unknown and cursor decrease are
rejected. Mention and Notification remain additive facts and create no runtime,
review, task, workflow, or authority side effect.

## 4. Migration and compatibility evidence

The frozen source evidence established the following product-core results on
fresh disposable PostgreSQL 16.x databases and an isolated current-snapshot
clone. The split execution re-runs the clean-database subset without querying or
writing a source or production database.

```text
PRISMA_MIGRATION_DRIFT_REVIEW = PASS
CLEAN_DB_APPLY = PASS (all 15 migrations)
CURRENT_SNAPSHOT_APPLY = PASS (source 11 -> repository 15)
SECOND_DEPLOY_NOOP = PASS
MIGRATION_STATUS = UP_TO_DATE
MIGRATION_HISTORY_CONSISTENCY = PASS
FAILURE_RETRY_REHEARSAL = PASS
OLD_APPLICATION_COMMIT = a72dcf231b690dca524532bff3a2bfc1b2a0c1de
OLD_APPLICATION_COMPATIBILITY = PASS
FIVE_TABLES_EMPTY = PASS
PARTICIPATION_ROWS = 0
WATCH_ROWS = 0
READ_STATE_ROWS = 0
MENTION_ROWS = 0
NOTIFICATION_ROWS = 0
```

Failure/retry used an isolated migration copy and fresh database: an injected
invalid final statement failed, Prisma recorded the migration rolled back, the
exact repository migration bytes were restored, and deployment then succeeded.
No product migration bytes were changed by that rehearsal.

## 5. Product verification

The core verifier is exposed only as:

```text
verify:subscription-storage = node scripts/verify-subscription-storage.mjs
```

It validates exact catalog bindings, the five tables, 15 RESTRICT/RESTRICT
foreign keys, SQL-029..SQL-040, and the adopted behavior constraints. Product
verification records:

```text
npm ci = PASS
npm run prisma:generate = PASS
npm run typecheck = PASS
npm run build = PASS
npm test = PASS
TESTS = 294
PASSED = 294
FAILED = 0
npm run verify:subscription-storage = PASS
```

## 6. Scope and final disposition

```text
ADVANCED_CLEANUP_SCRIPT_INCLUDED = NO
ADVANCED_PARALLEL_SCRIPT_INCLUDED = NO
ADVANCED_COORDINATOR_SCRIPT_INCLUDED = NO
ADVANCED_FAULT_SUITE_EVIDENCE_INCLUDED = NO
COORDINATOR_ONLY_RECOVERY_INCLUDED = NO
RUNTIME_CODE_CHANGED = NO
RUNTIME_SCOPE_CREEP = NO
SOURCE_DB_QUERIES_DURING_SPLIT = 0
SOURCE_DB_WRITES_DURING_SPLIT = 0
PRODUCTION_DB_QUERIES_DURING_SPLIT = 0
PRODUCTION_DB_WRITES_DURING_SPLIT = 0
BACKFILLED_ROWS = 0
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
AUTHORITY_SWITCH = NO
RUNTIME_CUTOVER = NO
BACKFILL = NO
DEPLOYMENT = NO
MERGE_ALLOWED = NO
R5_FINAL_REVIEW = ACCEPT_WITH_TOOLING_DEBT
HARD_PRODUCT_BLOCKERS = NONE
ADVANCED_TOOLING_EXCLUDED_FROM_PRODUCT_PR = YES
ADVANCED_TOOLING_DOES_NOT_BLOCK_PRODUCT_ACCEPTANCE = YES
NEXT_TASK = 产品 审计
AUDIT_SCOPE = 订阅核心
```

No reviewer identity is asserted by this record. No password, token,
Authorization header, secret, or raw sensitive legacy row is stored here.
