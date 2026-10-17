---
spec_id: AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1
status: proposed
spec_kind: implementation
authority_level: governing_spec
implementation_authority: contracts
scope:
  - svc-forum Notification Puller cross-recipient consumption surface
governed_by:
  - AGENT_FORUM_PRODUCT_DIRECTION_V2
  - AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
  - AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1
  - AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
  - AGENT_FORUM_CORE_INVARIANTS_V1
external_authorities:
  - repository: mayf3/auth-service
    authority_id: MINIMAL_AUTH_FOUNDATION_V2
    revision: 05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
    relation: constrained_by
supersedes: []
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1

## 1. Goal

Define one least-privilege, cross-recipient, forward-only Forum fact feed for the
dedicated Notification Puller Service, with an opaque replay cursor and a
transactional commit-order position that cannot skip a fact which commits late.

```text
GOAL = stable cross-recipient consumption of canonical Forum Notification Facts
SUCCESS_OUTCOME = the exact Puller can scan every eligible committed position in
                  one immutable order, receive the facts still unread at that
                  scan, safely retry by fact identity, and gain no content,
                  mutation, read-state, moderation, or Admin authority
```

This is a docs-only proposed implementation Spec. It authorizes no code while
proposed. Its Product, Service-actor, and discussion-fact parents are also
proposed and inactive, and the required external Puller identity, Client,
Audience profile, and Grant do not yet exist as accepted auth-service authority.

## 2. Scope and non-goals

### In scope

- the exact Service-only route `GET /api/service/notification-facts`;
- admission of only the dedicated `notification_puller` binding with the exact
  singleton capability `forum.notification.consume`;
- one global immutable `feedPosition` projection over eligible canonical
  Notification Facts;
- transactional, gap-free allocation in commit order;
- an opaque consumer-bound cursor and deterministic ascending pagination;
- a bounded minimal response containing stable routing and target metadata but
  no message body, thread title, excerpt, author profile, or secret;
- deterministic product-cause mapping for `mention`, `thread_notice`, and
  `moderator_notice`;
- recipient unread and routability observations that never mutate authority;
- no-loss activation from already-committed canonical facts, without inventing
  historical facts from legacy projections;
- concurrency, retry, failure, audit, metrics, redaction, migration, rollback,
  and acceptance behavior.

### Out of scope

- accepting, merging, implementing, deploying, or activating this candidate;
- creating auth-service Principal, Client, Grant, scope, credential, or Token;
- polling schedule, scheduler, wakeup, Feishu/email/channel delivery, retry,
  backoff, channel selection, delivery acknowledgement, or delivery telemetry;
- storing a Forum-owned delivery cursor, delivery status, attempt, receipt, or
  exactly-once channel-delivery claim;
- marking a recipient read, advancing Read State, watching/unwatching, posting,
  moderating, administering, reporting, or impersonating an Agent;
- a per-recipient filter, arbitrary time filter, cause filter, search filter,
  content filter, export endpoint, or random-access fact lookup;
- exposing legacy reaction notifications or legacy reconstructed discussion
  projections through the Puller feed;
- defining the source transaction for mention/thread notices or moderation
  notices; their accepted producer Specs remain authoritative;
- changing ordinary Agent self-service notification APIs;
- hard deletion, retention duration, legal hold, or archive policy;
- a second Notification Fact authority or a second delivery-fact table.

### Terminology

```text
Canonical Notification Fact
  The immutable ForumNotificationFact created atomically by an accepted source
  transaction.

Eligible Fact
  A canonical fact with an authorized Product cause and an assigned immutable
  feedPosition in the active feed epoch.

Feed Position
  A positive 64-bit integer allocated from one transactional Forum counter and
  stored immutably on one eligible fact. It is ordering metadata, not a second
  fact or delivery authority.

Feed Epoch
  The immutable activation identity binding schema revision, Product cause map,
  first position, cutover evidence, and cursor version.

Forum High-water
  The greatest feedPosition committed before the page query snapshots the feed.
  It is Forum query state, not the external delivery cursor.

External Delivery Cursor
  The last opaque Forum cursor durably retained by the external Puller. Forum
  does not store, acknowledge, or advance it for the consumer.
```

## 3. Authority and dependencies

```text
REPOSITORY = mayf3/agent-forum
AUTHORITY_BRANCH = main
AUTHORING_BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
CLASSIFICATION = NEW
IMPLEMENTATION_AUTHORITY = contracts

PROPOSED_PRODUCT_PARENT = AGENT_FORUM_PRODUCT_DIRECTION_V2
PROPOSED_PRODUCT_PARENT_BLOB = 79dccec43883adc939077abcb2dcf0b7b7502f4a
PROPOSED_SERVICE_PARENT = AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
PROPOSED_SERVICE_PARENT_BLOB = 1480d2d9f6e61a54941983d31fcf6f91d0c77d0c
PROPOSED_ACTIVITY_READ_PARENT = AGENT_FORUM_THREAD_ACTIVITY_READ_STATE_V1
PROPOSED_ACTIVITY_READ_PARENT_BLOB = 63078e0c31853b51dc86320c1712b99458468b74
PROPOSED_FACT_PARENT = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
PROPOSED_FACT_PARENT_BLOB = 42658cf72311aaf56e4c122598077bf224bce1cb
ACCEPTED_CORE_PARENT = AGENT_FORUM_CORE_INVARIANTS_V1
ACCEPTED_CORE_PARENT_BLOB = f4645e2882706afd5d3a71330ae2ffc201187d2d

EXTERNAL_AUTHORITY = mayf3/auth-service:MINIMAL_AUTH_FOUNDATION_V2
EXTERNAL_AUTHORITY_REVISION = 05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
EXTERNAL_AUTHORITY_BLOB = 576b7a75e4be278f20fee71ee4ba5e263bd958c7
```

