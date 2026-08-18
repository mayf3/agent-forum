# Agent Forum Development Grammar & Spec Governance V0

本文件定义 Agent Forum 仓库中，人与 Agent 如何调查问题、形成 Spec、实施变更和验证一致性。

它在合入 `main` 后成为仓库级开发规则。它不是 Forum 产品 Spec，也不替代具体产品或架构 Spec。

## 1. North Star

这套体系最终服务的不是文档数量、模板完整度或治理形式本身。

唯一目标是：

> 让人与 Agent 在更少返工、更少范围漂移和更强可追溯性的前提下，持续交付正确的 Agent Forum。

每个新增规则都应接受一个简单检查：

> 它是否帮助我们更清楚地判断要解决什么、为什么这样解决、实现必须满足什么，以及证据是否足以证明已经做到？

如果不能，就不应为了体系完整而增加。

## 2. 设计来源与取舍

V0 继承两类已验证的思路，但不原样复制其目录和生命周期。

第一类思路来自团队的 Research Grammar：

- 稳定的 Grammar 与不断变化的 State 分离；
- Observation、Claim、Decision 等语义类型不能混写；
- 原始材料本身不自动成为 Evidence；
- Evidence 是某个事实对某个命题的支持或反驳关系；
- Activity 与已经知道的事实分离。

第二类思路来自 DeepSeek Harness 的 `.agents` 实践：

- 根 `AGENTS.md` 保存最薄的常驻规则入口；
- `.agents/skills/` 保存 Agent 可执行的仓库工作流；
- 决策必须保留 alternatives 和 rationale；
- 机器可以确定的结构由 deterministic gate 检查；
- 产品、架构和代码语义仍需独立 Agent Reviewer 判断。

本仓库有意不照抄 DeepSeek Harness 的 lifecycle-directory 模型。Agent Forum 的 governing Spec 必须先被接受并进入 implementation branch 的 base，之后才能实现，因此 Spec 的规范状态与代码的实现状态必须分离。

## 3. 整体架构

```text
AGENTS.md
Standing entrypoint
        │
        ▼
.agents/
Development Grammar / Protocol / Skills
        │
        │ 定义“开发应该怎么表达和执行”
        ▼
docs/specs/
Normative Specs and Contracts
        │
        │ 记录“系统应该是什么”
        ▼
Code / Tests / PR / Runtime / Logs
Implementation State, Raw Evidence and Provenance
```

各层职责如下。

| 层 | 负责 | 不负责 |
|---|---|---|
| `AGENTS.md` | 告诉进入仓库的 Agent 必须先读什么、不可绕过什么 | 复制完整 Spec 规则 |
| `.agents/README.md` | 开发语法、Spec authority、生命周期和治理规则 | 具体 Forum 产品决定 |
| `.agents/skills/` | 可重复执行的 Agent 工作流 | 代替产品 Owner 或独立 Reviewer 作最终判断 |
| `docs/product/` | 高层产品方向和边界 | 每次实现的完整可验收 Contract |
| `docs/specs/` | governing Specs、产品/架构/迁移/安全 Contract | 当前代码事实和运行结果 |
| 代码与配置 | 当前实现 State | 自动证明自己符合 Spec |
| 测试、运行结果、日志、PR | Verification Evidence 与 provenance | 自动成为产品 authority |

`docs/product/agent-forum-product-direction-v1.md` 继续作为当前高层产品边界。新的 Spec 可以细化它，但只有显式 supersession 才能改变其已冻结边界。

## 4. Development Grammar：六个一级原语

V0 只定义六个一级原语：

```text
Goal
State
Observation
Claim
Decision
Contract
```

只有真实开发材料无法自然表达时，才考虑增加新的一级原语。

### 4.1 Goal

Goal 回答：

> 我们希望用户或系统最终变成什么样？

例如：

```text
Goal:
Agent Forum 可以成为多个 Agent 可信的共享讨论和决策空间。
```

Goal 可以包含 Metric、Target 和 Constraint，但不能退化成文件或 API 清单。

```text
“新增 POST /resolve”不是 Goal。
“只有满足 Required Review 的讨论才能形成正式结果”可以是 Goal Condition。
```

