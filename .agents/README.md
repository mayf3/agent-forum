# Agent Forum Development Grammar & Spec Governance V0

本文件定义 Agent Forum 仓库中，人与 Agent 如何调查问题、形成 Spec、实施变更和验证一致性。

它在合入 `main` 后成为仓库级开发规则。它不是 Forum 产品 Spec，也不替代具体产品或架构 Spec。

```text
ENFORCEMENT_STATUS = MANUAL_POLICY
DETERMINISTIC_SPEC_VERIFIER = NOT_IMPLEMENTED
BASE_BRANCH_SPEC_GATE = NOT_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
```

V0 的规则具有规范性，但目前依赖作者、Reviewer 和 Maintainer 人工执行。不得把本文、Skill 或 PR 模板的存在描述成已经生效的机器门禁。

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

## 3. 整体架构与目录职责

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
| `.agents/README.md` | 开发语法、authority、生命周期和治理规则 | 具体 Forum 产品决定 |
| `.agents/skills/` | 可重复执行的 Agent 工作流 | 代替 Product Owner 或独立 Reviewer 作最终判断 |
| `docs/product/` | 高层产品方向和边界 | 每次实现的完整可验收 Contract |
| `docs/specs/` | governing Specs、产品/架构/迁移/安全 Contract | 当前代码事实和运行结果 |
| 代码与配置 | 当前实现材料 | 自动证明自己符合 Spec |
| 测试、运行结果、日志、PR | Verification Evidence 与 provenance | 自动成为产品 authority |

`.agents/` 保存稳定 Grammar 和 Skills；真实 governing Specs 固定放在 `docs/specs/`；当前实现事实和运行证据留在代码、测试、PR、日志和原始系统中。

## 4. Authority Model 与优先级

### 4.1 仓库内 authority 层级

Agent Forum V0 明确区分以下层级：

```text
Product Direction
        ↓ may be refined by
Accepted lower-level Specs
        ↓ must be implemented by
Code / Configuration / Schema / Deployment
        ↓ evaluated through
Tests / Runtime Evidence / Compliance Records
```

其中：

1. **Product Direction 是具名的更高层产品 authority。** 当前 authority 是 `docs/product/agent-forum-product-direction-v1.md`。
2. **Accepted Spec 是下级 authority。** 它可以把 Product Direction 细化成可实施、可验收的 Decision 和 Contract。
3. **下级 Spec 不得 supersede、削弱、改写或绕过 Product Direction。** 若产品方向需要改变，必须通过同层级的新 Product Direction authority 完成，而不是由 `docs/specs/` 中的实现级 Spec 完成。
4. **代码、测试和当前部署不是规范 authority。** 它们只能表达实现材料、Observation、Evidence 和 conformance。

当下级 Spec 与 Product Direction 冲突时：

```text
AUTHORITY_CONFLICT = YES
SPEC_READY_FOR_ACCEPTANCE = NO
IMPLEMENTATION_ALLOWED = NO
```

不能以“代码已经如此”或“下级 Spec 更具体”为理由覆盖 Product Direction。

### 4.2 V0 禁止 partial supersession

V0 的 `supersedes` 只表示**完整 authority supersession**。

禁止：

- 只 supersede 一份 Spec 的某个章节；
- 只 supersede 某个 Decision 或 Contract；
- 同一份旧 Spec 在没有机器可读映射时一部分仍有效、一部分失效；
- 使用自然语言范围声明模拟 partial supersession。

若 accepted Spec 的任何既有规范含义需要改变，V0 要求创建一份完整的新 Spec，重新陈述其完整 authority，并完整 supersede 旧 Spec。

只有先通过独立治理变更引入显式、机器可读的 per-authority / per-Contract ownership 与 supersession model，未来版本才可以允许 partial supersession。

### 4.3 External governing dependencies

本仓库可以引用其他仓库拥有的 governing authority，例如 auth-service 的 accepted Spec、协议或安全 Contract。

外部 authority 引用必须固定：

```text
repository
stable authority or spec ID
immutable revision: commit / tag / release
relevant scope when needed
```

可在 Spec frontmatter 中使用：

```yaml
external_authorities:
  - repository: mayf3/auth-service
    authority_id: AUTH_SERVICE_EXAMPLE_V1
    revision: <immutable commit>
```

规则：

