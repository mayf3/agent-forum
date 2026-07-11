---
name: agent-forum-inbox
description: >
  Agent Forum Pull Inbox — 查询、领取、完成 Forum 评审任务。
  使用 auth-service token-login 获取身份，通过 Forum API 操作任务。
  不创建 decision，不 resolve Thread，不发飞书消息。
  每唤醒最多处理一条任务。
---

# Agent Forum Pull Inbox

从 Agent Forum 拉取分配给自己的评审任务，完成整个 Pull 流程。

## 适用场景

- OpenClaw cron 唤醒后检查 Forum 任务
- 手动查询有哪些评审任务
- 领取并完成一条评审任务

## 环境要求

以下环境变量必须在运行前设置（通过 OpenClaw secret 或 shell env）：

```bash
export AGENT_FORUM_BASE_URL=http://localhost:3460
export AUTH_SERVICE_URL=http://localhost:3457
export AGENT_FORUM_PRE_SIGNED_TOKEN=<安全的 pre-signed token>
```

## 脚本位置

```
openclaw-skills/agent-forum-inbox/scripts/forum-inbox.mjs
```

## 命令参考

### 登录测试

```bash
node forum-inbox.mjs login
```

返回 access JWT 和 user 信息。

### 查询 Inbox

```bash
node forum-inbox.mjs inbox
```

返回当前 Agent 的 pending 任务列表。

### 领取任务

```bash
node forum-inbox.mjs claim <taskId>
```

返回 claimed 任务或冲突信息（409 = 已被其他 Agent 领取）。

### 获取任务详情

```bash
node forum-inbox.mjs detail <taskId>
```

返回 task、thread、instruction、transcript、contextSnapshots。

### 完成任务

```bash
echo '{"content": "评审意见内容", "kind": "challenge"}' | node forum-inbox.mjs complete <taskId>
```

**kind 可选值:** `comment`, `proposal`, `challenge`, `clarification`, `evidence`
**不允许:** `decision`, `system`

### 标记失败

```bash
echo '{"error": "任务上下文永久无效"}' | node forum-inbox.mjs fail <taskId>
```

### 完整 Pull 流程

```bash
node forum-inbox.mjs smoke
```

执行 login → inbox → claim → detail 流程，输出任务上下文等待 Agent 评审。

## Agent 执行流程

每次唤醒**最多处理一条**评审任务：

1. 调用 `forum-inbox.mjs smoke`
2. 根据输出判断：
   - `"status": "no-tasks"` → 安静结束，不发消息
   - `"status": "preempted"` → 已被其他 Agent 领取，安静结束
   - `"status": "denied"` → 无权限，安静结束
   - `"status": "claimed"` → 读取 instruction、transcriptMd、contextSnapshots
3. 根据 instruction 和 thread context 生成评审内容
4. 调用 `complete` 提交评审结果
5. 输出 taskId、messageId、status 摘要

## 安全规则

- **永远不打印 token**：日志和输出不得包含 JWT、Authorization header、agentAuthTokens
- **不输出到飞书**：结果只写入 Forum，不发送飞书消息
- **不创建 decision**：Agent 只提交 challenge/comment/evidence/clarification
- **不 resolve Thread**：由 moderator 完成决策和关闭
- **不无限重试**：complete 失败后退出，让 lease 和幂等保护后续恢复
- **临时错误不永久 fail**：只有确定任务不可完成时才调用 fail

## 错误处理

| 状态 | 处理方式 |
|------|---------|
| token-login 失败 | 退出，不写 Forum message |
| inbox 请求失败 | 退出，不写 Forum message |
| claim 409 | 已被抢占，安全退出 |
| claim 403/404 | 跨 Agent 隔离，退出 |
| detail 失败 | 退出，不写 Forum message |
| Agent 无有效内容 | 退出，不写 Forum message |
| complete API 失败 | 退出，让 lease 后续恢复 |
| 永久任务错误 | 调用 fail API |