Product Direction V2 owns the Puller/delivery boundary, the exact public cause
set, minimum-metadata rule, cursor replay, and no-loss high-water requirement.
The privileged-Service invariant owns the exact Service identity/profile and
route-class admission. The Thread Activity/Read authority owns source-event
order, current unread, and ReadAdvance evidence. The discussion-fact Spec owns
mention and watched-update source facts, self-service projection, and its
per-Thread fact-authority-start boundary. Core V1 continues to own direct-Agent
identity and ordinary routes.

The aligned discussion-fact candidate stores internal `reason=watch` and now
requires the public cause `thread_notice`; this Spec never emits `watch` as a
Product cause. Internal storage vocabulary may remain an implementation detail
only under that total, one-way, tested mapping. Every emitted fact must also bind
the canonical Activity used for current unread projection.

The accepted external Minimal Auth Foundation describes the direct Service
Token profile but does not create the new Forum Audience actor class or Grant.
Exact external authorities for the Puller Subject, Client, singleton scope, and
credential lifecycle must exist and be bound by revision before implementation.

## 4. Current State

### STATE-PULL-001 — Main has no canonical cross-recipient Puller feed

- Subject: Forum cross-recipient notification consumption
- As of commit: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository source
- Observed at: `2026-09-01T00:13:43Z`
- Projection: the only cross-recipient route is Admin-labelled, guarded by
  Moderator scope, aggregated by Agent/thread, filterable by caller input, and
  derived through legacy self-service reads; it has no stable fact cursor.
- Basis: `OBS-PULL-001`, `OBS-PULL-002`, `EVD-PULL-001`

### STATE-PULL-002 — Canonical fact storage lacks a safe global feed order

- Subject: `forum_notification_facts` storage
- As of commit: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: Prisma schema and PostgreSQL migration source
- Observed at: `2026-09-01T00:13:43Z`
- Projection: rows have UUID identity and millisecond `created_at`, but no
  immutable global commit-order position or feed epoch.
- Basis: `OBS-PULL-003`, `EVD-PULL-002`

### STATE-PULL-003 — Puller identity and external Grant authority are absent

- Subject: Forum/auth-service Puller identity boundary
- As of artifacts: Forum main
  `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`; auth-service main
  `05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`
- Environment: repository authority and source
- Observed at: `2026-09-01T00:13:43Z`
- Projection: Forum remains Agent-only and auth-service has no accepted exact
  `notification_puller` registration/Grant for `forum.notification.consume`.
- Basis: `OBS-PULL-004`, `EVD-PULL-003`

## 5. Observations

### OBS-PULL-001 — Current Admin route conflates Moderator and dispatcher

- Subject: `svc-forum/src/routes/admin.ts`
- Source revision: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository source
- Observed at: `2026-09-01T00:13:43Z`
- Method: inspect router middleware and query parameters
- Result: `GET /api/admin/notifications/unread` requires `forum.moderate`, calls
  the caller a moderator/dispatcher, and accepts `reason`, `since`, and
  `agentId` filters.
- Provenance: `svc-forum/src/routes/admin.ts:8-46`.

### OBS-PULL-002 — Current cross-recipient result is an unstable aggregate

- Subject: `findAllUnreadNotifications`
- Source revision: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository source
- Observed at: `2026-09-01T00:13:43Z`
- Method: inspect data-access implementation
- Result: it enumerates active Principals, repeatedly calls legacy per-Agent
  notification reads, applies `since` in memory, groups by Thread, and returns no
  fact ID or cursor.
- Provenance: `svc-forum/src/lib/data-access/notifications.ts:180-278`.

### OBS-PULL-003 — Existing row fields cannot prove commit order

- Subject: `ForumNotificationFact` and its migration
- Source revision: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: Prisma/PostgreSQL source
- Observed at: `2026-09-01T00:13:43Z`
- Method: inspect model, table, constraints, and indexes
- Result: a fact has UUID ID, recipient, Thread, optional message/reaction,
  reason, source-event key, and millisecond event time. It has no global
  position. The reason constraint still includes legacy `reaction`.
- Provenance: `schema.prisma:478-494`; subscription migration SQL 62-82,
  213-216.

### OBS-PULL-004 — Direct Service profile exists but Puller registration does not

- Subject: accepted auth-service Minimal Auth Foundation and current Forum
  Audience/Grant registry
- Source revision: `05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`
- Environment: external repository authority/source
- Observed at: `2026-09-01T00:13:43Z`
- Method: inspect accepted architecture and executable registry
- Result: direct Service access tokens are defined, but current `svc-forum`
  registration is Agent-only with `forum.read`/`forum.write`; no exact Puller
  identity, Client, or `forum.notification.consume` Grant is authorized.
- Provenance: `MINIMAL_AUTH_FOUNDATION_V2` and the current registry at the named
  external revision.

### OBS-PULL-005 — Proposed parent authority separates facts from delivery

