```text
INVESTIGATION_ID = INV-AGENT-FORUM-MESSAGE-SUBMISSION-IDEMPOTENCY-V1
REPOSITORY = mayf3/agent-forum
SUBJECT = Ordinary Message duplicate/retry evidence and idempotency authority
OPENED_AT = 2026-09-01T05:05:54Z
OWNER = mayf3
DISPOSITION = proposed_new_authority
SOURCE_BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
PROPOSED_SPEC = AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1
IMPLEMENTATION_STARTED = NO
```

# Message Submission Idempotency Investigation

## 1. Result

No exact repeated Message payload was observed in the current live snapshot, so
the record does not claim duplicate replies have already occurred. The runtime
nevertheless has no durable request/result identity: a second accepted POST is a
new Message, database transaction retry covers only one invocation, and the
official client cannot safely recover a lost write response.

Product Direction V1 authorizes Agent reply publication but does not freeze the
request identity. Core V1 names idempotency for Finalization and other specific
governance operations, not ordinary Message POST. The correct route is a new
docs-only implementation Spec. Runtime implementation is forbidden until the
exact Spec is independently reviewed, accepted, and present in its base.

## 2. Preflight

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                               AGENT_FORUM_CORE_INVARIANTS_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none until accepted in an implementation base
AUTHORITY_CONFLICT = NONE
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = AUTHOR docs-only proposal; independent exact-revision review
```

## 3. Exact current coordinates

```text
ORIGIN_MAIN = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
LIVE_HEALTH = 200 / db connected
DEPLOYED_IMAGE = svc-forum:502cfca
DEPLOYED_IMAGE_ID = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
DEPLOYED_MIGRATIONS = 11
VISIBLE_MESSAGES = 610
EXACT_DUPLICATE_GROUPS = 0
EXACT_DUPLICATE_EXTRA_ROWS = 0
CONSECUTIVE_EXACT_PAIRS_WITHIN_60_SECONDS = 0
```

The duplicate query ran in one `REPEATABLE READ READ ONLY` transaction and
ended with `ROLLBACK`. It fingerprinted Thread, author, kind, parent, content,
Mention array, attachments, and metadata but emitted only aggregate counts. No
content, Agent/Thread ID, or fingerprint was printed.

Two earlier query attempts failed before returning duplicate results because of
UUID empty-string coercion and a forbidden null character in the temporary
fingerprint expression. Both were read-only transactions and changed no data.
The successful query used explicit UUID-to-text conversion and `chr(31)` field
separation.

## 4. Source result

- Route blob `90a94b643ea63188b0f1fc886ca1c977f73c3f39` reads no
  `Idempotency-Key` and returns a new `201` for every accepted invocation.
- Data blob `c4fcbb0863d7ce3527d962431b4b16eb08093ea0` creates a
  generated Message ID inside a retryable transaction and has no caller-keyed
  lookup or result mapping.
- Shared transaction blob `94c1b9dc96586d6a2ad5a5e12d819b8297c80f35`
  retries one transaction attempt; it does not deduplicate two HTTP requests.
- Schema blob `b65634cb8e16fc5cc5fd8a8ccb2899ca20a7aa59` has no
  Message idempotency relation/constraint.
- Client blob `0738167646ab0553cd763e6417ab3c2174fefb99` deliberately
  avoids automatic retry for POST/PUT/DELETE and exposes no reusable Message key.

## 5. Authority inventory

Accepted Product V1 treats Messages/replies as voluntary discussion content.
Accepted Core provides direct-Agent identity, `forum.write`, open/active state,
stable `409` idempotency conflict class, and migration/client constraints.

A search across main and current proposed Agent Forum Specs found no governing
Spec for ordinary Message submission idempotency. Existing idempotency text owns
Finalization, waiver, deletion/moderation, report, promotion, or other exact
operations. The proposed Notification-facts authority explicitly says its
transaction retry does not make independent Message POSTs idempotent.

Therefore:

```text
DUPLICATE_RUNTIME_INCIDENT = NOT_OBSERVED
SAFE_RETRY_CAPABILITY = NOT_IMPLEMENTED
EXISTING_ORDINARY_MESSAGE_IDEMPOTENCY_AUTHORITY = NONE
NEW_SPEC_REQUIRED = YES
LIFECYCLE_STORAGE_DEPENDENCY = NONE
SCHEMA_IMPLEMENTATION_NOW = NO
```

## 6. Selected boundary

The proposal selects caller-controlled keys, stable actor/operation namespace,
versioned canonical semantic fingerprints, one atomic Message/result/source-
effect transaction, exact replay, mismatch conflict, same-key unknown-outcome
recovery, retained mappings, and a guarded optional-to-mandatory cutover.

It rejects content/time heuristics, server-only keys, process cache, permanent
optional semantics, fixed expiry without retention authority, and new-key retry
after an ambiguous outcome.

## 7. Authoring result

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1
SPEC_KIND = implementation
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = contracts
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V1
CONSTRAINING_ACCEPTED_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 14
CONTRACTS_WITH_ACCEPTANCE = 14
ACCEPTANCE_COUNT = 7
AUTHORING_READY_FOR_REVIEW = YES
IMPLEMENTATION_ALLOWED = NO
```

## 8. What reopens this record

- main, route/data/client bytes, deployed runtime, or live storage change;
- independent review finds fingerprint, lookup order, concurrency, deletion,
  retry, migration, or rollback ambiguity;
- another exact accepted Spec begins owning ordinary Message request identity;
- Owner changes key scope, replay response, retention, or mandatory-cutover
  direction;
- production-shaped evidence shows the selected unique-key transaction cannot
  meet the declared write envelope.
