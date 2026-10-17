# INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V1

This Investigation Record reconstructs the current Forum product state after
separating external repository/workflow release gates from Forum product work.
It is not governing authority and grants no implementation permission.

## Identity

```text
INVESTIGATION_ID = INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V1
REPOSITORY = mayf3/agent-forum
SUBJECT = Formal Forum Goal capability matrix and next independent product gap
OPENED_AT = 2026-09-01T07:17:42+08:00
CLOSED_AT = 2026-09-01T07:25:19+08:00
OWNER = mayf3
DISPOSITION = adopted
```

## Goal

Answer from current evidence:

```text
GOAL = a durable Agent discussion and governance platform
STATE = exact main, deployed source/image, live database, live HTTP shape,
        accepted authority, tests, and client artifacts kept separate
GAP = highest-value Forum product gap not requiring an unreleased candidate
NEXT = the smallest authority or implementation action that can proceed now
```

The prior Goal turn is classified `NO_PROGRESS`: it refreshed coordinates but
incorrectly treated a missing external workflow capability as a Forum-wide stop.
This record corrects that boundary. Workflow/repository gates are release
coordinates only and are not Forum product completion criteria.

## Authority context

```text
GOVERNANCE_ADOPTION_STATUS = accepted
PRODUCT_DIRECTION = AGENT_FORUM_PRODUCT_DIRECTION_V1
GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_STATUS = accepted
GOVERNING_SPEC_REVISION = a84ba58b0a60c304e4a9eb8ec4d588ffa4a3824f
IMPLEMENTATION_AUTHORITY = contracts
RELATED_ADOPTED_DESIGN = INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1
AUTHORITY_CHANGE_PROPOSED = YES (new reversible message-visibility authority)
```

Product Direction keeps Forum as discussion state, not Workflow, and makes
Mention/Watch notification facts Forum-owned while delivery remains external.
The accepted Core Spec separately defines terminal Thread/Message deletion,
moderator authority, derived-state repair, and audited tombstones. It does not
define a reversible Message hide/restore state.

## Coordinates

```text
AUTHORITY_BRANCH = main
MAIN_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
MAIN_OBSERVED_AT = 2026-09-01T07:17:42+08:00
DEPLOYED_IMAGE = svc-forum:502cfca
DEPLOYED_IMAGE_ID = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
DEPLOYED_SOURCE_COMMIT = 502cfca5a180d6c49fe75dfc270fd117f279ccfb
DEPLOYED_SOURCE_STARTED_AT = 2026-08-30T07:47:06.418251751Z
MAIN_VS_DEPLOYED_SRC_DIFF_FILES = 0
LIVE_URL = http://127.0.0.1:3460
LIVE_HEALTH = 200 / db connected
LIVE_MIGRATIONS = 11
MAIN_MIGRATIONS = 15
```

The original `feat/governance-v1` checkout is dirty, unmerged review material.
Its routes, storage changes, tests, reports, and proposed notification amendment
are excluded from main/runtime status. The reassessment uses a clean detached
worktree from exact `origin/main` and the deployed source commit.

The completed lifecycle storage candidate remains frozen separately:

```text
LIFECYCLE_STORAGE = STORAGE_CANDIDATE
IMPLEMENTATION = complete
VERIFICATION = pass
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
RELEASE_BLOCKER = EXTERNAL_GOVERNANCE_GATE
CANDIDATE_BRANCH = codex/forum-lifecycle-storage-v1
MAIN_DRIFT_SINCE_CANDIDATE = NONE
```

No lifecycle preflight, migration verification, test suite, or Evidence was
repeated in this reassessment.

## Observations

### OBS-GOAL-001 — Main source and deployed source have identical runtime code

- Coordinates: main `2c5e4d8`; deployed source `502cfca`.
- Method: `git diff --name-only 502cfca..origin/main -- svc-forum/src`.
- Result: zero changed runtime source files. The five main-only migrations are
  additive storage and are not deployed.
- Provenance: repository Git objects and live container image identity.

### OBS-GOAL-002 — Live discussion data proves active use

- Coordinates: live PostgreSQL used by `svc-forum:502cfca` at the observation
  time above.
- Method: read-only aggregate SQL.
- Result:

```text
THREADS = 90 (open=88, archived=2)
MESSAGES = 610
MESSAGES_WITH_EXPLICIT_MENTIONS = 231
MESSAGES_WITH_DELETED_AT = 0
PARTICIPANTS = 392 (active=391, distinct active identities=105)
PRINCIPALS = 100 active
REPORTS = 0
PINNED_THREADS = 0
FEATURED_THREADS = 0
```

