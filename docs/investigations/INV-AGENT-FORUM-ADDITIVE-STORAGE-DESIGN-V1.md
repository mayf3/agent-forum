```text
INVESTIGATION_ID =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Phase 2 additive schema/storage and audit tooling design

OWNER =
mayf3

DISPOSITION =
open

INVESTIGATION_RESULT =
ready_for_independent_review

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_CORE_INVARIANTS_V1

MIGRATION_POLICY =
INV-AGENT-FORUM-MIGRATION-OPTION-C-V1

SOURCE_COMMIT =
fc384870df10fcf863ca651e73efbb5d5277bed9

AUTHORITY_CHANGE_PROPOSED =
NO

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Additive Storage Design Investigation V1

```text
REPORT_ID =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

REPOSITORY =
mayf3/agent-forum

TASK_NAME =
存储 调查

TASK_TYPE =
调查

PRIOR_AUDIT_RESULT =
STORAGE_DESIGN_REVIEW = REVISE

PRIOR_AUDIT_REVIEWER =
AF-STORAGE-AUDIT-R7
```

## 1. Executive summary

本次修订调查已在全新 detached worktree、唯一固定 commit 上完成。accepted Core Invariants 已覆盖全部设计决策，Option C 已关闭历史数据处理政策，不存在新的 Spec 或 Owner gap。

结论：

1. Phase 2 additive schema/storage 可以开始，但必须先持久化本报告并通过后续独立存储审计。
2. `BLOCKER-ENV-001` 不阻止 Phase 2 创建空表、nullable FK、约束、索引和审计工具。
3. `BLOCKER-ENV-001` 继续阻止 backfill、production-shaped validation、cutover 和 cleanup。
4. Phase 2 不写入任何 canonical authority fact，不导入 185 条 quarantine 记录，不启用新读写路径。
5. Option C 的 91 个 collision group、1 个 unresolved Participant、2 个 lifecycle unknown 和历史 Review 缺口均已获得关闭政策；它们只约束以后 backfill。
6. 推荐采用：
   - 独立 Participation、Watch interval、Read State；
   - Thread Revision；
   - Requirement + 单一 Resolution 表；
   - Finalization 内嵌唯一 authoritative Outcome；
   - Thread/Message 两个强类型 Tombstone；
   - append-only Audit；
   - 五个 Migration evidence/quarantine 模型。
7. 不建议将全部 Phase 2 结构塞入一个“存储 执行”大 PR。首个实施任务应为 **基座 执行**。

```text
SPEC_GAP_COUNT = 0
OWNER_DECISIONS_REQUIRED = 0
STORAGE_DESIGN_STATUS = READY
REPORT_READY_TO_PERSIST = YES
PHASE_2_EXECUTION_ALLOWED = YES

BACKFILL_ALLOWED = NO
DUAL_READ_ALLOWED = NO
DUAL_WRITE_ALLOWED = NO
CUTOVER_ALLOWED = NO
```

---

## 2. Correct exact coordinates

```text
EXPECTED_MAIN =
fc384870df10fcf863ca651e73efbb5d5277bed9

REMOTE_MAIN_AT_START =
fc384870df10fcf863ca651e73efbb5d5277bed9

START_COMMIT_FACT =
fc384870df10fcf863ca651e73efbb5d5277bed9

END_COMMIT_FACT =
fc384870df10fcf863ca651e73efbb5d5277bed9

WORKTREE =
../.worktrees/agent-forum-storage-investigation-v2

WORKTREE_CREATED = YES
WORKTREE_REUSED = NO
COMMIT_SWITCH_OCCURRED = NO
EVIDENCE_COLLECTED_ON_SINGLE_COMMIT = YES
```

源码、Schema、migration 和测试证据均取自上述 commit。

本地 PostgreSQL catalog 仅用于验证当前物理类型和 DDL 可行性：

```text
POSTGRES_VERSION = 16.14
LOCAL_DATASET = local-only
PG_DUMP_SCHEMA_ONLY = /tmp/agent-forum-storage-v2-schema.sql
DATABASE_WRITES = 0
```

该本地数据库绑定旧部署，不被当作当前 source commit 或 production 数据形态。

权威和输入：

- `docs/product/agent-forum-product-direction-v1.md`
- `docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md`
- `docs/investigations/INV-AGENT-FORUM-MIGRATION-OPTION-C-V1.md`
- `docs/investigations/reports/RPT-AGENT-FORUM-INVENTORY-V1.md`
- `docs/investigations/reports/RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1.md`
- 上一版《Agent Forum 存储设计调查报告》
- `AF-STORAGE-AUDIT-R7` 的 `REVISE` 裁决

---

## 3. Governance and Option C gate

治理验证：

```text
PREFLIGHT_MODE = REUSE
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
AUTHORITY_CONFLICT = NONE
SPEC_GAP_COUNT = 0
OWNER_DECISIONS_REQUIRED = 0
```

执行命令：

```bash
python3 .agents/tools/verify_governance.py \
  --target . \
  --require-accepted
```

结果：

```text
vendored governance bytes match governance.lock.json
and adoption is accepted
```

### 3.1 Option C 固定政策

| 事项 | 已采纳政策 | Phase 2 gate |
|---|---|---|
| 91 个 Participant collision group、182 行 | `PROVEN_FIELDS_ONLY`; 冲突字段 `QUARANTINE` | NO |
| 1 条 unresolved Participant | `QUARANTINE`; 禁止 synthetic Principal | NO |
| 2 条 archived lifecycle unknown | visibility=archived；discussion=`legacy_unknown` 只进 evidence/quarantine | NO |
| 历史 Review 缺口 | `NONE_PROVEN`; 禁止历史 Review backfill | NO |

```text
PARTICIPANT_COLLISION_POLICY = PROVEN_FIELDS_ONLY
CONFLICTING_FIELDS_POLICY = QUARANTINE
UNRESOLVED_PARTICIPANT_POLICY = QUARANTINE
SYNTHETIC_PRINCIPAL_ALLOWED = NO
HISTORICAL_REVIEW_REQUIREMENTS = NONE_PROVEN
HISTORICAL_REVIEW_BACKFILL_ALLOWED = NO

POLICY_DECISION_REOPENED = NO
OPTION_C_GATE_REVIEW = PASS
```

`legacy_unknown` 不进入正常运行时 `open | resolved` enum；它只能存在于 Migration evidence/quarantine。

当前观察的 `185` 是数据证据数量，不得编码为 Schema 常量、CHECK 或 migration 预期固定值。

---

## 4. Environment gate semantics

```text
BLOCKER-ENV-001 =
OPEN_FOR_FUTURE_BACKFILL_VALIDATION_AND_CUTOVER