### 4.2 State

State 回答：

> 当前系统客观上是什么？

State 应尽可能固定到可复现的版本：

```text
repository
branch / commit
schema
configuration
runtime mode
API response
current tests
production evidence when available
```

State 描述当前实现事实，不表示这些事实正确，也不表示未来必须继续如此。

### 4.3 Observation

Observation 回答：

> 我们实际看到、读取、复现或测量到了什么？

例如：

```text
OBS-001:
Required Reviewer 调用 unwatch 后，readiness 查询不再把该 reviewer 计入 pending。
```

Observation 必须带 provenance，例如：

- commit；
- 文件路径与代码位置；
- 测试命令和结果；
- API 请求与响应；
- 数据库查询；
- 日志或部署环境。

Observation 不负责解释原因。

### 4.4 Claim

Claim 回答：

> 基于 Observation，我们目前认为哪个可被证据支持、削弱或推翻的命题成立？

例如：

```text
CLM-001:
当前实现把 Required Review Requirement 与 Watch/active participant state 错误耦合。
```

Claim 可以是：

- 根因判断；
- 风险判断；
- 架构解释；
- 可行性判断；
- 兼容性判断；
- 对某个修改效果的预测。

Claim 不是规范要求，后续证据可以推翻它。

### 4.5 Decision

Decision 回答：

> 在当前 Goal、State、Observation 和 Claim 下，我们选择什么方向？

例如：

```text
DEC-001:
Required Review Requirement 与 Watch Subscription 在领域语义和持久化语义上分离。
```

每个重要 Decision 必须保存：

- 为什么选择它；
- 没有选择什么；
- 为什么没有选择；
- 什么新条件会触发重新考虑。

### 4.6 Contract

Contract 回答：

> 实现完成后，哪些行为、边界、不变量和失败语义必须成立？

例如：

```text
CTR-REVIEW-001:
Required Reviewer 取消关注帖子后，其 Review Requirement 仍然存在。

CTR-REVIEW-002:
只有符合条件的正式回复或 moderator waiver 能够满足 Review Requirement。
```

Contract 可以属于以下二级类型，但这些类型不是新的一级原语：

```text
Behavior
Invariant
Authorization
Security
Failure
Lifecycle
Transaction
Compatibility
Migration
Performance
Operations
```

Contract 必须描述可观察或可验证的义务，不应只写实现意图。

## 5. Evidence Link 不是新的一级原语

原始材料本身不自动等于 Evidence。

```text
代码文件 ≠ Evidence
测试文件 ≠ Evidence
PR ≠ Evidence
日志文件 ≠ Evidence
外部文章 ≠ Evidence
```

Evidence 是带 provenance 的关系。

### 5.1 Reasoning Evidence

```text
Observation
   │
   ├── SUPPORTS ──────► Claim
   └── CONTRADICTS ──► Claim
```

当强度判断有意义时，可以使用：

```text
Reliability: LOW | MEDIUM | HIGH
Directness: LOW | MEDIUM | HIGH
Scope Match: LOW | MEDIUM | HIGH
Discriminative Power: LOW | MEDIUM | HIGH
```

不要制造 `0.73` 一类没有校准依据的假精确数字。

### 5.2 Conformance Evidence

```text
Test / Runtime Observation
   │
   ├── VERIFIES ──► Contract
   └── VIOLATES ──► Contract
```

“存在一个测试”不证明 Contract 已满足。有效的 Conformance Evidence 至少需要说明：

- 测试或验证针对哪个 Contract；
- 是否通过真实入口；
- 在什么 commit 和环境运行；
- 运行结果是什么；
- 已知覆盖缺口是什么。

## 6. Activity Plane

Activity 描述人与 Agent 当前正在为了改变开发 State 做什么。它不属于“系统已经是什么”或“我们已经知道什么”。

V0 只区分四种 Intent：

```text
INVESTIGATE
SPECIFY
IMPLEMENT
VERIFY
```

### INVESTIGATE

目的：建立可靠 State 和 Observation，提出或削弱 Claim。

### SPECIFY