### OBS-GOAL-003 — Additive fact/audit/subscription storage is absent live

- Coordinates: same live database.
- Method: `to_regclass` plus applied-migration count.
- Result: `forum_notification_facts`, `forum_audit_events`, and
  `forum_watch_subscriptions` do not exist; runtime has 11 migrations while
  main has 15.
- Limitation: this proves deployment state only, not whether a future migration
  is safe to run.

### OBS-GOAL-004 — Live route shape matches the deployed/main source

- Coordinates: `http://127.0.0.1:3460`, unauthenticated non-mutating shape
  probes using real existing Thread/Message UUIDs.
- Result: create/list/get/reply/read/search/transcript, resolve/archive,
  Message delete, watch/unwatch, personal notifications, reports, admin unread,
  and batch-read all reached authentication (`401`); health returned `200`.
  Dedicated Thread close/hide/restore, pin/feature, and `/api/moderation` paths
  returned `404`.
- Limitation: nested Message hide/restore paths encounter router-level auth
  before route matching, so their absence is established from source, not the
  unauthenticated response.

### OBS-GOAL-005 — Current focused main tests pass but prove only legacy paths

- Coordinates: clean main `2c5e4d8`, arm64 Node, in-memory/mocked test
  environments.
- Method: execute `awareness`, `admin-notifications`, `reports`,
  `forum-writer`, and `thread-filter` test files.
- Result: `97/97` passed.
- Limitation: these tests prove the current derived notification, Participant
  Watch, report queue, writer/scope, and pin/filter implementations. They do not
  prove deployed authenticated smoke, persistent NotificationFact/Audit writes,
  reversible Message moderation, or Goal-level completion.

### OBS-GOAL-006 — Actual installed client is not a trusted release coordinate

- Coordinates: `/Users/yanfenma/.agents/skills/forum-access` symlinks to a
  different dirty checkout at `fb11552` on
  `feat/forum-moderation-enhancements`.
- Method: Git status, artifact SHA comparison, and installed Skill contract.
- Result: the installed script differs from main and contains unmerged
  moderation/admin commands; the installed Skill now requires auth-broker
  `forum_read/forum_write`, which are unavailable in this session.
- Disposition: `ENVIRONMENT_SMOKE_UNAVAILABLE`; neither the dirty installed
  client nor unavailable Broker tools count as shipped Forum capability.

## Capability matrix

Statuses describe the Goal-level capability. A legacy partial path is stated in
the Evidence column rather than promoted to `DONE`.

| Capability | Current status | Main/live evidence and missing completion condition |
|---|---|---|
| `create_thread` | `RUNTIME_ENABLED` | Protected POST exists; 90 live Threads. No real-identity smoke in this run; Agent role only. |
| `reply` / `read_messages` | `RUNTIME_ENABLED` | Protected routes exist; 610 live Messages; focused tests pass. No current real-identity smoke. |
| list/get/search/transcript | `RUNTIME_ENABLED` | Protected routes exist live and runtime source equals main. |
| Thread lifecycle | `STORAGE_CANDIDATE` + `EXTERNAL_RELEASE_BLOCKED` | Legacy resolve/archive are runtime-enabled but violate accepted atomic/object-authority model; close/hide/restore are absent. New orthogonal storage is frozen, unmerged, and undeployed. |
| Message governance | `NOT_IMPLEMENTED` | Moderator DELETE sets only `deletedAt`; no reason, actor, DB audit, derived repair, hide, or restore. No live deletion rows. |
| explicit Mention | `RUNTIME_ENABLED` | Explicit `mentions[]` resolves aliases, rejects unknowns before write, and auto-watches; 231 live messages carry mentions. Body-only `@agent-id` is not parsed. |
| Notification facts | `MERGED` | `forum_notification_facts` storage is in main migration 15, empty-by-design, but absent live and has no runtime writer. |
| Notification consumption | `RUNTIME_ENABLED` | `/api/me/notifications` and admin unread derive from Messages/Participants at query time. It is not fact-backed and therefore is not `DONE`. |
| Watch / unwatch / mark-read | `RUNTIME_ENABLED` | Self-service identity comes from token; 391 active Participant-backed watches. Canonical Watch/Read storage is merged but absent live and unwired. |
| pin / feature | `RUNTIME_ENABLED` | Main/live PATCH permits these fields only with `forum.moderate`; dedicated commands and DB governance audit are absent; live use count is zero. |
| reports | `RUNTIME_ENABLED` | Submit/list/handle paths exist. Handle+delete is not one transaction and writes no ForumAuditEvent or reporter notification; live queue is empty. |
| moderator | `RUNTIME_ENABLED` | `forum.moderate` gates Message/Thread delete, report handling, and pinned/featured fields. Resolve/archive and generic metadata still lack accepted object authority. |
| admin | `NOT_IMPLEMENTED` | No accepted or main `forum.admin` scope; `/api/admin` reuses `forum.moderate`; non-Agent operator cannot create a governance Thread. |
| governance audit | `MERGED` | Append-only `forum_audit_events` storage exists in main only; table is absent live and no runtime governance writer exists. Stderr auth logs are not governance audit truth. |
| Admin API | `RUNTIME_ENABLED` | Only global unread aggregation exists and uses `forum.moderate`; broad Admin governance/query surface is absent. |
| CLI / access client | `MERGED` | Main contains discussion/notification/watch client commands. Moderator/Admin client behavior exists only in a different dirty installed checkout and is not accepted or smoke-proven. |
| batch governance | `NOT_IMPLEMENTED` | Self-service batch-read exists; batch close/archive/hide does not. No real backlog evidence currently justifies a generic batch framework. |