BLOCKER_ENV_001_GATES_PHASE_2 = NO
BLOCKER_ENV_001_GATES_BACKFILL = YES
BLOCKER_ENV_001_GATES_PRODUCTION_SHAPED_VALIDATION = YES
BLOCKER_ENV_001_GATES_CUTOVER = YES
BLOCKER_ENV_001_GATES_CLEANUP = YES
```

Phase 2 可以：

- 创建空表；
- 添加 nullable、无默认值的列；
- 添加不改变旧路径的 FK/CHECK/UNIQUE/INDEX；
- 添加 migration evidence、quarantine 和 audit 结构；
- 在隔离数据库验证 migration；
- 验证旧应用在新空结构存在时继续运行；
- 设计并演练应用回退。

Phase 2 禁止：

```text
BACKFILL = NO
DUAL_READ = NO
DUAL_WRITE = NO
AUTHORITY_SWITCH = NO
CUTOVER = NO
DESTRUCTIVE_CLEANUP = NO
```

所有新业务表在 Phase 2 apply 后必须为空；所有现有行上的新增 nullable 列必须保持 `NULL`。

---

## 5. Complete current storage map

记号：

- `NN`：NOT NULL
- `NULL`：可空
- `D=`：数据库默认
- 当前 `DateTime` 物理类型为 `timestamp without time zone`
- Prisma `@default(uuid())` 与 `@updatedAt` 主要由 Prisma Client 提供，不等于数据库默认

### 5.1 九模型总表

| MODEL / TABLE | COLUMNS_AND_DB_TYPES / NULLABILITY / DEFAULTS | PK / UNIQUE / INDEX | FK / ON DELETE | READERS / WRITERS / TESTS | CURRENT_SEMANTICS / GAPS |
|---|---|---|---|---|---|
| `ForumThread` / `forum_threads` | `id uuid NN`; `title text NN`; `type text NN D='discussion'`; `status text NN D='open'`; `contextType/contextId/pipeline/layer text NULL`; `tags text[] NULL D=[]`; `pinned/featured bool NN D=false`; `messageCount/viewCount int NN D=0`; `lastMessageAt timestamp NULL`; `createdById/createdByName text NN`; `createdByType text NN D='agent'`; `createdAt timestamp NN D=now`; `updatedAt timestamp NN`; `resolvedAt timestamp NULL`; `resolvedById/resolvedByName text NULL` | PK `id`; indexes `status`, `type`, `(contextType,contextId)`, `pipeline`, `lastMessageAt`, `pinned`, `featured`, `viewCount`; no business unique | 无 outbound FK | Readers：`findThreadById`, `findThreads`, `heatScore`, `getForumStats`, `getTagStats`, `searchAll`, `getThreadReviewReadiness`, `buildTranscriptMd`, notification/report/observer routes。Writers：`createThread`, `updateThread`, `softDeleteThread`, `createMessage`, `recordView`, resolve/archive routes。Tests：`forum`, `thread-filter`, `tags`, `views-hot`, `observer`, `search`, `thread-id-validation` | `status` 混合 discussion/visibility；creator 无 FK/immutable guard；resolve 非原子；archive 覆盖 discussion state；删除无 actor/reason；派生 counter 可漂移；无 revision/finalization |
| `ForumThreadParticipant` / `forum_participants` | `id uuid NN`; `threadId uuid NN`; `agentId/agentName text NN`; `role text NN D='member'`; `status text NN D='invited'`; `lastReadAt timestamp NULL`; `joinedAt timestamp NN D=now`; `leftAt timestamp NULL`; `reviewWaivedAt timestamp NULL`; `reviewWaivedById/reviewWaiverReason text NULL` | PK `id`; UNIQUE `(threadId,agentId)` | `threadId→Thread`, CASCADE | Readers：`findParticipant`, `findParticipantsByThreadId`, readiness, transcript, notifications, stats/filter。Writers：participant CRUD、watch/unwatch/read、`autowatchThread`、waive。Tests：`forum`, `awareness`, `review-readiness`, `principal`, `admin-notifications` | 一行混合 presentation、Watch、Read、Review；`agentId` 命名空间混乱；unwatch 会移除 reviewer；role 可伪装 moderator；无来源与 revision |
| `ForumThreadMessage` / `forum_messages` | `id uuid NN`; `threadId uuid NN`; `parentId uuid NULL`; `seq int NN`; `authorId/authorName text NN`; `authorType text NN D='agent'`; `kind text NN D='comment'`; `content text NN`; `mentions text[] NULL D=[]`; `attachments/metadata jsonb NULL`; `editedAt/deletedAt timestamp NULL`; `createdAt timestamp NN D=now` | PK `id`; indexes `(threadId,seq)`, `(threadId,createdAt)`, `authorId`, `kind`, `parentId`; `(threadId,seq)` 非唯一 | `threadId→Thread`, CASCADE；无 parent/author/mention FK | Readers：message list、review、transcript、search、notifications、report/reaction target。Writers：`createMessage`, `softDeleteMessage`。Tests：`forum`, `awareness`, `review-readiness`, `search`, `observer`, `reactions`, `reports` | author 无 FK；seq 有竞态；Mention 为 alias 数组；删除无 actor/reason 且不修复派生状态；无 revision/explicit response |
| `ForumThreadView` / `forum_thread_views` | `id uuid NN`; `threadId uuid NN`; `principal_id text NN`; `viewed_at timestamp NN D=now` | PK `id`; UNIQUE `(threadId,principal_id)`；index `threadId` | `threadId→Thread`, CASCADE | `recordView` 唯一读写；detail GET fire-and-forget 调用；`views-hot.test.ts` | principal 无 FK；GET 隐式写；异常吞掉导致 row/count 漂移；`viewCount` 是缓存 |
| `ForumPrincipal` / `forum_principals` | `id uuid NN`; `auth_subject text NN`; `principalType text NN D='agent'`; `agent_id text NULL`; `displayName text NULL`; `source text NN D='jit'`; `status text NN D='active'`; `first_seen_at/last_seen_at/createdAt timestamp NN D=now`; `updatedAt timestamp NN` | PK `id`; UNIQUE `auth_subject`; UNIQUE nullable `agent_id`; indexes `status`,`principalType` | 无 | Readers：principal lookup/resolution/notifications。Writers：JIT `resolvePrincipal`, `disablePrincipal`。Tests：`principal`, OAuth integration, migration smoke | 当前 canonical identity 基础可保留；但其他 actor 字段均无 FK；alias 永久占用历史未单独表达；status/type/source 自由文本 |
| `ForumOutcome` / `forum_outcomes` | `id uuid NN`; `threadId uuid NN`; `summaryMd text NN`; `decisionsJson/actionItemsJson/rejectedOptionsJson/openQuestionsJson jsonb NULL`; `writebackTargetType/writebackTargetRef text NULL`; `createdById/createdByName text NN`; `createdAt timestamp NN D=now`; `updatedAt timestamp NN` | PK `id`; index `threadId`;无唯一 revision/finalization | `threadId→Thread`, CASCADE | Readers：`findOutcomesByThreadId`, `findLatestOutcomeByThreadId`, search/transcript。Writer：direct Outcome route、resolve route。Tests：`forum`, `review-readiness`, `search` | 可绕过 Finalization；多行“latest”权威；actor 无 FK；无 revision、idempotency、immutability、review snapshot |
| `ForumContextSnapshot` / `forum_context_snapshots` | `id uuid NN`; `threadId uuid NN`; `snapshotType text NN D='thread_creation'`; `sourceType/sourceRef/title text NN`; `excerptMd/contentHash text NULL`; `snapshot jsonb NULL`; `takenById/takenByName text NN`; `takenAt timestamp NN D=now`; `note text NULL` | PK `id`; indexes `threadId`, `(sourceType,sourceRef)` | `threadId→Thread`, CASCADE | Readers：snapshot list/transcript；writer：`createContextSnapshot`；routes `context-snapshots`；tests `forum` | actor 无 FK；无 revision；任意 writer 可写；source/hash 无完整性/immutability |
| `ForumReport` / `forum_reports` | `id uuid NN`; `target_type text NN`; `target_id uuid NN`; `reporter_id/reporter_name/reason text NN`; `note text NULL`; `status text NN D='pending'`; `handled_by_id/handled_by_name/handled_at/handle_note NULL`; `created_at timestamp NN D=now`; `updated_at timestamp NN` | PK `id`; UNIQUE `(target_type,target_id,reporter_id)`；indexes `status`, `(target_type,target_id)` | 无 target/principal FK | Readers：`assertReportTargetExists`, `findReports`, `findReportById`；writers：`createReport`, `handleReport`；tests `reports` | target 多态无 FK；actor 无 FK；enum 自由；delete action 与 target tombstone 非原子 |
| `ForumReaction` / `forum_reactions` | `id uuid NN`; `message_id/thread_id uuid NN`; `principal_id/principal_name/emoji text NN`; `created_at timestamp NN D=now` | PK `id`; UNIQUE `(message_id,principal_id,emoji)`；indexes `message_id`,`thread_id` | `message_id→Message`, CASCADE | Readers：reaction summary/message include/notifications；writers：`addReaction`,`removeReaction`；tests `reactions` | principal 无 FK；`thread_id` 可与 message 不一致；remove 未真正使用 route thread；无 lifecycle gate；emoji 自由文本 |

### 5.2 当前数据规模

| 表 | 当前本地行数 | relation size |
|---|---:|---:|
| `forum_threads` | 90 | 221,184 B |
| `forum_participants` | 389 | 229,376 B |
| `forum_messages` | 607 | 1,687,552 B |
| `forum_thread_views` | 79 | 98,304 B |
| `forum_principals` | 90 | 155,648 B |
| 其余四表 | 0 | 24–82 KB |

这些数值只用于本地 DDL 风险基线，不代表目标环境。

---

## 6. Complete field-level usage map

`CURRENT_FIELDS_MAPPED = 26`

| FIELD | READ_LOCATIONS / ROUTES / FUNCTIONS | WRITE_LOCATIONS / FUNCTIONS | TESTS | AUTHORITY / LIFECYCLE / DERIVED EFFECT | TARGET_REPLACEMENT | PHASE 2 / BACKFILL |
|---|---|---|---|---|---|---|
| `Thread.status` | `findThreads`, message/report/search/notifications/stats/transcript；thread/message/report routes | `softDeleteThread`; resolve/archive routes; generic `updateThread` | `forum`, `thread-filter`, `reports`, `search` | 混合 open/resolved/archived/deleted | `visibilityState` + `ThreadRevision.discussionState` | 加 nullable 列；不填值；BF 依 Option C |
| `Thread.createdById` | creator comparison、waiver、routes、transcript | `createThread`, thread POST | `forum`, `forum-writer`, `observer` | creator authority | `creatorPrincipalId UUID FK` | nullable；deterministic BF |
| `Thread.resolvedAt` | transcript/observer | resolve route | `forum`, `observer` | 旧 resolved metadata | `ThreadRevision.resolvedAt`、Finalization | 新结构空；legacy BF |
| `Thread.resolvedById` | inventory/actor attribution | resolve route | `forum` | finalizer attribution | `ThreadRevision.resolvedByPrincipalId` / Finalization actor | nullable；deterministic BF only |
| `Thread.messageCount` | list/stats/heat/transcript/observer | `createMessage` | `forum`, `views-hot` | derived projection | 保留为可重建 cache | Phase 2 不改；删除 runtime 后事务修复 |
| `Thread.lastMessageAt` | list/notifications/heat/observer | `createMessage` | `forum`, `awareness` | derived projection/read baseline | 可重建 visible-message projection | Phase 2 不改 |
| `Participant.agentId` | participant lookup/filter/readiness/notifications | thread/participant create、autowatch/watch | `awareness`,`review-readiness` | 当前同时是 alias/principal/target key | 新表 `principalId UUID FK` | 不改旧列；Option C BF |
| `Participant.role` | readiness/transcript/waiver moderator check | body create/PATCH | `review-readiness`,`forum` | 错误承载 review/moderator authority | `Participation.presentationRole`；Requirement 独立 | 新空表；禁止按 role 补造 Review |
| `Participant.status` | transcript/observer | create/PATCH/autowatch | `forum`,`awareness` | presentation 与参与状态混合 | `Participation.presentationStatus` | 冲突允许 unknown |
| `Participant.lastReadAt` | notification baseline | mark/batch/PATCH read | `awareness`,`admin-notifications` | unread authority | `ForumReadState` | known/unknown；禁止取较新冲突值 |
| `Participant.joinedAt` | notification baseline | create/autowatch/rewatch | `awareness` | 同时被当作 watch baseline | Participation display + Watch startedAt | 冲突为 unknown |
| `Participant.leftAt` | active participant/readiness/notifications | unwatch/softDelete/rewatch | `awareness`,`review-readiness` | unwatch 会影响 Review | Watch interval endedAt；Participation leftAt 仅 presentation | agreed current Watch 可 BF，来源 unknown |
| `reviewWaivedAt` | readiness/waive idempotency | waive route | `review-readiness` | Review evidence | `ReviewResolution(kind=waiver).resolvedAt` | 历史 BF 禁止 |
| `reviewWaivedById` | readiness/response | waive route | `review-readiness` | waiver actor | `resolvedByPrincipalId FK` | 历史 BF 禁止 |
| `reviewWaiverReason` | readiness/response | waive route | `review-readiness` | waiver reason | Resolution reason + non-empty CHECK | 历史 BF 禁止 |
| `Message.authorId` | review/transcript/notifications | `createMessage` from authenticated user | `forum-writer`,`observer`,`review` | authorship + review matching | `authorPrincipalId UUID FK` | nullable；deterministic BF |
| `Message.seq` | list/transcript/read cursor | `createMessage` max+1 | `forum`,`observer` | order/read cursor；当前有竞态 | UNIQUE `(threadId,seq)`；ReadState cursor | index initially; uniqueness later after validation |
| `Message.deletedAt` | all visible-message queries | `softDeleteMessage` | reports/search/review | incomplete tombstone | `ForumMessageTombstone` | 新表空；不改旧列 |
| `Outcome.threadId` | list/latest/search/transcript | direct/resolve create | `forum`,`search` | 多 Outcome 与 thread 绑定 | Finalization `(threadId,revision)` | legacy Outcome 保留非权威 |
| `Outcome.createdById` | inventory/display | direct/resolve create | `forum` | result actor | Finalization finalizer + nullable `createdByPrincipalId` legacy FK | additive nullable；deterministic BF |
| `Outcome.createdAt` | “latest”排序 | Prisma create | `forum` | 被误当权威选择器 | Finalization immutable `createdAt` + unique revision | 不再按时间选 authoritative |
| `ThreadView.principalId` | `recordView` dedup | `recordView` | `views-hot` | view identity | `viewerPrincipalId UUID FK` | additive nullable |
| `Reaction.principalId` | summary/notifications/remove | reaction routes | `reactions` | reaction actor | `actorPrincipalId UUID FK` | additive nullable |
| `Report.reporterId` | duplicate/report display | report create | `reports` | reporter actor | `reporterPrincipalId UUID FK` | additive nullable |
| `Report.handledById` | moderation trace | `handleReport` | `reports` | moderator actor | `handledByPrincipalId UUID FK` | additive nullable |
| `ContextSnapshot.takenById` | transcript/inventory | snapshot route/create helper | `forum` | snapshot actor | `takenByPrincipalId UUID FK` | additive nullable |

---

## 7. Complete 36-Contract storage matrix

缩写：

- `P2`：Phase 2 只建空结构/nullable 列
- `BF`：后续 deterministic backfill
- `RT`：后续 runtime/cutover 改造

| CONTRACT_ID | DURABLE FACT REQUIRED | CURRENT STORAGE / GAP | PROPOSED STORAGE + DB CONSTRAINT | TRANSACTION REQUIREMENT | P2 / BF / RT | ACCEPTANCE |
|---|---|---|---|---|---|---|
| `CTR-ID-001` | verified sub→唯一 Principal；所有 authority actor 为 Principal ID | Principal 存在，其他 actor 为 TEXT | canonical actor UUID FK；Audit actor FK | identity resolve 与 mutation/audit 同边界 | P2 nullable FK；BF deterministic；RT canonical-only | `ACC-ID-001` |
| `CTR-ID-002` | authSubject 1:1；Agent alias 永不重分配 | 当前 unique，无永久 alias ledger | `ForumPrincipalAlias`; UNIQUE(namespace,value)；owner immutable | alias conflict 原子 fail closed | P2 空 alias 表；BF proven aliases；RT resolver 使用 ledger | `ACC-ID-002` |
| `CTR-ID-003` | strict direct Agent token profile | middleware 有，storage 不足以验证 | Audit 保存 actor/sub/agent/client context；actor FK | auth 完成后才开 domain txn | P2 Audit 空表；RT strict verifier | `ACC-ID-001` |
| `CTR-ID-004` | disabled/conflict/unresolved fail closed | disabled 支持；历史 ambiguity 未结构化 | Migration evidence/quarantine；alias uniqueness | mutation 前 status/conflict check | P2 空 evidence；BF quarantine；RT authority reject | `ACC-ID-002` |
| `CTR-ID-005` | labels 非权威，audit 保留稳定/外部坐标 | labels 与 actor 混合 | actor FK + bounded Audit payload | mutation/audit 同事务 | P2 Audit schema；RT labels 仅展示 | `ACC-ID-001` |
| `CTR-AUTHZ-001` | auth+scope+object authority+lifecycle | 多 route 只有 scope | creator FK、Revision/visibility state | 锁内重检 authority/state | P2 结构；RT central guard | `ACC-AUTHZ-001` |
| `CTR-AUTHZ-002` | creator immutable | `createdById` TEXT，可泛写 | `creatorPrincipalId` FK；immutability trigger/later guard | creator check 与 mutation 同 txn | P2 nullable；BF proven；RT NOT NULL/authoritative | `ACC-AUTHZ-001` |
| `CTR-AUTHZ-003` | moderator 只来自 scope | participant role 曾授予 moderator | presentation role closed CHECK，无 authority column | scope check + audited mutation | P2 Participation；RT 移除 role authorization | `ACC-AUTHZ-001` |
| `CTR-AUTHZ-004` | nested target thread-bound；维度隔离 | participant by ID 可跨 thread | 分表；composite keys/FK；closed checks | route thread 下锁定目标 | P2 split tables；RT nested guards | `ACC-AUTHZ-002` |
| `CTR-AUTHZ-005` | Watch/Read 绑定 authenticated principal | Participant key 可接收外部 ID | Watch/Read `(thread,principal)` FK/unique | authenticated principal predicate/CAS | P2 空表；BF proven；RT self-service only | `ACC-AUTHZ-002` |
| `CTR-AUTHZ-006` | ordinary writes 仅 open+active | route lifecycle 检查不完整 | current Revision + visibility；closed CHECK | 同 txn state recheck | P2 lifecycle；RT operation matrix | `ACC-AUTHZ-001`,`ACC-LIFE-002` |
| `CTR-REVIEW-001` | Watch/Read/Participation/Review 独立 | 当前同一 Participant | 四个独立模型；无 cascade | 各命令只改自身维度 | P2 空表；BF Option C；RT split | `ACC-REVIEW-001` |
| `CTR-REVIEW-002` | stable revision-bound Requirement | role row，无 requirement ID | Requirement；UNIQUE(thread,revision,reviewer) | assignment idempotent，不物理删除 | P2 空表；历史 Review BF 禁止；RT endpoint | `ACC-REVIEW-001` |
| `CTR-REVIEW-003` | creator/moderator assignment 与时间边界 | 无 revision/requestedAt | Requirement exact actor/time/revision FKs | 锁 current open+active revision | P2 schema；RT authorized assignment | `ACC-REVIEW-002` |
| `CTR-REVIEW-004` | reviewer explicit response | 任意历史消息满足 | Resolution response kind；effective partial unique；guard trigger | lock requirement + verify actor/message/revision | P2 schema；历史 response BF 禁止；RT explicit response | `ACC-REVIEW-002` |
| `CTR-REVIEW-005` | generic activity不满足 | 当前 message search readiness | readiness 只查 effective Resolution | finalization locked snapshot | P2 Resolution；RT remove message inference | `ACC-REVIEW-002` |
| `CTR-REVIEW-006` | authorized reasoned waiver | Participant 三字段 | Resolution waiver kind；reason CHECK；effective mutual exclusion | lock pending req，authorize，insert resolution | P2 schema；历史 BF 禁止；RT waiver endpoint | `ACC-REVIEW-003` |
| `CTR-REVIEW-007` | reproducible readiness；删除前恢复 pending；Finalization snapshot immutable | 无 stable evidence/snapshot | Requirement+Resolution+Finalization.reviewSnapshot | deletion/finalization 各自单 txn | P2 schema；RT readiness/deletion repair | `ACC-REVIEW-001`,`ACC-REVIEW-004` |
| `CTR-LIFE-001` | open/resolved × active/archived/deleted × revision | free-form status | Revision state；Thread visibility/currentRevision；CHECK/FK | transition CAS/row lock | P2 nullable+empty Revision；BF proven only | `ACC-LIFE-001` |
| `CTR-LIFE-002` | content mutations only open+active | route checks不统一 | lifecycle predicate | 每次 mutation txn 内重检 | P2 indexes/state；RT all routes | `ACC-LIFE-002` |
| `CTR-LIFE-003` | archive 只改 visibility | archive 覆盖 status | `visibilityState`; Audit event | authorized conditional update | P2 nullable；BF archived visibility；RT archive/unarchive | `ACC-LIFE-001` |
| `CTR-LIFE-004` | only Finalization resolve；reopen +1 revision | split resolve，无 reopen | Revision+Finalization+new Requirements | resolve/reopen 各自单 txn | P2 schema；legacy unknown 不造 revision | `ACC-LIFE-001` |
| `CTR-LIFE-005` | deleted terminal，全普通 surface 404 | direct/search/nested 泄漏 | visibility+tombstones；terminal guard | delete txn；ordinary reads central filter | P2 structures；RT visibility cutover | `ACC-LIFE-001`,`ACC-DELETE-001` |
| `CTR-FINAL-001` | only creator/moderator finalizes，记录 actor/time | broad resolve | Finalization finalizer FK/time | authority check 与 finalization 同锁 | P2 empty table；RT endpoint | `ACC-FINAL-001` |
| `CTR-FINAL-002` | lock/version/readiness/outcome/state/audit 原子 | Outcome 与 Thread 两写 | Finalization inline Outcome；unique revision；review snapshot | 单 PostgreSQL transaction | P2 structures；RT atomic implementation | `ACC-FINAL-001` |
| `CTR-FINAL-003` | 每 revision 一个 immutable authoritative Outcome | 多 legacy Outcomes | Outcome 内嵌 Finalization；UNIQUE(thread,revision)；immutable trigger | 仅 Finalization txn 创建 | P2 empty；legacy Outcomes remain non-authoritative | `ACC-FINAL-001` |
| `CTR-FINAL-004` | idempotency/concurrency/stale conflict | 无 key/version unique | UNIQUE(thread,idempotencyKey)、semantic hash、revision unique | row lock/CAS；same-key hash compare | P2 constraints；RT 409 semantics | `ACC-FINAL-002` |
| `CTR-FINAL-005` | 无 alternate authority path | direct Outcome/status/helper | Finalization 是唯一 authority；legacy Outcome discriminator | presentation 只能引用 committed Finalization | P2 fields；RT disable alternate writes | `ACC-FINAL-003` |
| `CTR-DELETE-001` | reasoned moderator Thread tombstone | 只 status=deleted | typed ThreadTombstone；reason CHECK；actor FK；append-only | tombstone+visibility+audit 同 txn | P2 empty；RT delete endpoint | `ACC-DELETE-001` |
| `CTR-DELETE-002` | Message tombstone + derived repair | 只 deletedAt | typed MessageTombstone；reason CHECK；actor FK | hide/count/time/notification/review/audit 同 txn | P2 empty；RT delete implementation | `ACC-REVIEW-004`,`ACC-DELETE-002` |
| `CTR-DELETE-003` | ordinary 404；audited moderation access | alternate path 可恢复 | tombstone join/central scope + AuditEvent | moderation read audit，不改变 visibility | P2 schema；RT all surfaces | `ACC-DELETE-001` |
| `CTR-MIG-001` | immutable classification，不猜测 | repository reports，无 row-level persisted manifest | MigrationRun/LegacyEvidence/FieldDecision/Quarantine | inventory read-only；seal report immutable | P2 空结构；Phase 3 才写 deterministic/quarantine evidence | `ACC-MIG-001` |
| `CTR-MIG-002` | split Watch/Read/Participation/Review | Participant 混合 | independent tables + evidence links | idempotent per source row/field | P2 empty；BF only Option C safe facts | `ACC-MIG-002` |
| `CTR-MIG-003` | historical resolved/Outcome preservation | 当前本地无 resolved；模型缺 authority | Finalization provenance + legacy Outcome non-authority | legacy finalization atomic | P2 schema；BF later，unknown archived 不造 Finalization | `ACC-MIG-002` |
| `CTR-MIG-004` | fixed phase order、rollback seam | 未实施 | MigrationRun/status/ValidationResult；old schema retained | phase prerequisite checks | P2 additive only；Phase 3–6 later | `ACC-MIG-003` |
| `CTR-MIG-005` | persistent migration acceptance report | 未存在 | MigrationRun + ValidationResult + artifact references | report sealed after validation；cutover checks pass | P2 empty schema；Phase 4/5 populate/use | `ACC-MIG-003` |

```text
CONTRACTS_MAPPED = 36
```

---

## 8. Exact candidate models and columns

### 8.1 Conventions

- 新时间字段：`TIMESTAMPTZ(3)` / Prisma `DateTime @db.Timestamptz(3)`。
- ID：`UUID` / Prisma `String @db.Uuid`，由 Prisma 创建，不要求 `pgcrypto`。
- 权威/历史 FK 默认 `ON DELETE RESTRICT`。
- Phase 2 所有新表初始 0 行。
- 现有表新增列：nullable、无默认值；现有行保持 `NULL`。
- 运行时 closed state 使用 lowercase 文本 + CHECK，不使用 PostgreSQL enum，避免 enum DDL 扩展锁和 Prisma enum 漂移。
- `legacy_unknown` 不进入任何 runtime CHECK。

### 8.2 Existing-table additive columns

| MODEL | ADDITIVE COLUMN | PG / PRISMA | PHASE 2 |
|---|---|---|---|
| `ForumThread` | `creatorPrincipalId` | `uuid NULL` / `String? @db.Uuid` | 全部 NULL |
|  | `visibilityState` | `text NULL` / `String?` | 全部 NULL |
|  | `currentRevision` | `integer NULL` / `Int?` | 全部 NULL |
| `ForumThreadMessage` | `authorPrincipalId` | `uuid NULL` | 全部 NULL |
|  | `discussionRevision` | `integer NULL` | 全部 NULL |
| `ForumThreadView` | `viewerPrincipalId` | `uuid NULL` | 全部 NULL |
| `ForumOutcome` | `createdByPrincipalId` | `uuid NULL` | 全部 NULL |
|  | `authorityKind` | `text NULL` | 全部 NULL；不得默认 authoritative |
| `ForumContextSnapshot` | `takenByPrincipalId` | `uuid NULL` | 全部 NULL |
|  | `discussionRevision` | `integer NULL` | 全部 NULL |
| `ForumReport` | `reporterPrincipalId` | `uuid NULL` | 全部 NULL |
|  | `handledByPrincipalId` | `uuid NULL` | 全部 NULL |
| `ForumReaction` | `actorPrincipalId` | `uuid NULL` | 全部 NULL |

### 8.3 New candidate models

#### A. `ForumPrincipalAlias` → `forum_principal_aliases`

| Column | Type / Prisma | Null/default |
|---|---|---|
| `id` | UUID / `String @id @db.Uuid` | NN |
| `principalId` | UUID / relation | NN |
| `namespace` | TEXT | NN |
| `value` | TEXT | NN |
| `firstSeenAt` | TIMESTAMPTZ(3) | NN |
| `retiredAt` | TIMESTAMPTZ(3) | NULL |
| `createdAt` | TIMESTAMPTZ(3) | NN/default now |

- FK：principal `RESTRICT`
- UNIQUE：`(namespace,value)`
- CHECK：namespace=`auth_subject|agent_id`
- INDEX：`(principalId,namespace)`
- Immutability：namespace/value/principal owner 不可改；只允许 `retiredAt NULL→timestamp`
- Phase 2：0 行
- BF：只接受 one-to-one proven aliases
- Option C：unresolved 不插入；冲突进入 quarantine

#### B. `ForumParticipation` → `forum_participations`

字段：

```text
id uuid PK
thread_id uuid NN FK RESTRICT
principal_id uuid NN FK RESTRICT
presentation_role text NULL
presentation_status text NULL
joined_at timestamptz NULL
left_at timestamptz NULL
fact_state text NN              -- known | partial | unknown
provenance text NN              -- runtime | migration
legacy_evidence_id uuid NULL FK RESTRICT
created_at timestamptz NN default now
updated_at timestamptz NN
```

约束：

- UNIQUE `(thread_id,principal_id)`
- presentation 字段不产生 creator/moderator/Review 权力
- unknown/partial 时冲突字段允许 NULL
- Phase 2：0 行
- Option C：只投影一致字段；其余由 `MigrationFieldDecision` 记录 unknown/quarantine

#### C. `ForumWatchSubscription` → `forum_watch_subscriptions`

选择：**interval history**。

```text
id uuid PK
thread_id uuid NN FK RESTRICT
principal_id uuid NN FK RESTRICT
state text NN                    -- active | inactive
source text NN                   -- explicit | author | mention | migration | unknown
provenance text NN               -- runtime | migration
started_at timestamptz NULL
ended_at timestamptz NULL
legacy_evidence_id uuid NULL FK RESTRICT
created_at timestamptz NN default now
updated_at timestamptz NN
```

约束：

- active 必须 `ended_at IS NULL`
- inactive 必须 `ended_at IS NOT NULL`
- `started_at` 允许 NULL，用于 Option C 无法证明开始时间
- 每 `(thread,principal)` 最多一个 active interval：

```sql
CREATE UNIQUE INDEX forum_watch_subscriptions_one_active_uq
ON forum_watch_subscriptions(thread_id, principal_id)
WHERE state = 'active' AND ended_at IS NULL;
```

Option C：

- 当前 Watch active/inactive 只有在源行一致时才可后续 BF；
- source 使用 `unknown`，不能把“由 migration 创建”误写成历史 origin；
- `provenance='migration'` 表示写入来源，不表示 Watch origin。

#### D. `ForumReadState` → `forum_read_states`

推荐显式 `known|unknown`，不使用裸 nullable cursor 表示两种含义。

```text
thread_id uuid NN FK RESTRICT
principal_id uuid NN FK RESTRICT
state text NN                    -- known | unknown
last_read_seq integer NULL
last_read_at timestamptz NULL
provenance text NN               -- runtime | migration
legacy_evidence_id uuid NULL FK RESTRICT
updated_at timestamptz NN
PRIMARY KEY(thread_id,principal_id)
```

语义：

- `known + last_read_seq=0 + last_read_at=NULL`：可证明尚未读任何消息
- `known + seq>0`：必须有 `last_read_at`
- `unknown`：cursor 和 time 必须都为空
- cursor 单调前进由 CAS + defensive trigger 保证
- Option C 冲突 `lastReadAt` 为 unknown；禁止选择较新的 cursor

#### E/F. `ForumReviewResponse` 与 `ForumReviewWaiver`

最终推荐不建两个互斥表，而采用单一：

### `ForumReviewResolution` → `forum_review_resolutions`

```text
id uuid PK
requirement_id uuid NN
kind text NN                         -- response | waiver
reviewer_principal_id uuid NN
resolved_by_principal_id uuid NN
message_id uuid NULL
revision integer NN
semantic_key text NULL
reason text NULL
resolved_at timestamptz NN
invalidated_at timestamptz NULL
invalidated_by_message_tombstone_id uuid NULL
created_at timestamptz NN default now
```

Response 映射：

- `kind=response`
- `resolvedByPrincipalId=reviewerPrincipalId`
- `messageId` NN
- `reason` NULL

Waiver 映射：

- `kind=waiver`
- `messageId` NULL
- `reason` non-empty
- `resolvedByPrincipalId` 是 creator/moderator

约束：

- 同 Requirement 同时最多一个未 invalidated Resolution；
- Response 和 Waiver 因单表+partial unique 天然互斥；
- active genuine Response 存在时 Waiver insert 冲突；
- pre-finalization message deletion 使 response resolution `invalidatedAt` 非空，并把 Requirement 恢复 pending；
- post-finalization 删除不改写 Finalization snapshot。

##### E/F.1 Staged tombstone FK（B-FK-001 冻结）

`invalidated_by_message_tombstone_id` 是跨 workstream 依赖列，必须分两阶段落地：

**评审 执行阶段**（本表创建时）：

```text
- 仅创建 scalar 列 invalidated_by_message_tombstone_id uuid NULL；
- Prisma 不为该列建 relation；
- 不建任何数据库 FK；
- 初始值全部 NULL；
- 不启用任何 runtime writer（应用不得写该列）。
```

**删除 执行阶段**（`forum_message_tombstones` 创建之后）：

```sql
ALTER TABLE forum_review_resolutions
ADD CONSTRAINT forum_review_resolutions_invalidated_by_fk
FOREIGN KEY (invalidated_by_message_tombstone_id)
REFERENCES forum_message_tombstones(message_id)
NOT VALID;
```

随后执行 `VALIDATE CONSTRAINT`（DDL D20；registry SQL-073）。验收：评审 阶段该列存在、无 FK、可空；删除 阶段 FK 存在且 invalidation 负向测试通过（§17.2 评审/删除两行）。

##### E/F.2 Waiver 幂等（B-RW-001；CTR-REVIEW-006）

waiver 提交必须在同一事务内按固定顺序执行：

```text
FOR UPDATE Requirement
→ 查询当前 effective Resolution
→ 若存在且为同义 waiver（same reviewer + same normalized reason
  + same semantic request）→ 直接返回该 Resolution，不再 INSERT
