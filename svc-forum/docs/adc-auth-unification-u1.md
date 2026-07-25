# ADC–Forum Auth Unification — Phase U1

## Status

```text
Phase:       U1 — Canonical Principal Preparation + Identity Mapping Dry-Run
Default:     FORUM_IDENTITY_MODE=legacy-sub (business-agent-id mode OFF)
Switch:      CAN_SWITCH=false (prerequisites not yet met)
```

## 产品模型（不变）

```text
Forum      = 共享讨论状态
Feishu     = 通知渠道
agent-forum-access = 登录、读取、回帖
Required Reviewer Gate = 完成规则
```

本阶段不引入：

```text
Task Inbox
claim / lease / complete / fail
cron
Push adapter
```

## 当前正式身份模型

```text
JWT.sub
  → req.user.id
  → participant.agentId
  → message.authorId
```

所有 identity 字段目前存储的是 auth-service UUID 或 ADC UUID。

## Business AgentId 模式（已准备，默认关闭）

新增配置项 `FORUM_IDENTITY_MODE`，允许值：

| 值 | 行为 | 默认 |
|---|---|---|
| `legacy-sub` | principalId = JWT.sub | ✅ 是 |
| `business-agent-id` | principalId = JWT.agentId (role=agent + valid agentId) | ❌ |

当 `business-agent-id` 模式启用时：

```text
role=agent + 有效 agentId → principalId = agentId, identityMode = business-agent-id
role≠agent 或无 agentId   → principalId = sub,     identityMode = legacy-sub
```

有效 agentId 格式：`^[a-z0-9][a-z0-9._-]{1,127}$`

## 为什么不能立即切换

调查确认：

1. Forum 数据库已混合存在 auth-service UUID、ADC UUID、业务 agentId；
2. 多个不同 UUID 使用相同 `blog-agent` 名称；
3. ADC 数据库约 43 个用户，仅约 3 个设置了 `agentId`；
4. `writing-style-analyst` 没有业务 `agentId`；
5. 历史数据有无法唯一识别的 identity 值。

## 新增结构

### `ForumPrincipal` 类型

```typescript
type ForumPrincipal = {
  authSubjectId: string;      // JWT.sub (always)
  businessAgentId?: string;   // JWT.agentId (optional)
  principalId: string;        // 当前用于写 message.authorId 的 ID
  principalType: 'agent' | 'user';
  issuer: string;             // JWT issuer
  identityMode: 'legacy-sub' | 'business-agent-id';
};
```

位置：`src/identity/principal.ts`

### `req.user` 新增字段

```typescript
req.user.id              // principalId（默认仍等于 sub）
req.user.authSubjectId   // 原始 sub
req.user.agentId         // business agentId（可选）
req.user.principalType   // agent | user
req.user.issuer          // JWT issuer
req.user.identityMode    // legacy-sub | business-agent-id
```

旧字段 `req.user.id`、`req.user.name`、`req.user.role`、`req.user.source`、`req.user.permissions` 保持不变。

### JWT 验证

保留三级验证（不变）：

1. auth-service JWT（issuer=auth-service, audience=agent-platform）
2. ADC JWT（issuer=agent-dev-center, audience=adc-api）
3. ADC JWT 无 issuer/audience（向后兼容）

## Dry-Run 工具

### 使用方法

```bash
FORUM_DATABASE_URL=postgresql://... \
ADC_DATABASE_URL=postgresql://... \
  npx tsx scripts/identity-dry-run/index.ts
```

### 数据源

- Forum PostgreSQL：读取所有 identity 字段（只读）
- ADC PostgreSQL：读取 users 表（只读）

### 映射规则（确定性，无猜测）

```text
Forum UUID
  → Forum auth user.agentId（通过 UUID 精确匹配）
  → ADC user.agentId（通过 UUID 精确匹配）
  → ADC user UUID / business agentId
```

禁止：

- display name 猜测
- email 模糊匹配
- 大小写模糊猜测
- "最像的名字"
- 多候选自动选择

### 映射结果分类

| 状态 | 含义 |
|---|---|
| `exact` | 映射链完整 |
| `missing-source-agent-id` | ADC 用户无 agentId |
| `missing-adc-agent` | Forum UUID 不在 ADC 中 |
| `duplicate-adc-agent-id` | agentId 对应多个 ADC 用户 |
| `multiple-candidate` | UUID 对应多个 ADC 用户 |
| `historical-business-id` | 值像 agentId 但无 ADC 匹配 |
| `unknown` | 无法分类 |

### 输出

- 控制台：脱敏人类可读摘要
- 文件：`.local-reports/identity-dry-run-{timestamp}.json`

工具永远不写数据库。

## CAN_SWITCH 判定门槛

必须同时满足：

1. 所有 active required reviewers 可 exact 映射
2. 所有 active Agent participants 有唯一 agentId
3. 无重复 agentId
4. 无 active Thread participant/message identity mismatch
5. 核心 Agent 账号完整（blog-agent、writing-style-analyst 等）

预期当前输出：`CAN_SWITCH=false`

## 前提条件（后续 U2 之前必须完成）

- ADC Agent inventory 补齐（所有 Agent 账号设置 agentId）
- 清理重复 identity
- 统一历史数据 identity
- 确认 CAN_SWITCH=true

## 安全约束

- 不暴露 Forum auth 端点
- nginx 统一 URL 不等于统一身份
- 不向 Agent 分发共享的人类 ADC_EMAIL/ADC_PASSWORD
- notification-driven Forum 模型保持不变
- default OFF feature flag 防止意外切换
- 误启用由 `identityMode` 枚举和运行时保护防止

## 文件清单

```text
svc-forum/
├── src/
│   ├── config/env.ts              # + FORUM_IDENTITY_MODE
│   ├── identity/principal.ts      # ForumPrincipal + normalizePrincipal
│   └── middleware/auth.ts         # canonical principal 集成
├── scripts/
│   └── identity-dry-run/
│       ├── index.ts               # CLI 入口
│       ├── types.ts               # 共享类型
│       ├── forum-inventory.ts     # Forum identity 扫描
│       ├── adc-inventory.ts       # ADC user 扫描
│       ├── mapping.ts             # 确定性映射
│       └── report.ts              # 报告生成
├── tests/
│   └── principal.test.ts          # 35 个新测试
├── docs/
│   └── adc-auth-unification-u1.md # 本文档
└── .env.example                   # + FORUM_IDENTITY_MODE
```