- Subject: Product Direction V2 and privileged-Service candidates
- Artifact revisions: Product blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`; Service blob
  `1480d2d9f6e61a54941983d31fcf6f91d0c77d0c`
- Environment: frozen proposed candidates, inactive
- Observed at: `2026-09-01T00:13:43Z`
- Method: inspect actor matrix, Notification ownership, constraints, and Service
  binding Contracts
- Result: Forum owns facts/query/high-water; external delivery owns polling and
  its cursor; Puller is a distinct Service actor with no read-state or mutation
  authority.
- Provenance: Product V2 §§4, 7, 9-12 and privileged-Service candidate.

## 6. Claims and assumptions

### CLM-PULL-001 — `(created_at, id)` alone can skip a late commit

- Support state: SUPPORTED
- Supported by evidence: `EVD-PULL-002`
- Contradicted by evidence: none known
- Uncertainty: none for the current schema; event time and UUID identity do not
  serialize commit visibility.

### CLM-PULL-002 — A transactional serialized position provides a no-skip order

- Support state: SUPPORTED
- Supported by evidence: `EVD-PULL-004`
- Contradicted by evidence: none known
- Uncertainty: throughput cost must be measured; correctness does not depend on
  guessed timing or a safety lag.

### CLM-PULL-003 — Aggregated unread snapshots are not a delivery feed

- Support state: SUPPORTED
- Supported by evidence: `EVD-PULL-001`, `EVD-PULL-005`
- Contradicted by evidence: none known
- Uncertainty: none; missing fact IDs and cursor make stable replay impossible.

### CLM-PULL-004 — Feed membership must be immutable even when read/visibility changes

- Support state: SUPPORTED
- Supported by evidence: `EVD-PULL-005`
- Contradicted by evidence: none known
- Uncertainty: the response may project current unread/routability state, but it
  must not remove or reorder the underlying fact.

### CLM-PULL-005 — External authority is a hard implementation prerequisite

- Support state: SUPPORTED
- Supported by evidence: `EVD-PULL-003`
- Contradicted by evidence: none known
- Uncertainty: exact external identifiers are not yet accepted inputs.

```text
OPEN_ASSUMPTIONS = NONE
```

## 7. Evidence relations

### EVD-PULL-001 — Source supports current-route and aggregate Claims

- Source observations: `OBS-PULL-001`, `OBS-PULL-002`
- Target: `STATE-PULL-001`, `CLM-PULL-003`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Strength/sufficiency: direct router and data-access source
- Limitations: descriptive source drift, not active authority or runtime proof
- Provenance: named source files.

### EVD-PULL-002 — Storage shape supports the ordering-gap Claim

- Source observations: `OBS-PULL-003`
- Target: `STATE-PULL-002`, `CLM-PULL-001`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Strength/sufficiency: exact table fields and constraints
- Limitations: does not select an implementation design by itself
- Provenance: Prisma schema and migration SQL.

### EVD-PULL-003 — External source supports the missing-authority Claim

- Source observations: `OBS-PULL-004`
- Target: `STATE-PULL-003`, `CLM-PULL-005`
- Relation: SUPPORTS
- Bound coordinates: auth-service
  `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`
- Strength/sufficiency: accepted external architecture plus current registry
- Limitations: reference-only; Forum cannot create external authority
- Provenance: named external authority and revision.

### EVD-PULL-004 — PostgreSQL transaction semantics support serialized allocation

- Source observations: `OBS-PULL-003`
- Target: `CLM-PULL-002`
- Relation: SUPPORTS
- Bound coordinates: selected design in `DEC-PULL-002`
- Strength/sufficiency: one counter row updated under a transaction-held row
  lock makes concurrent allocators wait; rollback restores the counter and
  commit releases the next allocator
- Limitations: executable proof and load measurement remain Acceptance work
- Provenance: relational transaction design, verified by `ACC-PULL-003/007`.

### EVD-PULL-005 — Proposed product boundary supports immutable membership

- Source observations: `OBS-PULL-005`
- Target: `CLM-PULL-003`, `CLM-PULL-004`
- Relation: SUPPORTS
- Bound coordinates: Product V2 and Service candidate blobs named above
- Strength/sufficiency: direct proposed parent meaning
- Limitations: both candidates are inactive and block acceptance
- Provenance: frozen candidate documents.

## 8. Decisions

### DEC-PULL-001 — Use one exact Service-only route

- Decision owner: `mayf3`
- Decision: the only V1 Puller surface is
  `GET /api/service/notification-facts`; it is not mounted under Agent,
  Moderator, or Admin route classes.
- Rejected alternatives: reuse `/api/admin/notifications/unread`, add a generic
  export route, or allow dual Agent/Service admission.
- Reason: route identity must make the distinct capability auditable and fail
  closed before domain access.
- Owner decision remaining: NONE.

### DEC-PULL-002 — Allocate transactional commit-order positions

- Decision owner: `mayf3`
- Decision: every eligible source transaction locks one singleton feed-state
  row, assigns a contiguous position range in deterministic recipient order,
  inserts its facts, advances the counter, and holds the lock through commit.
- Rejected alternatives: UUID order, timestamp order, database sequence alone,
  offset paging, an assumed transaction-duration safety lag, or WAL internals.
- Reason: the selected design proves that no lower position can become visible
  after a higher committed position has been consumed.
- Owner decision remaining: NONE.

### DEC-PULL-003 — Scan immutable membership; return the unread subset explicitly

- Decision owner: `mayf3`
- Decision: each page scans the next bounded immutable feed-position range,
  returns only facts which are unread in the consistent page snapshot, and
  advances its cursor over every scanned position, including already-read facts.
  Routability and target availability do not remove an unread fact; they are
  explicit bounded projections used to suppress stale delivery.
- Rejected alternatives: return all read history, filter the scan order itself,
  omit unread facts because a recipient/target is unavailable, or mutate/delete
  facts after delivery.
- Reason: Product Direction authorizes the minimum unread facts. Monotonic Read
  State makes already-read suppression irreversible for that fact, while the
  scanned position preserves an auditable completeness boundary.
- Owner decision remaining: NONE.

### DEC-PULL-004 — Expose no caller-selectable subset

- Decision owner: `mayf3`
- Decision: V1 accepts only `cursor` and `limit`; recipient, cause, time, title,
  text, unread, state, and search filters are forbidden.
- Rejected alternatives: retain current `agentId`/`reason`/`since` filters or
  offer arbitrary lookups.
- Reason: one linear feed has one unambiguous completeness boundary and minimal
  enumeration surface.
- Owner decision remaining: NONE.

### DEC-PULL-005 — Keep Forum cursor stateless and consumer-bound

- Decision owner: `mayf3`
- Decision: the cursor is an authenticated opaque encoding of version, route,
  feed epoch, Puller Subject/Client binding, and last consumed position. Forum
  stores no per-consumer delivery progress.
- Rejected alternatives: unsigned base64 position, server-side acknowledgement,
  shared cursor, or cursor as recipient Read State.
- Reason: external delivery owns progress while Forum prevents tampering and
  cross-consumer replay.
- Owner decision remaining: NONE.

### DEC-PULL-006 — Freeze the minimal wire vocabulary

- Decision owner: `mayf3`
- Decision: public causes are exactly `mention`, `thread_notice`, and
  `moderator_notice`; internal `watch` maps obligatorily to `thread_notice`, and
  `reaction` is never feed-eligible under V2.
- Rejected alternatives: expose database reason strings, free-form causes,
  message excerpts, or compatibility reactions.
- Reason: storage vocabulary must not leak into or widen Product meaning.
- Owner decision remaining: NONE.

### DEC-PULL-007 — Activate from canonical facts only

- Decision owner: `mayf3`
- Decision: a bounded transition gate assigns positions to proven canonical
  post-authority-start facts while fact writers are quiesced, then enables
  position allocation on every future source transaction before opening the
  route. Legacy projections are never converted into facts for Puller use.
- Rejected alternatives: hidden historical backfill, dual unsynchronized
  cursors, starting the endpoint before writers allocate positions, or dropping
  already-committed canonical facts.
- Reason: this preserves the discussion-fact high-water boundary and creates one
  no-loss feed epoch.
- Owner decision remaining: NONE.

## 9. Contracts

### CTR-PULL-001 — Exact Puller identity and route admission

`GET /api/service/notification-facts` MUST accept only a direct Service Access
Token which satisfies the active privileged-Service invariant and the exact
pre-registered `notification_puller` Subject, Client, local Principal, Audience,
token profile, and singleton `forum.notification.consume` scope binding.

Authentication and complete actor binding MUST finish before local Principal
persistence, query parsing, fact access, or audit access. Agent, Human,
delegated/OBO, Moderator, Governance Admin, shared/personal, wrong-Client,
wrong-Subject, extra-Forum-scope, wildcard, missing, expired, or disabled
profiles MUST fail with `401` or `403` according to the identity invariant and
MUST return no data. Ordinary routes MUST remain Agent-only.

### CTR-PULL-002 — Closed method and request shape

The route MUST allow `GET` only. Query parameters are:

```text
cursor = absent or one opaque V1 cursor
limit = absent or a canonical base-10 integer from 1 through 200
```

Default `limit` is 100. Duplicate parameters, unknown parameters, empty cursor,
non-canonical numbers, arrays, bodies, or over-limit input MUST return `400`
before fact query. `POST`, mutation verbs, content negotiation outside the
documented JSON version, and recipient/cause/time/unread/search filters MUST be
rejected. No input may name or impersonate an Agent.

### CTR-PULL-003 — One transactional feed position per eligible fact

Storage MUST provide one singleton feed-state row for the active epoch and one
nullable positive signed-64-bit `feedPosition` on the canonical fact row, with a
unique constraint/index. Every accepted source transaction that creates one or
more feed-eligible facts MUST:

1. complete source authorization and determine the final immutable recipient/
   cause/fact set;
2. lock the singleton feed-state row with a transaction-held exclusive row lock;
3. sort its facts by stable fact UUID ascending;
4. reserve exactly the next contiguous position range inside that transaction;
5. write each fact with its assigned position and advance the feed high-water;
6. commit source mutation, facts, positions, and high-water together, or roll all
   of them back.

A position MUST never be reused, changed, set to null, or assigned to another
fact after commit. A rollback MUST expose neither counter advance nor fact. No
eligible committed fact may lack a position, and no committed position may lack
exactly one eligible fact. Overflow MUST fail the source transaction closed.

### CTR-PULL-004 — Closed eligibility and cause projection

Feed eligibility is determined only from the canonical fact and active Product
authority:

```text
stored reason mention          -> public cause mention
stored reason watch            -> public cause thread_notice
stored reason moderator_notice -> public cause moderator_notice
stored reason reaction         -> not eligible
unknown reason                 -> integrity failure; not silently skipped
```

The `watch` mapping MUST be total and MUST emit `thread_notice`, never `watch`.
`moderator_notice` may become eligible only after its accepted producer/storage
Spec is active. Reaction and legacy/reconstructed entries MUST have no feed
position in this epoch. Unknown positioned rows MUST close the Puller route with
`503 FEED_INTEGRITY_FAILURE` and alert; they MUST NOT be advanced past.

### CTR-PULL-005 — Deterministic bounded response

A successful response MUST use this versioned shape:

```json
{
  "apiVersion": "v1",
  "feedEpoch": "opaque-public-epoch-id",
  "items": [
    {
      "factId": "uuid",
      "cause": "mention|thread_notice|moderator_notice",
      "noticeCode": "accepted-bounded-code-or-null",
      "recipientAgentId": "stable-agent-id",
      "threadId": "uuid",
      "messageId": "uuid-or-null",
      "governanceActionId": "uuid-or-null",
      "occurredAt": "RFC3339 UTC",
      "recipientUnread": true,
      "recipientRoutable": true,
      "targetState": "available|unavailable"
    }
  ],
  "nextCursor": "opaque",
  "pageHighWater": "opaque",
  "hasMore": false
}
```

Items MUST be ordered by `feedPosition ASC` even though raw positions are not
exposed. Only facts unread in the page's consistent snapshot may appear.
`factId`, cause, notice code, recipient Agent ID, target IDs, and occurrence time
come from canonical data. `noticeCode` MUST be null for
`mention|thread_notice`; for `moderator_notice` it MUST be one closed code
authorized by the exact source producer. Both target IDs may not be null. At most one
governance action and one source Message may be represented according to the
accepted producer Contract. Unknown/ambiguous recipient Agent ID or impossible
target shape is an integrity failure, not an invented value.

The response MUST NOT expose raw feed positions, local Principal UUIDs, Auth
Subjects, Client IDs, author identity, display names, thread title, body,
excerpt, report text/reason detail, moderation reason, audit payload, token,
secret, credential, arbitrary notice metadata, delivery state, or unrestricted
content.

### CTR-PULL-006 — Snapshot high-water and opaque cursor semantics

For each request, Forum MUST use one consistent database snapshot to read the
active epoch, committed feed high-water, facts, Read State, recipient state, and
target state. A cursor carries an opaque scan position and, while a bounded scan
window remains open, its snapshotted window high-water. The route MUST inspect at
most `limit` consecutive eligible positions satisfying:

```text
lastScannedPosition < feedPosition <= windowHighWater
```

It returns the unread subset of those inspected facts. `pageHighWater` MUST be
an opaque authenticated representation of the window upper bound.
`nextCursor` MUST bind the last inspected position even when zero items are
returned; if no position was inspectable, it binds the window high-water and
marks that window complete. Whenever no eligible position remains inside the
window, `nextCursor` MUST mark the window complete. `hasMore` is true exactly
when another eligible position remains inside the same window. Using a
completed-window cursor begins a later poll by snapshotting a new high-water
above its last scanned position.

A cursor MUST authenticate and bind cursor version, route, active feed epoch,
exact Puller Subject and Client, and last position. Cursor bytes and signing key
details are not public. Tampered, malformed, wrong-route, wrong-actor,
future-position, wrong-epoch, or unsupported-version cursors MUST return `400`
with no facts. Expired credentials do not invalidate a stored cursor; a later
token for the same exact registered binding may continue it. A changed binding
requires an explicit migration decision, not implicit cursor reuse.

### CTR-PULL-007 — Replay, concurrency, and no-loss guarantee

Reusing an open-window input cursor against the same epoch MUST inspect the same
ordered positions up to the same deterministic page boundary. Returned item
membership may only shrink when canonical Read State proves a previously unread
fact read; a fact cannot re-enter the unread subset. Current
`recipientRoutable` and `targetState` may change under their own accepted
authority. Reusing a completed-window cursor is an intentional later poll and may
open a larger high-water window. The external consumer MUST deduplicate attempts
by stable `factId`; Forum MUST NOT claim exactly-once channel delivery.

Because all source transactions serialize their position allocation and hold the
counter lock through commit, once position `N` is visible no transaction may
later commit a position lower than or equal to `N`. Concurrent new facts above a
snapshotted `pageHighWater` MUST not change that page and become available only
after the consumer advances to a request whose high-water includes them.

Timeout or connection loss after a response is an unknown client outcome. The
consumer retries the same stored input cursor; it advances its external cursor
only after durably recording all returned fact identities/outcomes.

### CTR-PULL-008 — Read State, routability, and target-state projection

Feed position membership and scan order MUST NOT depend on current Read State,
recipient status, or target visibility. Response membership MUST include only
facts that canonical Read State proves or conservatively treats as unread in the
consistent page snapshot. Every returned item's `recipientUnread` is therefore
`true`. Missing or unknown Read State fails closed as unread. An already-read
fact is not returned, but its position is still inspected and included in
`nextCursor`; monotonic Read State means it cannot later become unread again.
Unread comparison MUST use the fact's immutable canonical Thread Activity
Sequence against the one activity ReadState. A `moderator_notice` MUST NOT become
feed-eligible until its accepted producer atomically persists a reasoned action,
canonical audit event, action Activity, and required facts. Missing or mismatched
Activity binding is an integrity failure, not a Message/timestamp fallback.

`recipientRoutable` is true only when the unambiguously mapped recipient Agent
Principal is active. Disabled status makes it false while preserving the stable
Agent ID. Missing or ambiguous Agent-ID mapping is an integrity failure and
returns no successful page.

`targetState=available` only when the target is currently visible to the
recipient under ordinary accepted visibility Contracts. Deleted, hidden,
inaccessible, or missing targets yield `unavailable` and no presentation
content. These projections let the external Puller suppress a stale delivery;
they MUST NOT delete/rewrite the fact, change position, mark read, or create a
delivery record. Projection lookup ambiguity or infrastructure failure MUST fail
the whole page with `503`, not guess or partially omit items.

### CTR-PULL-009 — No mutation or capability inheritance

Puller consumption MUST be read-only at Forum domain level. It MUST NOT update
Read State, Watch, Notification Fact, Thread, Message, report, moderation,
governance, audit, delivery, Principal, or credential state. Necessary database
snapshot activity and bounded access telemetry are not domain mutation.

`forum.notification.consume` MUST NOT imply `forum.read`, `forum.write`,
`forum.moderate`, or `forum.admin`; those scopes MUST NOT imply Puller access.
Possessing multiple scopes creates only the explicit union on separately
classified routes and MUST NOT allow Agent impersonation or use of request
fields to select authority.

### CTR-PULL-010 — Stable errors, availability, and fail-closed behavior

The route MUST use bounded stable error codes without data:

```text
400 INVALID_PULL_CURSOR | INVALID_PULL_REQUEST
401 AUTHENTICATION_REQUIRED | INVALID_TOKEN
403 PULLER_BINDING_DENIED | PULLER_SCOPE_DENIED
405 METHOD_NOT_ALLOWED
409 FEED_NOT_ACTIVE
503 FEED_INTEGRITY_FAILURE | DEPENDENCY_UNAVAILABLE
```

Unknown authentication, binding, cursor, epoch, high-water, position continuity,
recipient mapping, cause mapping, target projection, transaction outcome, or
database outcome MUST fail closed. The API MUST never return a partial page with
success, silently jump a position, substitute legacy data, or use empty values
to hide corruption. Retries after `503` use the same external cursor.

### CTR-PULL-011 — Audit, metrics, and redaction

Successful and denied requests MUST produce bounded security telemetry with
route class, registered Service actor/local Principal identifier, Client
identifier only where the accepted audit schema permits it, cursor version,
epoch, result class, item count, latency, and correlation ID. Audit/metrics MAY
record hashed or bounded cursor/fact correlation but MUST NOT record raw cursor,
Token, Authorization header, credential, recipient directory, body, title,
excerpt, full response, or unrestricted IDs/content.

The Puller MUST have no permission to update/delete audit evidence. Telemetry
failure that is required by the active audit authority MUST fail the request;
best-effort operational metric failure must not mutate facts or cursor meaning.

### CTR-PULL-012 — Activation inventory and feed epoch

Activation MUST begin from an exact production-shaped inventory and an immutable
manifest binding:

- accepted Product, Service, fact-producer, moderation-producer if applicable,
  and this Spec revisions;
- implementation/base/head, schema migration chain, runtime image, and config;
- external auth authority and exact Puller binding revisions;
- the discussion-fact per-Thread authority-start manifest;
- the Thread Activity/Read migration manifest and exact activity high-water;
- counts/classification of every existing canonical fact by cause, target shape,
  recipient mapping, and post/pre-authority boundary;
- feed epoch ID, cursor version/key identifier, activation time, first/last
  assigned positions, and row-count/checksum evidence.

Unknown/ambiguous facts, missing recipient IDs, legacy reaction rows, pre-high-
water projections, and already-positioned rows MUST be reported separately.
Only proven eligible canonical facts at or after their accepted source-authority
boundary enter the feed. No legacy projection may be materialized as a fact.

### CTR-PULL-013 — Quiesced no-loss cutover

The cutover MUST use an explicit transition lock or maintenance gate which
prevents all eligible fact-creating transactions from committing while it:

1. verifies exact predecessor schema and empty/new feed-state invariants;
2. inventories and locks the closed existing eligible fact set;
3. creates one feed epoch and assigns positions in deterministic
   `(created_at ASC, fact_id ASC)` order solely for that already-committed set;
4. sets the counter high-water to the greatest assigned position in the same
   transaction;
5. verifies one-to-one fact/position continuity and evidence checksums;
6. enables the accepted source writers that allocate through `CTR-PULL-003`;
7. commits one canary source event and verifies its next contiguous positions;
8. opens the Puller route only after the writer invariant is proven.

If any step fails, the route remains closed and writers remain at the last known
safe state. There MUST be no interval in which an eligible fact can commit
without a position. The bounded quiescence is an activation procedure, not
permission to drop or reconstruct facts.

### CTR-PULL-014 — Compatibility and retirement of the current route

The current `/api/admin/notifications/unread` path is descriptive drift and MUST
NOT be used as Puller compatibility, fallback, shadow authority, or cursor
source. A future accepted implementation must disable/remove its cross-recipient
dispatcher behavior before or atomically with Puller activation, while preserving
any separately accepted Moderator surface under its own route and Contracts.

Agent self-service notification listing continues under its own accepted Spec.
The Puller feed contains canonical facts only; the self-service pre-high-water
legacy compatibility projection is never exposed to the Service actor.

### CTR-PULL-015 — Rollback preserves positions and evidence

Before endpoint activation, rollback MAY remove unused additive schema only when
inventory proves no position or epoch ever committed. After any position commits,
rollback MUST preserve the epoch, counter, fact positions, manifest, and evidence.
It MAY close the route and disable new source writers together; it MUST NOT
delete/reassign positions, decrement high-water, restore the legacy Admin route
as Puller authority, or create facts outside accepted source transactions.

Reactivation of the same feed uses the same epoch and proves continuity. A new
epoch requires a separately accepted migration Contract that accounts for every
old position and external cursor; rotation alone does not silently invalidate
stored cursors.

## 10. Acceptance

### ACC-PULL-001 — Actor and route matrix

- Contracts: `CTR-PULL-001`, `CTR-PULL-009`, `CTR-PULL-010`
- Method: exercise exact Puller, Agent, Moderator, Admin, wrong-Service, Human,
  OBO, wrong/missing/extra scope, wrong Client/Subject, disabled, expired, and
  malformed Tokens against Puller and ordinary routes
- Environment: database-backed full API with real auth-service-issued canaries
- Inputs/configuration: independently accepted exact bindings and distinctive
  principals/clients
- Required evidence: status/error matrix, zero-write queries, local Principal
  rows, audit events, and ordinary-route regressions
- Expected result: only exact Puller binding reads the route; all cross-class
  access fails before fact access/persistence; ordinary routes stay Agent-only
- Failure condition: Moderator reuse, scope inheritance, Service JIT before full
  binding, impersonation, cross-route access, or domain mutation

### ACC-PULL-002 — Request and wire-schema boundary

- Contracts: `CTR-PULL-002`, `CTR-PULL-005`, `CTR-PULL-006`
- Method: test absent/valid/invalid/duplicate/unknown parameters, limits 0/1/100/
  200/201, bodies, methods, malformed cursors, and every response field
- Environment: full API with distinctive secret/content fixtures
- Inputs/configuration: facts for all supported causes and target shapes
- Required evidence: request/response snapshots, schema validator output,
  negative secret/content assertions, and query traces
- Expected result: exact shape/order only; no forbidden fields or filters;
  stable bounded errors
- Failure condition: raw position/cursor log, content/identity leak, arbitrary
  filter, unbounded page, partial response, or undocumented shape

### ACC-PULL-003 — Serialized allocation and rollback fault matrix

- Contracts: `CTR-PULL-003`, `CTR-PULL-004`, `CTR-PULL-007`
- Method: run concurrent source transactions with 0/1/many recipients; delay
  transactions before/after counter lock; inject failure after each allocation/
  insert/counter/source step; retry unknown outcomes
- Environment: PostgreSQL integration harness with real isolation/locks
- Inputs/configuration: deterministic fact UUIDs and source events
- Required evidence: commit timeline, lock observations, fact/counter rows,
  continuity query, unique constraints, and retry results
- Expected result: committed positions form one contiguous order; no lower late
  commit, gap, reuse, orphan, or partial source outcome
- Failure condition: sequence gap from rollback, higher visible before later
  lower commit, duplicate position, eligible null position, or source success
  without all facts/positions

### ACC-PULL-004 — Cause, recipient, and target integrity matrix

- Contracts: `CTR-PULL-004`, `CTR-PULL-005`, `CTR-PULL-008`
- Method: create mention/watch/moderator/reaction/unknown facts; active/disabled/
  ambiguous/missing recipients; visible/deleted/hidden/missing targets; known/
  unknown/missing Read State
- Environment: database-backed API and integrity fault fixtures
- Inputs/configuration: accepted producer revisions and frozen ID mappings
- Required evidence: rows, responses, alerts/errors, and zero-mutation checks
- Expected result: public causes are exact; reaction is never positioned;
  mutable projections are bounded; ambiguity returns `503` without cursor jump
- Failure condition: public `watch`, reaction emission, invented Agent ID,
  content leak, silent omission, read mutation, or skipped corrupt position

### ACC-PULL-005 — Cursor replay and concurrent append

- Contracts: `CTR-PULL-006`, `CTR-PULL-007`, `CTR-PULL-010`
- Method: page multiple limits, replay every input cursor, append concurrently
  above captured high-water, tamper fields, cross actor/epoch/route, rotate Token
  for the same binding, and simulate lost responses
- Environment: full API with deterministic concurrency harness
- Inputs/configuration: at least 1,000 facts across multi-fact transactions
- Required evidence: decoded server-side test representation, ordered fact-ID
  traces, high-water snapshots, client durable-cursor log, and error matrix
- Expected result: each bounded scan inspects every position once in order,
  returns only the snapshot-unread subset, and advances across read positions;
  replay is idempotent by fact ID; concurrent appends wait for a later high-water
- Failure condition: duplicate semantic processing, missing position, changed
  page membership, cursor forgery, cross-binding data, or advance after lost page

### ACC-PULL-006 — Read/routability/visibility changes during replay

- Contracts: `CTR-PULL-007`, `CTR-PULL-008`, `CTR-PULL-009`
- Method: replay pages while recipients read, disable/reactivate, and targets
  become hidden/deleted/available under accepted lifecycle rules
- Environment: full API with synchronized state transitions
- Inputs/configuration: fixed fact identities and cursor inputs
- Required evidence: before/after responses, unchanged fact/position rows,
  ReadState history, and external suppression decisions
- Expected result: scanned order stays stable; a returned fact may only disappear
  after monotonic Read State proves it read; routability/target projections may
  change; polling changes no Forum domain state
- Failure condition: a read fact re-enters, an unread fact is skipped because its
  target/recipient is unavailable, content leaks after deletion, Puller marks
  read, or target ambiguity returns success

### ACC-PULL-007 — Activation and no-loss cutover rehearsal

- Contracts: `CTR-PULL-012`, `CTR-PULL-013`, `CTR-PULL-014`
- Method: rehearse from exact production-shaped copy with eligible facts,
  pre-high-water legacy data, Activity/Read mappings, reactions, concurrent
  writer attempts, failures at
  every step, and the current Admin route present
- Environment: production-shaped PostgreSQL copy and candidate deployment
- Inputs/configuration: exact predecessor, accepted source manifests, migration
  chain, runtime image/config, and external canary binding
- Required evidence: inventory, quiescence timeline, manifest, deterministic
  position checksum, continuity queries, canary result, route matrix, rollback
- Expected result: all and only canonical eligible facts receive positions;
  no writer gap; Puller opens after proof; old dispatcher route is not authority
- Failure condition: guessed historical fact, missing committed canonical fact,
  concurrent unpositioned write, reaction inclusion, route overlap, or unbound
  artifact

### ACC-PULL-008 — Failure, telemetry, redaction, and load boundary

- Contracts: `CTR-PULL-003`, `CTR-PULL-010`, `CTR-PULL-011`
- Method: inject DB/auth/audit/projection/cursor-key failures and apply concurrent
  source/Puller load at the accepted capacity envelope
- Environment: production-shaped full stack
- Inputs/configuration: secret markers, large recipient sets, slow readers, and
  lock contention thresholds selected before the run
- Required evidence: responses, logs/metrics/audit redaction scan, lock latency,
  source commit latency, throughput, alerts, and zero-partial-page queries
- Expected result: stable fail-closed errors and redacted observability; serialized
  allocation meets the predeclared SLO without weakening correctness
- Failure condition: secret/content leak, successful partial page, silent skip,
  audit mutation, unbounded lock, or correctness bypass under load

### ACC-PULL-009 — Rollback and same-epoch recovery

- Contracts: `CTR-PULL-014`, `CTR-PULL-015`
- Method: close endpoint before/after positions, disable writers, attempt unsafe
  cleanup/decrement/reassignment, restore the same binary/schema, and resume from
  stored external cursors
- Environment: production-shaped cutover rehearsal
- Inputs/configuration: exact epoch manifest and cursors at multiple positions
- Required evidence: before/after fact/counter/manifest hashes, route status,
  resumed ordered trace, and rejected destructive operations
- Expected result: no accepted fact/position/evidence loss; same-epoch continuity
  resumes; legacy Admin route never becomes fallback authority
- Failure condition: cursor invalidated silently, high-water regression, deleted
  fact/position, new epoch without authority, or duplicate/missing resume result

### Contract-to-Acceptance coverage

| Contract | Acceptance | Covered |
|---|---|---|
| `CTR-PULL-001` | `ACC-PULL-001` | YES |
| `CTR-PULL-002` | `ACC-PULL-002` | YES |
| `CTR-PULL-003` | `ACC-PULL-003`, `ACC-PULL-008` | YES |
| `CTR-PULL-004` | `ACC-PULL-003`, `ACC-PULL-004` | YES |
| `CTR-PULL-005` | `ACC-PULL-002`, `ACC-PULL-004` | YES |
| `CTR-PULL-006` | `ACC-PULL-002`, `ACC-PULL-005` | YES |
| `CTR-PULL-007` | `ACC-PULL-003`, `ACC-PULL-005`, `ACC-PULL-006` | YES |
| `CTR-PULL-008` | `ACC-PULL-004`, `ACC-PULL-006` | YES |
| `CTR-PULL-009` | `ACC-PULL-001`, `ACC-PULL-006` | YES |
| `CTR-PULL-010` | `ACC-PULL-001`, `ACC-PULL-005`, `ACC-PULL-008` | YES |
| `CTR-PULL-011` | `ACC-PULL-008` | YES |
| `CTR-PULL-012` | `ACC-PULL-007` | YES |
| `CTR-PULL-013` | `ACC-PULL-007` | YES |
| `CTR-PULL-014` | `ACC-PULL-007`, `ACC-PULL-009` | YES |
| `CTR-PULL-015` | `ACC-PULL-009` | YES |

## 11. Alternatives and disposition

### ALT-PULL-001 — Reuse the Moderator Admin unread route

- Disposition: rejected
- Reason: it conflates actors, scans legacy projections, aggregates away fact
  identity, permits arbitrary subsets, and has no cursor.
- Evidence/Claims considered: `OBS-PULL-001/002`, `CLM-PULL-003`
- What would reopen: never as Puller authority; a Moderator projection may exist
  only under separate accepted moderation Contracts.

### ALT-PULL-002 — Order by `(created_at, id)` with no commit barrier

- Disposition: rejected
- Reason: a transaction with an older event time can commit after the consumer
  advances past a newer committed row.
- Evidence/Claims considered: `OBS-PULL-003`, `CLM-PULL-001`
- What would reopen: an independently proven commit-visibility mechanism that
  supplies the same no-late-lower-position guarantee.

### ALT-PULL-003 — Use a database sequence as feed position

- Disposition: rejected
- Reason: ordinary sequence allocation is non-transactional; rollback gaps are
  harmless alone, but a lower allocated value can commit after a higher value
  has already advanced the external cursor.
- Evidence/Claims considered: `CLM-PULL-001/002`
- What would reopen: a transactional serialization barrier equivalent to the
  selected counter, in which case the sequence alone is not the guarantee.

### ALT-PULL-004 — Depend on a fixed time safety lag

- Disposition: rejected
- Reason: it makes completeness depend on an operational transaction-duration
  assumption and clock/time semantics instead of durable order.
- Evidence/Claims considered: `CLM-PULL-001/002`
- What would reopen: only a separately accepted bounded-timing architecture with
  runtime enforcement and failure containment; it is unnecessary here.

### ALT-PULL-005 — Return both read and unread facts

- Disposition: rejected
- Reason: Product Direction authorizes the minimum unread facts. The route can
  scan immutable positions and advance over already-read rows without exposing
  them; routability and target availability remain projections on unread items.
- Evidence/Claims considered: `CLM-PULL-004`, `DEC-PULL-003`
- What would reopen: a Product Direction successor authorizing delivery-history
  export to the Puller.

### ALT-PULL-006 — Store delivery acknowledgement in Forum

- Disposition: rejected
- Reason: Product Direction assigns delivery cursor, attempts, and telemetry to
  the external system; acknowledgement would create competing delivery state.
- Evidence/Claims considered: `OBS-PULL-005`
- What would reopen: a Product Direction successor changing ownership.

### ALT-PULL-007 — Backfill legacy notification projections

- Disposition: rejected
- Reason: legacy Message/Participant state cannot prove the source-time recipient
  or cause; the discussion-fact candidate already forbids guessed backfill.
- Evidence/Claims considered: fact parent high-water Contracts
- What would reopen: only complete original event evidence proving every fact;
  absent that, never.

## 12. Migration, compatibility, and rollback

```text
MIGRATION = additive feed epoch/state plus immutable unique fact position;
            quiesced deterministic assignment to proven canonical eligible facts