- 外部 authority 的所有权仍属于其原仓库；
- 本仓库只能声明 dependency、alignment 或 conflict；
- 本仓库的 `supersedes` / `superseded_by` 不得指向外部仓库；
- 本仓库不得修改、接受、拒绝或 supersede 外部 authority；
- 出现跨仓库冲突时，必须阻塞本地接受或实现，并在 authority owner 所在仓库完成协调。

External reference 不是跨仓库治理权的转移。

## 5. Development Grammar：六个一级原语

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

### 5.1 Goal

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

### 5.2 State

State 回答：

> 在一个明确版本、环境和时间点上，我们对当前系统形成了什么投影？

Current State 是一个**有版本的 projection**，不是无需来源的事实 authority。

它应尽可能固定：

```text
repository
branch / commit
schema
configuration
runtime mode
environment
observation time
API response
current tests
production evidence when available
```

每个 load-bearing State 陈述必须：

- 由一个或多个带 provenance 的 Observation 支撑；或
- 明确标记为由 Observation 推导出的 Claim / inference；或
- 标记为尚未验证的 assumption。

State 可以压缩和组织 Observations 与 Claims，方便恢复当前系统视图，但不能把未引用的叙述升级成事实，也不能反过来充当自己的 Evidence。

### 5.3 Observation

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
- 日志、环境和观察时间。

Observation 不负责解释原因。

### 5.4 Claim

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

Claim 永远不是“已被证明为不可推翻的事实”。在 Spec 中使用：

```text
SUPPORTED CLAIM
INFERRED CLAIM
UNVERIFIED ASSUMPTION
```

不得使用 `VERIFIED CLAIM`。Claim 即使得到强证据支持，仍然是可被后续 Observation 削弱或推翻的命题。

### 5.5 Decision

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

### 5.6 Contract

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

## 6. Evidence Link 不是新的一级原语

原始材料本身不自动等于 Evidence。

```text
代码文件 ≠ Evidence
测试文件 ≠ Evidence
PR ≠ Evidence
日志文件 ≠ Evidence
外部文章 ≠ Evidence
```

Evidence 是带 provenance 的关系。

### 6.1 Reasoning Evidence

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

### 6.2 Conformance Evidence

```text
Test / Runtime Observation
   │
   ├── VERIFIES ──► Contract
   └── VIOLATES ──► Contract
```

“存在一个测试”不证明 Contract 已满足。有效的 Conformance Evidence 至少需要说明：

- 针对哪个 Contract；
- 是否通过真实入口；
- Spec revision commit；
- implementation commit；
- environment；
- evaluation time；
- 运行结果；
- evidence reference；
- 已知覆盖缺口。

## 7. Activity Plane

Activity 描述人与 Agent 当前正在为了改变开发 State 做什么。它不属于“系统已经是什么”或“我们已经知道什么”。

V0 只区分四种 Intent：

```text
INVESTIGATE
SPECIFY
IMPLEMENT
VERIFY
```

- `INVESTIGATE`：建立可靠 Observation，形成 Current State projection，提出或削弱 Claim。
- `SPECIFY`：冻结 Decision 和 Contract，形成可独立实施的 governing Spec。
- `IMPLEMENT`：按照 accepted Spec 改变代码、配置、schema 或部署 State。
- `VERIFY`：获得能够验证或违反 Contract 的 qualified Conformance Evidence。

Issue、PR、工作流任务和测试运行都是 Activity 的容器或方法，不是新的知识原语。

## 8. 最重要的类型规则

V0 至少强制以下语义分离。

```text
State ≠ Observation

当前系统的版本化投影
≠
直接读取、复现或测量到的原始事实
```

```text
State ≠ Contract

代码当前是什么
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
某次执行结果对某个 Contract 证明了什么
```

```text
Accepted Spec ≠ Implemented State

规范已经生效
≠
代码已经符合规范
```

```text
VERIFIED Conformance ≠ Permanent Spec Property

某次有完整限定条件的评估通过
≠
该 Spec 永久、无条件地被实现
```

```text
Activity ≠ Knowledge

Agent 正在做什么
≠
仓库已经知道或承诺什么
```

## 9. Spec 是组合型治理文档

Spec 不是新的一级原语。

```text
Spec
=
Goal
+ Current State projection
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
当前投影基于哪些真实 Observation？
哪些解释是 SUPPORTED、INFERRED 或 UNVERIFIED？
产品和架构最终选择了什么？
系统必须满足哪些 Contract？
什么 qualified Evidence 足以证明已经完成？
哪些诱人的方案已被拒绝，为什么？
```

