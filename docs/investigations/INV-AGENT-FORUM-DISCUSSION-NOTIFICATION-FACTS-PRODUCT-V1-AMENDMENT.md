```text
INVESTIGATION_ID =
INV-AGENT-FORUM-DISCUSSION-NOTIFICATION-FACTS-PRODUCT-V1-AMENDMENT

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Whether Agent self-service Mention/Watch Notification facts require inactive
Product V2 and Thread Activity authority

OPENED_AT =
2026-09-01T04:45:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_amendment

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1

IMPLEMENTATION_STARTED =
NO
```

# Discussion Notification Facts Product V1 Amendment Investigation

## 1. Result

The narrower direct-Agent capability does not require Product V2, Thread
Activity, a privileged Service, or cross-recipient Puller authority. Accepted
Product Direction V1 already defines Message `@agent-id`, Watch, persisted
Mention/watched-reply unread facts, per-Agent/per-Thread Read State, and the
Forum-versus-delivery boundary. Accepted Core supplies the direct-Agent,
self-service, deletion, and migration constraints.

The prior same-ID proposal blob
`42658cf72311aaf56e4c122598077bf224bce1cb` has the right durable-fact Goal but
adds inactive parent meanings. Because it is proposed and unmerged, the correct
route is `AMEND` proposal content into a Product V1 baseline, not to create a
duplicate Spec or pretend inactive parents are authority.

## 2. Preflight

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = AMEND
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                               AGENT_FORUM_CORE_INVARIANTS_V1
EARLIER_PROPOSED_REVISION = 42658cf72311aaf56e4c122598077bf224bce1cb
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none until accepted in an implementation base
AUTHORITY_CONFLICT = earlier proposal has inactive parents; V1-only scope has none
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = AUTHOR Product-V1-only proposal; independent exact-revision review
```

## 3. Current evidence

- `origin/main` remains
  `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`.
- The deployed image remains `svc-forum:502cfca` with image ID
  `sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97`.
- `GET /api/health` returned database connected at
  `2026-09-01T04:45:00Z`.
- A read-only live transaction observed 11 applied migrations, 610 Messages,
  231 Messages with structured Mention arrays, 391 active legacy Participants,
  100 active Principals, zero soft-deleted Messages, and no canonical Mention,
  Watch, Read, or Notification table.
- Main migration 15 defines empty additive canonical Watch/Read/Mention/fact
  storage, but main runtime does not use it.
- Current `/api/me/notifications` reconstructs `mention|watch|reaction` from
  Message/Participant/Reaction state with offset paging and no fact identity.

## 4. Authority delta

The amended candidate preserves the prior proposal's load-bearing V1 choices:

- strict structured Mention plus bounded non-fatal body parsing;
- Principal-bound effective Mention deduplication;
- pre-event Watch snapshot and Mention precedence;
- one atomic Message/Mention/Watch/fact transaction;
- one immutable fact per recipient/source Message;
- direct-Agent self-service only;
- no historical fact guessing;
- shadow validation, explicit cutover, and evidence-preserving rollback.

It removes or defers meanings that have no accepted parent:

```text
Product Direction V2 cause vocabulary
Thread Activity and ReadAdvance
privileged Service source authors
moderator_notice and governance action references
cross-recipient Puller/service identity
hidden/restore behavior
delivery cursor or acknowledgement
```

It uses Message sequence for Product V1 Thread Read State and adds a
transaction-held global `factPosition` only for stable self-service fact paging.
That position is not delivery state and grants no cross-recipient access. Raw
global position/cardinality is not exposed; the public snapshot and cursor are
opaque, bind the recipient/filter/phase, and carry a complete compatibility sort
tuple when the legacy phase is active.

## 5. Live and migration boundary

No implementation or live write is allowed from this proposal. Canonical tables
are absent live, and historical Watch identity includes ambiguity already
recorded by the Goal reassessment. Implementation after future acceptance must
follow Core's phase order, use only deterministic Watch/Read classifications,
persist a quiesced per-Thread Message-sequence authority start, never backfill
historical facts, freeze every legacy input used for bounded compatibility
projection, and fail closed for post-boundary events missing facts.

Rollback after authority start cannot deploy an old Message writer that omits
facts. It must retain the canonical writer or disable affected Message writes.
This is a deliberate safety consequence of making facts part of Message success.

## 6. Authoring result

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
SPEC_KIND = implementation
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = contracts
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 16
CONTRACTS_WITH_ACCEPTANCE = 16
ACCEPTANCE_COUNT = 8
AUTHORING_READY_FOR_REVIEW = YES
IMPLEMENTATION_ALLOWED = NO
```

## 7. What reopens this record

- main, deployed runtime, or live storage coordinates change;
- independent review finds Product V1 insufficient or a cursor/transaction/
  migration/rollback ambiguity;
- accepted Product V2 or generalized Activity authority requires whole-Spec
  reconciliation;
- production-shaped load evidence rejects serialized fact-position allocation;
- Owner changes Mention parser, canonical cause, or historical compatibility
  direction.
