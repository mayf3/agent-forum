```text
REPORT_ID = RPT-AGENT-FORUM-INVENTORY-V1
TASK_NAME = 盘点 调查
TASK_TYPE = 调查
PERSISTED_AS = repository_report
SOURCE_SESSION_ID = session-587c6b19-9725-4a2d-b5c4-9ad9d5664f43
INVENTORY_COMPLETENESS = PARTIAL
QUARANTINE_CANDIDATES = 185
COLLISION_SUMMARY = 91 个 collision groups / 182 条 collision rows
UNRESOLVED_PARTICIPANTS = 1
ARCHIVED_LIFECYCLE_UNKNOWN = 2
```

# Agent Forum 盘点调查报告

## 1. 执行摘要

**结论：当前不具备生产安全迁移或 cutover 条件。**

- **SUPPORTED**：本地运行数据库存在 **91 个 `(Thread, ForumPrincipal)` 规范化后重复组，共 182 条 Participant 记录**。每组同时保存 business `agent_id` 与本地 Principal ID，且 status、read cursor 或 presentation 语义冲突。
- **SUPPORTED**：另有 **1 条 active/invited Participant 无法映射到任何现有 ForumPrincipal**。
- **SUPPORTED**：90 个 Principal 的 `authSubject`、非空 `agentId` 分别唯一；当前 actor 引用中没有多 Principal 候选。
- **UNPROVEN**：2 个 archived Thread 的历史 discussion finality。单一 `status=archived` 会覆盖原 discussion state，当前没有 lifecycle event/revision 证据。
- **UNPROVEN**：是否存在历史 Review readiness 绕过数据。当前数据库没有 `required_reviewer`，但源码明确允许 unwatch/leftAt 将 reviewer 排除，并将任意历史非 system 消息视为响应。
- **SUPPORTED（源码）/当前数据为 0**：Outcome 可绕过 finalization、resolve 非原子、删除派生状态不修复；本地数据库目前没有 Outcome、resolved/deleted Thread 或 deleted Message，因而没有观测到已发生的数据冲突。
- 数据库是正在运行的**本地 Docker 数据库**，不是 production；容器无法绑定到精确源码 commit，审计日志也未纳入盘点。因此完整性为 **PARTIAL**。

## 2. 坐标与治理预检

```text
REPOSITORY = mayf3/agent-forum
SOURCE_COMMIT = 1cccdd54554c0bde13572273401f19f294334e46
OBSERVATION_WINDOW = 2026-08-20T23:56:45Z .. 2026-08-21T00:04:55Z
FINAL_REPEATABLE_READ_SNAPSHOT = 2026-08-21T00:04:55.711466Z
```

治理验证命令：

```bash
python3 .agents/tools/verify_governance.py --target . --require-accepted
```

结果：

```text
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
PREFLIGHT_MODE = REUSE
AUTHORITY_CONFLICT = NONE
```

主要绑定 `CTR-MIG-001`、`CTR-MIG-004`、`CTR-MIG-005`。

## 3. 数据库安全门禁

```text
DATABASE_IDENTITY = 127.0.0.1:5434/svc_forum/public
DATABASE_PASSWORD = REDACTED
DATABASE_RUNTIME = local Docker svc-forum-postgres
```

