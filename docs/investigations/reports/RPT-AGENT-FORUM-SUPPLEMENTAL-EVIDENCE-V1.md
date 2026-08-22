```text
REPORT_ID = RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1
TASK_NAME = 补证 调查
TASK_TYPE = 调查
PERSISTED_AS = repository_report
SOURCE_SESSION_ID = session-f90d1be4-453a-49bb-ab59-c79ae758efa0
DEPLOYMENT_ENVIRONMENT = local-only
DEPLOYMENT_BINDING = DETERMINISTIC
BLOCKER-ENV-001 = OPEN
LOCAL_COPY_REPRESENTATIVE = UNPROVEN
HISTORICAL_REVIEW_EVIDENCE = UNAVAILABLE
```

# Agent Forum 补证调查报告

## 1. 结论

- 当前仅发现**本地 Docker 部署**，仓库配置明确标注“不部署生产环境，仅本地开发”。
- 未获得 production、production snapshot 或受控 production-shaped staging 数据。
- 因此 **BLOCKER-ENV-001 仍 OPEN**，不能宣称 Inventory 完成。
- 本地部署数据库复查仍有：
  - 91 个 Participant canonical collision group，182 行；
  - 1 个无直接身份映射的 Participant；
  - 2 个 archived Thread 无法证明历史 discussion state。
- 无历史 Review Requirement、waiver 或生命周期操作的持久审计证据，无法证明或排除历史 bypass。

## 2. 治理门禁

```text
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
PREFLIGHT_MODE = REUSE
AUTHORITY_CONFLICT = NONE
```

治理验证：

```text
vendored governance bytes match governance.lock.json and adoption is accepted
```

本轮保持在 `CTR-MIG-001` 的 Inventory evidence gathering 阶段，未进入 additive schema/storage。

## 3. 部署身份证据

```text
DEPLOYMENT_SERVICE = svc-forum
APPLICATION_CONTAINER = svc-forum
DATABASE_CONTAINER = svc-forum-postgres
IMAGE_REPOSITORY = svc-forum
IMAGE_TAG = 502cfca
IMAGE_BUILD_TIMESTAMP = 2026-08-14T00:26:27.067896708Z
CONTAINER_CREATED_AT = 2026-08-14T00:26:34.979779587Z
CONTAINER_STARTED_AT = 2026-08-14T00:26:45.837200467Z
NODE_ENV = production
COMPOSE_CONFIG_HASH = d747ac6f48bb6ed815730f214a7015961c7dc7f54b264caa8838983de8050632
```

运行数据库坐标：

```text
INTERNAL_DATABASE = postgres:5432/svc_forum/public
PUBLISHED_DATABASE = 127.0.0.1:5434/svc_forum/public
DATABASE_SECRET = REDACTED
```

部署 commit 绑定证据：

- image tag `502cfca` 唯一解析为：
  `502cfca5a180d6c49fe75dfc270fd117f279ccfb`
- 对 Dockerfile 实际复制进 image 的 `src/`、`prisma/`、package lock、tsconfig 和 entrypoint 共 **62 个文件**逐一比较 SHA-256：
  - `COPIED_FILES_CHECKED=62`
  - `CONTENT_MISMATCHES=0`
- image digest 与运行容器 image ID 完全相同。
- 部署 commit 是预期 main 的祖先，但落后 **16 commits**，不是当前 main。

```text
DEPLOYED_COMMIT = 502cfca5a180d6c49fe75dfc270fd117f279ccfb
DEPLOYED_IMAGE_DIGEST = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
DEPLOYMENT_BINDING = DETERMINISTIC
DEPLOYED_COMMIT_EQUALS_EXPECTED_MAIN = NO
DEPLOYED_COMMIT_BEHIND_MAIN = 16
```

没有 OCI revision label 或 CI provenance，但 immutable digest、完整复制文件内容和精确 Git object 三者一致，足以绑定当前本地部署。

环境分类依据：

- `svc-forum/deploy.yaml` 明确写明“不部署生产环境，仅本地开发”；
- 无有效 Kubernetes context；
- 没有发现远程 production/staging manifest 或生产只读数据库入口；
- `NODE_ENV=production` 只是运行配置，不足以将本地部署认定为 production-shaped。

## 4. 数据库只读门禁

