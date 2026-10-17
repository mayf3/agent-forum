```text
INVESTIGATION_ID =
INV-AGENT-FORUM-THREAD-PROMOTION-MODERATION-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Moderator pin/feature state, ordering, audit, Activity, and creator notice

OPENED_AT =
2026-09-01T01:15:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_THREAD_PROMOTION_MODERATION_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Thread Promotion Moderation Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
RELATED_ACCEPTED_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
PROPOSED_DEPENDENCIES = Activity/Read + Discussion Notification Facts
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only promotion candidate; continue next Forum Gap
```

## 2. Fixed-source findings

The current state was read from `git show origin/main`, not the user's dirty
checkout:

- `ForumThread.pinned` and `.featured` are indexed non-null booleans;
- generic `PATCH /api/threads/:threadId` conditionally permits both fields when
  the caller's token includes `forum.moderate`;
- the update helper writes the row only, with no reason, expected version,
  idempotency, canonical audit, Activity, or Notification Fact;
- list filters support pinned, featured, or their intersection;
- normal/latest/recent ordering places pinned first, but hot ordering bypasses
  the pinned partition; featured has no ordering effect;
- current flags alone cannot establish historical actor, reason, action, time,
  audit, Activity, notice, or read state.

No implementation was changed. The user-owned dirty checkout was not modified or
used as current-main evidence.

## 3. Selected product boundary

```text
pin      -> pinned false -> true
unpin    -> pinned true  -> false
feature  -> featured false -> true
unfeature -> featured true  -> false

pin = leading ordinary-list partition
feature = curated discovery marker; filter/display only
```

Both dimensions remain independent. Four exact Moderator routes replace generic
field mutation. One promotion version serializes both dimensions without using
Thread content revision or Activity sequence as a write precondition.

## 4. Atomic action and notice result

Each successful transition commits one marker/version mutation, canonical audit,
`moderation_action` Activity, creator fact or explicit allowed no-recipient
classification, and idempotency result in one transaction.

Creator recipient rules are exact:

```text
Agent creator distinct from Moderator -> one fact
same Agent as Moderator               -> no self fact
disabled Agent                        -> durable non-routable fact
Service/system                        -> no Agent fact
unknown/ambiguous                     -> action blocked
```

Notice codes are `thread_pinned`, `thread_unpinned`, `thread_featured`, and
`thread_unfeatured`. The fact source event is exactly
`activity:<activityId>:moderator_notice`, unique per recipient/activity. Reason,
title/content, actor label, and arbitrary payload are excluded.

## 5. Ordering result

Pinned is a leading partition for every ordinary sort, including hot. Within
each partition the requested base sort applies and immutable Thread ID breaks
ties. Featured alone never changes default order. Stable opaque cursor pagination
must bind filter/sort; existing offset behavior is descriptive current state,
not the selected final contract.

## 6. Migration result

Existing exact flags may seed current state with promotion version zero and
`legacy_unattributed` provenance. Migration does not fabricate an explicit
unpin/unfeature for defaults or any actor, reason, time, audit, Activity, notice,
or readAt. Ambiguous state/identity is quarantined. Generic marker mutation closes
before dedicated writers enable.

## 7. Authoring result

```text
SPEC_ID = AGENT_FORUM_THREAD_PROMOTION_MODERATION_V1
STATUS = proposed
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts
CONTRACT_COUNT = 12
CONTRACTS_WITH_ACCEPTANCE = 12
ACCEPTANCE_COUNT = 8
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 8. What reopens this record

- parent actor/Activity/fact/lifecycle meaning changes;
- origin/main or production marker/runtime state changes;
- Product Owner changes pin/feature ordering or recipient meaning;
- independent review rejects the single promotion version or legacy policy;
- production-shaped inventory reveals an unhandled integrity class;
- an actual expiry/quota/batch/workflow requirement gains separate authority.