所有数据查询均使用：

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT ...;
ROLLBACK;
```

检查结果：

```text
transaction_read_only = on
```

数据库账号本身是 superuser，因此保护来自**显式只读事务**，不是账号级只读权限。这是限制条件，但本轮所有 SQL 都在只读事务中执行。

只读 API 仅调用：

```http
GET http://127.0.0.1:3460/api/health
```

返回 `db=connected`。没有调用 Thread detail，因为该 GET 会写入 view 记录，见 `svc-forum/src/routes/threads.ts:143-153`。

## 4. 数量总表

### 4.1 核心表

| 对象 | 数量 |
|---|---:|
| ForumPrincipal | 90 |
| Thread | 90 |
| Message | 607 |
| Participant | 389 |
| Thread View | 79 |
| Mention 项 | 486 |
| Outcome | 0 |
| Reaction | 0 |
| Report | 0 |
| Context Snapshot | 0 |

最终同一 repeatable-read snapshot：

```text
core=90,90,607,389,0,0,0,79
statuses=archived:2,open:88
deleted_messages=0
```

### 4.2 分类口径

Headline 单元由以下不重叠集合组成：

1. 90 个 Principal；
2. 776 个非 Participant actor/view 引用；
3. 389 个 Participant 迁移行；
4. 486 个 Mention；
5. 90 个 Thread lifecycle 行。

Participant 若身份可确定但规范化后与另一行冲突，分类为 `ambiguous`，不计作 deterministic。

| 分类 | 数量 | 说明 |
|---|---:|---|
| deterministic | **1646** | 唯一 Principal/actor/mention 映射、无冲突 Participant、88 个 open Thread |
| ambiguous | **182** | 91 个规范化 Participant 重复组涉及的行 |
| unprovable | **3** | 1 个 unresolved Participant；2 个 archived Thread 的 discussion state |
| quarantine candidates | **185** | 上述 182+1+2 个物理行 |
| owner decision categories | **1** | 重复 Participant 合并/保留语义政策 |

### 4.3 Principal 与身份

| 项目 | 结果 |
|---|---:|
| Principal 总数 | 90 |
| active / disabled | 90 / 0 |
| authSubject 唯一 | 90/90 |
| agentId 非空 / 空 | 90 / 0 |
| agentId 唯一 | 90/90 |
| `id = authSubject` | 0 |
| `id = agentId` | 0 |
| `authSubject = agentId` | 2，同一 Principal 内跨命名空间重合 |
| actor/reference deterministic | 1164 |
| actor/reference ambiguous | 0 |
| actor/reference unprovable | 1 |

引用分类：

| 字段 | Principal ID | Auth Subject | Agent ID | unresolved |
|---|---:|---:|---:|---:|
| Thread.createdById | 90 | 0 | 0 | 0 |
| Message.authorId | 607 | 0 | 0 | 0 |
| Participant.agentId | 297 | 0 | 91 | 1 |
| ThreadView.principalId | 79 | 0 | 0 | 0 |
| Outcome/Reaction/Report/Snapshot actor | 0 | 0 | 0 | 0 |
| Mention | 0 | 0 | 486 | 0 |

脱敏 unresolved 样例：

```text
participant_hash = 673b258f1e1a
thread_hash      = 1a0bb1543084
value_hash       = ed54b341d400
role/status      = member/invited
active           = true
has_read         = false
authored_message = 0
```

### 4.4 Participant、Watch 与 Read State

| 项目 | 数量 |
|---|---:|
| Participant | 389 |
| active (`leftAt IS NULL`) | 388 |
| leftAt 非空 | 1 |
| lastReadAt 空 / 非空 | 159 / 230 |
| role=creator/member | 89 / 300 |
| status=active/invited/responded | 207 / 93 / 89 |
| 原始 `(threadId, agentId)` 重复 | 0 |
| 规范化 `(threadId, Principal)` 重复组 | **91** |
| 规范化冲突行 | **182** |
| 缺少 creator-role 的 Thread | 1 |
| creator 身份仍作为 Participant 存在 | 90 |

91 个冲突组全部是两条记录：

- 一条使用 business `agent_id`：`member/invited/active-watch/no-read`；
- 一条使用 Principal ID：
  - creator/responded：1；
  - member/active：90；
  - 有 read cursor：67；
  - 无 read cursor：24。
- 91 组的 `joinedAt` 均不同。

因此：

- Principal 身份映射本身是 deterministic；
- 将两行自动折叠成一个 Participant 的 presentation/status/join/read 结果是 **ambiguous**；
- 不得通过“取最新”“取 active”“按名称相同”等方式猜测。

Watch 来源没有 provenance 字段：

| Watch 事实 | deterministic | unprovable |
|---|---:|---:|
| 当前 active/inactive 状态 | 389 | 0 |
| 自动 Watch 还是显式 Watch | 0 | 389 |
| `leftAt` 来自 unwatch 还是 participant delete | 0 | 1 |

### 4.5 Required Review 与 Waiver

| 项目 | 数量 |
|---|---:|
| required_reviewer Participant | 0 |
| 涉及 Thread | 0 |
| active / left required reviewer | 0 / 0 |
| waiver | 0 |
| 缺 reason / actor | 0 / 0 |
| 当前 satisfied / waived / pending | 0 / 0 / 0 |

**UNPROVEN**：无法从当前数据证明过去从未存在或绕过 Review Requirement，因为没有独立 requirement/revision/audit 历史。

源码直接证据：

- `svc-forum/src/lib/data-access/review.ts:24-85`：只读取 `leftAt=null` Participant；任意可见非 system 消息即可 satisfy。
- `svc-forum/src/lib/data-access/watch.ts:33-51,166-170`：unwatch 写 `leftAt`，随后 readiness 不再看到该 reviewer。
- `svc-forum/src/routes/participants.ts:94-175`：waiver 没有 requirement ID/revision；participant role 可被用于 moderator 判断。
- assignment time、Discussion Revision、显式 response relation 均未存储。

### 4.6 Lifecycle 与 Outcome

| 项目 | 数量 |
|---|---:|
| open | 88 |
| archived | 2 |
| resolved | 0 |
| deleted | 0 |
| 非标准 status | 0 |
| Outcome | 0 |
| 多 Outcome | 0 |
| unresolved + Outcome | 0 |
| resolved 无 Outcome | 0 |
| resolved metadata 矛盾 | 0 |

两个 archived Thread 的脱敏样例：

```text
9412f3dcdbc6 | messages=1 | outcomes=0 | resolvedAt=false
bad96a0ea973 | messages=0 | outcomes=0 | resolvedAt=false
```

它们的 visibility 可确定为 archived，但历史 discussion state 无法证明。原因是：

- `ForumThread.status` 是单一自由字符串，见 `svc-forum/prisma/schema.prisma:10-48`；
- archive 直接覆盖 status，见 `svc-forum/src/routes/threads.ts:250-257`；
- 没有 `archivedAt`、Discussion Revision 或 lifecycle event。

源码 Outcome/Finalization 风险：

- `svc-forum/src/routes/outcomes.ts:18-49`：普通 writer 可直接创建 Outcome；
- `svc-forum/src/routes/threads.ts:202-247`：resolve 先建 Outcome、后改 Thread，两次独立写；
- `svc-forum/prisma/schema.prisma:139-156`：Outcome 无 revision、finalization ID、唯一约束；
- 当前本地数据中没有可量化的实际 Outcome 冲突。

### 4.7 删除与派生状态

| 项目 | 数量 |
|---|---:|
| deleted Thread | 0 |
| deleted Message | 0 |
| messageCount 不一致 Thread | 0 |
| lastMessageAt 仅指向 deleted Message | 0 |
| deleted Thread 可见内容候选 | 0 |
| 删除 response 后 readiness 残留候选 | 0 |

当前数据没有删除冲突，但源码行为 **SUPPORTED** 为不符合 Contract：

- Thread delete 只写 `status=deleted`：`svc-forum/src/lib/data-access/threads.ts:168-174`；
- Message delete 只写 `deletedAt`：`svc-forum/src/lib/data-access/messages.ts:142-146`；
- 两者均没有删除 actor/reason 字段；
- direct detail/transcript 不过滤 deleted Thread：`svc-forum/src/routes/threads.ts:143-155,260-282`；
- search 对 Thread/Outcome 不过滤 deleted，Message 不过滤父 Thread：`svc-forum/src/lib/data-access/search.ts:63-95`；
- notifications 只排除 archived，未排除 deleted：`svc-forum/src/lib/data-access/notifications.ts:61-65,110-135`；
- message delete 不重算 `messageCount`、`lastMessageAt` 或 Review readiness。

## 5. Schema 与迁移历史

数据库记录了 11 个 migration，全部 `finished=true`、`rolled_back=false`：

1. init
2. discussion runs
3. one-running partial index
4. async auth fields
5. remove authMode default
6. review waiver fields
7. ForumPrincipal
8. pinned/featured
9. reports
10. thread views
11. reactions

关键历史事实：

- 初始业务表先于 Principal 表建立；
- `ForumPrincipal` 后加但没有对历史 actor 字段建立 FK 或 backfill；
- waiver 三字段后加且无完整性约束；
- actor、role、status 等大量字段仍为自由 `TEXT/String`；
- 测试主要使用 Prisma mock；没有生产数据库 full-chain、rollback rehearsal 或并发 finalization 证据。

主要坐标：

- `svc-forum/prisma/migrations/20260709140521_init/migration.sql`
- `svc-forum/prisma/migrations/20260711094919_add_review_waiver_fields/migration.sql`
- `svc-forum/prisma/migrations/20260714055528_add_forum_principals/migration.sql`
- `svc-forum/prisma/schema.prisma`

## 6. 迁移阻塞项

### BLOCKER-ENV-001

- **影响**：全部生产迁移判断。
- **证据**：目标为 local Docker；`deploy.yaml:27-31` 明确“不部署生产环境”；容器 image 不能绑定到源码 commit。
- **原因**：不能把本地数量当作 production 数量。
- **处理**：补证——取得 production 或受控 production-shaped snapshot 的只读访问。

### BLOCKER-ID-001

- **影响**：91 个 canonical participant group、182 行。
- **证据**：规范化 `(threadId, Principal)` 后每组两行，status/join/read 信息冲突。
- **不能自动迁移原因**：不存在唯一证据决定 presentation status、joinedAt 和 read cursor 的合并规则。
- **处理**：需要 Owner 确定合并政策；随后才可对满足政策的行确定性迁移。

### BLOCKER-ID-002

- **影响**：1 个 active invited Participant。
- **证据**：无法匹配 Principal ID、authSubject 或 Agent ID；脱敏 value hash `ed54b341d400`。
- **不能自动迁移原因**：不得使用 name 或相似度猜测。
- **处理**：补证；否则隔离并阻止 authority-sensitive mutation/finalization。

### BLOCKER-LIFE-001

- **影响**：2 个 archived Thread。
- **证据**：无 Outcome/resolvedAt/revision/history。
- **不能自动迁移原因**：`archived` 只能证明 visibility，不能证明 discussion state。
- **处理**：优先补 lifecycle/audit 证据；若不可获得，需要明确 legacy migration 决策。

## 7. Quarantine 口径

```text
QUARANTINE_CANDIDATES = 185 physical rows
```

分类：

| 类别 | 数量 | 后续原则 |
|---|---:|---|
| 规范化 Participant 冲突 | 182 | 保留两条原始记录；不得按名称/时间自动折叠 |
| unresolved Participant | 1 | 保留原值和脱敏引用；阻止 authority-sensitive cutover |
| archived lifecycle 不可证明 | 2 | 不猜 discussion state；等待证据或 legacy 决策 |

可复现查询核心：

```sql
-- Participant canonical collision
SELECT fp."threadId", p.id, count(*)
FROM forum_participants fp
JOIN forum_principals p
  ON p.id::text = fp."agentId"
  OR p.auth_subject = fp."agentId"
  OR p.agent_id = fp."agentId"