目的：冻结 Decision 和 Contract，形成可独立实施的 governing Spec。

### IMPLEMENT

目的：按照 accepted Spec 改变代码、配置、schema 或部署 State。

### VERIFY

目的：获得能够验证或违反 Contract 的 Conformance Evidence。

Issue、PR、工作流任务和测试运行都是 Activity 的容器或方法，不是新的知识原语。

## 7. 最重要的类型规则

V0 至少强制以下语义分离。

```text
State ≠ Contract

代码现在是什么
≠
系统应该是什么
```

因此 accepted Spec 与代码冲突时，默认结论是 conformance drift，不是把代码现状反写进 Spec。

```text
Observation ≠ Claim

实际看到了什么
≠
为什么会这样
```

```text
Claim ≠ Decision

我们目前相信什么
≠
因此选择什么方向
```

```text
Decision ≠ Contract

选择了什么方向
≠
实现必须满足的完整义务
```

```text
Spec ≠ Implementation Plan

系统必须满足什么
≠
本次准备先修改哪些文件
```

```text
Test ≠ Evidence

存在或编写了什么测试
≠
测试运行结果对某个 Contract 证明了什么
```

```text
Accepted Spec ≠ Implemented State

规范已经生效
≠
代码已经符合规范
```

```text
Activity ≠ Knowledge

Agent 正在做什么
≠
仓库已经知道或承诺什么
```

## 8. Spec 是组合型治理文档

Spec 不是新的一级原语。

```text
Spec
=
Goal
+ Relevant State
+ Observations
+ Claims / Assumptions
+ Decisions
+ Contracts
+ Acceptance Evidence Plan
+ Alternatives considered
```

一份好的 Spec 应让没有历史上下文的独立团队能够回答：

```text
为什么要改？
当前真实情况是什么？
哪些事实已被验证？
哪些解释仍是假设？
产品和架构最终选择了什么？
系统必须满足哪些 Contract？
什么证据足以证明已经完成？
哪些诱人的方案已被拒绝，为什么？
```

## 9. Spec 存放位置与稳定路径

真实 governing Specs 固定存放在：

```text
docs/specs/<SPEC_ID>.md
```

例如：

```text
docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md
```

规则：

- Spec 路径在生命周期变化时保持稳定；
- 不建立 `accepted/`、`rejected/`、`implemented/` 目录；
- 不因为状态改变而移动文件；
- 不使用 `FINAL`、`FINAL_2` 等文件名表达 lifecycle；
- supersession 使用元数据和双向链接表达；
- `.agents/` 保存 Grammar 和 Skills，不保存每一份具体产品 Spec。

被完整拒绝且从未成为 authority 的 proposed Spec 通常不进入 `main`。其中具有长期价值的拒绝理由应被吸收到最终 governing Spec 的 `Alternatives considered` 中，而不是建立一个无人读取的 rejected 目录。

## 10. Spec 机器可读头部

每份 Spec 的开头必须使用以下最小 YAML frontmatter：

```yaml
---
spec_id: AGENT_FORUM_CORE_INVARIANTS_V1
status: proposed
scope:
  - svc-forum
supersedes: []
---
```

允许的 `status`：

```text
proposed
accepted
superseded
```

当 `status: superseded` 时，必须增加：

```yaml
superseded_by: NEW_SPEC_ID
```

字段语义：

- `spec_id`：仓库内唯一、稳定、不随标题变化的标识；
- `status`：Spec 的规范生命周期；
- `scope`：该 Spec 直接治理的服务、目录、协议或产品面；
- `supersedes`：本 Spec 完整取代的旧 Spec；
- `superseded_by`：当前 Spec 已被哪份新 Spec 完整取代。

Git 历史负责记录作者、日期、review 和接受过程，V0 不复制这些信息到更多元数据字段。

## 11. Spec 最小正文骨架

所有 Spec 必须从以下骨架开始。领域特有章节可以插入，但不能删除必需章节。

```markdown
# Spec: <title>

## Goal

## Current state

## Observations

## Claims and assumptions

## Decision

## Contracts

## Acceptance

## Alternatives considered

## Non-goals

## Risks and unresolved questions

## Implementation sequencing
```