## 10. Spec 存放位置与稳定路径

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

## 11. Spec 机器可读头部

每份 Spec 的开头必须使用以下最小 YAML frontmatter：

```yaml
---
spec_id: AGENT_FORUM_CORE_INVARIANTS_V1
status: proposed
scope:
  - svc-forum
supersedes: []
external_authorities: []
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
- `supersedes`：本 Spec 完整取代的本仓库同层级旧 Spec；
- `superseded_by`：当前 Spec 已被哪份本仓库同层级新 Spec 完整取代；
- `external_authorities`：只读引用的外部 governing dependencies。

`supersedes` 与 `superseded_by` 不得用于 Product Direction 或外部仓库 authority。

Git 历史提供 commit provenance，但**不能单独代替 Review Binding**。Review Binding 由第 16 节规定的人工治理记录保存。

## 12. Spec 最小正文骨架

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

### 12.1 Current state

固定 commit、environment 和 observation time。每项重要 State 陈述应引用 Observation，或明确标为 Claim / assumption。不得用理想状态冒充当前状态，也不得把 Current State 当作无需来源的 authority。

### 12.2 Observations

保存直接事实及 provenance。推测必须移动到 `Claims and assumptions`。

### 12.3 Claims and assumptions

明确区分：

```text
SUPPORTED CLAIM
INFERRED CLAIM
UNVERIFIED ASSUMPTION
```

影响实现方向的 assumption 在 Spec 被接受前必须解决，或者被明确转换为 Contract 允许的行为范围。

### 12.4 Decision

冻结产品和架构选择。Implementation Agent 不应再被要求在多个产品选项中自行选择。

### 12.5 Contracts 与稳定 ID

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

Contract ID 一旦进入 accepted Spec，就永久绑定其当时的规范含义：

- 不得改变含义；
- 不得用于不同 Contract；
- 不得在删除、supersession 或历史清理后重新分配；
- 规范含义变化必须使用新 Spec ID 和新 Contract ID。

Observation、Claim 和 Decision 在小型 Spec 中可以不编号；当它们存在 Evidence Link、跨章节引用或跨 Spec 引用时，使用稳定 ID：

```text
OBS-<DOMAIN>-<NNN>
CLM-<DOMAIN>-<NNN>
DEC-<DOMAIN>-<NNN>
```

一旦编号的 Decision 进入 accepted Spec，其 ID 同样不得承载不同规范含义。

### 12.6 Acceptance

每个验收场景必须显式引用一个或多个 Contract ID。

推荐格式：

```text
AC-001 verifies CTR-REVIEW-001, CTR-REVIEW-002

Given ...
When ...
Then ...
```

Acceptance 必须能区分正确和错误实现，不能只写“测试通过”或“接口可用”。

### 12.7 Alternatives considered

每个真实、重要且未来可能再次被提出的替代方案必须记录：

```text
Rejected because:
<当前为什么不选>

