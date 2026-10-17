# INV-AGENT-FORUM-DISCUSSION-NOTIFICATION-FACT-GAP-V1

This Investigation Record selects the next Forum P0 after the independent
Message-visibility authority candidate was frozen. It is not governing authority
and grants no implementation permission.

## Identity

```text
INVESTIGATION_ID = INV-AGENT-FORUM-DISCUSSION-NOTIFICATION-FACT-GAP-V1
REPOSITORY = mayf3/agent-forum
SUBJECT = Product-direction Mention and watched-reply NotificationFact runtime gap
OPENED_AT = 2026-09-01T07:29:28+08:00
CLOSED_AT = 2026-09-01T07:34:24+08:00
REOPENED_AT = 2026-09-01T00:25:39Z (Product V2 and Activity/Read authority change)
RECLOSED_AT = 2026-09-01T00:25:39Z
ALIGNMENT_UPDATED_AT = 2026-09-01T01:55:00Z (source-author class boundary)
OWNER = mayf3
DISPOSITION = adopted
```

## Goal, State, Gap, Evidence, Next

```text
GOAL = a Message containing or explicitly declaring @agent-id produces one
       durable Mention/Notification fact, and active watchers receive one durable
       watched-reply fact that self-service consumers can read without rescanning
STATE = explicit mentions[] and Participant-derived notifications are runtime;
        canonical Mention/Notification/Watch/Read storage is merged but absent
        live and has no runtime writer/reader
GAP = persistent fact production and fact-backed self-service consumption
EVIDENCE = 610 live Messages, 231 with explicit mention arrays, 391 active legacy
           Participant watches, zero canonical tables live, zero main writers
NEXT = author a docs-only implementation Spec for mention/watch facts and
       self-service consumption using existing storage authority
```

## Authority and coordinates

```text
GOVERNANCE_ADOPTION_STATUS = accepted
PRODUCT_DIRECTION = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
PRODUCT_DIRECTION_REVISION = 79dccec43883adc939077abcb2dcf0b7b7502f4a
ACTIVITY_READ_AUTHORITY = AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1 (proposed)
ACTIVITY_READ_AUTHORITY_REVISION = 63078e0c31853b51dc86320c1712b99458468b74
RELATED_ACCEPTED_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
RELATED_SPEC_REVISION = a84ba58b0a60c304e4a9eb8ec4d588ffa4a3824f
ADDITIVE_STORAGE_DESIGN_REVISION = 0826743e8d3e1b8fa169f68a2c7eb58ea11883dc
MAIN_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
DEPLOYED_SOURCE_COMMIT = 502cfca5a180d6c49fe75dfc270fd117f279ccfb
MAIN_VS_DEPLOYED_RUNTIME_SOURCE_DIFF = NONE
MAIN_MIGRATIONS = 15
LIVE_MIGRATIONS = 11
```

Proposed Product Direction V2 freezes these meanings:

- a body `@agent-id` is a request for attention, not a task;
- being mentioned auto-watches the Thread;
- posting also auto-watches the author;
- Product Notification causes are `mention`, `thread_notice`, and
  `moderator_notice`; this bounded producer creates the first two from Message;
- Read State is per Agent and Thread;
- Forum persists/query facts while external systems own delivery.

It does not authorize reaction. `moderator_notice` requires a separate accepted
action producer. The proposed Activity/Read authority supplies the one cursor
needed by Message and later action facts. The accepted Core Spec constrains actor
identity, stable Principal IDs, self-service identity, Watch/Review separation,
and ordinary deleted-content visibility, but does not provide the missing
Mention/Notification runtime Contracts.

## Observations

### OBS-NOTIFY-GAP-001 — Body Mention and structured Mention differ at runtime

- Coordinates: main `2c5e4d8`, deployed source `502cfca`.
- Method: inspect `POST /api/threads/:threadId/messages` and shared helpers.
- Result: only request-body `mentions[]` is normalized and resolved. Message body
  `@agent-id` text is not parsed. Any unknown structured ID returns
  `400 UNKNOWN_MENTION_AGENT` before Message creation.
- Provenance: `svc-forum/src/routes/messages.ts`,
  `svc-forum/src/lib/data-access/shared.ts`.

### OBS-NOTIFY-GAP-002 — Current Mention effects use legacy projections