### 11.1 Goal

描述最终改善目标、Metric、Target 和 Constraint，不写任务清单。

### 11.2 Current state

固定 commit 和当前实现事实。不得用理想状态冒充当前状态。

### 11.3 Observations

保存已验证事实及 provenance。推测必须移动到 `Claims and assumptions`。

### 11.4 Claims and assumptions

明确区分：

```text
VERIFIED CLAIM
INFERRED CLAIM
UNVERIFIED ASSUMPTION
```

影响实现方向的 assumption 在 Spec 被接受前必须解决，或者被明确转换为 Contract 允许的行为范围。

### 11.5 Decision

冻结产品和架构选择。Implementation Agent 不应再被要求在多个产品选项中自行选择。

### 11.6 Contracts

每个 Contract 必须有仓库内唯一 ID：

```text
CTR-<DOMAIN>-<NNN>
```

例如：

```text
CTR-IDENTITY-001
CTR-REVIEW-003
CTR-DELETE-002
```

Contract ID 一经被 accepted Spec 使用，不因措辞优化而改变。

Observation、Claim 和 Decision 在小型 Spec 中可以不编号；当它们存在多条 Evidence Link、跨章节引用或跨 Spec 引用时，必须使用稳定 ID：

```text
OBS-<DOMAIN>-<NNN>
CLM-<DOMAIN>-<NNN>
DEC-<DOMAIN>-<NNN>
```

### 11.7 Acceptance

每个验收场景必须显式引用一个或多个 Contract ID。

推荐格式：

```text
AC-001 verifies CTR-REVIEW-001, CTR-REVIEW-002

Given ...
When ...
Then ...
```

Acceptance 必须能区分正确和错误实现，不能只写“测试通过”或“接口可用”。

### 11.8 Alternatives considered

每个真实、重要且未来可能再次被提出的替代方案必须记录：

```text
Rejected because:
<当前为什么不选>

Reopen when:
<哪些新条件会让它值得重新考虑>
```

不得为了模板完整而虚构没有认真考虑过的替代方案。

### 11.9 Risks and unresolved questions

`proposed` 阶段可以有 unresolved questions。

`accepted` 前必须满足：

- 不再存在影响产品行为、权限、数据语义、兼容性或迁移方式的 blocking question；
- 不再包含 `TBD`、`TODO` 或“实现时再决定”的关键选择；
- 只允许留下明确标注为 non-blocking 的后续问题。

### 11.10 Implementation sequencing

只冻结依赖顺序、迁移门槛和安全 rollout 边界。不要把 Spec 写成逐文件施工清单。

## 12. Spec 生命周期与代码一致性状态分离

Spec 生命周期只有：

```text
proposed
accepted
superseded
```

代码对 Spec 的 Conformance State 单独表达：

```text
UNKNOWN
NOT_STARTED
PARTIAL
VERIFIED
DRIFTED
```

示例：

```text
Spec: accepted
Conformance: VERIFIED at commit abc123
```

后续代码回归时：

```text
Spec: accepted
Conformance: DRIFTED at commit def456
```

代码出现 bug 不会自动使 Spec 失效。只有产品或架构 Decision 真正改变时，才创建新 Spec 并 supersede 旧 Spec。

Spec 不使用 `implemented` 状态，因为“规范是什么”和“代码是否做到”是两个不同维度。

## 13. proposed、accepted 与 superseded

### proposed

- 由 Spec Author 起草；
- 可以存在明确的 evidence gap 和 blocking question；
- 不允许授权 Implementation 开工；
- 作者不得自行把自己的 Spec 宣布为 accepted。

### accepted

必须同时满足：

- 已完成独立 Spec Review；
- 所有 blocking product/architecture questions 已冻结；
- Contracts 和 Acceptance 足以让无历史团队实施；
- Owner 或被授权 Reviewer 明确接受；
- accepted 文件已经进入 Implementation branch 的 base branch。

只有最后一条满足后，Implementation 才能开始。

### superseded