Reopen when:
<哪些新条件会让它值得重新考虑>
```

不得为了模板完整而虚构没有认真考虑过的替代方案。

### 12.8 Risks and unresolved questions

`proposed` 阶段可以有 unresolved questions。

`accepted` 前必须满足：

- 不再存在影响产品行为、权限、数据语义、兼容性或迁移方式的 blocking question；
- 不再包含 `TBD`、`TODO` 或“实现时再决定”的关键选择；
- 只允许留下明确标注为 non-blocking 的后续问题。

### 12.9 Implementation sequencing

只冻结依赖顺序、迁移门槛和安全 rollout 边界。不要把 Spec 写成逐文件施工清单。

## 13. Spec 生命周期与 Accepted-Spec immutability

Spec 生命周期只有：

```text
proposed
accepted
superseded
```

### 13.1 proposed

- 由 Spec Author 起草；
- 可以存在明确的 evidence gap 和 blocking question；
- 不允许授权 Implementation 开工；
- 作者不得自行把自己的 Spec 宣布为 accepted。

### 13.2 accepted

必须同时满足：

- 已完成独立 Spec Review；
- 所有 blocking product/architecture questions 已冻结；
- Contracts 和 Acceptance 足以让无历史团队实施；
- Product Owner 或被授权 Reviewer 明确接受；
- final accepted head 已完成独立 recheck；
- accepted 文件已经进入 Implementation branch 的 base branch。

只有最后一条满足后，Implementation 才能开始。

一旦某一 Spec revision 被接受：

- 该 revision 中既有 Decision 和 Contract 的规范含义不可在同一稳定 ID 下改变；
- `status: accepted` 不授权作者根据代码现状改写规范；
- 旧 revision 的历史含义必须能通过 Git 及 Review Binding 恢复。

### 13.3 Post-acceptance AMEND

accepted Spec 在同一 `spec_id` 下只允许两类 AMEND：

1. **Editorial-only**：拼写、链接、格式或不改变任何规范含义的澄清。
2. **Strictly additive**：新增独立 Decision / Contract / Acceptance，使用新稳定 ID，且不缩小、扩大、冲突、废弃或重新解释任何既有规范义务。

每次 post-acceptance AMEND 都形成新的 Spec revision commit，必须重新经过独立 Review Binding。

若变更会影响既有 Decision 或 Contract 的含义，即使只改变一句话、一个边界或一个例外，也不是 AMEND，必须 `SUPERSEDE`。

### 13.4 superseded

- 只用于整份 accepted Spec 的 authority 被完整新 Spec 取代；
- 旧 Spec 保留原有规范内容，只允许增加 supersession 元数据和链接；
- 新 Spec 必须重新陈述完整 authority；
- 新旧 Spec 必须双向引用；
- V0 不支持 partial supersession；
- superseding Spec 使用新的 `spec_id` 和新的 Contract IDs；旧 ID 永久保留且不得复用。

下级 Spec 不得 supersede Product Direction，任何本地 Spec 不得 supersede 外部 authority。

## 14. 代码一致性状态与 qualified conformance

代码对 Spec 的一致性不是 Spec 的 lifecycle，也不是永久属性。

V0 使用以下结果词：

```text
UNKNOWN
NOT_STARTED
PARTIAL
VERIFIED
DRIFTED
```

每一条 Conformance Record 必须绑定：

```text
spec_id
spec_revision_commit
implementation_commit
environment
evaluated_at
evidence_refs
result
coverage_gaps
```

形式上：

```text
Conformance(
  spec revision,
  implementation commit,
  environment,
  evaluation time,
  evidence set
) = result
```

因此禁止无条件陈述：

```text
“这个 Spec 已经 VERIFIED”
“系统永久符合 CTR-X”
```

允许陈述：

```text
Conformance for SPEC_X @ <spec commit>
against implementation @ <implementation commit>
in <environment>
at <time>
with <evidence refs>
= VERIFIED
```

`VERIFIED` 只表示在该限定关系和 evidence scope 内，所有 in-scope Contract 已被验证。后续代码、环境、依赖、数据或证据变化后，必须产生新的 Conformance Record；旧记录仍是历史证据，但不能自动推广。

代码出现 bug 不会自动使 Spec 失效。只有规范 Decision 真正改变时，才完整 supersede 旧 Spec。

## 15. 开工前必须分类：REUSE / AMEND / SUPERSEDE / NEW

每次非机械性工作开始前，必须先查找 Product Direction、现有 Specs 和外部 governing dependencies，并选择一种 disposition。

### REUSE

已有 accepted Spec revision 已完整覆盖变更。

```text
不新增 Spec。
Implementation PR 引用 spec_id、spec revision commit 和相关 Contract IDs。
```

### AMEND

对 proposed Spec，可在同一 `spec_id` 下继续修改。

对 accepted Spec，只允许第 13.3 节定义的 editorial-only 或 strictly additive AMEND。任何既有规范含义变化都不得使用 AMEND。

```text
先提交独立 Spec amendment PR。
重新 Review Binding 和接受。
新 revision 进入 base 后再实现。
```

### SUPERSEDE

既有 accepted Decision、Contract、兼容承诺、authority 或产品语义需要改变。

```text
创建完整新 Spec。
使用新 spec_id 和新 Contract IDs。
完整 supersede 旧 Spec。
双向链接。
新 Spec accepted 后再实现。
```

V0 不允许 partial supersession。

### NEW

这是一个独立的新 Goal、Contract 集合或产品/架构问题，不改变既有 authority 的含义。

选择 disposition 时，不允许为了省事把 normative change 伪装成 AMEND，也不允许为同一个 Decision 创建重复 authority。

## 16. Review Binding

每次 `REVIEW` 必须针对精确 commit，而不是针对文件名、PR 标题或“最新版本”。

初次 Review 记录至少包含：

```text
REVIEW_BASE_COMMIT = <exact base sha>
REVIEWED_SPEC_COMMIT = <exact head sha containing reviewed Spec>
REVIEWER_IDENTITY = <platform-bound identity, e.g. github:login>
SPEC_REVIEW = ACCEPT | REVISE
REVIEWED_AT = <timestamp>
```

规则：

- reviewer identity 优先使用 GitHub 等平台绑定身份；
- Spec Author 不得作为独立 Reviewer；
- Review 只绑定 `REVIEWED_SPEC_COMMIT`；
- Review 后任何 Decision、Contract、Acceptance、authority、risk disposition 或其他语义变化都会立即使该 Review 失效；
- 语义变化后必须对新的 exact commit 完整重跑 REVIEW；
- 仅 status flip、review metadata 或已确认不改变规范含义的机械编辑可以进入 final recheck，而不能自动继承接受结论。

在最终接受前，必须对 PR 的 final accepted head 独立 recheck，并记录：

```text
FINAL_ACCEPTED_HEAD = <exact final head sha>
FINAL_RECHECK_REVIEWER_IDENTITY = <independent platform-bound identity>
FINAL_RECHECK_RESULT = PASS | FAIL
SEMANTIC_CHANGE_SINCE_ACCEPTED_REVIEW = NONE | <description>
REVIEW_BINDING = VALID | INVALID
FINAL_RECHECKED_AT = <timestamp>
```

`FINAL_RECHECK_REVIEWER_IDENTITY` 必须独立于 Spec Author；可以是原独立 Reviewer，也可以是另一名独立 Reviewer。

只有同时满足以下条件时，Review Binding 才有效：

- initial ACCEPT review 的 exact base/head/identity 已记录；
- final accepted head 已记录；
- final head 完成独立 recheck；
- reviewed commit 之后不存在未经重新 REVIEW 的语义变化；
- `REVIEW_BINDING = VALID`。

V0 的 Review Binding 记录保存在 GitHub PR review / conversation 中。由于把最终 commit SHA 写入该 commit 自身会形成自引用，V0 不要求 Spec 文件内嵌 final head。未来可以通过独立 sidecar 或 repository gate 机械化，但不能用普通 Git 历史替代上述绑定。

## 17. Spec-first base-branch rule

每个非机械性 Implementation PR 必须满足：

```text
governing accepted Spec revision
已经存在于该 PR 的 base branch
```

禁止：

```text
同一个 PR 新建 governing Spec
+
实现该 Spec
```

Implementation PR 必须引用：

```text
spec_id
accepted spec revision commit
Contract IDs
```

实现过程中发现 Spec 缺陷时：

1. 停止扩大实现范围；
2. 报告 authority conflict、conformance drift 或 missing decision；
3. 单独提交允许的 AMEND 或完整 SUPERSEDE；
4. 新 accepted revision 进入 base 后再继续实现。

当前该规则仅由人工 PREFLIGHT、REVIEW、COMPLIANCE 和 Maintainer 执行：

```text
ENFORCEMENT = MANUAL_POLICY
AUTOMATIC_BASE_BRANCH_GATE = NO
REQUIRED_BRANCH_PROTECTION = NO
```

因此 `IMPLEMENTATION_ALLOWED = YES` 只是治理判断，不表示 GitHub 已技术阻止违规 merge。

## 18. Mechanical Change 豁免

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

## 19. Skill 与 deterministic gate 的职责分工

### Skill 负责语义工作

`.agents/skills/spec-governance/SKILL.md` 负责：

- PREFLIGHT 与 disposition；
- authority resolution；
- 调查 Observation 并形成 Current State projection；
- 区分 Claim、Decision 和 Contract；
- Spec authoring；
- exact-commit Review Binding；
- Implementation compliance review；
- 判断 alternatives、scope、risk 和 evidence 是否充分。

Skill 是工作流和语义判断，不是 parser。

### Deterministic gate 负责机器可判定结构

后续应实现仓库级 verifier，至少机械检查：

- `spec_id` 唯一；
- frontmatter 字段和 status 合法；
- 必需章节存在；
- Contract ID 唯一且不被复用；
- Acceptance 引用存在的 Contract；
- supersession 只在本仓库同层级 Spec 间发生；
- partial supersession 被拒绝；
- external authority reference 固定 immutable revision；
- accepted Spec 不含 blocking `TBD` / `TODO`；
- Markdown 链接有效；
- Implementation PR 引用的 accepted Spec revision 已存在于 base branch；
- 同一 PR 没有同时新建 governing Spec 并实现它；
- Review Binding 覆盖 final accepted head；
- branch protection 要求该 gate。

Parser 不应尝试判断：

- 产品设计是否合理；
- Observation 是否真的支持 Claim；
- Contract 是否完整；
- Acceptance 是否具有足够区分力；
- Alternative 是否诚实；
- AMEND 是否真的没有改变语义；
- 实现是否在语义上符合 Spec。

这些必须由 Skill 和独立 Reviewer 完成。

V0 bootstrap 只冻结 Grammar、authority、Review Binding 与 Skill。deterministic verifier、base-branch gate 和 required branch protection 作为后续独立治理实现完成。

## 20. 标准开发流程

```text
1. PRECHECK
   读取 AGENTS、Development Grammar、Product Direction、现有 Specs、外部 authority、当前代码