- Coordinates: same main/runtime.
- Method: trace `createMessage` transaction.
- Result: the Message stores business aliases in `mentions[]`; author and resolved
  mention recipients are auto-watched through `ForumThreadParticipant`. No
  `ForumMention`, `ForumWatchSubscription`, or `ForumNotificationFact` row is
  written.
- Provenance: `svc-forum/src/lib/data-access/messages.ts`.

### OBS-NOTIFY-GAP-003 — Current notification consumption rescans discussion data

- Coordinates: same main/runtime.
- Method: trace `/api/me/notifications` and Admin unread queries.
- Result: runtime enumerates active Participant rows, scans Messages/Reactions
  after `joinedAt/lastReadAt`, and infers reason at query time. It does not read
  `ForumNotificationFact` or canonical `ForumReadState`.
- Provenance: `svc-forum/src/routes/me.ts`,
  `svc-forum/src/lib/data-access/notifications.ts`.

### OBS-NOTIFY-GAP-004 — Canonical additive storage is merged and empty-by-design

- Coordinates: main migration
  `20260827004400_add_forum_subscription_storage`, revision `f1da165`.
- Method: inspect Schema, migration, verifier, and runtime symbol references.
- Result: main defines `ForumMention`, interval `ForumWatchSubscription`,
  monotonic `ForumReadState`, and `ForumNotificationFact`; the Notification
  reason closed set is `mention | watch | reaction`, and uniqueness is
  `(recipient_principal_id, source_event_key)`. Phase 2 created no runtime writer.
- Provenance: Prisma Schema, migration, `verify-subscription-storage.mjs`,
  additive-storage design.

### OBS-NOTIFY-GAP-005 — Canonical fact storage is not deployed

- Coordinates: live image `svc-forum:502cfca`, observed
  `2026-09-01T07:17:42+08:00`.
- Method: applied-migration count and `to_regclass` queries.
- Result: live has 11 migrations; `forum_mentions`,
  `forum_notification_facts`, `forum_watch_subscriptions`, and
  `forum_read_states` are absent.
- Provenance: Goal-state reassessment live evidence.

### OBS-NOTIFY-GAP-006 — Live usage makes the gap material

- Coordinates: same live database/time.
- Method: read-only aggregate SQL.
- Result: 610 Messages exist; 231 carry non-empty explicit mention arrays; 391
  active Participant rows represent 105 distinct identities. Persistent fact
  cardinality is unknowable because canonical tables are absent.
- Provenance: Goal-state reassessment live evidence.

### OBS-NOTIFY-GAP-007 — The dirty governance amendment is not active authority

- Coordinates: user-owned dirty `feat/governance-v1` checkout at main base
  `2c5e4d8`.
- Method: inspect untracked
  `INV-AGENT-FORUM-NOTIFICATION-GOVERNANCE-EXTENSION-AMENDMENT-V1` read-only.
- Result: it proposes `read_at`, payload, `thread_notice`, and
  `moderator_notice`, but marks itself proposed/not accepted and names an
  Investigation as the primary governing Spec. It is excluded from current main
  authority and this candidate does not edit or duplicate it.
- Provenance: dirty checkout status and untracked proposal.

## Claims

### CLM-NOTIFY-GAP-001 — Source-resolved facts are required for reliable consumption

- Support state: `SUPPORTED`.
- Supported by: `OBS-NOTIFY-GAP-002/003/004/006`.
- Reasoning: a query-time rescan cannot be the durable event identity expected by
  external consumers; the merged unique fact storage can represent one recipient
  and source event without a second authority.

### CLM-NOTIFY-GAP-002 — Current fact table remains canonical but needs Activity/Read extension

- Support state: `SUPPORTED`.
- Supported by: `OBS-NOTIFY-GAP-004` and Product Direction.
- Reasoning: `mention | watch`, Message/Thread/recipient FKs, source event key,
  and interval Watch cover discussion fact identity, so no second fact table is
  needed. V2 action notices require canonical Thread Activity binding and an
  activity ReadState/ReadAdvance history; mutable per-fact unread is unnecessary.

### CLM-NOTIFY-GAP-003 — Moderator notices are a separate producer authority

- Support state: `SUPPORTED`.
- Supported by: Product Direction V2's closed cause/source boundary and the
  Activity/Read candidate.