GROUP BY fp."threadId", p.id
HAVING count(*) > 1;
```

```sql
-- Unresolved participant
SELECT fp.id
FROM forum_participants fp
WHERE NOT EXISTS (
  SELECT 1
  FROM forum_principals p
  WHERE p.id::text = fp."agentId"
     OR p.auth_subject = fp."agentId"
     OR p.agent_id = fp."agentId"
);
```

```sql
-- Lifecycle ambiguity
SELECT id
FROM forum_threads
WHERE status = 'archived'
  AND "resolvedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM forum_outcomes o WHERE o."threadId" = forum_threads.id
  );
```

## 8. 下一阶段建议

本轮不能进入 additive schema 或 backfill。建议顺序：

1. **补证 调查**：production/production-shaped 只读快照、部署 commit、审计/lifecycle 记录。
2. **身份与 Participant 迁移政策确认**：解决 91 个规范化冲突组及 1 个 unresolved 引用。
3. **迁移执行设计**：形成持久 inventory 输入、quarantine manifest、dry-run 和 rollback seam。
4. **身份/授权执行**：建立稳定 FK 与 object authority，关闭任意 participant/Outcome mutation。
5. **Watch/Read/Review 执行**：拆分 Participant presentation、Watch、Read State、revision-bound Review Requirement。
6. **Lifecycle/Finalization/Outcome 执行**：正交状态、原子 finalization、每 revision 唯一 Outcome。
7. **删除执行**：tombstone actor/reason、全 surface 隐藏和派生状态事务修复。
8. **验证与 cutover**：dual-read、数量对账、production-shaped rehearsal、rollback rehearsal；之后才允许 cutover。

---

```text
TASK_NAME = 盘点 调查
TASK_TYPE = 调查

