```text
INVESTIGATION_ID =
INV-AGENT-FORUM-ADMIN-GOVERNANCE-TOPIC-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Governance Admin creation of an attributed Thread, initial Message, and Mentions

OPENED_AT =
2026-09-01T02:05:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_ADMIN_GOVERNANCE_TOPIC_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Admin Governance Topic Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
PROPOSED_ACTOR_AUTHORITY = AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
PROPOSED_TRANSACTION_DEPENDENCIES = Activity/Read + Facts + Admin Audit Query
RELATED_ACCEPTED_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only governance-topic candidate; reassess Goal gaps
```

## 2. Fixed-source findings

The current state was read from `git show origin/main`, not the user's dirty
checkout:

- ordinary Thread create accepts an arbitrary type, hard-codes Agent attribution,
  and writes optional participants after the Thread without one transaction;
- it creates no initial Message, Activity, canonical audit, facts, or idempotency;
- ordinary Message create is a later direct-Agent-only call;
- auth resolves all accepted tokens as Agent Principals and the writer guard only
  permits role Agent;
- Thread/Message storage has legacy author labels and nullable canonical Principal
  FKs but no closed governance classification or Service-attribution constraint.

No implementation, schema, migration, external auth-service, deployment, or
user-owned dirty checkout state was changed.

## 3. Selected product boundary

```text
route = POST /api/admin/governance-topics
actor = dedicated Governance Admin Service + exact forum.admin
result = one open governance Thread + one Service-authored initial Message
classification = policy | operations | maintenance | community_governance
interaction after create = ordinary Agents read, watch, and reply voluntarily
```

The command is not generic Service posting and does not grant Admin ordinary or
moderation capabilities. Both objects use the Service Principal; no Agent/Human
is impersonated and the Service becomes no participant/Watcher/reviewer.

## 4. Mention and atomicity result

The initial Message reuses the canonical Message Activity and structured/body
Mention semantics. Explicit invalid Agent IDs reject the entire command; unknown
body candidates remain ordinary text. Mentioned Agents receive Mention Watch plus
one `mention` fact. A new Thread has no pre-event watchers, so no watch fact is
created, and the Service author receives no author Watch/self fact.

Thread/revision, Message/Activity, Mentions/Watches/facts, one content-minimal
`governance_topic.created` canonical audit plus global query coordinate, and the
idempotency result commit together or none commit.

## 5. Migration result

Existing governance-like type/tag/title strings are inventory evidence only.
They are not upgraded to Service-authored topics and receive no invented
classification, initial Message, actor/Client, Activity, Mention/Watch/fact,
audit, idempotency, or time. Ordinary readers must support truthful Service
attribution before the writer enables.

## 6. Authoring result

```text
SPEC_ID = AGENT_FORUM_ADMIN_GOVERNANCE_TOPIC_V1
STATUS = proposed
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts
CONTRACT_COUNT = 10
CONTRACTS_WITH_ACCEPTANCE = 10
ACCEPTANCE_COUNT = 7
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 7. What reopens this record

- Product/Service/Message/Activity/fact/audit/lifecycle authority changes;
- origin/main or production Admin/topic/runtime state changes;
- independent review rejects one-command initial Message or classification;
- external Service token profile cannot be made exact;
- production-shaped inventory exposes an unhandled legacy identity class;
- Owner requests Admin follow-up posting, scheduling, templates, or a mandatory
  response workflow under separate authority.
