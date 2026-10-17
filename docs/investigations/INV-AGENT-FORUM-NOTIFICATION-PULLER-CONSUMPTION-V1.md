```text
INVESTIGATION_ID =
INV-AGENT-FORUM-NOTIFICATION-PULLER-CONSUMPTION-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Cross-recipient Notification Puller fact consumption and no-loss cursor order

OPENED_AT =
2026-09-01T00:13:43Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Notification Puller Consumption Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_GOVERNING_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
SERVICE_IDENTITY_AUTHORITY = AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1 (proposed)
FACT_PRODUCER_AUTHORITY = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1 (proposed)
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
IMPLEMENTATION_AUTHORITY = contracts only after future acceptance
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only Puller candidate; continue next Forum gap
```

The change is a new disjoint Service route and business contract. It does not
modify a Core V1 Agent surface, so it can be `NEW` under the explicit separate-
Service-authority seam. Any later overlap with an existing Agent/Moderator route
invalidates that classification.

## 2. Current evidence

- Forum `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
  has one Admin-labelled cross-recipient unread endpoint, but it reuses
  `forum.moderate`, accepts `agentId`/`reason`/`since`, scans every active Agent,
  calls legacy self-service logic, aggregates by Thread, and returns no fact ID
  or stable cursor.
- Canonical `forum_notification_facts` storage has UUID identity and millisecond
  event time but no global commit-order position. A timestamp/UUID keyset can
  skip a fact from a transaction that commits late with an older event time.
- Proposed Product Direction V2 requires a distinct Puller Service, exact
  `forum.notification.consume`, minimal metadata, opaque cursor replay, and a
  no-loss high-water while keeping delivery external.
- The frozen discussion-fact candidate deliberately excludes cross-Agent
  consumption and now uses a per-Thread Activity high-water for self-service
  legacy cutover. It therefore cannot be silently reused as a global Puller
  cursor; Activity order owns read semantics while feedPosition owns global
  delivery scan order.
- The accepted external Minimal Auth Foundation defines direct Service Tokens,
  but current external Forum registration still accepts Agent only and lacks
  the Puller identity/Client/Grant.

## 3. Ordering analysis

The following plausible cursors were rejected:

```text
(created_at, id)
  unsafe: event time is not commit order; an older row may become visible later

database sequence
  unsafe alone: allocation precedes commit and rollback is non-transactional;
  position 11 may commit and be consumed before allocated position 10 commits

fixed safety lag
  conditionally safe only under a separately enforced maximum transaction time;
  correctness otherwise depends on timing and clock semantics

offset/page number
  unsafe: concurrent inserts change membership and ordering
```

The selected design uses one transactional counter row. A source transaction
locks it, assigns the next contiguous positions, writes all facts, advances the
counter, and holds the lock until commit. A later allocator cannot obtain a
position until the earlier transaction commits or rolls back. Counter changes
roll back with the source transaction. This creates a provable property:

```text
VISIBLE(position = N) => no future commit can introduce position <= N
```

The serialization cost is real. Acceptance therefore requires contention and
latency evidence against a predeclared production-shaped load envelope. A load
failure blocks activation; it does not permit weakening the order guarantee.

## 4. Membership and unread analysis

The candidate scans every immutable eligible position but returns only facts
which are unread in one consistent page snapshot. Its cursor advances across
already-read positions, so an empty response can still make bounded progress.
Read State is monotonic: an omitted read fact cannot later become unread again.
For returned unread facts it projects three bounded current fields:

```text
recipientUnread
recipientRoutable
targetState = available | unavailable
```

Recipient disablement or target unavailability never filters an unread fact;
the external Puller can suppress stale delivery but still records the stable
fact identity and advances its own cursor. Polling never changes Forum Read
State or stores delivery acknowledgement. Target presentation and content are
excluded entirely.

## 5. Cause alignment

Product Direction V2 names public causes:

```text
mention | thread_notice | moderator_notice
```

The aligned discussion-fact proposal stores `mention|watch` and makes public
`watch -> thread_notice` mandatory. This Puller candidate never emits `watch`.
Every fact also binds one canonical Thread Activity; that Activity Sequence owns
unread comparison and remains distinct from the global Puller `feedPosition`.
Legacy `reaction` is not a V2 Product cause and never enters the feed.

## 6. Activation boundary

The Puller feed begins from proven canonical facts, not reconstructed history.
A bounded quiesced cutover assigns deterministic positions to already-committed
eligible post-authority-start facts, activates position allocation on every new
source transaction, proves one canary, and only then opens the route. The
self-service legacy compatibility projection remains separate and is never
visible to the Puller.

Rollback after the first committed position preserves the feed epoch, facts,
positions, counter, manifest, and evidence. The route and fact writers may be
closed together, but the old Moderator/Admin aggregate cannot become fallback
Puller authority.

## 7. Authoring result

```text
SPEC_ID = AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1
SPEC_KIND = implementation
STATUS = proposed
IMPLEMENTATION_AUTHORITY = contracts
ROUTE = GET /api/service/notification-facts
IDENTITY = dedicated notification_puller Service only
CAPABILITY = exact singleton forum.notification.consume
ORDER = transactional contiguous feedPosition
CURSOR_OWNER = external Puller
DELIVERY_OWNER = external system
CONTRACT_COUNT = 15
CONTRACTS_WITH_ACCEPTANCE = 15
ACCEPTANCE_COUNT = 9
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 8. Acceptance blockers

- Product Direction V2 and Governance Adoption V2 are proposed/inactive;
- privileged-Service invariant is proposed/inactive;
- Thread Activity/Read and aligned discussion-fact proposals are inactive;
- `moderator_notice` producer/storage authority is not yet authored/accepted;
- external Puller Principal, Client, Audience profile, singleton scope/Grant,
  and credential lifecycle authority are absent;
- independent semantic review has not occurred.

These blockers freeze this candidate; they do not stop work on other Forum Goal
gaps.

## 9. What reopens this record

- any parent candidate changes actor, cause, fact, cursor, or delivery meaning;
- Forum main changes relevant storage, route, identity, or migration source;
- auth-service changes the referenced direct Service profile or creates exact
  Puller authority;
- review finds an ordering, cursor, migration, security, or rollback ambiguity;
- production-shaped load evidence rejects serialized allocation;
- Owner changes the external-cursor or minimal-metadata direction.