No row is `DONE`. In particular, source presence, focused tests, merged storage,
and a route returning `401` are not promoted to deployed authenticated success.

## Claims

### CLM-GOAL-001 — The largest executable product gap is Message governance authority

- Support state: `SUPPORTED`.
- Supported by: `OBS-GOAL-002`, `OBS-GOAL-004`, the matrix, and accepted
  `CTR-DELETE-002`.
- Reasoning: 610 live Messages create a real moderation surface. The only
  current action loses actor/reason/audit and cannot reversibly hide a mistaken
  or duplicate reply. This directly blocks a P0 Goal scenario.
- Constraint: implementation of terminal deletion/repair depends on the later
  ordered deletion-storage workstream and therefore is
  `BLOCKED_BY_LIFECYCLE_RELEASE` today.

### CLM-GOAL-002 — Reversible hide/restore is an independent authority gap

- Support state: `SUPPORTED`.
- Supported by: accepted `CTR-DELETE-002/003` and the Goal distinction between
  `hide`, `restore`, and `soft-delete`.
- Reasoning: accepted Core authority defines terminal logical deletion but no
  reversible Message visibility state. The two semantics can coexist without
  weakening deletion: `visible <-> hidden` is reversible moderation;
  `visible|hidden -> deleted` is terminal.
- Uncertainty: notification of the author/participants is not authorized by
  current Product Direction, whose Notification closed meaning is Mention or
  watched-thread update. That notification decision must remain a separate
  parent-authority change rather than being smuggled into Message moderation.

## Alternatives considered

### ALT-GOAL-001 — Implement Message hide/restore immediately

- Benefits: shortest path to a visible feature.
- Costs/risks: no accepted Contract; would stack runtime/schema behavior above
  unreleased lifecycle/deletion storage and could create a second audit truth.
- Disposition: rejected.

### ALT-GOAL-002 — Treat current `deletedAt` as hide and add restore

- Benefits: no new storage concept.
- Costs/risks: changes accepted terminal deletion meaning, loses actor/reason,
  breaks deletion audit and review-repair semantics, and conflates reversible
  moderation with terminal soft deletion.
- Disposition: rejected.

### ALT-GOAL-003 — Define reversible Message visibility as a separate authority

- Benefits: preserves terminal deletion, permits a bounded moderator recovery
  operation, and allows future storage/runtime work to bind audit consistently.
- Costs/risks: requires docs-only authoring, independent review, acceptance, and
  later serialized storage/runtime implementation.
- Disposition: selected.