2. AUTHORITY + DISPOSITION
   解析 authority precedence；选择 REUSE / AMEND / SUPERSEDE / NEW

3. INVESTIGATE
   固定 commit/environment/time；记录 Observations、Claims 和 Current State projection

4. SPECIFY
   冻结 Decision、Contracts、Acceptance、Alternatives 和 Non-goals

5. INDEPENDENT SPEC REVIEW
   记录 exact base、reviewed commit、reviewer identity；ACCEPT 或 REVISE

6. FINAL ACCEPTED HEAD RECHECK
   语义变化则完整重跑 REVIEW；否则独立确认 final head 并形成 VALID Review Binding

7. ACCEPT AND MERGE SPEC
   accepted Spec revision 进入 implementation branch 的 base

8. IMPLEMENT
   只按 Contract 改变 State，不扩大产品 scope

9. VERIFY
   收集绑定 spec revision、implementation commit、environment、time、evidence 的 Conformance Record

10. COMPLIANCE REVIEW
   输出 qualified VERIFIED / PARTIAL / DRIFTED
```

不得跳过 5、6 和 7，直接把 proposed Spec 或未绑定的 review 当作 implementation authority。

## 21. Spec Review 的最低问题集

独立 Reviewer 至少必须回答：

1. Product Direction 是否被明确识别为更高 authority？
2. 下级 Spec 是否只 refine，而没有 supersede Product Direction？
3. 是否存在被伪装成自然语言范围的 partial supersession？
4. External authority 是否只读引用且固定 immutable revision？
5. Goal 是否是用户/系统结果，而不是实现清单？
6. Current State 是否固定 commit/environment/time，并由 Observation 和 Claim 支撑？
7. Observation、Claim、Decision、Contract 是否分离？
8. Claim 是否使用 SUPPORTED 而不是 VERIFIED？
9. Evidence 是否有 provenance，是否足以支持关键 Claim？
10. 是否仍有关键产品选择留给 Implementation Agent？
11. Contract 是否覆盖正常路径、权限、失败、生命周期、事务、迁移和兼容性？
12. Acceptance 是否逐条验证 Contract，并能让错误实现失败？
13. post-acceptance AMEND 是否真的只 editorial 或 strictly additive？
14. 规范含义变化是否完整 SUPERSEDE，并使用新 ID？
15. Non-goals 是否阻止 scope expansion？
16. Rejected alternatives 是否保留理由和 reopen condition？
17. 一个没有历史上下文的团队是否可以据此实施？
18. Review 是否绑定 exact base/head/identity，final accepted head 是否被独立 recheck？

## 22. Implementation Compliance Review

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
SPEC_REVISION_COMMIT = ...
SPEC_STATUS_IN_BASE = accepted | missing | wrong_status | superseded
IMPLEMENTATION_COMMIT = ...
ENVIRONMENT = ...
EVALUATED_AT = ...
EVIDENCE_REFS = ...
CONFORMANCE = VERIFIED | PARTIAL | DRIFTED
UNVERIFIED_CONTRACTS = ...
COVERAGE_GAPS = ...
SCOPE_EXPANSION = NONE | ...
REJECTED_ALTERNATIVE_REINTRODUCED = NO | ...
IMPLEMENTATION_READY_TO_MERGE = YES | NO
```