所有查询均在同一个事务中执行：

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT ...;
ROLLBACK;
```

结果：

```text
transaction_read_only = on
ACCOUNT_LEVEL_READ_ONLY = NO
TRANSACTION_LEVEL_READ_ONLY = YES
ACCOUNT_SUPERUSER = YES
```

快照坐标：

```text
LOCAL_ONLY_DATASET_ID = 084dbc8cd4e180dbd984a389c5cf28d6
LOCAL_ONLY_SNAPSHOT_AT = 2026-08-21T14:28:57.377760Z
QUERY_END_AT = 2026-08-21T14:28:57.410036Z
DATABASE_VERSION = PostgreSQL 16.14
MIGRATION_COUNT = 11
MIGRATION_SET_HASH = 9e41cf8a06708c2b3ff8560245a01472
```

没有调用会记录 view、lastSeenAt 或其他派生状态的 GET API。

## 5. 本地部署数据库盘点

| 对象 | 数量 |
|---|---:|
| ForumPrincipal | 90 |
| Thread | 90 |
| Message | 607 |
| Participant | 389 |
| ThreadView | 79 |
| Mention | 486 |
| Outcome | 0 |
| Reaction | 0 |
| Report | 0 |
| ContextSnapshot | 0 |
| deleted Thread | 0 |
| deleted Message | 0 |

Thread：

```text
open = 88
archived = 2
resolved = 0
deleted = 0
```

Participant：

| role/status | 行数 | active | left | lastReadAt null/set |
|---|---:|---:|---:|---:|
| creator/responded | 89 | 89 | 0 | 35/54 |
| member/active | 207 | 206 | 1 | 32/175 |
| member/invited | 93 | 93 | 0 | 92/1 |

## 6. Participant Collision Recheck

```text
CANONICAL_PARTICIPANT_COLLISION_GROUPS = 91
CANONICAL_PARTICIPANT_COLLISION_ROWS = 182
```

字段分类：

```text
business agent_id rows = 91
ForumPrincipal.id rows = 91
authSubject rows = 0

joinedAt equal groups = 0
lastReadAt equal groups = 24
leftAt equal groups = 91
waiver fields equal groups = 91
authored-message groups = 69
thread-creator groups = 1
required-reviewer groups = 0
```

组合：

```text
90 groups: role=member, status=active+invited
1 group: roles=creator+member, statuses=responded+invited
```

这与“盘点 调查”结果完全一致，但两次调查访问的是同一个本地 volume，不是独立 production 数据集。

```text
BLOCKER-ID-001_REPRODUCED = PARTIAL
```

含义：已在实际运行的本地部署上再次复现，但尚未在 production 或 production-shaped target 上验证。

### Owner 决策包

#### OPTION_A：全部 quarantine，不生成 canonical Participant

- 保留：182 条原始行及全部字段。
- 丢失：迁移后没有可用的 canonical Participant 投影。
- 可回滚：是，原始数据不变。
- Watch/Read/Review：相关 91 个 principal-thread pair 全部阻止 canonical Watch/Read/Review cutover。
- 影响：
  - 本地：91 组、182 行；
  - 合格目标：不可用，数量无法证明。

#### OPTION_B：创建 canonical Participant，并冻结逐字段合并规则

必须由 Owner 分别确定：

- role
- status
- joinedAt
- lastReadAt
- leftAt
- waiver 三字段

影响：

- 保留：按 Owner 规则选中的 canonical 值；若同时保留 legacy evidence，可保留原始 provenance。
- 丢失：未被选中的冲突值不再具有 canonical authority。
- 可回滚：仅在保留两条 legacy evidence 和版本化规则时可回滚。
- Watch/Read/Review：可形成单一 projection，但错误合并会改变 unread、watch 和 review semantics。
- 本地：91 个 canonical records，由182行合并产生。
- 合格目标：不可量化。

#### OPTION_C：只迁移具有唯一 provenance 的字段

- 保留：canonical identity，以及能够逐字段直接证明的事实。
- 丢失：无；冲突字段不进入 canonical authority，继续保留在 legacy evidence/quarantine。
- 可回滚：是。
- Watch/Read/Review：只有直接可证明部分可启用，其余继续 fail closed。
- 本地：91 组均需字段级分类；现有证据不足以给出完整字段 backfill 数。
- 合格目标：不可量化。

## 7. Unresolved Participant

本地记录：

```text
UNRESOLVED_PARTICIPANT_TARGET_COUNT = 1
participant_hash = 673b258f1e1a
thread_hash = 1a0bb1543084
value_hash = ed54b341d400
role/status = member/invited
joinedAt = 2026-08-08T07:05:50.390Z
active = true
lastReadAt = null
authored message = no
thread creator = no
```

直接证据检查：

- ForumPrincipal ID、authSubject、agentId：无精确匹配；
- 当前 Forum audit logs：无精确 agentId 匹配；
- 仓库和现有 migration evidence：无精确匹配；
- Forum 日志保留窗口从 `2026-08-14` 开始，晚于该 Participant 的 `2026-08-08` 创建时间；
- auth-service 数据库只读访问因账号认证不可用，未绕过权限；
- 未使用 display name、相似度或同 Thread 其他 Participant 推断。

```text
RESOLVED_BY_DIRECT_EVIDENCE = 0
REMAINING_UNPROVABLE = 1
BLOCKER-ID-002 = OPEN
```

## 8. Archived Lifecycle

```text
ARCHIVED_THREADS = 2
DISCUSSION_STATE_DETERMINISTIC = 0
DISCUSSION_STATE_AMBIGUOUS = 0
DISCUSSION_STATE_UNPROVABLE = 2
```

两条记录均：

- `resolvedAt IS NULL`
- `resolvedById IS NULL`
- Outcome = 0
- decision message = 0
- 没有 revision/lifecycle event 表
- 创建和 archive 发生于 `2026-08-05`
- 当前容器审计日志从 `2026-08-14` 才开始，无法覆盖 archive 操作

因此只能确定：

```text
visibility_state = archived
discussion_state = unknown
```

不能推断 `discussion_state=resolved`。

```text
BLOCKER-LIFE-001 = OPEN
```

## 9. Historical Review Evidence

当前数据库：

```text
required_reviewer = 0
waiver rows = 0
Outcome = 0
```

日志证据边界：

```text
AUDIT_WINDOW = 2026-08-14T00:30:42.101Z .. 2026-08-18T05:31:27.077Z
jwt.verified = 6060
principal.resolved = 6060
jwt.failed = 6
domain review/archive/resolve/outcome audit events = 0
```

现有 audit 类型只覆盖 JWT、Principal resolution 和 write rejection，不记录 reviewer assignment、waiver、unwatch、response、archive 或 resolve 操作。没有持久 Discussion/Review history 或历史 snapshot 可证明：

- 曾存在 required reviewer；
- unwatch 曾绕过 readiness；
- 任意旧消息曾被误算作 response；
- reviewer 未满足时曾 resolve；
- 历史上从未存在这些情况。

```text
HISTORICAL_REVIEW_EVIDENCE = UNAVAILABLE
REVIEW_BYPASS_OBSERVED = UNPROVEN
```

## 10. Local-vs-Target

| 项目 | LOCAL_COPY / 当前本地部署 | production/production-shaped target |
|---|---:|---:|
| Principal | 90 | unavailable |
| Thread | 90 | unavailable |
| Message | 607 | unavailable |
| Participant | 389 | unavailable |
| Collision group | 91 | unavailable |
| Unresolved identity | 1 | unavailable |
| archived/resolved/deleted | 2/0/0 | unavailable |
| Outcome | 0 | unavailable |
| required reviewer | 0 | unavailable |
| waiver | 0 | unavailable |

“盘点 调查”和本次补证查询的是同一个 `svc-forum-deploy_svc-forum-data` volume。数量一致只能证明本地数据未漂移，不能证明它代表 production。

```text
LOCAL_COPY_REPRESENTATIVE = UNPROVEN
```

## 11. 必填结果

```text
TASK_NAME = 补证 调查
TASK_TYPE = 调查

