```text
INVESTIGATION_ID =
INV-AGENT-FORUM-THREAD-ACTIVITY-READ-STATE-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
One Thread activity order for Message and moderator-notice Read State

OPENED_AT =
2026-09-01T00:25:39Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Thread Activity and Read State Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
ACCEPTED_REFINEMENT = AGENT_FORUM_CORE_INVARIANTS_V1
SIBLING_FACT_CANDIDATE = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1 (proposed)
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only activity/read authority; reconcile siblings
```

This is a new child implementation authority, not a Core supersession. Core V1
requires one independent monotonic Read State but does not freeze its physical
cursor to Message sequence. Product V2 adds a non-Message Notification source and
therefore creates a real new ordering requirement.

## 2. Gap discovered during Message-moderation reassessment

The frozen Message-visibility candidate was authored under Product Direction V1
and correctly prohibited moderation notices. Product Direction V2 now requires
reasoned moderation/governance action plus canonical audit plus every required
`moderator_notice` in one atomic result.

The existing discussion-fact proposal defines:

```text
unread = lastReadSeq < sourceMessage.seq
```

That is correct only for facts whose source is the Message. If a moderator hides
that Message later, binding the new notice to the old Message sequence can make
the newly created notice already read. A timestamp comparison would fork the
cursor and cannot prove ordering. Per-fact read state would violate the one
Thread Read authority.

## 3. Selected model

The candidate freezes one minimal append-only Thread Activity order:

```text
message             -> Activity(kind=message, messageId)
moderation action   -> Activity(kind=moderation_action, auditEventId)
governance action   -> Activity(kind=governance_action, auditEventId)

NotificationFact -> Activity
ReadState.lastReadActivitySeq -> Thread Activity order
```

Message remains content authority. ForumAuditEvent remains governance audit
authority. NotificationFact remains recipient/cause authority. Activity contains
no copied body, reason, recipient payload, secret, or delivery state; it only
orders accepted sources.

Each source transaction locks the Thread, increments its high-water, and commits
source + Activity + facts + required audit together. This provides a race-safe
per-Thread order without a global Message-write lock.

## 4. Honest readAt without a second cursor

One mutable `lastReadAt` cannot prove the first time each prior fact was crossed.
Updating every fact on mark-read creates unbounded fan-out and a second mutable
truth. The candidate therefore adds append-only Read Advance evidence:

```text
(fromActivitySeq, throughActivitySeq, advancedAt)
```

The current ReadState still solely decides unread. For post-activation facts,
`readAt` is the first interval that crosses the fact sequence. For migrated state
whose historical crossing time is not directly provable, the API must return
`read=true`, `readAt=null`, `readTimeKnown=false` rather than guessing.

## 5. Migration direction

Existing canonical Messages are real historical source events and may seed
Activities only after production-shaped inventory proves unique per-Thread
Message order. Trusted Message-sequence ReadState maps through that exact
Activity. Migration does not invent:

- historical moderation/governance Activities;
- historical moderator notices;
- historical Read Advances;
- exact historical `readAt`.

Ambiguous sequence/identity/cursor/fact mappings remain quarantined and block the
affected cutover. Activity writers and Activity readers switch without a split-
writer interval.

## 6. Sibling impact

The following frozen candidates need future exact reconciliation before
acceptance:

- `AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1`: replace direct Message-sequence
  unread/cutover semantics with Activity identity, make public
  `thread_notice` mandatory under V2, and preserve one fact authority;
- `AGENT_FORUM_MESSAGE_VISIBILITY_MODERATION_V1`: add the action Activity and
  required author `moderator_notice` to the same mutation/audit transaction;
- `AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1`: require every emitted fact to
  bind an Activity and use Activity-based unread projection; its independent
  global feed position remains delivery scan order, not Read State.

No sibling is edited in this worktree, and no implementation is stacked on it.

The notification-fact and Puller candidates were subsequently aligned in their
own frozen worktrees. Their content revisions are intentionally not embedded in
this sibling authority, avoiding a circular content-hash dependency; acceptance
review must bind the exact coordinated candidate set.

## 7. Authoring result

```text
SPEC_ID = AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1
STATUS = proposed
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts
ACTIVITY_AUTHORITY = one append-only per-Thread order
READ_AUTHORITY = one current per-(Thread, Principal) cursor
READ_TIME_EVIDENCE = append-only intervals, non-authoritative for unread
CONTRACT_COUNT = 12
CONTRACTS_WITH_ACCEPTANCE = 12
ACCEPTANCE_COUNT = 8
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 8. What reopens this record

- Product V2 changes notice cause, Read State, or atomic source meaning;
- Core or Forum main changes relevant lifecycle/Read/message storage authority;
- sibling review proves Activity order can be supplied by an existing canonical
  authority without changing its meaning;
- production-shaped inventory disproves deterministic Message mapping;
- load/concurrency evidence rejects per-Thread allocation;
- independent review finds a split authority, read-time, migration, or lock-order
  ambiguity.