→ 若存在且不同义（任何 response，或不同 reviewer/reason 的 waiver）→ 409
→ 若不存在 → INSERT waiver Resolution
```

同义判定使用 btrim + Unicode NFC 归一化后的 reason 比较。数据库层不承担幂等返回；`forum_review_resolution_guard` 第 5 步仅拒绝 INSERT（幂等返回在应用层于同一 `FOR UPDATE` 锁内完成，见 §9.1）。

##### E/F.3 Invalidation 一致性与授权（B-RW-001）

- 一致性 CHECK（并入 §9.1 shape CHECK）：

```text
(invalidated_at IS NULL) = (invalidated_by_message_tombstone_id IS NULL)
```

不允许只设置其中一个字段。

- 授权边界：effective response → invalidated response 的转换**只允许由 Message 删除事务**执行，机制为四层：
  1. equality CHECK 阻止无 tombstone 的单字段失效；
  2. staged FK（E/F.1）要求 tombstone 行真实存在；
  3. `forum_review_resolutions_invalidation_guard`（BEFORE UPDATE trigger，registry SQL-058/059）拒绝应用 role 直接 UPDATE invalidation 两列；
  4. 唯一合法路径是 SECURITY DEFINER 函数 `public.forum_invalidate_response(resolution_id, tombstone_id)`（registry SQL-074，B-SECDEF-001 加固），由删除事务调用，校验 tombstone 与 response 的 message 一致后成对更新，并写 `public.forum_audit_events`。

SECURITY DEFINER 安全边界（B-SECDEF-001 冻结）：

```text
SECURITY DEFINER path is safe only with:
fixed search_path (SET search_path = pg_catalog, public)
+ schema-qualified objects (public.forum_review_resolutions /
  public.forum_message_tombstones / public.forum_audit_events)
+ PUBLIC EXECUTE revoked (REVOKE ALL ON FUNCTION ... FROM PUBLIC)
+ explicit app-role grant (GRANT EXECUTE ... TO forum_app)
+ separate function owner
```

函数 owner 边界：

```text
FUNCTION_OWNER != forum_app
FUNCTION_OWNER = dedicated non-login schema owner
（实际角色名称在 删除 执行 中绑定，本设计只冻结约束）
- owner 不是应用运行角色；
- forum_app 不具备 ALTER FUNCTION / ownership；
- superuser/owner 可以绕过权限，因此 Acceptance 必须记录
  真实 owner 和 grants。
```

- 负向测试：无 tombstone 的 invalidation UPDATE 拒绝；普通 UPDATE 路径设置 `invalidated_at` 拒绝；经 `forum_invalidate_response` 的成对更新成功且只成功一次。

##### E/F.4 semantic_key 定义（B-RW-001）

`semantic_key text NULL` 保留，定义为**应用级可选去重键**：

```text
组成 = reviewer principal id + requirement id + kind
       + SHA-256(normalized request payload) 前 16 hex
用途 = 应用幂等重放检测与日志追踪；不参与任何数据库唯一约束，
       不参与 waiver 同义判定（同义判定见 E/F.2）；
nullable = YES；不 backfill。
```

不得将其解释为数据库幂等键或权限凭据。

##### E/F.5 并发单胜（B-RW-001）

concurrent response + waiver 最多一个成为 effective Resolution，由四层机制共同保证：`FOR UPDATE Requirement` 串行化、`forum_review_resolutions_one_effective_uq` partial unique 兜底、cross-row guard 拒绝第二个 effective INSERT、deferred consistency trigger 保证 Requirement state 与 effective Resolution 最终一致（同一事务 commit 前完成）。负向测试：并发 response+waiver 单胜（§17.2 评审行）。

#### G. `ForumReviewRequirement` → `forum_review_requirements`

```text
id uuid PK
thread_id uuid NN
revision integer NN
reviewer_principal_id uuid NN
requested_by_principal_id uuid NN
requested_at timestamptz NN
state text NN default 'pending'
created_at timestamptz NN default now
updated_at timestamptz NN
```

- UNIQUE `(thread_id,revision,reviewer_principal_id)`
- state=`pending|satisfied|waived`
- reviewer/requester Principal FK `RESTRICT`
- composite FK `(thread_id,revision)`→Revision
- 禁止物理 DELETE
- state 必须与 effective Resolution 一致
- Phase 2：0 行
- Historical Review backfill：NO

#### H. `ForumThreadRevision` → `forum_thread_revisions`

```text
id uuid PK
thread_id uuid NN FK RESTRICT
revision integer NN
discussion_state text NN             -- open | resolved
opened_at timestamptz NN
opened_by_principal_id uuid NN FK RESTRICT
resolved_at timestamptz NULL
resolved_by_principal_id uuid NULL FK RESTRICT
created_at timestamptz NN default now
UNIQUE(thread_id,revision)
```

规则：

- open：resolved actor/time 必须 NULL
- resolved：resolved actor/time 必须 NN
- `legacy_unknown` 不允许进入该表的 `discussion_state`
- `ForumThread.currentRevision` 指向 `(thread.id,revision)`
- archived lifecycle unknown 在 BF 前 `currentRevision=NULL`，只存在 quarantine

Reopen 算法：

```sql
BEGIN;
SELECT current_revision
FROM forum_threads
WHERE id = $thread
FOR UPDATE;

-- verify expected revision, visibility=active, current revision resolved
INSERT INTO forum_thread_revisions(..., revision = old + 1, discussion_state='open');

-- carry-forward / replace pending Requirements（引用新 revision）
INSERT INTO forum_review_requirements(..., revision = old + 1, state='pending');

UPDATE forum_threads
SET current_revision = old + 1
WHERE id=$thread AND current_revision=old;
COMMIT;
```

Initial Revision 创建事务（运行时新帖，单事务）：

```sql
BEGIN;
INSERT INTO forum_threads(..., current_revision = NULL);

INSERT INTO forum_thread_revisions(
  thread_id = $t, revision = 1, discussion_state = 'open',
  opened_by_principal_id = $actor, ...);

UPDATE forum_threads
SET current_revision = 1
WHERE id = $t AND current_revision IS NULL;
COMMIT;
```

Backfill 场景（Phase 3+，本 Phase 2 不执行）遵循相同顺序：thread 行以 `current_revision=NULL` 插入 → INSERT revision 1 → CAS `NULL→1`。

防护互锁（B-REV-001 冻结）：

1. `UNIQUE(thread_id,revision)` 拒绝重复 revision 行。
2. `forum_guard_current_revision` trigger **事件绑定固定为 `BEFORE UPDATE ON forum_threads`**：只防护 `forum_threads.current_revision` 的 UPDATE 路径（NULL→1、+1、不变；拒绝倒退/跳号/清空）。
3. `forum_thread_revisions` 表自身的 INSERT 路径由 **`BEFORE INSERT` guard**（`forum_thread_revisions_insert_guard`，registry SQL-044/045）防护：`new.revision` 必须等于该 thread 当前 `current_revision + 1`（`current_revision IS NULL` 时必须为 1），否则 `23514`。跳号、倒退、前置插入均被数据库拒绝。
4. 新 Thread INSERT 路径由 composite FK 防护：`forum_threads` 新行若带非 NULL `current_revision`，因 `(id,current_revision)` 无对应 revision 行而违反 FK。
5. Composite FK 完整 DDL（DDL D19；registry SQL-046）：

```sql
ALTER TABLE forum_threads
ADD CONSTRAINT forum_threads_current_revision_fk
FOREIGN KEY (id, current_revision)
REFERENCES forum_thread_revisions(thread_id, revision)
NOT VALID;
```

Phase 2 建约束时使用 `NOT VALID`（forum_threads 已有 90 行、列全 NULL，NULL 不参与 FK 匹配，但仍避免 scan）；`VALIDATE CONSTRAINT` 在 D17 阶段执行。NULL `current_revision` 行为：composite FK 对任一列为 NULL 的行不强制匹配，历史 thread 全部保持 NULL 不受影响。

Reopen 事务固定顺序（B-REV-001 冻结）：

```text
FOR UPDATE thread
→ verify expected revision / resolved / active
→ INSERT revision old+1
→ INSERT carried-forward / replaced pending Requirements（引用新 revision）
→ CAS UPDATE thread pointer（WHERE current_revision=old）
→ COMMIT
```

Requirement INSERT 必须位于 revision INSERT 之后、pointer CAS 之前：Requirement 的 composite FK 指向新 revision 行，先有 revision 行才能满足 FK；pointer CAS 最后执行保证失败时整体回滚。

数据库层（UNIQUE + 两个 trigger + composite FK）拒绝：跳号、倒退、清空已存在的 `currentRevision`、指向不存在的 Revision、创建两个相同 `(thread,revision)`。应用事务负责：授权、reviewer carry-forward 策略、expected revision 校验。

#### I. `ForumFinalization` → `forum_finalizations`

选择：**Finalization 与 authoritative Outcome 同表**。

```text
id uuid PK
thread_id uuid NN
revision integer NN
finalizer_principal_id uuid NN
idempotency_key text NN
semantic_request_version integer NN
semantic_request_hash bytea NN
review_snapshot jsonb NN
outcome_summary_md text NN
outcome_decisions jsonb NULL
outcome_rejected_options jsonb NULL
outcome_open_questions jsonb NULL
outcome_follow_up_md text NULL
provenance text NN                  -- runtime | migration_derived
created_at timestamptz NN default now
```

约束：

- UNIQUE `(thread_id,revision)`
- UNIQUE `(thread_id,idempotency_key)`
- composite FK `(thread_id,revision)`→Revision
- finalizer Principal FK
- summary/idempotency key 非空
- `semantic_request_hash` 定长 32 字节（CHECK，registry SQL-064）
- `semantic_request_version` 正整数（CHECK，registry SQL-063）
- commit 后 immutable
- review snapshot 必须包含 requirement IDs、state、response/waiver refs
- Phase 2：0 行

##### I.1 Idempotency 规范（B-IDEMP-001 冻结）

```text
IDEMPOTENCY_SCOPE =
(thread_id, idempotency_key)

ACTOR_IN_UNIQUE_SCOPE =
NO

ACTOR_INCLUDED_IN_SEMANTIC_HASH =
YES
```

1. **Key scope**：`(thread_id, idempotency_key)`，client-supplied，非空（btrim 后 length>0）。actor 不参与 unique scope；不同 actor 撞同一 key 时因 hash 输入含 finalizer principal id 而产生不同 semantic hash，按 different-payload 分支返回 409。

2. **Canonicalization**：`semantic_request_version`（int NN，初始值 1）字段化版本。Canonicalization V1 规则：

```text
- UTF-8 JSON 编码；
- object keys 字典序（lexicographic）排序；
- 无非语义空白（紧凑序列化，无缩进/换行）；
- null 值保留（不删除、不转为字符串）；
- array 顺序保留；
- Unicode NFC 归一化后编码；
- 固定字段集合（见 3），额外字段不进入 hash。
```

3. **Hash**：`SHA-256`，`semantic_request_hash bytea` 定长 32。输入字段按固定顺序：

```text
expected revision（integer）
outcome_summary_md
outcome_decisions
outcome_rejected_options
outcome_open_questions
outcome_follow_up_md
authenticated finalizer Principal ID
```

4. **行为矩阵**：

```text
same key + same semantic hash
→ 返回原 Finalization（不产生新行、不产生新 Outcome）

