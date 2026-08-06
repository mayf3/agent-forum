# CI 门禁使用指南（svc-forum）

本需求（8265a467）实现三层防线，解决"绕过工作流零成本"根因：

```
L0 平台层（不可绕过）  L1 本地层（可跳过但留痕）  L2 事后兜底（补救）
┌─────────────────┐   ┌─────────────────────┐   ┌──────────────────┐
│ branch protection│   │ commit-msg hook     │   │ postmortem + 补录│
│ workflow-gate.yml│   │ 强制 workflow: uuid │   │ 实例（留痕可追溯）│
│ arch-health-check│   └─────────────────────┘   └──────────────────┘
└─────────────────┘
```

## 开发提交流程（新规范）

```bash
# 1. 安装本地 hook（一次即可）
bash scripts/install-hooks.sh

# 2. 从 svc-workflow 创建需求实例，拿到实例 ID
#    （requirement-client 提交后自动创建）

# 3. commit 时必须带 workflow 实例 ID
git commit -m "feat: 实现 XXX" -m "workflow: 8265a467-f983-44af-bf56-fcef60a75996"

# 4. push 分支，创建 PR 到 main
#    PR 描述中必须包含：Workflow: <实例ID>（L0 校验）

# 5. PR 自动触发两个 status check：
#    - Workflow Gate: 校验实例存在且状态合法
#    - Arch Health Check: 架构体检（红线禁 merge）
#    两者全绿 + 1 个 review 通过后才能 merge
```

## PR 描述格式

```
## 变更说明
...

## 工作流
Workflow: 8265a467-f983-44af-bf56-fcef60a75996
```

## 常见问题

### Q1: commit 被拒绝，提示缺 workflow ID？
在 commit message 中加一行 `workflow: <uuid>`。紧急情况可 `--no-verify` 跳过（L1），
但 L0 CI 仍会拦截无实例 PR，且绕过会触发 postmortem。

### Q2: PR 的 Workflow Gate 红了？
- PR 描述没有 `Workflow: <uuid>` → 补充后重新触发（edit PR body 即可自动重跑）
- 实例 ID 无效 → 检查是否复制正确
- 实例已终止/被驳回 → 创建新实例并更新 PR 描述

### Q3: Arch Health Check 红了？
运行 `bash scripts/arch-health-check.sh svc-forum` 查看具体红线项：
- lineCount：文件超 500 行（grandfather 清单豁免除外）
- circularDeps：循环依赖
- magicValues：魔法值
- routesPurity：routes 直接调 Prisma

### Q4: 体检工具在哪？
`scripts/arch-health-check.sh`（需求 95265979 交付，纳入版本管理）。
grandfather 清单：`.arch-grandfather.yml`（超限文件的临时豁免，有过期时间）。

## 管理员配置（一次性）

1. GitHub Settings > Branches > main > Add rule：
   - Require pull request reviews (1)
   - Require status checks: 上述两个 check context
   - Dismiss stale reviews
   - 禁止 force push / 禁止直接 push（可参考 `.github/branch-protection.json`）
2. 配置 repo secrets：
   - `WF_API_BASE`: svc-workflow API 地址（如 http://8.163.44.127:8989）
   - `WF_TOKEN`: svc-workflow 只读 token（workflow.read scope）
3. 如仓库是自建 git server（非 GitHub），将 workflow-gate.yml 的校验逻辑
   移植到对应 CI 系统（GitLab CI / Gitea Actions），validator 脚本 `scripts/validate-workflow-ref.mjs` 可直接复用。

## 绕过处理（L2）

发现绕过 → 按 `docs/postmortem-template.md` 触发 postmortem → 补录实例 → 修复门禁。