绿色测试只能作为 Evidence 的一部分，不能替代逐 Contract mapping。`CONFORMANCE = VERIFIED` 只能在上述字段全部限定的记录中使用。

## 23. 目录布局

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

未来可以新增 deterministic verifier、Review Binding sidecar 和模板，但不在 `.agents/` 中堆放当前实现事实、运行日志、聊天记录或所有 PR 报告。

## 24. 有意拒绝的替代方案

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

### Partial supersession 只用自然语言声明

Rejected because:

没有 per-authority / per-Contract ownership model 时，读者和 verifier 无法稳定判断哪个 authority 仍生效，会制造无法机械解析的重叠规范。

Reopen when:

仓库先接受并实现显式、机器可读的 authority ownership 与 partial supersession model。

### accepted Spec 在同一 ID 下修改既有规范含义

Rejected because:

这会破坏历史 review、Contract mapping、conformance evidence 和新 Agent 对稳定 authority 的恢复。

Reopen when:

不适用。规范含义变化必须 SUPERSEDE；稳定 ID 不得复用。

### 仅依靠 Git 历史推断 Review Binding

Rejected because:

Git 只记录 commit 关系，不记录 Reviewer 对哪个 exact base/head 作了什么语义判断，也不能证明 final accepted head 未发生语义变化。

