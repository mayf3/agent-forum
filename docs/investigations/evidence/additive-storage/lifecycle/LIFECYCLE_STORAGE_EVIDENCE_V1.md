# LIFECYCLE_STORAGE_EVIDENCE_V1 — Phase 2 lifecycle storage candidate

This record covers one deliberately bounded gap: the additive lifecycle-storage
workstream named `状态 执行`. It does not claim merge, deployment, runtime
authority, backfill, cutover, or completion of the Forum governance-platform
Goal.

```text
TASK_NAME = 状态 执行
TASK_TYPE = 执行
WORKTREE = /Users/yanfenma/workspace/project/.worktrees/agent-forum-lifecycle-storage-v1
BRANCH = codex/forum-lifecycle-storage-v1
BASE = origin/main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db
CANDIDATE_COMMIT = TO_BE_FILLED_AFTER_PUSH (fixed SHA is recorded as LIFECYCLE_FIXED_HEAD in the PR created from this candidate)
RUNTIME_CUTOVER = NO
BACKFILL = NO
DEPLOYMENT = NO
REAL_IDENTITY_SMOKE = NOT_RUN
DISPOSITION = INDEPENDENTLY_REVERIFIED_2026-09-01_COMMITTED_VIA_DOCUMENTED_EMERGENCY_SEAM_AWAITING_AUDIT
```

## 1. Governance preflight

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = REUSE
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_REVISION = a84ba58b0a60c304e4a9eb8ec4d588ffa4a3824f
SPEC_PRESENT_IN_BASE = YES
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
RELATED_ACCEPTED_AUTHORITIES =
  AGENT_FORUM_PRODUCT_DIRECTION_V1
  AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