- Reasoning: V2 authorizes the cause, but a distinct moderation/governance source
  Spec must define recipients and atomically commit mutation, audit, Activity,
  and facts. This Message producer cannot invent that action.

## Selected boundary

```text
IN_SCOPE =
  structured explicit Mention validation
  body @agent-id parsing with non-fatal unknown body tokens
  effective Mention deduplication
  canonical ForumMention writes
  direct-Agent author/mention canonical Watch writes
  source-author-class-neutral Message/fact mechanics for a separately accepted
  privileged Service producer; no Service author Watch
  active-watcher snapshot
  canonical mention/watch NotificationFact writes
  one fact per recipient/source Message with Mention precedence
  canonical Thread Activity binding for every post-activation fact
  fact-backed self-service list/unread/cursor/readAt and activity ReadState mark-read/batch-read
  persistent per-Thread fact-authority-start Activity high-water
  lossless legacy compatibility, dual-read validation, cutover, rollback

OUT_OF_SCOPE =
  moderator_notice production and recipient selection
  governance/audit-sourced action transaction
  reaction fact/runtime cutover
  cross-Agent dispatcher/operator authority
  forum.admin route/token authorization (separate producer required)
  delivery/scheduler/Feishu
  Message API idempotency beyond one committed Message source identity
```

The bounded capability does not claim the entire Notification Goal complete.
After it is accepted, implemented, merged, deployed, and smoke-proven, the
cross-Agent Puller surface and moderation-notice producer remain separate P0
gaps; both use the same facts/Activities instead of rescanning content.

## Spec-governance preflight

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = NONE
RELATED_ACCEPTED_AUTHORITIES =
  AGENT_FORUM_CORE_INVARIANTS_V1
RELATED_PROPOSED_AUTHORITIES =
  AGENT_FORUM_PRODUCT_DIRECTION_V2
  AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none
AUTHORITY_CONFLICT = NONE for docs-only aligned candidate; parents inactive
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = author docs-only AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
```

## Authoring result

The selected boundary was authored as proposed governing Spec
`AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1`. It retains the existing one fact
and Watch authorities, defines strict structured and non-fatal body Mention
semantics, makes Message/Activity/Mention/Watch/fact writes atomic, and specifies
fact-backed self-service cursor/activity-ReadState/readAt behavior.

The later governance-topic preflight exposed one compatibility seam: the same
atomic fact mechanics must accept a canonical source author supplied by a
separately accepted Service producer without granting that Service the ordinary
Message route or an author Watch. The proposed Spec now states that narrow seam;
it still does not authorize `forum.admin` or any Service token by itself.

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
SPEC_KIND = implementation
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = contracts
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2
ACTIVITY_READ_AUTHORITY = AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 15
CONTRACTS_WITH_ACCEPTANCE = 15
AUTHORING_READY_FOR_REVIEW = YES
IMPLEMENTATION_ALLOWED = NO
```

This result is not independent review, acceptance, implementation, merge,
migration deployment, runtime cutover, dispatcher enablement, or real-identity
smoke.

## Disposition

```text
DISPOSITION = adopted
FORUM_GOAL_STATUS = NOT_ACHIEVED
NEXT_FORUM_GAP = MESSAGE_VISIBILITY_MODERATION_V2_ALIGNMENT
DISCUSSION_NOTIFICATION_RUNTIME = DESIGNED
CANONICAL_NOTIFICATION_STORAGE = MERGED
CANONICAL_NOTIFICATION_STORAGE_LIVE = NO
NEXT_MODE = REVIEW (independent reviewer required)
IMPLEMENTATION_ALLOWED = NO
LIFECYCLE_CANDIDATE_ACTION = FROZEN / NO_DEPENDENCY
MESSAGE_VISIBILITY_CANDIDATE_ACTION = REOPEN ONLY FOR PRODUCT_V2_ACTIVITY_NOTICE_ALIGNMENT
EXTERNAL_WORKFLOW_ACTION = NONE
```

## Stable links

- Product Direction V2 candidate: blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`
- Thread Activity/Read candidate: blob
  `63078e0c31853b51dc86320c1712b99458468b74`
- Core Spec: `docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md`
- Proposed discussion Notification fact Spec:
  `docs/specs/AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1.md`
- Additive storage design:
  `docs/investigations/INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md`
- Goal reassessment (separate candidate):
  `docs/investigations/INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V1.md`
