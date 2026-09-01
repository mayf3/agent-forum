```text
INVESTIGATION_ID =
INV-AGENT-FORUM-NOTIFICATION-GOVERNANCE-EXTENSION-AMENDMENT-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
forum_notification_facts 最小运行时扩展（Governance V1 通知收敛）

OWNER =
mayf3

DISPOSITION =
proposed

AMENDMENT_STATUS =
PROPOSED / NOT_ACCEPTED
（实施 Agent 无权自行标记 accepted；本 amendment 被独立接受前，
 notification storage invariant 视为未变更，见 NO_CLAIM_BEFORE_ACCEPTANCE）

PROPOSED_AT =
2026-08-31

PROPOSING_BRANCH =
feat/governance-v1（基于 origin/main @ 2c5e4d8，随 Governance V1 PR 提交）

PRIMARY_GOVERNING_SPEC =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

AMENDS_DESIGN =
additive-storage subscription storage —— forum_notification_facts 的
列目录（8 列）与 reason 闭集（SQL-040）

ORIGINAL_INVARIANT =
被本提案修改的两项既有 invariant，逐字引用：
1. SQL-040（forum_notifications_reason_ck，closed set）：
   CHECK (reason IN ('mention','watch','reaction'))
   出处：migrations/20260827004400_add_forum_subscription_storage/migration.sql
         （SQL-040: Notification reason closed set）
2. 订阅存储目录断言（scripts/verify-subscription-storage.mjs，
   assert_table_shape('forum_notification_facts', ...)）：
   精确 8 列 id / recipient_principal_id / thread_id / message_id /
   reaction_id / reason / source_event_key / created_at，不多不少。

PROPOSED_EXTENSION =
1. 新增可空列（纯 additive，不回填）：
   - read_at  TIMESTAMPTZ(3) NULL  —— 已读状态（未读 = NULL）
   - payload  JSONB NULL           —— 有界上下文（allowlisted 键：
     action/fromStatus/toStatus/reason），为外部投递桥接（Feishu）预留，
     绝不存 token / Authorization 头 / 密钥 / 敏感全行
2. reason 闭集扩宽为原集合的 superset（新增 2 值）：
   CHECK (reason IN ('mention','watch','reaction',
                     'thread_notice','moderator_notice'))
3. 查询索引：(recipient_principal_id, created_at)、
   (recipient_principal_id, read_at)、(thread_id)
   幂等唯一键 (recipient_principal_id, source_event_key) 不变：
   治理通知 sourceEventKey = 'audit:<forum_audit_events.event_id>'，
   mention = 'mention:<messageId>'，事务重试安全。

WHY_GOVERNANCE_V1_REQUIRES_THIS =
Governance V1 的通知需求（已由 Owner 任务规格冻结）：
- 通知可查询、已读状态可更新 ⇒ 需要 read_at（现表无任何已读语义）
- 通知类型 mention / thread_notice / moderator_notice ⇒ 现闭集只有
  mention/watch/reaction，均为订阅派生语义，无治理通知位
- 治理动作（close/archive/hide/restore/pin/feature/软删/举报处理）需要
  向参与者/举报人说明"发生了什么" ⇒ payload 承载有界上下文
不扩展则只有两个选项，均被否决：
a) 缩减治理通知类型/砍掉已读状态 —— 违反已冻结的 V1 规格；
b) 另建第二张通知表 —— 违反"不建第二套通知体系"与 additive-storage
   单一事实源原则（本表正是 additive-storage 为运行时通知预留的）。

SCOPE_EXCLUSIONS =
本 extension 不引入、也不为以下能力预留任何结构：
- workflow engine / 任务状态机 / 调度（ Forum 不做调度，边界见
  PRODUCT-BOUNDARY.md）
- scheduler / 唤醒 / 投递状态机（payload 只是被动的桥接上下文，
  无送达/重试语义）
- 第二审计表、第二通知表（均不存在）

MIGRATION_CONSTRAINTS =
- 仅 additive：新迁移 20260831090000_add_governance_v1 只含
  ADD COLUMN（nullable）/ CREATE INDEX / CHECK superset 替换
- CHECK 替换为 drop-and-re-add：表在扩宽时点无 runtime writer、行数为
  零，无数据风险；新集合是旧集合的超集，旧语义全部保留
- 不删除、不修改、不重写任何历史 migration（含
  20260827004400_add_forum_subscription_storage 原文）
- forum_app 角色边界不放松：本表本无 append-only 触发器，
  read_at UPDATE 是合法的本人已读状态转移，由 API 层 recipient
  归属校验保证，不涉及角色授权变化

VERIFIER_BINDING =
verify:subscription-storage 的两处断言已随本修订分支更新为"严格验证新契约"
（2026-09-01 Governance V1 REVISE 轮，Owner 指令）：
  - assert_table_shape('forum_notification_facts', ...) → 10 列
    （+read_at TIMESTAMPTZ(3) NULL / +payload JSONB NULL，列序按 ALTER 追加）
  - forum_notifications_reason_ck 断言 → 5 值 superset
    （mention/watch/reaction/thread_notice/moderator_notice）
  - 新增行为探针：thread_notice/moderator_notice 插入与更新 accepted；
    'reply' 与 'thread-notice'（错拼）仍 23514 拒绝；read_at/payload 可用。
更新方式是"把断言收紧到新契约"，不是放宽到任意 schema —— 断言失败即 FAIL。
绑定关系不变：断言与 migration 20260831090000 同进退。若本 amendment 最终被
Owner 拒绝，须同时回退 governance_v1 migration 与本 verifier 更新；
若被接受，则本 verifier 即为生效断言，无需再改。

NO_CLAIM_BEFORE_ACCEPTANCE =
在本 amendment 被 Owner 独立标记 accepted 之前：
- 任何人不得宣称 notification storage invariant 已变更；
- 本提案文本本身是 review material，不是 active authority；
- verifier 断言更新（VERIFIER_BINDING 节）与 migration 同为候选变更，
  随 amendment 的接受/拒绝同进退，本身不构成 invariant 已变更的声明。

OWNER_DECISION_REQUIRED =
是否采纳本 amendment。采纳动作 = 独立将 DISPOSITION 置为 adopted +
随验收 PR 更新上述两处 verifier 断言并归档本提案。
拒绝则 Governance V1 通知存储需另行设计或放弃已读/治理类型语义。
```