RELATED_ADOPTED_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
AUTHORITY_CONFLICT = NONE
IMPLEMENTATION_ALLOWED = YES (Phase 2 lifecycle storage only)
```

The accepted contracts in scope are `CTR-AUTHZ-001`, `CTR-AUTHZ-006`, and
`CTR-LIFE-001` through `CTR-LIFE-005`. The adopted design fixes the migration
order and makes lifecycle storage the only next schema workstream after merged
subscription storage. The design remains non-governing implementation detail;
the accepted Core Invariants Spec is the implementation authority.

The original checkout was already dirty with a broader, user-owned governance
candidate. It was not edited, reset, staged, or used as this candidate's base.
This work started in a new worktree from the freshly fetched, exact
`origin/main` commit above.

## 2. Exact scope and storage shape

```text
PREVIOUS_MIGRATION_TIP = 20260827004400_add_forum_subscription_storage
PREVIOUS_MIGRATION_COUNT = 15
NEW_MIGRATION_ID = 20260901062000_add_forum_lifecycle_storage
TOTAL_MIGRATION_COUNT = 16
MIGRATION_LINEAGE = SERIAL
NEW_TABLES = 1
NEW_RUNTIME_READERS = 0
NEW_RUNTIME_WRITERS = 0
BACKFILLED_ROWS = 0
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
AUTHORITY_SWITCH = NO
```

The candidate adds the empty `ForumThreadRevision` /
`public.forum_thread_revisions` model and binds it to the already merged
nullable lifecycle columns on Thread and Message. It installs:

- `SQL-041`: closed `open` / `resolved` revision shape;
- `SQL-042` and `SQL-043`: monotonic current-revision pointer guard;
- `SQL-044` and `SQL-045`: exact revision-insert sequencing guard;
- `SQL-046`: validated composite Thread pointer-to-Revision foreign key;
- `SQL-047` and `SQL-048`: standalone, partial concurrent indexes.

Prisma 5.22 executes migration files in a transaction, while PostgreSQL
rejects `CREATE INDEX CONCURRENTLY` in a transaction. Therefore SQL-047/048 are
installed and exact-shape verified by the idempotent post-migrate script
`scripts/apply-lifecycle-indexes.mjs`; both the package migration command and
container entrypoint run that step after `prisma migrate deploy`.

The adopted design registry spells SQL-048's legacy physical target as
`forum_thread_messages(thread_id, discussion_revision)`. Merged schema and every
merged migration physically use `forum_messages("threadId", discussion_revision)`.
The candidate preserves the stable SQL-048 object name and query purpose while
binding the index to those actual physical identifiers. No legacy column or
table rename is introduced.

Candidate artifact hashes:

```text
PRISMA_SCHEMA_SHA256 = 664c4b7aa5fbbd39d4c85b403910a615324b8ea1e9d4c452f3a017ca193290b8
LIFECYCLE_MIGRATION_SHA256 = 0c1aec1da05768a944aa172c54ab6fc798dee481302f068420b61ec0d221ecfa
CIC_INSTALLER_SHA256 = 95fd88867a60c8a9e52f17ee8db62d5353d0b95b5a153139d9673013dd9dde2f
LIFECYCLE_VERIFIER_SHA256 = 693449836f1ba1c7fb4ea8060343813cc83badb3225f402be409f0c903fd495c
ENTRYPOINT_SHA256 = 74d852f7a43f07bcbb6c46f381edb17d1b69eb148fe3dbe4662985c5a3e96c9c
PACKAGE_JSON_SHA256 = 7fa5e53f1c93b1b46f78e136a63fb8ee09f028519f97439640123d2f51577306
```

## 3. Database verification

All mutation probes ran only against disposable PostgreSQL databases. One run
started empty; the other started from an isolated `pg_dump` copy of the current
local runtime database. Both temporary databases were dropped after the run.
The real runtime database was read only for snapshot creation and inventory.

```text
CLEAN_DB_APPLY = PASS (all 16 migrations)
CURRENT_SNAPSHOT_APPLY = PASS (runtime 11 -> repository 16)
SNAPSHOT_THREADS_BEFORE_AFTER = 90 / 90
SNAPSHOT_MESSAGES_BEFORE_AFTER = 610 / 610
REVISION_ROWS_AFTER_APPLY = 0
NON_NULL_THREAD_LIFECYCLE_ROWS_AFTER_APPLY = 0
NON_NULL_MESSAGE_REVISION_ROWS_AFTER_APPLY = 0
SECOND_DEPLOY_NOOP = PASS
SQL_041_REVISION_SHAPE = PASS
SQL_042_043_POINTER_GUARD = PASS
SQL_044_045_INSERT_GUARD = PASS
SQL_046_COMPOSITE_FK = PASS
SQL_047_048_CIC_FORWARD_REPAIR = PASS
LIFECYCLE_STORAGE_PHASE_2 = PASS
DISPOSABLE_DATABASES_REMAINING = 0
```

Negative probes confirmed SQLSTATE `23514` for invalid lifecycle shape,
non-initial/jumping/decreasing/cleared revisions and SQLSTATE `23503` for
missing Thread/Principal/pointer references. The valid sequence
`revision 1 -> pointer 1 -> revision 2 -> pointer 2` passed. All verifier data
was rolled back. Both concurrent indexes were dropped and recreated outside a
transaction, then rechecked as valid and ready.

### 3.1 Independent re-verification on 2026-09-01

A separate execution agent re-ran every database claim from scratch against
freshly created disposable databases; no result above was copied forward.

```text
REVERIFIED_AT = 2026-09-01
CLEAN_DB_APPLY = PASS (16/16 migrations, all finished)
CLEAN_DB_PRECONDITION = role forum_app pre-created (base-main migration
  20260823162405 GRANTs TO forum_app; the live database already has the role;
  first attempt without the role fails with SQLSTATE 42704, which is a
  base-main property, not a candidate defect)
CLEAN_DB_INSTALLER = PASS (exit 0; SQL-047/SQL-048 READY)
CLEAN_DB_VERIFIER = PASS (exit 0; 28 PASS lines)
CURRENT_SNAPSHOT_APPLY = PASS (runtime 11 -> repository 16; 5 migrations applied)
SNAPSHOT_THREADS_BEFORE_AFTER = 90 / 90
SNAPSHOT_MESSAGES_BEFORE_AFTER = 610 / 610
SNAPSHOT_REVISION_ROWS_AFTER_APPLY = 0
SNAPSHOT_NON_NULL_THREAD_LIFECYCLE_ROWS = 0
SNAPSHOT_NON_NULL_MESSAGE_REVISION_ROWS = 0
SNAPSHOT_TABLE_COUNT_VS_LIVE = all 10 pre-existing public tables identical
  (context_snapshots 0, messages 610, outcomes 0, participants 392,
  principals 100, reactions 0, reports 0, thread_views 83, threads 90);
  _prisma_migrations 11 -> 16 is the only pre-existing-table delta
SNAPSHOT_NEW_TABLES_ALL_EMPTY = YES (13 new additive tables, 0 rows each,
  including forum_thread_revisions)