same key + different semantic hash
→ 409

并发 loser（第二个事务撞 UNIQUE）
→ 409，且不产生额外 Outcome 行

different actor 重用 same key
→ hash 不同（finalizer 在输入中）→ 409

stale revision 或 readiness 已变化
→ 不得通过旧 key 绕过状态重检；
  finalization 事务在锁内重新校验 expected revision
  与全部 Requirement readiness，失败即 409/409 语义冲突
```

5. **负向 Acceptance**（§17.2 定稿行）：empty key；overlong key；same key/different payload；canonical JSON key-order equivalence（顺序不同、语义相同 → 必须返回原行）；Unicode NFC 等价；null/array 差异；different actor；stale revision；changed readiness；hash version mismatch。

选择同表的理由：

- 不存在 Outcome orphan；
- 不需要 `Finalization.outcomeId` ↔ `Outcome.finalizationId` 循环 FK；
- 一条不可变记录天然实现 Finalization 恰好一个 authoritative Outcome；
- legacy `forum_outcomes` 永不自动成为 authoritative。

#### J. Tombstone

比较：

| 方案 | 结论 |
|---|---|
| 仅主表字段 | 查询简单，但把删除审计与可变业务行混合，历史 immutable 边界弱 |
| 通用 polymorphic tombstone | 一张表，但无法为 thread/message 建真实 target FK |
| Thread/Message 两个强类型表 | FK 清晰、约束可执行、普通/审计访问边界明确 |

推荐第三种。

##### `ForumThreadTombstone`

```text
thread_id uuid PK/FK RESTRICT
deleted_by_principal_id uuid NN FK RESTRICT
reason text NN
deleted_at timestamptz NN
source_report_id uuid NULL
audit_context jsonb NULL
created_at timestamptz NN default now
```

##### `ForumMessageTombstone`

同上，以 `message_id` 为 PK/FK。

两表：

- reason 非空；
- append-only；
- 普通读按 tombstone/visibility 排除；
- moderator audit access 通过单独 query + `ForumAuditEvent`；
- 不物理删除内容。

#### K. `ForumAuditEvent` → `forum_audit_events`

```text
event_id uuid PK
event_type text NN
actor_principal_id uuid NULL FK RESTRICT
auth_subject text NULL
agent_id text NULL
client_id text NULL
target_type text NN
target_id uuid NULL
thread_id uuid NULL FK RESTRICT
revision integer NULL
request_correlation_id text NULL
idempotency_key text NULL
payload jsonb NN default '{}'
provenance text NN
created_at timestamptz NN default now
```

要求：

- append-only：UPDATE/DELETE trigger 拒绝；
- app DB role 只授予 INSERT/SELECT；
- payload 只允许 allowlist、bounded metadata；
- 禁止 token、Authorization header、secret、完整敏感 legacy row；
- actor 可为空，仅用于系统 migration/constraint event，并必须由 provenance 说明。

#### L. `MigrationRun` → `forum_migration_runs`

```text
id uuid PK
source_commit text NN
source_schema_revision text NN
target_commit text NN
target_schema_revision text NN
environment text NN
dataset_id text NN
snapshot_at timestamptz NN
policy_id text NN
phase text NN
run_identity_key text NN
attempt integer NN
status text NN
started_at timestamptz NN
finished_at timestamptz NULL
rollback_reference text NULL
created_at timestamptz NN default now
UNIQUE(run_identity_key, attempt)
```

status closed set：`planned|running|validated|failed|rolled_back|sealed`（named CHECK：`forum_migration_runs_status_ck`）。

##### L.1 状态机与 sealed guard（B-MODEL-001 冻结）

MigrationRun **不得**放入无条件 `forum_forbid_mutation` 清单。状态推进依赖 UPDATE，由条件化 trigger `forum_migration_runs_sealed_guard`（BEFORE UPDATE OR DELETE；registry SQL-013/014）执行：

```text
合法转移：
planned   → running | failed
running   → validated | failed
validated → sealed | rolled_back | failed
sealed / failed / rolled_back = terminal（拒绝一切 UPDATE/DELETE）

字段不可变性：
status/finished_at/rollback_reference 之外的列一旦建立禁止改写；
identity、source/target、dataset、policy、phase 建立后不可改。
```

##### L.2 rerun identity（B-MODEL-001 冻结）

```text
run_identity_key =
source_commit | target_commit | dataset_id | policy_id | phase
（'|' 连接的确定性串联）

attempt = positive integer（CHECK attempt > 0）

UNIQUE(run_identity_key, attempt)
```

重试语义（固定）：失败 run 的 status 置 `failed` 后成为终态行，**不重开**；重试 = 以同一 `run_identity_key`、`attempt = max(attempt)+1` 创建**新 run 行**。同 run 内 check 结果不可变（append-only）；重验产生新 run。该模型与 append-only 设计一致：历史 attempt 行永久保留作为审计证据。

#### M. `MigrationLegacyEvidence` → `forum_migration_legacy_evidence`

```text
id uuid PK
migration_run_id uuid NN FK RESTRICT
source_table text NN
source_row_reference text NN
source_row_hash bytea NN
source_namespace text NULL
candidate_principal_id uuid NULL FK RESTRICT
classification text NN
safe_payload jsonb NN
created_at timestamptz NN default now
UNIQUE(migration_run_id,source_table,source_row_reference)
```

安全边界：

- 不复制完整 legacy row；
- 保存安全 hash、稳定/脱敏 row reference、allowlisted 必要字段快照；
- 原 legacy row 保持不变；
- payload 有大小和字段白名单；
- classification=`deterministic|ambiguous|unprovable`（named CHECK：`forum_migration_legacy_evidence_classification_ck`，registry SQL-003）。

#### N. `MigrationFieldDecision` → `forum_migration_field_decisions`

```text
id uuid PK
legacy_evidence_id uuid NN FK RESTRICT
field_name text NN
classification text NN
source_values_safe jsonb NN
selected_value_safe jsonb NULL
reason_code text NN
decided_by_policy text NN
created_at timestamptz NN default now
UNIQUE(legacy_evidence_id,field_name)
```

Option C：

- conflicting field 的 selected value 必须 NULL（named CHECK：`forum_migration_field_decisions_selected_ck`，registry SQL-005）；
- `decidedByPolicy=INV-AGENT-FORUM-MIGRATION-OPTION-C-V1`；
- 不允许 recency/name guess。

#### O. `MigrationQuarantine` → `forum_migration_quarantines`

```text
id uuid PK
legacy_evidence_id uuid NN UNIQUE FK RESTRICT
category text NN
authority_effect text NN
status text NN
reason_code text NN
reclassification_requirement text NN
created_at timestamptz NN default now
resolved_at timestamptz NULL
resolved_by_principal_id uuid NULL FK RESTRICT
```

category 至少包括：

```text
participant_collision
unresolved_participant
archived_lifecycle_unknown
other
```

`185` 不是约束；未来目标环境数量可以不同。

status closed set：`open|resolved`（named CHECK：`forum_migration_quarantines_status_ck`）。category closed set 见 named CHECK `forum_migration_quarantines_category_ck`（上述 4 值）。

一条 evidence 对应多少 quarantine（B-MODEL-001 冻结）：Option C 的三类本地 category（collision/unresolved/archived_lifecycle_unknown）对同一 source row **互斥**——inventory 分类对每行只产生一种处置，`other` 仅承接未来类别。因此当前冻结为 `UNIQUE(legacy_evidence_id)` 一行一 quarantine。若未来引入可共现的独立问题类别，必须先改键为 `UNIQUE(legacy_evidence_id, category)` 并声明 category 互斥关系变化；该变更属于设计修订，不得在执行中静默发生。

#### P. `MigrationValidationResult` → `forum_migration_validation_results`

```text
id uuid PK
migration_run_id uuid NN FK RESTRICT
check_id text NN
contract_id text NULL
required boolean NN
expected jsonb NN
actual jsonb NN
result text NN
evidence_reference text NN
created_at timestamptz NN default now
UNIQUE(migration_run_id,check_id)
```

result closed set：`pass|fail|inconclusive`（named CHECK：`forum_migration_validation_results_result_ck`）。

required/optional 与重验语义（B-MODEL-001 冻结）：

- `required boolean NN` 判别该 check 是否 cutover 前置；required check 清单由 Contract binding（`contract_id`）+ `required=true` 共同表达；
- 同 run + check ID 唯一；行 insert 后 result 不可变（append-only trigger）；
- 重验不 UPDATE、不重插：产生**新 run**（attempt+1），旧 run 的 check 结果永久保留；
- cutover 只能消费 sealed run 中**全部 required checks = pass** 的结果；该消费规则属于 Phase 5 语义，Phase 2 仅落存储载体。

#### Q. Product-direction support models

##### `ForumMention`

```text
id uuid PK
message_id uuid NN FK RESTRICT
mentioned_principal_id uuid NN FK RESTRICT
source_agent_id text NULL          -- display/input snapshot only
created_at timestamptz NN
UNIQUE(message_id,mentioned_principal_id)
```

##### `ForumNotificationFact`

```text
id uuid PK
recipient_principal_id uuid NN FK RESTRICT
thread_id uuid NN FK RESTRICT
message_id uuid NULL FK RESTRICT
reaction_id uuid NULL FK RESTRICT
reason text NN                     -- mention | watch | reaction
source_event_key text NN
created_at timestamptz NN
UNIQUE(recipient_principal_id,source_event_key)
```

Notification 是持久 unread discussion fact；是否 unread 由 ReadState 和 source message seq 派生，不变成 Todo/Workflow。

---

## 9. Exact constraints and indexes

### 9.1 Core SQL candidates

#### Watch active interval

```sql
CREATE UNIQUE INDEX forum_watch_subscriptions_one_active_uq
ON forum_watch_subscriptions(thread_id, principal_id)
WHERE state = 'active' AND ended_at IS NULL;
```

#### Read State shape

```sql
ALTER TABLE forum_read_states
ADD CONSTRAINT forum_read_states_shape_ck CHECK (
  (
    state = 'unknown'
    AND last_read_seq IS NULL
    AND last_read_at IS NULL
  )
  OR
  (
    state = 'known'
    AND last_read_seq = 0
    AND last_read_at IS NULL
  )
  OR
  (
    state = 'known'
    AND last_read_seq > 0
    AND last_read_at IS NOT NULL
  )
);
```

#### Waiver non-empty and Response/Waiver shape

```sql
ALTER TABLE forum_review_resolutions
ADD CONSTRAINT forum_review_resolutions_shape_ck CHECK (
  (
    kind = 'response'
    AND message_id IS NOT NULL
    AND resolved_by_principal_id = reviewer_principal_id
    AND reason IS NULL
  )
  OR
  (
    kind = 'waiver'
    AND message_id IS NULL
    AND length(btrim(reason)) > 0
  )
);

-- B-RW-001：invalidation 一致性 —— 两字段必须成对出现或成对为空
ALTER TABLE forum_review_resolutions
ADD CONSTRAINT forum_review_resolutions_invalidation_pair_ck CHECK (
  (invalidated_at IS NULL)
  =
  (invalidated_by_message_tombstone_id IS NULL)
);

CREATE UNIQUE INDEX forum_review_resolutions_one_effective_uq
ON forum_review_resolutions(requirement_id)
WHERE invalidated_at IS NULL;
```

#### Finalization uniqueness/idempotency

```sql
ALTER TABLE forum_finalizations
  ADD CONSTRAINT forum_finalizations_thread_revision_uq
  UNIQUE(thread_id, revision),
  ADD CONSTRAINT forum_finalizations_idempotency_uq
  UNIQUE(thread_id, idempotency_key),
  ADD CONSTRAINT forum_finalizations_idempotency_nonempty_ck
  CHECK(length(btrim(idempotency_key)) > 0),
  ADD CONSTRAINT forum_finalizations_summary_nonempty_ck
  CHECK(length(btrim(outcome_summary_md)) > 0);
```

#### Tombstone reason

```sql
ALTER TABLE forum_thread_tombstones
ADD CONSTRAINT forum_thread_tombstones_reason_ck
CHECK(length(btrim(reason)) > 0);

ALTER TABLE forum_message_tombstones
ADD CONSTRAINT forum_message_tombstones_reason_ck
CHECK(length(btrim(reason)) > 0);
```

#### Revision monotonicity

UPDATE 路径（`forum_threads.current_revision`）主保证是 row lock + CAS + UNIQUE。防御 trigger **事件绑定：`BEFORE UPDATE ON forum_threads`**：

```sql
CREATE FUNCTION forum_guard_current_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_revision IS NULL THEN
    IF NEW.current_revision IS NOT NULL
       AND NEW.current_revision <> 1 THEN
      RAISE EXCEPTION 'initial revision must be 1'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.current_revision IS NULL
     OR NEW.current_revision < OLD.current_revision
     OR NEW.current_revision > OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'revision must remain unchanged or increment by one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER forum_guard_current_revision_tg
BEFORE UPDATE ON forum_threads
FOR EACH ROW EXECUTE FUNCTION forum_guard_current_revision();
```

INSERT 路径（`forum_thread_revisions` 表自身，B-REV-001 新增）：

```sql
CREATE FUNCTION forum_thread_revisions_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cur integer;
BEGIN
  SELECT current_revision INTO cur
  FROM forum_threads WHERE id = NEW.thread_id FOR SHARE;
  IF cur IS NULL THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'initial revision must be 1'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.revision <> cur + 1 THEN
    RAISE EXCEPTION 'revision must be exactly current + 1'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER forum_thread_revisions_insert_guard_tg
BEFORE INSERT ON forum_thread_revisions
FOR EACH ROW EXECUTE FUNCTION forum_thread_revisions_insert_guard();
```

新 Thread 的 INSERT 路径由 composite FK `forum_threads_current_revision_fk`（§8.3 H / DDL D19 / registry SQL-046）防护：新行带非 NULL pointer 时无 revision 行可匹配，违反 FK。

三个 trigger 不负责授权；授权和 reopen reviewer carry-forward 必须在应用事务内完成。

#### Review cross-row guard

`forum_review_resolution_guard` 必须在 insert/effective update 时：

1. `FOR UPDATE` Requirement；
2. 校验 reviewer/revision 与 Requirement 一致；
3. response 时校验 Message：
   - 同一 Thread；
   - 同一 revision；
   - author 等于 reviewer；
   - created after requestedAt；
   - 无 MessageTombstone；
4. waiver 时仅校验结构；creator/moderator authority 仍由应用验证；
5. effective resolution 已存在时拒绝 INSERT（waiver 幂等返回在应用层、同一 `FOR UPDATE` 锁内完成：存在同义 waiver 时直接返回原 Resolution，见 §8.3 E/F.2；不同义才由应用返回 409）；
6. deferred consistency trigger 验证 Requirement state 与 effective resolution 一致。

#### Append-only guard

```sql
CREATE FUNCTION forum_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END $$;
```

用于：

- `forum_finalizations`
- `forum_thread_tombstones`
- `forum_message_tombstones`
- `forum_audit_events`
- MigrationLegacyEvidence
- MigrationFieldDecision
- MigrationValidationResult

`MigrationRun` **不在**该清单：其状态机依赖 UPDATE，由下方条件化 sealed guard 单独防护（B-MODEL-001）。

#### Migration foundation named CHECKs（B-MODEL-001）

```sql
ALTER TABLE forum_migration_runs
ADD CONSTRAINT forum_migration_runs_status_ck CHECK (
  status IN ('planned','running','validated','failed','rolled_back','sealed')
),
ADD CONSTRAINT forum_migration_runs_attempt_pos_ck CHECK (attempt > 0);

ALTER TABLE forum_migration_legacy_evidence
ADD CONSTRAINT forum_migration_legacy_evidence_classification_ck CHECK (
  classification IN ('deterministic','ambiguous','unprovable')
);

ALTER TABLE forum_migration_field_decisions
ADD CONSTRAINT forum_migration_field_decisions_classification_ck CHECK (
  classification IN ('deterministic','ambiguous','unprovable')
),
ADD CONSTRAINT forum_migration_field_decisions_selected_ck CHECK (
  classification = 'deterministic'
  OR selected_value_safe IS NULL
);

ALTER TABLE forum_migration_quarantines
ADD CONSTRAINT forum_migration_quarantines_category_ck CHECK (
  category IN ('participant_collision','unresolved_participant',
               'archived_lifecycle_unknown','other')
),
ADD CONSTRAINT forum_migration_quarantines_status_ck CHECK (
  status IN ('open','resolved')
);