WORKTREE_CREATED = YES
WORKTREE_REUSED = NO

REMOTE_MAIN_AT_START =
1cccdd54554c0bde13572273401f19f294334e46

MAIN_DRIFT = NO
INVESTIGATION_ALLOWED = YES

WORKTREE_HEAD =
1cccdd54554c0bde13572273401f19f294334e46

DEPLOYMENT_ENVIRONMENT =
local-only

DEPLOYED_COMMIT =
502cfca5a180d6c49fe75dfc270fd117f279ccfb

DEPLOYED_IMAGE_DIGEST =
sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97

DEPLOYMENT_BINDING =
DETERMINISTIC

DATABASE_TARGET =
unavailable

READ_ONLY_GUARD =
PASS

TARGET_SNAPSHOT_AT =
UNAVAILABLE

LOCAL_ONLY_SNAPSHOT_AT =
2026-08-21T14:28:57.377760Z

INVENTORY_COMPLETENESS =
PARTIAL

BLOCKER-ENV-001 =
OPEN

CANONICAL_PARTICIPANT_COLLISION_GROUPS =
91

CANONICAL_PARTICIPANT_COLLISION_ROWS =
182

BLOCKER-ID-001_REPRODUCED =
PARTIAL

UNRESOLVED_PARTICIPANT_TARGET_COUNT =
1

RESOLVED_BY_DIRECT_EVIDENCE =
0

REMAINING_UNPROVABLE =
1

BLOCKER-ID-002 =
OPEN

ARCHIVED_THREADS =
2

DISCUSSION_STATE_DETERMINISTIC =
0

DISCUSSION_STATE_AMBIGUOUS =
0

DISCUSSION_STATE_UNPROVABLE =
2

BLOCKER-LIFE-001 =
OPEN

HISTORICAL_REVIEW_EVIDENCE =
UNAVAILABLE

REVIEW_BYPASS_OBSERVED =
UNPROVEN

LOCAL_COPY_REPRESENTATIVE =
UNPROVEN

DETERMINISTIC_RECORDS =
1646

AMBIGUOUS_RECORDS =
182

UNPROVABLE_RECORDS =
3

QUARANTINE_CANDIDATES =
185

OWNER_DECISIONS_REQUIRED =
1

BLOCKERS =
4

FILES_MODIFIED = 0
COMMITS_CREATED = 0
PUSH_PERFORMED = NO
PR_CREATED = NO
PR_UPDATED = NO
DATABASE_WRITES = 0
MIGRATIONS_EXECUTED = 0
BACKFILL_EXECUTED = NO
DEPLOYMENT_CHANGED = NO

NEXT_TASK =
补证 调查
```

最终 worktree `git status --short` 为空，HEAD 未变化。