SNAPSHOT_THREADS_CONTENT_MD5_LIVE_VS_UPGRADED = 89cea438a3bc5f694fbb3b37d0ca87b5 (identical)
SNAPSHOT_MESSAGES_CONTENT_MD5_LIVE_VS_UPGRADED = c1ed0b39722001903c903cfe77ab7375 (identical)
SECOND_DEPLOY_NOOP = PASS ("No pending migrations to apply")
SECOND_INSTALLER_IDEMPOTENT = PASS (exit 0, both indexes already exact)
SQL_041_REVISION_SHAPE = PASS
SQL_042_043_POINTER_GUARD = PASS
SQL_044_045_INSERT_GUARD = PASS
SQL_046_COMPOSITE_FK = PASS
SQL_047_048_CIC_FORWARD_REPAIR = PASS
LIFECYCLE_STORAGE_PHASE_2 = PASS
DISPOSABLE_DATABASES_REMAINING = 0
```

The re-verification used one empty disposable PostgreSQL 16 container
(`lifecycle-empty-pg-r1`, 127.0.0.1:55201) and one snapshot container
(`lifecycle-snap-pg-r1`, 127.0.0.1:55202) holding two databases: the upgraded
`forum_snap` and the second isolated copy `forum_old` used by the §4 old-image
run. The verifier was invoked with `LIFECYCLE_STORAGE_DATABASE_URL` without a
`?schema=public` suffix because psql rejects that Prisma-only query parameter.
All containers, databases, dump files, and the temporary env file were removed
afterwards; the live service stayed on `svc-forum:502cfca` with 11 migrations,
90 threads, 610 messages, and `/api/health` = 200 throughout.

## 4. Old-application compatibility

The currently running image `svc-forum:502cfca` was started unchanged against a
second isolated copy of the 90-Thread / 610-Message runtime database, with only
the candidate migration directory, post-migrate installer, and entrypoint
mounted read-only. This is compatibility evidence, not a deployment.

```text
OLD_APPLICATION_IMAGE = svc-forum:502cfca
OLD_APPLICATION_COMPATIBILITY = PASS
OLD_APPLICATION_HEALTH = 200 / db connected
MIGRATIONS_AFTER_START = 16
THREADS_AFTER_START = 90
MESSAGES_AFTER_START = 610
REVISION_ROWS_AFTER_START = 0
SQL_047_INDISVALID_INDISREADY = true / true
SQL_048_INDISVALID_INDISREADY = true / true
LIFECYCLE_CIC_INDEXES = READY
TEMP_CONTAINER_REMOVED = YES
TEMP_DATABASE_REMOVED = YES
```

### 4.1 Independent re-verification on 2026-09-01

The same compatibility scenario was re-run unchanged: the old image started
against the second isolated copy (`forum_old`, restored from a fresh read-only
`pg_dump` of the live runtime database, 11 migrations / 90 / 610) with only the
candidate migration directory, installer, and entrypoint mounted read-only.
The bind-mounted entrypoint was a byte-identical executable copy (sha256
`74d852f7a43f07bcbb6c46f381edb17d1b69eb148fe3dbe4662985c5a3e96c9c`, equal to
ENTRYPOINT_SHA256) because the repository stores the file mode 100644 while
the image builds it with `chmod +x`.

```text
OLD_APP_REVERIFIED_AT = 2026-09-01
OLD_APP_ENTRYPOINT_LOG = migrate deploy 11 -> 16 applied, then SQL-047/SQL-048
  installed on attempt 1, then app start
OLD_APP_HEALTH = HTTP 200, {"ok":true,"service":"svc-forum","db":"connected"}
OLD_APP_AUTHENTICATED_READ = NOT_RUN (GET /api/threads returns 401 without
  credentials, which is expected baseline behavior, not a compatibility failure)