ALTER TABLE forum_migration_validation_results
ADD CONSTRAINT forum_migration_validation_results_result_ck CHECK (
  result IN ('pass','fail','inconclusive')
);
```

`forum_migration_field_decisions_selected_ck` 真值表（B-CHK-001 冻结验收口径）：

```text
deterministic + NULL       = ACCEPT
deterministic + non-NULL   = ACCEPT
ambiguous + NULL           = ACCEPT
ambiguous + non-NULL       = REJECT
unprovable + NULL          = ACCEPT
unprovable + non-NULL      = REJECT
```

#### MigrationRun sealed guard（B-MODEL-001）

```sql
CREATE FUNCTION forum_migration_runs_sealed_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('sealed','failed','rolled_back') THEN
    RAISE EXCEPTION 'terminal migration run cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('sealed','failed','rolled_back') THEN
    RAISE EXCEPTION 'terminal migration run cannot be updated'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      (OLD.status = 'planned'   AND NEW.status IN ('running','failed')) OR
      (OLD.status = 'running'   AND NEW.status IN ('validated','failed')) OR
      (OLD.status = 'validated' AND NEW.status IN ('sealed','rolled_back','failed'))
    ) THEN
      RAISE EXCEPTION 'illegal migration run status transition % -> %',
        OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.source_commit <> OLD.source_commit
       OR NEW.target_commit <> OLD.target_commit
       OR NEW.environment <> OLD.environment
       OR NEW.dataset_id <> OLD.dataset_id
       OR NEW.snapshot_at <> OLD.snapshot_at
       OR NEW.policy_id <> OLD.policy_id
       OR NEW.phase <> OLD.phase
       OR NEW.run_identity_key <> OLD.run_identity_key
       OR NEW.attempt <> OLD.attempt
       OR NEW.started_at <> OLD.started_at THEN
      RAISE EXCEPTION 'migration run identity fields are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER forum_migration_runs_sealed_guard_tg