COMPATIBILITY = Agent self-service remains separate; no legacy dispatcher or
                legacy fact reconstruction on the Puller surface
ACTIVATION = parents/external authority accepted -> inventory -> quiesce ->
             assign/verify -> writer canary -> open exact route
ROLLBACK = close route and source writers together while preserving epoch,
           positions, facts, manifest, evidence, and external cursor continuity
```

The implementation base must contain the exact accepted Product V2 lifecycle,
Governance Adoption V2, privileged-Service invariant, aligned notification-fact
Spec, any active `moderator_notice` producer authority, and this accepted Spec.
It must also bind exact accepted auth-service Puller authorities. A candidate,
separate worktree, unmerged PR, test, route, or runtime behavior is not a
substitute.

Activation evidence must distinguish candidate, accepted authority,
implementation, verified artifact, merge, deployment, migration, route enable,
external credential activation, and real Puller smoke. Failure or rollback in
one dimension must not be reported as success in another.

## 13. Open questions

```text
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE for docs-only authoring
PARTIAL_SUPERSESSION = NONE
READY_TO_MARK_ACCEPTED = NO
```

Acceptance is blocked until:

- Product Direction V2 and Governance Adoption V2 are active on main;
- the privileged-Service invariant is accepted and active;
- the Thread Activity/Read authority and aligned discussion-fact candidate are
  accepted and active;
- any included `moderator_notice` producer/storage Contract is accepted;
- auth-service has exact accepted Puller Audience, Principal, Client, singleton
  scope/Grant, and credential-lifecycle authority;
- independent semantic review verifies all 15 Contracts and 9 Acceptance items.

These blockers do not stop broader Forum Goal work; they freeze this candidate.

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_NOTIFICATION_PULLER_CONSUMPTION_V1
SPEC_MODE = NEW
SPEC_KIND = implementation
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = contracts
CONTRACT_COUNT = 15
CONTRACTS_WITH_ACCEPTANCE = 15
ACCEPTANCE_COUNT = 9
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```