MIGRATIONS_AFTER_START = 16
THREADS_AFTER_START = 90
MESSAGES_AFTER_START = 610
REVISION_ROWS_AFTER_START = 0
SQL_047_INDISVALID_INDISREADY = true / true
SQL_048_INDISVALID_INDISREADY = true / true
TEMP_CONTAINER_REMOVED = YES (lifecycle-old-app-r1)
TEMP_DATABASE_REMOVED = YES (forum_old dropped with its container)
```

## 5. Source verification and unresolved gates

Results below are the 2026-09-01 independent re-run in the lifecycle
worktree (`svc-forum` dependencies installed with `npm ci --ignore-scripts`;
the worktree ships no `.env`, so `prisma validate` received a placeholder
`DATABASE_URL`).

```text
prisma validate = PASS (exit 0, "The schema at prisma/schema.prisma is valid")
prisma generate = PASS (Prisma Client v5.22.0)
typecheck = PASS (tsc --noEmit, exit 0)
tests = PASS (294 / 294, 0 fail, 0 skipped)
governance verify = PASS (verify_governance.py --target .: "vendored
  governance bytes match governance.lock.json")
git diff --check = PASS (staged and unstaged)
RUNTIME_SOURCE_FILES_CHANGED = NO
ARCH_HEALTH_CHECK = FAIL (exit 12; pre-existing main baseline; the tool scans
  only svc-forum/src/*.ts, which this candidate does not touch)
DOCKER_BUILD = NOT_ATTEMPTED_THIS_ROUND (Docker Desktop DNS for deb.debian.org
  still unavailable; per task boundary no docker build was attempted)
```

The architecture health check reports existing magic-value and direct-Prisma
route violations already present in exact `origin/main`; this candidate changes
no file under `svc-forum/src/`, so it neither resolves nor expands that baseline
debt. The Docker build stopped during the base image's `apt-get update` because
Docker Desktop could not resolve `deb.debian.org`, before project source was
built. The old-image smoke above separately exercises the changed entrypoint,
migration, and standalone installer path.

The live local service remains `svc-forum:502cfca`, has only 11 applied
migrations, and does not contain the new audit/identity/subscription/lifecycle
storage. No deployment, migration, restart, real authenticated write, or real
identity smoke was performed against it.

## 6. WORKFLOW_GATE_DISPOSITION (Owner-authorized, 2026-09-01)

This section records the formal disposition of the repository workflow gate
for this freeze round. It is an Owner-authorized emergency-seam use of the
documented channel, not a silent bypass.

- L1 commit-msg hook 要求 workflow: <uuid>；正式获取通道（openclaw auth-broker / workflow_execute Broker 工具）已随 2026-08-31 Owner 决策迁移至 deepseek harness 而退役；svc-workflow 最后一个实例创建于 2026-08-18；本仓库自 PR #10 起（ci-gate 合并于 90e00a1 之后）所有已合并 feature commit 均无 workflow trailer；L0 workflow-gate.yml 未部署（main 无 .github、branch protection NOT_CONFIGURED）。
- 处置：按 docs/ci-gate-guide.md Q1 文档化的紧急通道提交（git --no-verify），不伪造任何 UUID，PR 正文显式披露，待新 harness 提供实例创建路径后按 L2 补录。

```text
GATE_DISPOSITION_AUTHORIZED_AT = 2026-09-01 (Owner decision recorded in the
  task authorization for this freeze round)
COMMIT_COMMAND = git commit --no-verify
UUID_FABRICATED = NO
PR_DISCLOSURE = YES (PR body carries a dedicated Workflow gate disclosure
  section)
L2_BACKFILL_COMMITMENT = YES (once the new harness provides a workflow
  instance creation path, a valid workflow: <uuid> will be backfilled per the
  documented L2 procedure)
```

## 7. Disposition and sequencing

The repository's L1 commit gate rejected the candidate commit because no real
svc-workflow instance UUID was available for the required
`workflow: <36-character UUID>` trailer. No ID was invented. On 2026-09-01 the
Owner formally authorized the documented emergency channel (section 6 above),
so the freeze-round commit uses `git --no-verify`, discloses this in the PR
body, and commits to the L2 backfill. This remains a packaging/traceability
precondition; it is not counted as a Forum product defect or used to change
Forum design.

```text
IMPLEMENTATION_COMPLETE = YES (candidate scope only)
INDEPENDENT_REVERIFICATION = YES (2026-09-01, section 3.1/4.1/5; the auditor
  is a different agent and must still perform its own fixed-SHA audit)
FIXED_SHA_AVAILABLE = YES (in the PR head; recorded as LIFECYCLE_FIXED_HEAD)
FIXED_SHA_PRECONDITION = resolved via the Owner-authorized emergency seam
COMMIT_GATE_BYPASSED = YES_VIA_DOCUMENTED_EMERGENCY_SEAM (see section 6;
  no UUID fabricated; disclosed in PR; L2 backfill committed)
INDEPENDENT_AUDIT_COMPLETE = NO
MERGED_TO_MAIN = NO
MIGRATED_RUNTIME = NO
RUNTIME_SMOKE_COMPLETE = NO
GOAL_COMPLETE = NO
MERGE_ALLOWED = NO (until independent fixed-SHA audit accepts the candidate)
NEXT_PRODUCT_TASK = 状态 审计 (fixed SHA is now available in the PR)
NEXT_SCHEMA_WORKSTREAM = NONE until this candidate is audited and merged
AFTER_MERGE_NEXT_SCHEMA_WORKSTREAM = 评审 执行
```

No reviewer identity is asserted by this record. No password, token,
Authorization header, secret, or raw sensitive legacy row is stored here.