BEFORE UPDATE OR DELETE ON forum_migration_runs
FOR EACH ROW EXECUTE FUNCTION forum_migration_runs_sealed_guard();
```

Audit table同时：

```sql
REVOKE UPDATE, DELETE, TRUNCATE
ON forum_audit_events
FROM forum_app;
```

数据库 owner/superuser 仍能绕过权限，因此 acceptance 必须同时验证应用 role grant 和 trigger。

### 9.2 Prisma/raw SQL boundary

| Object | Prisma expressible | Raw SQL required | RAW_SQL_OBJECT |
|---|---|---|---|
| PK、普通 UNIQUE、普通 INDEX、普通 FK | YES | NO | Prisma models/relations |
| Composite FK 到 `(threadId,revision)` | 部分可表达 | 建议 YES | migration 中显式命名、`NOT VALID` |
| closed state CHECK | NO | YES | named CHECK |
| non-empty reason/key/summary | NO | YES | `length(btrim(...))>0` |
| Watch active partial unique | NO | YES | partial UNIQUE INDEX |
| effective Resolution partial unique | NO | YES | partial UNIQUE INDEX |
| Read shape/monotonicity | NO | YES | CHECK + trigger |
| Revision monotonicity | NO | YES | trigger；主要保证仍是 txn/CAS |
| Response message cross-row关系 | NO | YES | trigger + transaction |
| Requirement/Resolution deferred一致性 | NO | YES | deferred constraint trigger |
| append-only | NO | YES | trigger + grants |
| immutable alias owner | NO | YES | update guard trigger |
| existing-table nullable FK | YES，但不可表达 `NOT VALID` | YES | `ADD CONSTRAINT ... NOT VALID` |
| `CREATE INDEX CONCURRENTLY` | NO | YES | standalone migration SQL |

计数口径（B-SQL-001 修订后，逐对象可加和，明细见 §9.3 registry）：

```text
RAW_SQL_CONSTRAINTS_REQUIRED = 74
PRISMA_ONLY_CONSTRAINTS = 64
```

`64` 为 candidate schema 中由 Prisma models/relations 表达的 PK、普通 UNIQUE 和普通 FK 声明总数（新增 17 表逐表可加和：Alias 3、Participation 5、Watch 4、ReadState 4、Resolution 5、Requirement 5、Revision 5、Finalization 2、ThreadTombstone 3、MessageTombstone 3、MigrationRun 1、LegacyEvidence 4、FieldDecision 3、Quarantine 4、ValidationResult 3、Mention 4、NotificationFact 6）；普通 non-unique indexes 不计入。`74` 为 §9.3 registry 逐行登记的 named CHECK、partial unique、named UNIQUE（finalization 两项因验收引用稳定物理名而走 raw）、trigger/constraint-trigger/function、`NOT VALID`/staged FK、CIC 与 grant 对象总数（基座 14、证据 3、身份 11、订阅 12、状态 8、评审 11、定稿 9、删除 6）。

### 9.3 Raw SQL object registry（B-SQL-001）

记号：TX = 进入 migration transaction；standalone = 独立执行、无显式事务。`pg_*` 验证查询均要求返回 1。每行 EVIDENCE_PATH 对应 §17.2 各 workstream 行。

#### 基座 执行（14 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-001 | forum_migration_runs_status_ck | 基座 | CHECK | forum_migration_runs | status closed set | `ALTER TABLE forum_migration_runs ADD CONSTRAINT forum_migration_runs_status_ck CHECK (status IN ('planned','running','validated','failed','rolled_back','sealed'))` | TX | NO | 1 | 表已建 | `SELECT count(*)=1 FROM pg_constraint WHERE conname='forum_migration_runs_status_ck'` | 非法 status INSERT 拒绝 | 保留（D01/D16；cleanup gate） | `.../base/` |
| SQL-002 | forum_migration_runs_attempt_pos_ck | 基座 | CHECK | forum_migration_runs | attempt 正整数 | `... ADD CONSTRAINT forum_migration_runs_attempt_pos_ck CHECK (attempt > 0)` | TX | NO | 1 | 表已建 | pg_constraint 同名 | attempt<=0 INSERT 拒绝 | 保留 | `.../base/` |
| SQL-003 | forum_migration_legacy_evidence_classification_ck | 基座 | CHECK | forum_migration_legacy_evidence | classification closed set | `... CHECK (classification IN ('deterministic','ambiguous','unprovable'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 classification 拒绝 | 保留 | `.../base/` |
| SQL-004 | forum_migration_field_decisions_classification_ck | 基座 | CHECK | forum_migration_field_decisions | classification closed set | `... CHECK (classification IN ('deterministic','ambiguous','unprovable'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 classification 拒绝 | 保留 | `.../base/` |
| SQL-005 | forum_migration_field_decisions_selected_ck | 基座 | CHECK | forum_migration_field_decisions | 非 deterministic 时 selected 必须 NULL | `... CHECK (classification = 'deterministic' OR selected_value_safe IS NULL)`（真值表见 §9.1，B-CHK-001） | TX | NO | 1 | SQL-004 | pg_constraint | ambiguous+selected 拒绝；ambiguous+NULL 接受；unprovable+selected 拒绝；unprovable+NULL 接受 | 保留 | `.../base/` |
| SQL-006 | forum_migration_quarantines_category_ck | 基座 | CHECK | forum_migration_quarantines | category closed set | `... CHECK (category IN ('participant_collision','unresolved_participant','archived_lifecycle_unknown','other'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 category 拒绝 | 保留 | `.../base/` |
| SQL-007 | forum_migration_quarantines_status_ck | 基座 | CHECK | forum_migration_quarantines | status closed set | `... CHECK (status IN ('open','resolved'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 status 拒绝 | 保留 | `.../base/` |
| SQL-008 | forum_migration_validation_results_result_ck | 基座 | CHECK | forum_migration_validation_results | result closed set | `... CHECK (result IN ('pass','fail','inconclusive'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 result 拒绝 | 保留 | `.../base/` |
| SQL-009 | forum_forbid_mutation (function) | 基座（共享） | FUNCTION | — | append-only 拒绝函数 | `CREATE FUNCTION forum_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$` | TX | NO | 2 | — | `SELECT count(*)=1 FROM pg_proc WHERE proname='forum_forbid_mutation'` | 任一绑定表 UPDATE/DELETE 抛 55000 | 保留；trigger 故障时 forward fix（D16） | `.../base/` |
| SQL-010 | forum_migration_legacy_evidence_append_only_tg | 基座 | TRIGGER | forum_migration_legacy_evidence | append-only | `CREATE TRIGGER forum_migration_legacy_evidence_append_only_tg BEFORE UPDATE OR DELETE ON forum_migration_legacy_evidence FOR EACH ROW EXECUTE FUNCTION forum_forbid_mutation()` | TX | NO | 3 | SQL-009 | `SELECT count(*)=1 FROM pg_trigger WHERE tgname='forum_migration_legacy_evidence_append_only_tg'` | UPDATE/DELETE 拒绝 | 保留 | `.../base/` |
| SQL-011 | forum_migration_field_decisions_append_only_tg | 基座 | TRIGGER | forum_migration_field_decisions | append-only | 同 SQL-010 形式 | TX | NO | 3 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE 拒绝 | 保留 | `.../base/` |
| SQL-012 | forum_migration_validation_results_append_only_tg | 基座 | TRIGGER | forum_migration_validation_results | append-only | 同 SQL-010 形式 | TX | NO | 3 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE 拒绝 | 保留 | `.../base/` |
| SQL-013 | forum_migration_runs_sealed_guard (function) | 基座 | FUNCTION | — | 终态+转移+identity 不可变 | `CREATE FUNCTION forum_migration_runs_sealed_guard() ...`（全文见 §9.1） | TX | NO | 2 | — | pg_proc 同名 | sealed 后 UPDATE/DELETE 拒绝；非法转移拒绝；identity 改写拒绝 | 保留 | `.../base/` |
| SQL-014 | forum_migration_runs_sealed_guard_tg | 基座 | TRIGGER | forum_migration_runs | sealed guard 绑定 | `CREATE TRIGGER forum_migration_runs_sealed_guard_tg BEFORE UPDATE OR DELETE ON forum_migration_runs FOR EACH ROW EXECUTE FUNCTION forum_migration_runs_sealed_guard()` | TX | NO | 3 | SQL-013 | pg_trigger 同名 | 同 SQL-013 负向 | 保留 | `.../base/` |

#### 证据 执行（3 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-015 | forum_audit_events_provenance_ck | 证据 | CHECK | forum_audit_events | provenance closed set | `... CHECK (provenance IN ('runtime','migration'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 provenance 拒绝 | 保留 | `.../audit/` |
| SQL-016 | forum_audit_events_append_only_tg | 证据 | TRIGGER | forum_audit_events | append-only | `CREATE TRIGGER forum_audit_events_append_only_tg BEFORE UPDATE OR DELETE ON forum_audit_events FOR EACH ROW EXECUTE FUNCTION forum_forbid_mutation()` | TX | NO | 2 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE/TRUNCATE 拒绝 | 保留 | `.../audit/` |
| SQL-017 | revoke-forum-app-audit-mutation | 证据 | GRANT/REVOKE | forum_audit_events | 应用 role 边界 | `REVOKE UPDATE, DELETE, TRUNCATE ON forum_audit_events FROM forum_app` | TX | NO | 3 | 表已建 | `SELECT NOT has_table_privilege('forum_app','forum_audit_events','UPDATE')` | forum_app UPDATE 以权限错误失败 | REVOKE 幂等重放；owner/superuser 例外记录 | `.../audit/` |

#### 身份 执行（11 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-018 | forum_principal_aliases_namespace_ck | 身份 | CHECK | forum_principal_aliases | namespace closed set | `... CHECK (namespace IN ('auth_subject','agent_id'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 namespace 拒绝 | 保留 | `.../identity/` |
| SQL-019 | forum_alias_owner_immutable_guard (function) | 身份 | FUNCTION | — | alias owner 不可变 | `CREATE FUNCTION forum_alias_owner_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.principal_id <> OLD.principal_id OR NEW.namespace <> OLD.namespace OR NEW.value <> OLD.value OR (OLD.retired_at IS NOT NULL AND NEW.retired_at <> OLD.retired_at) THEN RAISE EXCEPTION 'alias identity immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$` | TX | NO | 2 | — | pg_proc 同名 | owner/namespace/value 改写拒绝 | 保留 | `.../identity/` |
| SQL-020 | forum_alias_owner_immutable_guard_tg | 身份 | TRIGGER | forum_principal_aliases | 绑定 immutability | `CREATE TRIGGER forum_alias_owner_immutable_guard_tg BEFORE UPDATE ON forum_principal_aliases FOR EACH ROW EXECUTE FUNCTION forum_alias_owner_immutable_guard()` | TX | NO | 3 | SQL-019 | pg_trigger 同名 | alias 重分配拒绝 | 保留 | `.../identity/` |
| SQL-021 | forum_threads_creator_principal_fk | 身份 | FK NOT VALID | forum_threads | creator FK | `ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_creator_principal_fk FOREIGN KEY (creator_principal_id) REFERENCES forum_principals(id) NOT VALID` | TX；D17 VALIDATE | 部分（NOT VALID 不可表达） | 4 | 列已加（D04） | pg_constraint 同名 + `convalidated` 翻转 | 非法 principal 引用拒绝（VALIDATE 后） | 保留 FK；DDL 失败由事务回滚（D06） | `.../identity/` |
| SQL-022 | forum_messages_author_principal_fk | 身份 | FK NOT VALID | forum_messages | author FK | 同 SQL-021 形式，列 `author_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-023 | forum_thread_views_viewer_principal_fk | 身份 | FK NOT VALID | forum_thread_views | viewer FK | 同上，列 `viewer_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-024 | forum_outcomes_created_by_principal_fk | 身份 | FK NOT VALID | forum_outcomes | outcome actor FK | 同上，列 `created_by_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-025 | forum_context_snapshots_taken_by_principal_fk | 身份 | FK NOT VALID | forum_context_snapshots | snapshot actor FK | 同上，列 `taken_by_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-026 | forum_reports_reporter_principal_fk | 身份 | FK NOT VALID | forum_reports | reporter FK | 同上，列 `reporter_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-027 | forum_reports_handled_by_principal_fk | 身份 | FK NOT VALID | forum_reports | moderator FK | 同上，列 `handled_by_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |
| SQL-028 | forum_reactions_actor_principal_fk | 身份 | FK NOT VALID | forum_reactions | reaction actor FK | 同上，列 `actor_principal_id` | TX；D17 VALIDATE | 部分 | 4 | D04 | pg_constraint | 同上 | 同 D06 | `.../identity/` |

#### 订阅 执行（12 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-029 | forum_watch_subscriptions_state_ck | 订阅 | CHECK | forum_watch_subscriptions | state closed set | `... CHECK (state IN ('active','inactive'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 state 拒绝 | 保留 | `.../subscription/` |
| SQL-030 | forum_watch_subscriptions_source_ck | 订阅 | CHECK | forum_watch_subscriptions | source closed set | `... CHECK (source IN ('explicit','author','mention','migration','unknown'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 source 拒绝 | 保留 | `.../subscription/` |
| SQL-031 | forum_watch_subscriptions_provenance_ck | 订阅 | CHECK | forum_watch_subscriptions | provenance closed set | `... CHECK (provenance IN ('runtime','migration'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 provenance 拒绝 | 保留 | `.../subscription/` |
| SQL-032 | forum_watch_subscriptions_shape_ck | 订阅 | CHECK | forum_watch_subscriptions | active/inactive interval 形状 | `... CHECK ((state='active' AND ended_at IS NULL) OR (state='inactive' AND ended_at IS NOT NULL))` | TX | NO | 1 | SQL-029 | pg_constraint | active+ended_at 拒绝 | 保留 | `.../subscription/` |
| SQL-033 | forum_watch_subscriptions_one_active_uq | 订阅 | PARTIAL UNIQUE INDEX | forum_watch_subscriptions | 每 (thread,principal) 一个 active | `CREATE UNIQUE INDEX forum_watch_subscriptions_one_active_uq ON forum_watch_subscriptions(thread_id,principal_id) WHERE state='active' AND ended_at IS NULL` | TX | NO | 2 | SQL-032 | `SELECT count(*)=1 FROM pg_indexes WHERE indexname='forum_watch_subscriptions_one_active_uq'` | 第二个 active Watch 拒绝 | 保留 | `.../subscription/` |
| SQL-034 | forum_participations_fact_state_ck | 订阅 | CHECK | forum_participations | fact_state closed set | `... CHECK (fact_state IN ('known','partial','unknown'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 fact_state 拒绝 | 保留 | `.../subscription/` |
| SQL-035 | forum_participations_provenance_ck | 订阅 | CHECK | forum_participations | provenance closed set | `... CHECK (provenance IN ('runtime','migration'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 provenance 拒绝 | 保留 | `.../subscription/` |
| SQL-036 | forum_read_states_shape_ck | 订阅 | CHECK | forum_read_states | state closed set + known/unknown 形状（全文见 §9.1） | `ALTER TABLE forum_read_states ADD CONSTRAINT forum_read_states_shape_ck CHECK ((state='unknown' AND last_read_seq IS NULL AND last_read_at IS NULL) OR (state='known' AND last_read_seq=0 AND last_read_at IS NULL) OR (state='known' AND last_read_seq>0 AND last_read_at IS NOT NULL))` | TX | NO | 1 | 表已建 | pg_constraint | unknown+seq 拒绝；known+seq>0 无 time 拒绝 | 保留 | `.../subscription/` |
| SQL-037 | forum_read_states_provenance_ck | 订阅 | CHECK | forum_read_states | provenance closed set | `... CHECK (provenance IN ('runtime','migration'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 provenance 拒绝 | 保留 | `.../subscription/` |
| SQL-038 | forum_read_cursor_monotonic_guard (function) | 订阅 | FUNCTION | — | cursor 单调 | `CREATE FUNCTION forum_read_cursor_monotonic_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.last_read_seq IS DISTINCT FROM OLD.last_read_seq AND NEW.last_read_seq < OLD.last_read_seq THEN RAISE EXCEPTION 'read cursor must not regress' USING ERRCODE='23514'; END IF; RETURN NEW; END $$` | TX | NO | 2 | — | pg_proc 同名 | cursor 回退拒绝 | 保留 | `.../subscription/` |
| SQL-039 | forum_read_cursor_monotonic_guard_tg | 订阅 | TRIGGER | forum_read_states | 绑定 cursor 单调 | `CREATE TRIGGER forum_read_cursor_monotonic_guard_tg BEFORE UPDATE ON forum_read_states FOR EACH ROW EXECUTE FUNCTION forum_read_cursor_monotonic_guard()` | TX | NO | 3 | SQL-038 | pg_trigger 同名 | 同上 | 保留 | `.../subscription/` |
| SQL-040 | forum_notifications_reason_ck | 订阅 | CHECK | forum_notification_facts | reason closed set | `... CHECK (reason IN ('mention','watch','reaction'))` | TX | NO | 1 | 表已建 | pg_constraint | 非法 reason 拒绝 | 保留 | `.../subscription/` |

#### 状态 执行（8 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-041 | forum_thread_revisions_shape_ck | 状态 | CHECK | forum_thread_revisions | discussion_state closed set + open/resolved 配对 | `... CHECK ((discussion_state='open' AND resolved_at IS NULL AND resolved_by_principal_id IS NULL) OR (discussion_state='resolved' AND resolved_at IS NOT NULL AND resolved_by_principal_id IS NOT NULL))` | TX | NO | 1 | 表已建（D10） | pg_constraint | open+resolved_at 拒绝；非法 state 拒绝 | 保留 | `.../lifecycle/` |
| SQL-042 | forum_guard_current_revision (function) | 状态 | FUNCTION | — | pointer UPDATE 单调 | `CREATE FUNCTION forum_guard_current_revision() ...`（全文见 §9.1） | TX | NO | 2 | — | pg_proc 同名 | 跳号/倒退/清空 UPDATE 拒绝 | 保留 | `.../lifecycle/` |
| SQL-043 | forum_guard_current_revision_tg | 状态 | TRIGGER | forum_threads | BEFORE UPDATE 绑定 | `CREATE TRIGGER forum_guard_current_revision_tg BEFORE UPDATE ON forum_threads FOR EACH ROW EXECUTE FUNCTION forum_guard_current_revision()` | TX | NO | 3 | SQL-042 | pg_trigger 同名 | 同上 | 保留 | `.../lifecycle/` |
| SQL-044 | forum_thread_revisions_insert_guard (function) | 状态 | FUNCTION | — | revisions INSERT 单调 | `CREATE FUNCTION forum_thread_revisions_insert_guard() ...`（全文见 §9.1） | TX | NO | 2 | — | pg_proc 同名 | 跳号/前置 INSERT 拒绝 | 保留 | `.../lifecycle/` |
| SQL-045 | forum_thread_revisions_insert_guard_tg | 状态 | TRIGGER | forum_thread_revisions | BEFORE INSERT 绑定 | `CREATE TRIGGER forum_thread_revisions_insert_guard_tg BEFORE INSERT ON forum_thread_revisions FOR EACH ROW EXECUTE FUNCTION forum_thread_revisions_insert_guard()` | TX | NO | 3 | SQL-044 | pg_trigger 同名 | revision=3 首插拒绝（当前 NULL→须 1） | 保留 | `.../lifecycle/` |
| SQL-046 | forum_threads_current_revision_fk | 状态 | COMPOSITE FK NOT VALID | forum_threads | pointer↔revision 互锁 | `ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_current_revision_fk FOREIGN KEY (id,current_revision) REFERENCES forum_thread_revisions(thread_id,revision) NOT VALID` | TX；D17 VALIDATE | 部分 | 4 | D10、SQL-041 | pg_constraint 同名 | 孤儿 pointer（指向不存在 revision）拒绝 | 保留（D19） | `.../lifecycle/` |
| SQL-047 | forum_threads_visibility_state_cic_idx | 状态 | INDEX (CIC) | forum_threads | 未来 visibility 查询 | `CREATE INDEX CONCURRENTLY forum_threads_visibility_state_cic_idx ON forum_threads(visibility_state) WHERE visibility_state IS NOT NULL` | standalone / no explicit transaction | NO | 5 | D05 | pg_indexes 同名 | invalid index 恢复演练（D18） | 失败仅 forward repair：DROP INDEX CONCURRENTLY 后重建 | `.../lifecycle/` |
| SQL-048 | forum_thread_messages_discussion_revision_cic_idx | 状态 | INDEX (CIC) | forum_messages | revision 维度查询 | `CREATE INDEX CONCURRENTLY forum_thread_messages_discussion_revision_cic_idx ON forum_thread_messages(thread_id,discussion_revision) WHERE discussion_revision IS NOT NULL` | standalone / no explicit transaction | NO | 5 | D05 | pg_indexes 同名 | 同 D18 | 同 D18 forward repair | `.../lifecycle/` |

#### 评审 执行（11 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-049 | forum_review_requirements_state_ck | 评审 | CHECK | forum_review_requirements | state closed set | `... CHECK (state IN ('pending','satisfied','waived'))` | TX | NO | 1 | 表已建（D11） | pg_constraint | 非法 state 拒绝 | 保留 | `.../review/` |
| SQL-050 | forum_review_requirements_revision_fk | 评审 | COMPOSITE FK | forum_review_requirements | 绑定 revision | `ALTER TABLE forum_review_requirements ADD CONSTRAINT forum_review_requirements_revision_fk FOREIGN KEY (thread_id,revision) REFERENCES forum_thread_revisions(thread_id,revision)`（新空表，inline VALID） | TX | 部分 | 2 | D10 | pg_constraint 同名 | 跨 revision 引用拒绝 | 保留 | `.../review/` |
| SQL-051 | forum_review_resolutions_shape_ck | 评审 | CHECK | forum_review_resolutions | kind closed set + response/waiver 形状（全文见 §9.1） | `ALTER TABLE forum_review_resolutions ADD CONSTRAINT forum_review_resolutions_shape_ck CHECK (...)` | TX | NO | 1 | 表已建 | pg_constraint | response 无 message 拒绝；waiver 空 reason 拒绝 | 保留 | `.../review/` |
| SQL-052 | forum_review_resolutions_invalidation_pair_ck | 评审 | CHECK | forum_review_resolutions | invalidation 成对 | `... CHECK ((invalidated_at IS NULL) = (invalidated_by_message_tombstone_id IS NULL))` | TX | NO | 1 | 表已建 | pg_constraint | 单字段失效拒绝 | 保留 | `.../review/` |
| SQL-053 | forum_review_resolutions_one_effective_uq | 评审 | PARTIAL UNIQUE INDEX | forum_review_resolutions | 单 effective | `CREATE UNIQUE INDEX forum_review_resolutions_one_effective_uq ON forum_review_resolutions(requirement_id) WHERE invalidated_at IS NULL` | TX | NO | 2 | SQL-051 | pg_indexes 同名 | 并发 response+waiver 单胜 | 保留 | `.../review/` |
| SQL-054 | forum_review_resolution_guard (function) | 评审 | FUNCTION | — | cross-row 校验 | `CREATE FUNCTION forum_review_resolution_guard() ...`（按 §9.1 六步） | TX | NO | 3 | SQL-049/050/051 | pg_proc 同名 | reviewer/revision 不匹配拒绝；tombstoned message response 拒绝 | 保留 | `.../review/` |
| SQL-055 | forum_review_resolution_guard_tg | 评审 | TRIGGER | forum_review_resolutions | insert/effective update 绑定 | `CREATE TRIGGER forum_review_resolution_guard_tg BEFORE INSERT OR UPDATE ON forum_review_resolutions FOR EACH ROW EXECUTE FUNCTION forum_review_resolution_guard()` | TX | NO | 4 | SQL-054 | pg_trigger 同名 | 同上 | 保留 | `.../review/` |
| SQL-056 | forum_requirement_resolution_consistency (function) | 评审 | FUNCTION | — | state↔effective 一致 | `CREATE FUNCTION forum_requirement_resolution_consistency() RETURNS trigger ... 校验 Requirement.state 与 effective Resolution 匹配` | TX | NO | 3 | SQL-049/053 | pg_proc 同名 | satisfied 无 effective response 拒绝 | 保留 | `.../review/` |
| SQL-057 | forum_requirement_resolution_consistency_tg | 评审 | CONSTRAINT TRIGGER (DEFERRABLE) | forum_review_requirements / forum_review_resolutions | deferred 一致性 | `CREATE CONSTRAINT TRIGGER forum_requirement_resolution_consistency_tg AFTER INSERT OR UPDATE ON forum_review_resolutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION forum_requirement_resolution_consistency()` | TX | NO | 5 | SQL-056 | pg_trigger 同名 | commit 时不一致拒绝 | 保留 | `.../review/` |
| SQL-058 | forum_review_resolutions_invalidation_guard (function) | 评审 | FUNCTION | — | invalidation UPDATE 授权 | `CREATE FUNCTION forum_review_resolutions_invalidation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at OR NEW.invalidated_by_message_tombstone_id IS DISTINCT FROM OLD.invalidated_by_message_tombstone_id) AND current_user = 'forum_app' AND pg_trigger_depth() <= 1 THEN RAISE EXCEPTION 'invalidation only via forum_invalidate_response' USING ERRCODE='42501'; END IF; RETURN NEW; END $$` | TX | NO | 3 | SQL-052 | pg_proc 同名 | forum_app 直接 UPDATE invalidation 列拒绝 | 保留 | `.../review/` |
| SQL-059 | forum_review_resolutions_invalidation_guard_tg | 评审 | TRIGGER | forum_review_resolutions | 绑定 invalidation 授权 | `CREATE TRIGGER forum_review_resolutions_invalidation_guard_tg BEFORE UPDATE ON forum_review_resolutions FOR EACH ROW EXECUTE FUNCTION forum_review_resolutions_invalidation_guard()` | TX | NO | 4 | SQL-058 | pg_trigger 同名 | 同上 | 保留 | `.../review/` |

#### 定稿 执行（9 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-060 | forum_finalizations_provenance_ck | 定稿 | CHECK | forum_finalizations | provenance closed set | `... CHECK (provenance IN ('runtime','migration_derived'))` | TX | NO | 1 | 表已建（D12） | pg_constraint | 非法 provenance 拒绝 | 保留 | `.../finalization/` |
| SQL-061 | forum_finalizations_idempotency_nonempty_ck | 定稿 | CHECK | forum_finalizations | key 非空 | `... CHECK (length(btrim(idempotency_key)) > 0)` | TX | NO | 1 | 表已建 | pg_constraint | empty/whitespace key 拒绝 | 保留 | `.../finalization/` |
| SQL-062 | forum_finalizations_summary_nonempty_ck | 定稿 | CHECK | forum_finalizations | summary 非空 | `... CHECK (length(btrim(outcome_summary_md)) > 0)` | TX | NO | 1 | 表已建 | pg_constraint | empty summary 拒绝 | 保留 | `.../finalization/` |
| SQL-063 | forum_finalizations_semantic_request_version_ck | 定稿 | CHECK | forum_finalizations | version 正整数 | `... CHECK (semantic_request_version > 0)` | TX | NO | 1 | 表已建 | pg_constraint | version<=0 拒绝 | 保留 | `.../finalization/` |
| SQL-064 | forum_finalizations_semantic_request_hash_len_ck | 定稿 | CHECK | forum_finalizations | hash 定长 | `... CHECK (octet_length(semantic_request_hash) = 32)` | TX | NO | 1 | 表已建 | pg_constraint | 非 32 字节 hash 拒绝 | 保留 | `.../finalization/` |
| SQL-065 | forum_finalizations_thread_revision_uq | 定稿 | UNIQUE CONSTRAINT | forum_finalizations | 每 revision 一条（验收引用稳定名，走 raw） | `ALTER TABLE forum_finalizations ADD CONSTRAINT forum_finalizations_thread_revision_uq UNIQUE(thread_id,revision)` | TX | YES（但采用 raw 命名） | 2 | 表已建 | pg_constraint 同名 | duplicate revision 拒绝 | 保留 | `.../finalization/` |
| SQL-066 | forum_finalizations_idempotency_uq | 定稿 | UNIQUE CONSTRAINT | forum_finalizations | key scope | `ALTER TABLE forum_finalizations ADD CONSTRAINT forum_finalizations_idempotency_uq UNIQUE(thread_id,idempotency_key)` | TX | YES（同上） | 2 | 表已建 | pg_constraint 同名 | 同 key 二次插入拒绝（并发 loser 409） | 保留 | `.../finalization/` |
| SQL-067 | forum_finalizations_revision_fk | 定稿 | COMPOSITE FK | forum_finalizations | 绑定 revision | `ALTER TABLE forum_finalizations ADD CONSTRAINT forum_finalizations_revision_fk FOREIGN KEY (thread_id,revision) REFERENCES forum_thread_revisions(thread_id,revision)`（新空表，inline VALID） | TX | 部分 | 2 | D10 | pg_constraint 同名 | 跨 revision 引用拒绝 | 保留 | `.../finalization/` |
| SQL-068 | forum_finalizations_append_only_tg | 定稿 | TRIGGER | forum_finalizations | append-only | `CREATE TRIGGER forum_finalizations_append_only_tg BEFORE UPDATE OR DELETE ON forum_finalizations FOR EACH ROW EXECUTE FUNCTION forum_forbid_mutation()` | TX | NO | 3 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE 拒绝 | 保留 | `.../finalization/` |

#### 删除 执行（6 objects）

| SQL_OBJECT_ID | STABLE_OBJECT_NAME | OWNING_WORKSTREAM | OBJECT_TYPE | TARGET_TABLE | PURPOSE | EXACT_SQL_OR_EXECUTABLE_PSEUDOSQL | TRANSACTION_MODE | PRISMA_EXPRESSIBLE | CREATION_ORDER | DEPENDENCIES | VALIDATION_QUERY | NEGATIVE_TEST | ROLLBACK_OR_FORWARD_REPAIR | EVIDENCE_PATH |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQL-069 | forum_thread_tombstones_reason_ck | 删除 | CHECK | forum_thread_tombstones | reason 非空 | `... CHECK (length(btrim(reason)) > 0)` | TX | NO | 1 | 表已建（D13） | pg_constraint | empty reason 拒绝 | 保留 | `.../deletion/` |
| SQL-070 | forum_message_tombstones_reason_ck | 删除 | CHECK | forum_message_tombstones | reason 非空 | `... CHECK (length(btrim(reason)) > 0)` | TX | NO | 1 | 表已建 | pg_constraint | empty reason 拒绝 | 保留 | `.../deletion/` |
| SQL-071 | forum_thread_tombstones_append_only_tg | 删除 | TRIGGER | forum_thread_tombstones | append-only | `CREATE TRIGGER forum_thread_tombstones_append_only_tg BEFORE UPDATE OR DELETE ON forum_thread_tombstones FOR EACH ROW EXECUTE FUNCTION forum_forbid_mutation()` | TX | NO | 2 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE 拒绝 | 保留 | `.../deletion/` |
| SQL-072 | forum_message_tombstones_append_only_tg | 删除 | TRIGGER | forum_message_tombstones | append-only | 同 SQL-071 形式 | TX | NO | 2 | SQL-009 | pg_trigger 同名 | UPDATE/DELETE 拒绝 | 保留 | `.../deletion/` |
| SQL-073 | forum_review_resolutions_invalidated_by_fk | 删除 | FK NOT VALID (staged) | forum_review_resolutions | staged tombstone FK（B-FK-001） | `ALTER TABLE forum_review_resolutions ADD CONSTRAINT forum_review_resolutions_invalidated_by_fk FOREIGN KEY (invalidated_by_message_tombstone_id) REFERENCES forum_message_tombstones(message_id) NOT VALID` → `VALIDATE CONSTRAINT`（DDL D20） | TX；VALIDATE 独立 | 部分 | 3 | D13、SQL-070 | pg_constraint 同名 + convalidated | 指向不存在 tombstone 拒绝 | 保留；VALIDATE 失败修复数据后重验（D17） | `.../deletion/` |
| SQL-074 | forum_invalidate_response (function) | 删除 | FUNCTION (SECURITY DEFINER) | forum_review_resolutions | 唯一 invalidation 路径（B-SECDEF-001 加固） | `CREATE OR REPLACE FUNCTION public.forum_invalidate_response(resolution_id uuid, tombstone_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN -- 校验 public.forum_message_tombstones.message_id = public.forum_review_resolutions.message_id 且两者当前未失效；成对 UPDATE public.forum_review_resolutions(invalidated_at, invalidated_by_message_tombstone_id)；INSERT public.forum_audit_events；全部对象 schema-qualified END $$`；`REVOKE ALL ON FUNCTION public.forum_invalidate_response(uuid, uuid) FROM PUBLIC`；`GRANT EXECUTE ON FUNCTION public.forum_invalidate_response(uuid, uuid) TO forum_app` | 调用方在删除事务内 | NO | 4 | SQL-052/053/073 | `pg_proc.prosecdef = true`；`pg_proc.proconfig` 含 `search_path=pg_catalog, public`；`pg_get_userbyid(pg_proc.proowner) <> 'forum_app'`；函数 ACL 不向 PUBLIC 提供 EXECUTE；forum_app 拥有 EXECUTE | message 不匹配拒绝；二次失效拒绝；非 forum_app 角色调用返回 42501；篡改 caller search_path 后调用仍访问固定 public schema 对象；普通 UPDATE 仍不能直接 invalidate response | 保留；owner/grants 漂移在 Acceptance 记录真实 owner 与 grants 后修复（owner 必须保持非 forum_app 的 dedicated non-login schema owner） | `.../deletion/` |

Registry 计数（逐行可加和）：

```text
RAW_SQL_OBJECTS_TOTAL = 74
基座 14 + 证据 3 + 身份 11 + 订阅 12 + 状态 8 + 评审 11 + 定稿 9 + 删除 6
```

替代旧口径 `RAW_SQL_CONSTRAINTS_REQUIRED = 27 / PRISMA_ONLY_CONSTRAINTS = 75`：旧数字不可从文档推导复算，本轮按逐对象登记后重新计算为 74 / 64，未保留旧数字。

---

## 10. DDL lock and rewrite analysis

| DDL_ID | OPERATION / TARGET | SQL SHAPE | LOCK / REWRITE | CURRENT ROWS | RISK / COMPATIBILITY | ORDER / TX GROUP |
|---|---|---|---|---:|---|---|
| D01 | 创建五个 Migration tables | `CREATE TABLE` | 新 relation catalog locks；无 rewrite | 0 | 低；旧应用不可见 | 1 / TX-A |
| D02 | 创建 Audit table | `CREATE TABLE` | 新 relation only | 0 | 低 | 2 / TX-A |
| D03 | 创建 PrincipalAlias | `CREATE TABLE` | 新 relation only | 0 | 低 | 3 / TX-B |
| D04 | 现有表添加 actor nullable columns | `ALTER TABLE ADD COLUMN ... NULL` | 每表短暂 ACCESS EXCLUSIVE；PG16 无 heap rewrite | 0–607 | 目标规模未知；设置 lock timeout | 4 / 每表独立 TX |
| D05 | Thread/Message 添加 lifecycle/revision nullable columns | `ADD COLUMN` no default | 短暂 ACCESS EXCLUSIVE；无 rewrite | Thread 90/Message 607 | 旧应用兼容 | 5 / 每表独立 TX |
| D06 | 添加 existing-table actor FK | `ADD CONSTRAINT FK ... NOT VALID` | child/referenced relation lock；无 scan/rewrite | 0–607 | 用 lock timeout | 6 / 每 FK 小组 |
| D07 | 添加 existing lifecycle CHECK | `CHECK ... NOT VALID` | 短暂 ACCESS EXCLUSIVE；无 legacy scan | Thread 90 | 新写受约束，NULL 允许 | 7 / TX |
| D08 | 创建 Participation | `CREATE TABLE` | 新 relation | 0 | 低 | 8 / TX-C |
| D09 | 创建 Watch/Read/Mention/Notification | `CREATE TABLE` | 新 relation | 0 | 低 | 9 / TX-C |
| D10 | 创建 Revision | `CREATE TABLE` | 新 relation | 0 | 低 | 10 / TX-D |
| D11 | 创建 Requirement/Resolution | `CREATE TABLE` | 新 relation | 0 | 低 | 11 / TX-E |
| D12 | 创建 Finalization | `CREATE TABLE` | 新 relation | 0 | 低 | 12 / TX-F |
| D13 | 创建 typed Tombstones | `CREATE TABLE` | 新 relation | 0 | 低 | 13 / TX-G |
| D14 | 新空表普通 indexes | `CREATE INDEX` | SHARE lock，仅新空表；无业务写阻塞 | 0 | 可事务内 | 随各 create table |
| D15 | Watch/Resolution partial unique | `CREATE UNIQUE INDEX ... WHERE` | SHARE lock，仅新空表 | 0 | 可事务内 | 随对应表 |
| D16 | functions/triggers/grants | `CREATE FUNCTION/TRIGGER`, `REVOKE` | 新表短暂 SHARE ROW EXCLUSIVE/catalog lock；无 rewrite | 0 | 低；必须负向测试 | 独立 TX-H |
| D17 | validate nullable FK/CHECK | `VALIDATE CONSTRAINT` | referencing table SHARE UPDATE EXCLUSIVE；heap scan；无 rewrite | 0–607 | 目标大表时耗时由行数/I/O决定 | 每约束独立 |
| D18 | 现有表新增查询 index | `CREATE INDEX CONCURRENTLY` | 允许 DML；多阶段 scan/wait；无 rewrite | 0–607 | 失败可能留下 invalid index | standalone，无显式 transaction |
| D19 | Thread currentRevision composite FK | `ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_current_revision_fk FOREIGN KEY (id,current_revision) REFERENCES forum_thread_revisions(thread_id,revision) NOT VALID` | 两 relation catalog lock；无 scan（NOT VALID） | 90 | NULL 不参与匹配；VALIDATE 在 D17 | 10 后 / TX-D（registry SQL-046） |
| D20 | Resolution staged tombstone FK | `ALTER TABLE forum_review_resolutions ADD CONSTRAINT forum_review_resolutions_invalidated_by_fk FOREIGN KEY (invalidated_by_message_tombstone_id) REFERENCES forum_message_tombstones(message_id) NOT VALID` + 后续 `VALIDATE CONSTRAINT` | catalog lock；NOT VALID 无 scan；VALIDATE SHARE UPDATE EXCLUSIVE | 0 | 删除 执行 专属；依赖 D13 | 13 后 / TX-G（registry SQL-073） |

### 10.1 Rewrite 风险

不允许在 Phase 2 使用：

- 非空 volatile default；
- `SET NOT NULL`；
- 有数据列的类型重写；
- stored generated column；
- table rewrite 型 enum/type conversion；
- destructive drop/rename；
- 在同 migration 内 backfill。

### 10.2 Prisma Migrate 承载方式

- Prisma schema 表达 models、columns、普通 relation/unique/index。
- 生成 migration 后人工审查 SQL。
- raw CHECK、partial unique、trigger、`NOT VALID` FK 追加到 migration SQL。
- `CREATE INDEX CONCURRENTLY` 必须独立为不含 `BEGIN/COMMIT` 的 migration 单元。
- 不得把 CIC 放入显式 migration transaction。
- 必须在 Prisma 5.22.0 上实际验证 deploy 失败恢复和 migration 状态。
- CIC 失败时只允许 forward repair：
  1. 检测 invalid index；
  2. `DROP INDEX CONCURRENTLY`；
  3. 修复原因后重新执行；
  4. 保存证据。

---

## 11. Per-operation rollback plan

Phase 2 默认 rollback 是**应用回退并保留 additive schema/evidence**，不是 down migration。

| DDL_ID | ROLLBACK_APPLICATION_PATH | ROLLBACK_SCHEMA_ACTION | EVIDENCE_PRESERVED | DESTRUCTIVE | WHEN ALLOWED |
|---|---|---|---|---|---|
| D01 | 旧应用不引用 migration tables | 保留表 | YES | NO | cleanup 后另行决定 |
| D02 | 停止任何新 audit writer；旧 app 回退 | 保留 Audit 与已写证据 | YES | NO | 不默认 DROP |
| D03 | 旧 resolver 继续旧字段 | 保留 alias 表 | YES | NO | 独立 cleanup gate |
| D04 | 旧 app 忽略 nullable columns | 保留列 | YES | NO | 无数据且独立审批后才可删 |
| D05 | 旧 status/deletedAt 路径继续 | 保留 lifecycle/revision 列 | YES | NO | 不作为事故回滚 DROP |
| D06 | 旧 app 不使用新 FK | 保留 FK；若 FK DDL 本身失败由事务回滚 | YES | NO | 仅阻断故障可 forward repair |
| D07 | NULL 兼容旧路径 | 保留 CHECK | YES | NO | 独立证据证明不需要时 |
| D08 | 旧 Participant 继续 | 保留空 Participation | YES | NO | cleanup gate |
| D09 | 旧 Watch/Read/notifications 继续 | 保留空表 | YES | NO | cleanup gate |
| D10 | 旧 Thread.status 继续 | 保留空 Revision | YES | NO | cleanup gate |
| D11 | 旧 readiness 继续 | 保留空 Review tables | YES | NO | cleanup gate |
| D12 | 旧 resolve 路径继续 | 保留空 Finalization | YES | NO | cleanup gate |
| D13 | 旧 deletion 字段继续 | 保留空 Tombstones | YES | NO | cleanup gate |
| D14 | 无应用依赖 | 保留 indexes | YES | NO | 性能证据后可单独 DROP |
| D15 | 无应用依赖 | 保留 partial indexes | YES | NO | 不默认删除约束 |
| D16 | 旧 app 不写新表 | 保留 triggers/grants | YES | NO | trigger 自身阻断旧路径时 forward fix |
| D17 | validation 失败不切换应用 | 修复数据/约束后重验，不 DROP evidence | YES | NO | validation phase 决定 |
| D18 | 旧 app 继续 | invalid index 用 `DROP INDEX CONCURRENTLY` forward repair | YES | 仅 invalid index | 仅失败恢复 |
| D19 | 旧 app 不写 current_revision | 保留 composite FK；NULL 行为不受影响 | YES | NO | cleanup gate |
| D20 | 旧 app 不写 invalidation 列 | 保留 staged FK；评审阶段语义不受影响 | YES | NO | cleanup gate；VALIDATE 失败修复数据后重验 |

```text
ROLLBACK_OPERATIONS_DEFINED = 20
ADDITIVE_ROLLBACK_SAFETY = PASS
```

---

## 12. Option C and quarantine storage

Phase 2：

```text
MigrationRun rows = 0
MigrationLegacyEvidence rows = 0
MigrationFieldDecision rows = 0
MigrationQuarantine rows = 0
MigrationValidationResult rows = 0

canonical Participation rows = 0
Watch rows = 0
Read State rows = 0
Review rows = 0
Revision rows = 0
Finalization rows = 0
Tombstone rows = 0
```

Phase 3 才允许：

- 读取已完成 Inventory classification；
- 为每个 legacy source row 建 evidence；
- 对每个字段建立 FieldDecision；
- 只把 one-to-one proven 值写入 canonical projection；
- ambiguity/unprovable 写 quarantine；
- 保留原 legacy rows。

Option C 字段行为：

| 历史事实 | Canonical projection | Evidence/quarantine |
|---|---|---|
| Participant identity 唯一可证 | 可投影 principal | 保存 source namespace/hash |
| role/status 冲突 | NULL/unknown | 两个安全值摘要 + reason |
| joinedAt 冲突 | NULL | quarantine |
| lastReadAt 冲突 | ReadState unknown | 禁止选 max/latest |
| Watch 当前状态源行一致 | active/inactive 可投影 | source=unknown，provenance=migration |
| Watch origin | 不投影 | unknown |
| unresolved Participant | 不建 Principal/authority row | quarantine |
| archived visibility | later 可投影 archived | discussion legacy_unknown 进 quarantine |
| historical Review | 不建 Requirement/Response/Waiver | `none_proven` policy decision |
| historical Outcome/Finalization | 仅按 `CTR-MIG-003` direct evidence | unknown archived 不补造 |

---

## 13. Alternatives and recommendations

| Decision | Alternatives | Recommendation |
|---|---|---|
| Watch | current row；interval history | interval history + active partial unique；支持 rewatch provenance |
| Read unknown | `lastReadSeq=NULL`；显式 state | 显式 `known|unknown`；避免“未读过”与“不可证明”混淆 |
| Review evidence | Response/Waiver 两表；Requirement pointer；单 Resolution | 单 `ForumReviewResolution` + kind + effective partial unique |
| Lifecycle | 主表三个状态字段；Revision 表 | Thread visibility/currentRevision + Revision discussion state |
| Revision monotonicity | sequence；trigger；CAS | row lock/CAS + UNIQUE 为主，trigger 防御 |
| Finalization/Outcome | 一对一分表；同表 | 同表；彻底消除 orphan/circular FK |
| Tombstone | 主表字段；generic；typed tables | Thread/Message typed tombstones |
| Runtime state encoding | PostgreSQL enum；TEXT+CHECK | TEXT+named CHECK，升级和回滚风险更低 |
| Audit | stderr；普通 mutable table；append-only table | append-only DB table + grant + trigger |
| Migration evidence | 完整复制 legacy row；hash-only；bounded snapshot | hash + row reference + allowlisted bounded snapshot |
| Legacy Outcome | 直接标 authoritative；按 latest 选；保留非权威 | 永不自动 authoritative；只由 Finalization 产生 authority |
| Notification | 完全实时 derived；持久 fact | 持久 NotificationFact，unread 状态由 ReadState 派生 |

---

## 14. Complete workstream decomposition

所有任务均为 Phase 2 additive storage；`PRODUCT_CODE_CHANGED=NO` 指不切换业务 runtime path，允许 Prisma schema、migration SQL、migration test/harness 变更。

**Migration lineage 约束（B-LINEAGE-001）**：任一触及 `svc-forum/prisma/schema.prisma` 或 `svc-forum/prisma/migrations/**` 的任务，authoring 与 merge 均严格串行（见 §15 冻结块）；下表 `PARALLEL_WITH` 仅表示非 schema 准备工作（调查、测试设计、不生成 migration 的代码）可并行。

| TASK_NAME / TYPE | CONTRACT_SUBSET | DEPENDENCIES | CHANGED_MODELS / DDL_SCOPE | PRODUCT CODE | BF / DUAL WRITE / CUTOVER | PARALLEL_WITH | AUDIT_TASK |
|---|---|---|---|---|---|---|---|
| **基座 执行** / 执行 | MIG-001,004,005 | persisted READY report + independent audit | 五个 Migration models；基础 CHECK/FK/index；sealed guard；rerun identity | NO | NO/NO/NO | NONE，最先 | 基座 审计 |
| **证据 执行** / 执行 | ID-005, MIG-004,005, DELETE-003 | 基座 | ForumAuditEvent、append-only grants/triggers | NO | NO/NO/NO | 身份 执行（仅非 schema 准备） | 证据 审计 |
| **身份 执行** / 执行 | ID-001..005, AUTHZ-002..004 | 基座 | PrincipalAlias；13 个 nullable existing columns；NOT VALID FK | NO | NO/NO/NO | 证据 执行（仅非 schema 准备） | 身份 审计 |
| **订阅 执行** / 执行 | AUTHZ-005, REVIEW-001, MIG-002 | 身份 | Participation、Watch、Read、Mention、Notification | NO | NO/NO/NO | 状态 执行（仅非 schema 准备） | 订阅 审计 |
| **状态 执行** / 执行 | AUTHZ-001,006, LIFE-001..005 | 身份 | Thread lifecycle columns、Revision、revision FK/trigger、composite FK（D19）、CIC | NO | NO/NO/NO | 订阅 执行（仅非 schema 准备） | 状态 审计 |
| **评审 执行** / 执行 | REVIEW-001..007 | 状态、身份 | Requirement、Resolution（`invalidated_by_message_tombstone_id` 仅 scalar、无 relation/FK）、partial unique、guards | NO | NO/NO/NO | NONE | 评审 审计 |
| **定稿 执行** / 执行 | FINAL-001..005, MIG-003 | 评审、状态、身份 | Finalization inline Outcome、idempotency（version/hash）、immutable guard | NO | NO/NO/NO | NONE | 定稿 审计 |
| **删除 执行** / 执行 | DELETE-001..003, LIFE-005, REVIEW-007 | 定稿、评审、状态、身份、证据 | typed Tombstones、reason checks、audit linkage、staged FK（D20）+ `forum_invalidate_response` | NO | NO/NO/NO | NONE | 删除 审计 |

---

## 15. Parallel/serial dependency graph

逻辑依赖图：

```text
报告持久化
  → 独立存储审计通过
    → 基座 执行
      ├─ 证据 执行 ─────────────────────┐
      └─ 身份 执行                      │
           ├─ 订阅 执行 ────────────────┤
           └─ 状态 执行                 │
                 → 评审 执行            │
                      → 定稿 执行        │
                           → 删除 执行 ←─┘
```

### 15.1 Prisma migration lineage 冻结（B-LINEAGE-001）

```text
PARALLEL_INVESTIGATION_ALLOWED = YES
PARALLEL_NON_SCHEMA_AUTHORING_ALLOWED = YES
PARALLEL_SCHEMA_AUTHORING_ALLOWED = NO
PARALLEL_MERGE_ALLOWED = NO
MIGRATION_LINEAGE = SERIAL
```

任何修改以下路径的任务，authoring 与 merge 均严格串行：

```text
svc-forum/prisma/schema.prisma
svc-forum/prisma/migrations/**
```

**Migration merge chain（固定线性）**：

```text
基座 执行 → 基座 审计 → 基座 合并
→ 证据 执行 → 证据 审计 → 证据 合并
→ 身份 执行 → 身份 审计 → 身份 合并
→ 订阅 执行 → 订阅 审计 → 订阅 合并
→ 状态 执行 → 状态 审计 → 状态 合并
→ 评审 执行 → 评审 审计 → 评审 合并
→ 定稿 执行 → 定稿 审计 → 定稿 合并
→ 删除 执行 → 删除 审计 → 删除 合并
```

串行规则：

1. 每个 migration workstream 必须从**前一 migration PR 已合并的最新 `origin/main`** 创建全新 worktree 开始；
2. 前一个 migration PR 合并后，下一个任务才允许启动 schema authoring；
3. 使用单一线性 Prisma migration lineage：不允许两个分支从同一 schema base 各自生成 migration 后合并；
4. 不允许只靠 rebase 解决 migration 目录冲突：base 漂移时必须 rebase 后由 `prisma migrate` **重新生成** migration（记录重生成证据：新旧 migration ID/checksum）；
5. 不允许并行 merge migration PR；
6. 若提前进行了非 Schema 设计（调查、测试设计、不触碰 schema/migration 的代码），可并行进行；真正创建 migration 时必须重新从最新 main 开始。

每个 Schema PR 必须报告并持久化：

```text
PREVIOUS_MAIN
PREVIOUS_MIGRATION_TIP
NEW_MIGRATION_ID
NEW_MIGRATION_CHECKSUM
MIGRATION_STATUS
NEXT_ALLOWED_WORKSTREAM
```

每个 Schema PR 必须执行并持久化：

```text
prisma migrate status
clean database apply
current snapshot apply
second deploy no-op
migration history consistency
```

### 15.2 并行/串行声明

并行关系（仅限 §15.1 定义的非 schema 工作）：

```text
PARALLEL_WORKSTREAMS (non-schema only) =
[证据 执行 || 身份 执行],
[订阅 执行 || 状态 执行]
```

串行依赖（逻辑 + migration merge chain）：

```text
SERIAL_DEPENDENCIES =
基座 → 证据 → 身份 → 订阅 → 状态 → 评审 → 定稿 → 删除
（migration merge chain 顺序；逻辑依赖基座 → 身份 → 状态 → 评审 → 定稿 → 删除、
  基座 → 身份 → 订阅、基座 → 证据 → 删除 均被该线性链满足）
```

- Revision 基础完成前不得开始评审。
- Review 基础完成前不得开始定稿。
- 删除中的 Review response invalidation 和 immutable Finalization preservation 依赖评审与定稿结构，因此删除必须最后。
- `PARALLEL_WORKSTREAMS` 仅表示逻辑依赖上的可并行调研与非 schema 产物准备；触及 schema/migration 的 PR 一律走 §15.1 线性链。

---

## 16. First implementation task

```text
RECOMMENDED_FIRST_IMPLEMENTATION_TASK =
基座 执行

BASE_TASK_ALLOWED_TO_START =
NO
（本 PR 通过重新独立审计、disposition 变为 adopted 并合入 main 前不得启动）
```

范围严格限制为：

- `MigrationRun`
- `MigrationLegacyEvidence`
- `MigrationFieldDecision`
- `MigrationQuarantine`
- `MigrationValidationResult`
- 对应 PK/FK/CHECK/INDEX
- migration apply/rollback/old-app compatibility tests

禁止同时加入：

- actor backfill；
- 185 条 evidence 导入；
- lifecycle/read/watch/review projection；
- runtime writer；
- dual-read/write；
- authority switch。

该任务最小、锁风险低，且为所有后续 Phase 3/4 evidence 提供稳定容器。

---

## 17. Acceptance evidence plan

### 17.1 全 workstream 通用证据

每个 Phase 2 workstream 必须执行并持久化：

```text
SOURCE_COMMIT
MIGRATION_CHECKSUM
PRISMA_SCHEMA_HASH
POSTGRES_VERSION
APPLY_STARTED_AT / FINISHED_AT
SCHEMA_DIFF_BEFORE_AFTER
ROW_COUNTS_BEFORE_AFTER
OLD_TABLE_HASHES_BEFORE_AFTER
NEW_TABLE_EMPTY_ASSERTION
NO_BACKFILL_ASSERTION
NO_DUAL_WRITE_ASSERTION
LOCK_TIMEOUT
STATEMENT_TIMEOUT
PG_LOCKS_OBSERVATION
RELATION_FILENODE_BEFORE_AFTER
MIGRATION_RERUN_RESULT
APPLICATION_DOWNGRADE_RESULT
ROLLBACK_REFERENCE
```

通用测试：

1. clean database apply；
2. current schema snapshot apply；
3. second `prisma migrate deploy` no-op；
4. migration failure/retry；
5. old application build/start/test on additive schema；
6. app rollback/downgrade；
7. all new business/evidence tables empty；
8. existing business rows unchanged；
9. no new read/write path；
10. raw SQL constraints physically present于 `pg_constraint/pg_indexes/pg_trigger`；
11. `prisma generate`；
12. `pnpm typecheck`/`npm run typecheck`；
13. full `tests/*.test.ts`；
14. DDL lock observation；
15. CIC invalid-index recovery rehearsal where applicable。

### 17.2 Per-workstream plan

| WORKSTREAM | CONTRACT_IDS | APPLY / ROLLBACK / OLD APP | EMPTY / NO BF / NO DUAL WRITE | CONSTRAINT TEST | LOCK / TOOLING / SUITE | FUTURE EVIDENCE PATH |
|---|---|---|---|---|---|---|
| 基座 | MIG-001,004,005 | clean+snapshot apply；old app start；app rollback；schema retained | 五表均 0；旧表 hash 相同 | invalid classification/status/category/result rejected；selected_ck 真值表六格全验（deterministic+NULL/non-NULL ACCEPT；ambiguous+NULL ACCEPT、ambiguous+selected REJECT；unprovable+NULL ACCEPT、unprovable+selected REJECT）；duplicate rerun_identity/attempt rejected；sealed/terminal run UPDATE/DELETE rejected；非法 status 转移 rejected；identity 列改写 rejected | CREATE TABLE locks；Prisma generate/typecheck/full tests | `docs/investigations/evidence/additive-storage/base/` |
| 证据 | ID-005,MIG-004,005,DELETE-003 | Audit apply；旧 app不写表；回退后表保留 | Audit 0；无 stderr→DB dual write | Audit UPDATE/DELETE/TRUNCATE rejected（trigger+grant 双验证）；payload boundaries；invalid provenance rejected | trigger/grant catalog；lock duration | `.../audit/` |
| 身份 | ID-001..005,AUTHZ-002..004 | nullable columns/FK apply；旧 app CRUD suite；rollback app | 所有新增 actor 列 NULL；Alias 0 | invalid FK rejected on explicit test row；alias reassignment rejected；invalid namespace rejected | ADD COLUMN filenode unchanged；NOT VALID/VALIDATE observations | `.../identity/` |
| 订阅 | AUTHZ-005,REVIEW-001,MIG-002 | tables apply；旧 awareness suite unchanged | 六表 0；Participant 不复制 | second active Watch rejected；ended intervals allowed；Read unknown/known invalid shapes rejected；cursor 回退 rejected；invalid closed-set values rejected | partial indexes catalog；Prisma types | `.../subscription/` |
| 状态 | AUTHZ-001,006,LIFE-001..005 | nullable lifecycle+Revision apply；旧 status behavior unchanged | Revision 0；currentRevision/visibility NULL | invalid state/revision rejected；jump/decrease/clear UPDATE rejected；revisions 跳号/前置 INSERT rejected；orphan pointer 被 composite FK 拒绝；initial revision 非 1 拒绝 | Thread ADD COLUMN lock；composite FK catalog；CIC invalid-index 演练 | `.../lifecycle/` |
| 评审 | REVIEW-001..007 | Review tables apply；旧 readiness tests unchanged | Requirement/Resolution 0；历史 reviewer 不导入；invalidated_by 列无 FK 且全 NULL | duplicate req；response+waiver conflict；empty reason；mismatched actor/thread/revision；DELETE req rejected；waiver 重放返回原行（不 409）；无 tombstone 的 invalidation UPDATE 拒绝；单字段 invalidation 拒绝；并发 response+waiver 单胜 | trigger/partial index evidence；negative SQL tests | `.../review/` |
| 定稿 | FINAL-001..005,MIG-003 | Finalization apply；旧 Outcome/resolve suite unchanged | Finalization 0；legacy Outcome authorityKind NULL | duplicate revision/key；empty key/summary；UPDATE/DELETE rejected；same key+different payload 409；same key+same hash 返回原行；canonical JSON key-order/Unicode NFC 等价返回原行；null/array 差异 409；different actor 409；stale revision 409；changed readiness 409；version mismatch 拒绝；hash 非 32 字节拒绝 | failure-safe migration；Prisma generate/typecheck | `.../finalization/` |
| 删除 | DELETE-001..003,LIFE-005,REVIEW-007 | Tombstones apply；旧 deletedAt/status behavior unchanged | Tombstones 0；不补 deleted rows；staged FK VALIDATE 通过（全 NULL） | empty reason rejected；bad actor/target FK；mutation rejected；指向不存在 tombstone 的 invalidation 拒绝；`forum_invalidate_response` 成对失效成功且仅一次；message 不匹配拒绝；非 forum_app 角色调用函数返回 42501；修改 caller search_path 后调用仍访问固定 public schema 对象；PUBLIC 不具有 EXECUTE；forum_app 具有 EXECUTE；function owner 不是 forum_app；普通 UPDATE 仍不能直接 invalidated response | trigger/grant catalog；full report/search suite | `.../deletion/` |

每个 workstream 行同时适用 §15.1 串行 lineage 验收：报告 `PREVIOUS_MAIN / PREVIOUS_MIGRATION_TIP / NEW_MIGRATION_ID / NEW_MIGRATION_CHECKSUM / MIGRATION_STATUS / NEXT_ALLOWED_WORKSTREAM`，并执行 `prisma migrate status`、clean apply、current snapshot apply、second deploy no-op、migration history consistency。

### 17.3 DDL lock evidence

每次对既有表执行 DDL，应记录：

- `pg_locks`
- waiting/blocking PID
- lock acquisition duration
- statement duration
- relation size
- relation filenode before/after
- WAL delta
- `lock_timeout` failure rehearsal
- 是否发生 table rewrite
- CIC 是否生成 invalid index

```text
DDL_OPERATIONS_ANALYZED = 20
ROLLBACK_OPERATIONS_DEFINED = 20
ACCEPTANCE_EVIDENCE_PLAN = COMPLETE
```

Phase 2 evidence只能证明 additive storage 结构就绪，不能宣称全部 runtime Contracts 已实现或 conformance verified。

---

## 18. Final gates

```text
TASK_NAME = 存储 调查
TASK_TYPE = 调查

NEW_AGENT_SESSION = YES

WORKTREE_CREATED = YES
WORKTREE_REUSED = NO

REMOTE_MAIN_AT_START =
fc384870df10fcf863ca651e73efbb5d5277bed9

START_COMMIT_FACT =
fc384870df10fcf863ca651e73efbb5d5277bed9

END_COMMIT_FACT =
fc384870df10fcf863ca651e73efbb5d5277bed9

COMMIT_SWITCH_OCCURRED =
NO

EVIDENCE_COLLECTED_ON_SINGLE_COMMIT =
YES

WORKTREE_HEAD =
fc384870df10fcf863ca651e73efbb5d5277bed9

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_CORE_INVARIANTS_V1

MIGRATION_POLICY =
OPTION_C

POLICY_DECISION_REOPENED =
NO

BLOCKER_ID_001_PHASE_2_GATE =
NO

BLOCKER_ID_002_PHASE_2_GATE =
NO

BLOCKER_LIFE_001_PHASE_2_GATE =
NO

HISTORICAL_REVIEW_PHASE_2_GATE =
NO

BLOCKER_ENV_001 =
OPEN_FOR_FUTURE_BACKFILL_VALIDATION_AND_CUTOVER

BLOCKER_ENV_001_GATES_PHASE_2 =
NO

BLOCKER_ENV_001_GATES_BACKFILL =
YES

BLOCKER_ENV_001_GATES_PRODUCTION_SHAPED_VALIDATION =
YES

BLOCKER_ENV_001_GATES_CUTOVER =
YES

BLOCKER_ENV_001_GATES_CLEANUP =
YES

PHASE_2_EXECUTION_ALLOWED =
YES

BACKFILL_ALLOWED =
NO

DUAL_READ_ALLOWED =
NO

DUAL_WRITE_ALLOWED =
NO

AUTHORITY_SWITCH_ALLOWED =
NO

CUTOVER_ALLOWED =
NO

CURRENT_MODELS_REVIEWED =
9

CURRENT_FIELDS_MAPPED =
26

CONTRACTS_MAPPED =
36

CANDIDATE_NEW_MODELS =
ForumPrincipalAlias,
ForumParticipation,
ForumWatchSubscription,
ForumReadState,
ForumMention,
ForumNotificationFact,
ForumThreadRevision,
ForumReviewRequirement,
ForumReviewResolution,
ForumFinalization,
ForumThreadTombstone,
ForumMessageTombstone,
ForumAuditEvent,
MigrationRun,
MigrationLegacyEvidence,
MigrationFieldDecision,
MigrationQuarantine,
MigrationValidationResult

CANDIDATE_ADDITIVE_COLUMNS =
ForumThread.creatorPrincipalId,
ForumThread.visibilityState,
ForumThread.currentRevision,
ForumThreadMessage.authorPrincipalId,
ForumThreadMessage.discussionRevision,
ForumThreadView.viewerPrincipalId,
ForumOutcome.createdByPrincipalId,
ForumOutcome.authorityKind,
ForumContextSnapshot.takenByPrincipalId,
ForumContextSnapshot.discussionRevision,
ForumReport.reporterPrincipalId,
ForumReport.handledByPrincipalId,
ForumReaction.actorPrincipalId

RAW_SQL_CONSTRAINTS_REQUIRED =
74

PRISMA_ONLY_CONSTRAINTS =
64

DDL_OPERATIONS_ANALYZED =
20

ROLLBACK_OPERATIONS_DEFINED =
20

IMPLEMENTATION_WORKSTREAMS =
基座 执行,
证据 执行,
身份 执行,
订阅 执行,
状态 执行,
评审 执行,
定稿 执行,
删除 执行

PARALLEL_WORKSTREAMS (non-schema only) =
[证据 执行 || 身份 执行],
[订阅 执行 || 状态 执行]

PARALLEL_INVESTIGATION_ALLOWED =
YES

PARALLEL_NON_SCHEMA_AUTHORING_ALLOWED =
YES

PARALLEL_SCHEMA_AUTHORING_ALLOWED =
NO

PARALLEL_MERGE_ALLOWED =
NO

MIGRATION_LINEAGE =
SERIAL

SERIAL_DEPENDENCIES =
基座 → 证据 → 身份 → 订阅 → 状态 → 评审 → 定稿 → 删除
（migration merge chain；逻辑依赖均被满足）

RECOMMENDED_FIRST_IMPLEMENTATION_TASK =
基座 执行

ACCEPTANCE_EVIDENCE_PLAN =
COMPLETE

OPTION_C_STORAGE_SUPPORT =
PASS

ADDITIVE_ROLLBACK_SAFETY =
PASS

REPORT_COMPLETENESS =
PASS

REPORT_READY_TO_PERSIST =
YES

SPEC_GAP_COUNT =
0

OWNER_DECISIONS_REQUIRED =
0

STORAGE_DESIGN_STATUS =
READY

AMENDMENT_REVIEWER =
AF-STORAGE-REAUDIT-R1; AF-STORAGE-AMEND-REAUDIT-R1

AMENDMENT_PRIOR_HEAD =
d69c705009fff633f4d3e57062f64755a5027c62; d44509c9731c31b92e72901f8ddd5768d383caaa

AMENDMENT_SCOPE =
DOCS_ONLY_DESIGN_AMENDMENT

B_REV_001_AMENDED = YES
B_FK_001_AMENDED = YES
B_IDEMP_001_AMENDED = YES
B_MODEL_001_AMENDED = YES
B_SQL_001_AMENDED = YES
B_LINEAGE_001_AMENDED = YES
B_RW_001_AMENDED = YES

B_CHK_001_AMENDED = YES
B_SECDEF_001_AMENDED = YES

RESPONSE_WAIVER_EXCLUSION_AMENDED = YES

B_LINK_001 = NOT_A_BLOCKER
STABLE_LINK_REVIEW = PASS

OPTION_C_POLICY_CHANGED = NO
QUARANTINE_POLICY_CHANGED = NO
STABLE_LINKS_CHANGED = NO

FRESH_INDEPENDENT_REVIEW_REQUIRED = YES

REPORT_ID =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

RECOMMENDED_REPORT_PATH =
docs/investigations/INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md
```

---

## 19. No-change gate and next action

结束检查：

```text
git rev-parse HEAD =
fc384870df10fcf863ca651e73efbb5d5277bed9

git status --short =
<empty>
```

最终状态：

```text
FILES_MODIFIED = 0
COMMITS_CREATED = 0
PUSH_PERFORMED = NO
PR_CREATED = NO
PR_UPDATED = NO

SCHEMA_CHANGED = NO
MIGRATION_CREATED = NO
DATABASE_WRITES = 0
BACKFILL_EXECUTED = NO
DUAL_READ_ENABLED = NO
DUAL_WRITE_ENABLED = NO
CUTOVER_EXECUTED = NO
DEPLOYMENT_CHANGED = NO

NEXT_TASK =
存档 执行
```

## Stable links

- Governing Spec:
  [`AGENT_FORUM_CORE_INVARIANTS_V1`](../specs/AGENT_FORUM_CORE_INVARIANTS_V1.md)
- Option C policy:
  [`INV-AGENT-FORUM-MIGRATION-OPTION-C-V1`](INV-AGENT-FORUM-MIGRATION-OPTION-C-V1.md)
- Inventory report:
  [`RPT-AGENT-FORUM-INVENTORY-V1`](reports/RPT-AGENT-FORUM-INVENTORY-V1.md)
- Supplemental evidence report:
  [`RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1`](reports/RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1.md)
- Investigation index:
  [`docs/investigations/README.md`](README.md)
- Investigation PR:
  to be bound by the Draft PR created for this record