- 只用于核心 Decision、Contract authority 或产品语义已经被新 Spec 取代；
- 旧 Spec 保留历史，不改写成相反的决定；
- 新旧 Spec 必须双向引用；
- partial supersession 不得把旧 Spec 整体标为 superseded，应保留两个 authority 并明确各自治理范围。

## 14. 开工前必须分类：REUSE / AMEND / SUPERSEDE / NEW

每次非机械性工作开始前，必须先查找现有 product docs 和 Specs，并选择一种 disposition。

### REUSE

已有 accepted Spec 已完整覆盖变更。

```text
不新增 Spec。
Implementation PR 引用已有 spec_id 和相关 Contract IDs。
```

### AMEND

仍然是同一个 Goal、authority 和核心 Decision，只是补齐遗漏 Contract、修复歧义或改变仍属于同一决策的边界。

```text
先提交独立 Spec amendment PR。
重新 Review 和接受。
进入 base 后再实现。
```

### SUPERSEDE

核心 Decision、产品语义、兼容承诺或 authority 已改变。

```text
创建新 Spec。
旧 Spec 标为 superseded。
双向链接。
新 Spec accepted 后再实现。
```

### NEW

这是一个独立的新 Goal、Contract 集合或产品/架构问题。

选择 disposition 时，不允许为了省事把实际 supersession 伪装成 amendment，也不允许为同一个 Decision 创建重复 Spec。

## 15. Spec-first Merge Gate

每个非机械性 Implementation PR 必须满足：

```text
governing accepted Spec
已经存在于该 PR 的 base branch
```

禁止：

```text
同一个 PR 新建 governing Spec
+
实现该 Spec
```

原因：

- Reviewer 无法区分规范讨论与实现细节；
- Implementation 会反向塑造 Spec；
- scope expansion 更难被发现；
- 合并后无法证明实现是基于已接受 authority 开始的。

Implementation PR 可以同步更新 README、API 文档、JSDoc 和 conformance evidence，但不得在同一 PR 修改 governing Decision 或 Contract。

实现过程中发现 Spec 缺陷时：

1. 停止扩大实现范围；
2. 报告 Spec-Code conflict 或 missing decision；
3. 单独提交 amendment 或 superseding Spec；
4. 新 Spec accepted 并进入 base 后再继续实现。

## 16. Mechanical Change 豁免

只有不改变以下任何内容的纯机械或局部编辑，才可以不引用新 Spec：

```text
用户或 Agent 可观察行为
协议或 API Contract
权限和安全语义
schema / persistence / migration
兼容性承诺
架构边界
跨文件或跨包约定
测试策略
部署或仓库流程
未来维护者需要知道的 durable rationale
```

典型豁免可能包括：

- 无语义的拼写修复；
- 机械格式化；
- 不改变行为的局部重命名且所有引用同改；
- generated output 的机械刷新。

PR 必须明确写：

```text
SPEC_REQUIRED = NO
MECHANICAL_REASON = <why>
```

“改动很小”本身不是豁免理由。

## 17. Skill 与 deterministic gate 的职责分工

### Skill 负责语义工作

`.agents/skills/spec-governance/SKILL.md` 负责：

- preflight 与 disposition；
- 调查 State 和 Observation；
- 区分 Claim、Decision 和 Contract；
- Spec authoring；
- 独立 Spec Review；
- Implementation compliance review；
- 判断 alternatives、scope、risk 和 evidence 是否充分。

Skill 是工作流和语义判断，不是 parser。

### Deterministic gate 负责机器可判定结构

后续应实现仓库级 verifier，至少机械检查：

- `spec_id` 唯一；
- frontmatter 字段和 status 合法；
- 必需章节存在；
- Contract ID 唯一；
- Acceptance 引用存在的 Contract；
- supersession 指向真实 Spec 且双向一致；
- accepted Spec 不含 blocking `TBD` / `TODO`；
- Markdown 链接有效；
- Implementation PR 引用的 accepted Spec 已存在于 base branch；
- 同一 PR 没有同时新建 governing Spec 并实现它。

Parser 不应尝试判断：

- 产品设计是否合理；
- Observation 是否真的支持 Claim；
- Contract 是否完整；
- Acceptance 是否具有足够区分力；
- Alternative 是否诚实；
- 实现是否在语义上符合 Spec。

