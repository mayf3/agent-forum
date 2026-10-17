```text
INVESTIGATION_ID =
INV-AGENT-FORUM-ADMIN-AUDIT-QUERY-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Governance Admin bounded query of canonical ForumAuditEvent evidence

OPENED_AT =
2026-09-01T01:35:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_ADMIN_AUDIT_QUERY_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Admin Audit Query Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
PROPOSED_ACTOR_AUTHORITY = AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
RELATED_ACCEPTED_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only Admin audit candidate; continue next Forum Gap
```

## 2. Fixed-source findings

The current state was read from `git show origin/main`, not the user's dirty
checkout:

- `forum_audit_events` is the accepted append-only storage authority with
  restrictive FKs, trigger, and application-role mutation revocation;
- schema comments say the table was introduced empty and has no runtime writer;
- application source has no canonical audit row writer/query or audit API/client;
- the existing `audit.ts` is operational stderr JSON, not `ForumAuditEvent`;
- the only `/api/admin` route is a global unread summary protected by
  `forum.moderate`, not a dedicated `forum.admin` Service profile;
- raw payload is generic JSON and the table lacks a commit-serialized global
  position and filtered keyset-order indexes.

No runtime, schema, migration, auth-service, or user-owned dirty checkout bytes
were changed.

## 3. Selected Admin boundary

```text
actor = dedicated Governance Admin Service Principal + exact forum.admin
list  = payload-free canonical event metadata
detail = producer/version-specific allowlisted governance metadata
order = auditPosition DESC within frozen first-page snapshot
authority = ForumAuditEvent only
```

Moderator, Discussion Agent, Puller, Human, OBO, shared Client, and request-body
identity remain denied. The query grants no ordinary or moderation capability.

## 4. Access Evidence result

Every successful list/detail response requires one `audit.admin_query` or
`audit.admin_detail_read` canonical event. A singleton transactional audit-order
allocator prevents late lower-position commits. The snapshot high-water is
captured first, then Access Evidence receives the next position, so it cannot
appear in its own page. The event
records bounded filter/result metadata but not returned events, payload, raw
cursor, auth subject, content, reason, or secrets. It appends evidence without
mutating/reclassifying any prior event.

## 5. Projection and migration result

List never returns payload. Detail returns only a producer Contract's exact
event-type/schema-version allowlist; unknown, legacy, malformed, oversized, or
sensitive payload stays event-identifiable but detail-suppressed. Existing rows
are not rewritten and operational stderr logs are not promoted into canonical
history.

Existing events remain byte-identical. A new append-only one-to-one query
coordinate receives deterministic `(createdAt,eventId)` legacy positions only
while writers are closed; the positions are explicitly not historical causal
proof or a second audit authority. Its indexes support global position, Thread,
actor, target, and event-type keyset queries. A request is bounded by a 90-day
time range or an exact Thread, target, or actor; every page is 1..100 rows.

## 6. Authoring result

```text
SPEC_ID = AGENT_FORUM_ADMIN_AUDIT_QUERY_V1
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

## 7. What reopens this record

- Product/Service actor or canonical audit authority changes;
- origin/main or production audit/runtime state changes;
- an accepted producer cannot define a safe detail allowlist;
- independent review rejects Access Evidence or cursor/filter bounds;
- production-shaped cardinality/payload inventory reveals a new integrity class;
- Owner requires full forensic export, retention, or legal hold under separate
  authority.