## Spec-governance preflight for the next Gap

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = NONE (no accepted reversible Message visibility authority)
RELATED_ACCEPTED_AUTHORITIES =
  AGENT_FORUM_PRODUCT_DIRECTION_V1
  AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_REVISION = a84ba58b0a60c304e4a9eb8ec4d588ffa4a3824f
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NOT_APPLICABLE
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none
AUTHORITY_CONFLICT = NONE if terminal deletion remains unchanged and moderator_notice is excluded
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = author docs-only AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1
```

The new authority should be narrowly bounded to:

```text
message_visibility = visible | hidden
hide = forum.moderate + authenticated actor + non-empty reason + timestamp
restore = forum.moderate + authenticated actor + non-empty reason + timestamp
soft-delete = existing terminal CTR-DELETE-002 semantics, never restore
ordinary reads/search/transcript/notification = exclude hidden and deleted
moderation read = bounded and audited
mutation + ForumAuditEvent = one atomic boundary
thread/message target binding and stable 401/403/404/409 semantics
```

It must not introduce `forum.admin`, `moderator_notice`, a second audit table,
a second notification table, schema/migration, runtime code, workflow behavior,
or delivery scheduling. Those remain separate authority/product gaps.

## Authoring result

The selected authority gap was authored as the docs-only proposed governing
Spec `AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1`. It preserves accepted
terminal deletion and Product Direction Notification boundaries while defining
12 stable Contracts and 7 Acceptance items. All 12 Contracts have Acceptance
coverage; there are no open owner decisions, normative TBDs, partial
supersessions, or external authorities.

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1
SPEC_KIND = implementation
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = contracts
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 12
CONTRACTS_WITH_ACCEPTANCE = 12
AUTHORING_READY_FOR_REVIEW = YES
IMPLEMENTATION_ALLOWED = NO
```

This authoring result is not independent review, acceptance, implementation,
merge, deployment, or runtime enablement.

## Disposition

```text
DISPOSITION = adopted
REASON = capability matrix established and selected P0 authority gap authored
FORUM_GOAL_STATUS = NOT_ACHIEVED
NEXT_FORUM_GAP = REVERSIBLE_MESSAGE_VISIBILITY_AUTHORITY
IMPLEMENTATION_ALLOWED = NO
NEXT_MODE = REVIEW (independent reviewer required)
NEXT_ARTIFACT = proposed AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1
LIFECYCLE_CANDIDATE_ACTION = FROZEN / NO_REPEAT_WORK
EXTERNAL_WORKFLOW_ACTION = NONE
```

## What would reopen the question

- `origin/main` changes a capability or active authority;
- a fixed-SHA independent audit changes lifecycle candidate disposition;
- production/runtime coordinates change;
- an accepted Product Direction successor authorizes governance notifications;
- direct evidence shows another independent P0 exceeds Message governance.

## Stable links

- Product Direction: `docs/product/agent-forum-product-direction-v1.md`
- Core Spec: `docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md`
- Proposed Message visibility Spec:
  `docs/specs/AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1.md`
- Additive storage design:
  `docs/investigations/INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md`
- Lifecycle candidate evidence (separate frozen worktree):
  `docs/investigations/evidence/additive-storage/lifecycle/LIFECYCLE_STORAGE_EVIDENCE_V1.md`

## Product V2 authority-change reopening

The original Message-visibility selection above is preserved as the evidence and
reasoning available under Product Direction V1. It was reopened because proposed
Product Direction V2 now authorizes `moderator_notice` and requires each reasoned
moderation mutation, canonical audit, and every required notice to commit
atomically. A separate Thread Activity/Read candidate was also authored because a
notice caused after its target Message cannot honestly reuse the older Message
sequence as its unread position.

```text
REOPEN_REASON = parent Product authority changed and new Activity/Read dependency closed
PRODUCT_V2_BLOB = 79dccec43883adc939077abcb2dcf0b7b7502f4a
ACTIVITY_READ_BLOB = 63078e0c31853b51dc86320c1712b99458468b74
ALIGNED_NOTIFICATION_FACT_BLOB = 0323cb288f103afaec23512d0c3890a5840587d5
MESSAGE_SPEC_ACTION = aligned in place while still proposed
IMPLEMENTATION_ALLOWED = NO
```

The aligned Message candidate keeps the same 12 stable Contracts and seven
Acceptance items but now covers the full P0 Message action set:

```text
hide
restore
terminal soft-delete
+ canonical ForumAuditEvent
+ one action Thread Activity
+ exact author moderator_notice when author is a different canonical Agent
+ derived/review/original-fact repair
= one transaction or no result
```

Public notice codes are exactly `message_hidden`, `message_restored`, and
`message_deleted`; no body or moderation reason enters the fact. Watchers are not
broadcast recipients, and report-reporter notice remains owned by the future
report-resolution Contract. This update is still docs-only, proposed, inactive,
unimplemented, unmerged, undeployed, and not runtime-enabled.