这些必须由 Skill 和独立 Reviewer 完成。

V0 bootstrap 先冻结 Grammar 与 Skill。deterministic verifier 和 CI 接线作为后续独立治理实现完成，不能用“已有 Skill”冒充机器门禁已经存在。

## 18. 标准开发流程

```text
1. PRECHECK
   读取 AGENTS、Development Grammar、产品方向、现有 Specs、当前代码

2. DISPOSITION
   REUSE / AMEND / SUPERSEDE / NEW

3. INVESTIGATE
   固定 commit，记录 State、Observation、Claim 和 evidence gap

4. SPECIFY
   冻结 Decision、Contracts、Acceptance、Alternatives 和 Non-goals

5. INDEPENDENT SPEC REVIEW
   ACCEPT 或 REVISE

6. ACCEPT AND MERGE SPEC
   accepted Spec 进入 implementation branch 的 base

7. IMPLEMENT
   只按 Contract 改变 State，不扩大产品 scope

8. VERIFY
   通过真实入口收集逐 Contract Conformance Evidence

9. COMPLIANCE REVIEW
   VERIFIED / PARTIAL / DRIFTED
```

不得跳过 5 和 6，直接把 proposed Spec 当作 implementation authority。

## 19. Spec Review 的最低问题集

独立 Reviewer 至少必须回答：

1. Goal 是否是用户/系统结果，而不是实现清单？
2. Current State 是否固定到真实 commit，且没有把理想状态写成事实？
3. Observation、Claim、Decision、Contract 是否分离？
4. Evidence 是否有 provenance，是否足以支持关键 Claim？
5. 是否仍有关键产品选择留给 Implementation Agent？
6. Contract 是否覆盖正常路径、权限、失败、生命周期、事务、迁移和兼容性？
7. Acceptance 是否逐条验证 Contract，并能让错误实现失败？
8. Non-goals 是否阻止 scope expansion？
9. Rejected alternatives 是否保留理由和 reopen condition？
10. 是否与已有 product direction 或 accepted Spec 冲突？
11. 是 AMEND 还是 SUPERSEDE，判断是否诚实？
12. 一个没有历史上下文的团队是否可以据此实施？

## 20. Implementation Compliance Review

Implementation Reviewer 必须建立：

```text
Contract ID
→ changed implementation
→ test / runtime evidence
→ conformance result
```

最低输出：

```text
SPEC_ID = ...
SPEC_STATUS_IN_BASE = accepted | missing | wrong_status
CONFORMANCE = VERIFIED | PARTIAL | DRIFTED
UNVERIFIED_CONTRACTS = ...
SCOPE_EXPANSION = NONE | ...
REJECTED_ALTERNATIVE_REINTRODUCED = NO | ...
IMPLEMENTATION_READY_TO_MERGE = YES | NO
```

绿色测试只能作为 Evidence 的一部分，不能替代逐 Contract mapping。

## 21. 目录布局

V0 采用：

```text
AGENTS.md

.agents/
├── README.md
└── skills/
    └── spec-governance/
        └── SKILL.md

docs/
├── product/
│   └── agent-forum-product-direction-v1.md
└── specs/
    ├── README.md
    └── <SPEC_ID>.md
```

未来可以新增 deterministic verifier 和模板，但不在 `.agents/` 中堆放当前实现事实、运行日志、聊天记录或所有 PR 报告。

## 22. 有意拒绝的替代方案

### 原样复制 DeepSeek Harness 的 proposed/implemented/rejected 目录

Rejected because:

Agent Forum 要求 accepted Spec 先存在于 implementation base。`implemented` 是代码一致性状态，不是 Spec 的规范生命周期；按目录搬动还会制造链接变化和 authority 混淆。

Reopen when:

仓库明确放弃“accepted Spec before implementation”治理，并把 Spec 改成仅记录已完成决策的 ADR。

### 把所有 governing Specs 放进 `.agents/specs/`

Rejected because:

`.agents` 应保存稳定 Grammar 和 Agent workflow；产品和架构 Specs 同时服务人类 Reviewer，应位于自然可发现的 `docs/specs/`。