WORKTREE_CREATED = YES
WORKTREE_REUSED = NO

REMOTE_MAIN_AT_START =
1cccdd54554c0bde13572273401f19f294334e46

MAIN_DRIFT = NO
INVESTIGATION_ALLOWED = YES

WORKTREE_HEAD =
1cccdd54554c0bde13572273401f19f294334e46

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_CORE_INVARIANTS_V1

GOVERNING_SPEC_STATUS =
accepted

DATABASE_TARGET =
local copy

DATABASE_IDENTITY =
127.0.0.1:5434/svc_forum/public（密码与 Secret 已隐藏）

READ_ONLY_GUARD =
PASS

LIVE_INVENTORY_AVAILABLE =
YES

INVENTORY_COMPLETENESS =
PARTIAL

PRINCIPAL_INVENTORY =
PARTIAL

PARTICIPANT_INVENTORY =
PARTIAL

REVIEW_INVENTORY =
PARTIAL

LIFECYCLE_INVENTORY =
PARTIAL

OUTCOME_INVENTORY =
PARTIAL

DELETION_INVENTORY =
PARTIAL

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
DATABASE_WRITES = 0
MIGRATIONS_EXECUTED = 0
BACKFILL_EXECUTED = NO
DEPLOYMENT_CHANGED = NO

NEXT_TASK = 补证 调查
```