Reopen when:

存在等价或更强、可机械验证的 review attestation 系统。

### 所有 Spec 使用完全刚性的超长模板

Rejected because:

不同领域需要协议、schema、权限、部署或迁移等特有章节。V0 只固定核心骨架和语义类型。

Reopen when:

多轮真实 Spec 显示某些缺失章节持续产生同类事故，且可以机械定义而不制造空洞内容。

### 只使用 Skill，不实现 deterministic gate

Rejected because:

Agent 语义审查不应承担唯一 ID、必需章节、链接和 base-branch 前置等确定性检查。

Reopen when:

不适用。Skill-only 只允许作为明确标记的 `MANUAL_POLICY` bootstrap 过渡状态。

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

## 25. Agent Forum Pilot 顺序

本治理 PR 合入后，Agent Forum 的第一轮 Pilot 应按以下顺序进行：

```text
Phase 1
起草 AGENT_FORUM_CORE_INVARIANTS_V1

Phase 2
独立 Spec Review，解决所有 blocking product decisions

Phase 3
独立 recheck final accepted head，形成 VALID Review Binding

Phase 4
将 accepted Spec revision 先合入 main

Phase 5
从最新 main 创建 Implementation branch

Phase 6
逐 Contract 修复 identity、authorization、review gate、state machine、delete semantics 和 finalization

Phase 7
独立 compliance review 与真实入口验证，产生 qualified Conformance Record

Phase 8
实现 deterministic spec verifier、base-branch gate 和 required branch protection
```

Phase 1 不得顺手修改 Forum 产品代码。

## 26. V0 成功标准

V0 是否成功，不看：

- `.agents` 文件有多少；
- Spec 有多长；
- Agent 是否自动运行；
- 模板是否覆盖所有可能章节。

重点看：

- Agent 能否区分 State projection、Observation、Claim、Decision 和 Contract；
- Product Direction 是否始终保持上级 authority；
- 非机械性实现是否都能找到 base 中的 accepted governing Spec revision；
- accepted Decision 与 Contract ID 是否保持语义不可变；
- Spec Review 是否绑定 exact commits 和 reviewer identity；
- Implementation PR 是否能逐 Contract 给出 qualified Evidence；
- Spec 与代码冲突是否被报告为 drift，而不是被静默改写；
- 被拒绝方案是否不再被无意重复引入；
- 新 Agent 能否在没有聊天历史的情况下恢复当前 authority 和理由。

## 27. V0 明确不做

第一阶段不做：

- 不建设 Spec 数据库或知识图谱；
- 不迁移所有历史设计文档；
- 不要求每个小改动新建 Spec；
- 不让 Agent 自行接受自己的 Spec；
- 不把测试绿色等同于实现合规；
- 不允许下级 Spec 改变 Product Direction；
- 不支持 partial supersession；
- 不把 Forum 扩展成 Workflow、Scheduler、Task Inbox 或 Agent Runtime；
- 不用复杂 confidence 数学模型替代工程判断；
- 不宣称 deterministic verifier、base-branch gate 或 branch protection 已存在。

V0 首先建立：

> Grammar + authority precedence + accepted-Spec immutability + Review Binding + qualified conformance + reusable Skill；当前 enforcement 明确为 MANUAL_POLICY。