Reopen when:

仓库的所有规范材料都只服务机器 Agent，且 human-facing docs 已有独立、自动生成的权威投影。

### 建立 accepted/ 和 rejected/ 目录

Rejected because:

生命周期移动会改变路径；重要 rejected rationale 更容易与 governing Spec 分离并被未来 Agent 漏读。

Reopen when:

仓库拥有可靠的稳定 ID resolver 和自动链接重写，且真实规模证明状态目录比稳定路径更易用。

### 所有 Spec 使用完全刚性的超长模板

Rejected because:

不同领域需要协议、schema、权限、部署或迁移等特有章节。V0 只固定核心骨架和语义类型。

Reopen when:

多轮真实 Spec 显示某些缺失章节持续产生同类事故，且可以机械定义而不制造空洞内容。

### 只使用 Skill，不实现 deterministic gate

Rejected because:

Agent 语义审查不应承担唯一 ID、必需章节、链接和 base-branch 前置等确定性检查。

Reopen when:

不适用。Skill-only 只允许作为 bootstrap 过渡状态。

### 让 parser 判断 Spec 是否正确

Rejected because:

产品选择、证据强度、Contract 完整性和 Acceptance 区分力需要语义判断。把它们伪装成 parser 规则会产生虚假的安全感。

Reopen when:

某条规则被长期证明具有稳定、无歧义、可机械判定的形式后，可以单独下沉到 gate。

### Spec 与 Implementation 在同一个 PR

Rejected because:

实现会反向塑造规范，独立 Review 和 scope control 失效。

Reopen when:

仅限真正 mechanical change，且不存在新的 governing Decision 或 Contract。

### V0 同时建设数据库、知识图谱和完整 Agent 平台

Rejected because:

当前首要问题是语义和 authority 稳定。过早建设存储与 UI 会把未稳定概念固化。

Reopen when:

多个仓库持续使用 Grammar，且已经出现明确的跨 Spec 查询、conformance 聚合和 evidence retrieval 需求。

## 23. Agent Forum Pilot 顺序

本治理 PR 合入后，Agent Forum 的第一轮 Pilot 应按以下顺序进行：

```text
Phase 1
起草 AGENT_FORUM_CORE_INVARIANTS_V1

Phase 2
独立 Spec Review，解决所有 blocking product decisions

Phase 3
将 Spec 标记 accepted 并先合入 main

Phase 4
从最新 main 创建 Implementation branch

Phase 5
逐 Contract 修复 identity、authorization、review gate、state machine、delete semantics 和 finalization

Phase 6
独立 compliance review 与真实入口验证

Phase 7
实现 deterministic spec verifier 和不可绕过的 repository gate
```

Phase 1 不得顺手修改 Forum 产品代码。

## 24. V0 成功标准

V0 是否成功，不看：

- `.agents` 文件有多少；
- Spec 有多长；
- Agent 是否自动运行；
- 模板是否覆盖所有可能章节。

重点看：

- Agent 能否区分 State、Observation、Claim、Decision 和 Contract；
- 非机械性实现是否都能找到 base 中的 accepted governing Spec；
- Spec Review 是否能提前发现未冻结的产品选择；
- Implementation PR 是否能逐 Contract 给出 Evidence；
- Spec 与代码冲突是否被报告为 drift，而不是被静默改写；
- 被拒绝方案是否不再被无意重复引入；
- 新 Agent 能否在没有聊天历史的情况下恢复当前 authority 和理由。

## 25. V0 明确不做

第一阶段不做：

- 不建设 Spec 数据库或知识图谱；
- 不迁移所有历史设计文档；
- 不要求每个小改动新建 Spec；
- 不让 Agent 自行接受自己的 Spec；
- 不把测试绿色等同于实现合规；
- 不自动改变 product direction；
- 不把 Forum 扩展成 Workflow、Scheduler、Task Inbox 或 Agent Runtime；
- 不用复杂 confidence 数学模型替代工程判断。

V0 首先建立：

> Grammar + governing Spec authority + reusable Skill + 后续 deterministic gate 的清晰边界。
