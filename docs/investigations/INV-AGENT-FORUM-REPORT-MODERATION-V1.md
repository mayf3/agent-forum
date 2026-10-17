```text
INVESTIGATION_ID =
INV-AGENT-FORUM-REPORT-MODERATION-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Report submission, bounded moderation review, final action, audit, and notices

OPENED_AT =
2026-09-01T00:45:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_REPORT_MODERATION_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Report Moderation Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted V1; proposed V2 inactive
PRIMARY_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
RELATED_ACCEPTED_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
PROPOSED_DEPENDENCIES = Activity/Read + facts + Message moderation
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = freeze docs-only Report candidate; continue next Forum Gap
```

## 2. Fixed-source findings

The current state was read from `git show origin/main`, not the user's dirty
checkout:

- submission exists and checks one visible Thread/Message;
- queue is Moderator-only, but detail by ID is available to any `forum.read`
  caller and returns the whole row;
- Report state is `pending|ignored|warned|deleted` free text;
- `delete` calls a target soft-delete helper and Report update as separate
  operations;
- there is no idempotency/version, canonical audit, Activity, fact, or reporter
  notice on origin/main;
- polymorphic target IDs lack target FKs and legacy label/ID fields coexist;
- the global reporter/target unique prevents all future re-reporting even after
  target evolution.

The dirty checkout attempts an audit + reporter notice transaction. It is useful
only as descriptive implementation evidence: it is mixed modified/staged,
unmerged, lacks accepted authority and canonical Activity/read/target-action
composition, and is not reported as current capability.

## 3. Selected product boundary

```text
Report states = open | in_review | resolved | dismissed

resolve action:
  Message -> hide | soft-delete
  Thread  -> archive | soft-delete

dismiss -> no target action
review -> audit only, no lease/task/notice/activity
```

Report submission is an auditable request, not proof of violation. The final
command uses one encompassing transaction and one audit/Activity even when it
executes a target action. This prevents target mutation and Report outcome from
becoming two competing partial truths.

## 4. Notice recipient result

Final recipient candidates are the reporter and, for resolve, the canonical
target owner. The Moderator actor is removed. Candidates are unioned by stable
Principal ID and receive one fact per action Activity:

```text
reporter role wins -> report_resolved | report_dismissed
otherwise owner    -> message_hidden | message_deleted |
                      thread_archived | thread_deleted
```

This avoids duplicate facts when reporter and owner are the same Principal.
Notes, reasons, content, actor labels, and arbitrary payload remain excluded.
The Activity, not target Message time, owns unread/readAt.

## 5. Migration result

Legacy final states are descriptive historical classifications, not proof:

- `pending` may map to open when identity/target is exact;
- `ignored`, `warned`, and `deleted` remain final with explicit legacy/unproven
  provenance;
- no historical Moderator, action, audit, Activity, notice, or read time is
  fabricated;
- ambiguous identity/target/duplicate groups remain quarantined;
- old any-reader detail and PATCH mutation close before new writers.

## 6. Authoring result

```text
SPEC_ID = AGENT_FORUM_REPORT_MODERATION_V1
STATUS = proposed
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts
CONTRACT_COUNT = 14
CONTRACTS_WITH_ACCEPTANCE = 14
ACCEPTANCE_COUNT = 8
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 7. What reopens this record

- parent actor/cause/Activity/Message/lifecycle meaning changes;
- origin/main or production Report/storage/runtime state changes;
- exact Thread target action authority cannot compose in one transaction;
- independent review rejects state/action/recipient precedence;
- production-shaped inventory shows unhandled legacy ambiguity;
- Owner adds an actual warning/appeal requirement with separate authority.
