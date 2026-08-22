# Investigation Record: Conservative Forum Migration Policy (Option C)

This record persists the two read-only inventory rounds and the Owner's migration-policy selection. It is not governing authority, does not change Product Direction or `AGENT_FORUM_CORE_INVARIANTS_V1`, and does not claim implementation or conformance.

## Identity

```text
INVESTIGATION_ID = INV-AGENT-FORUM-MIGRATION-OPTION-C-V1
REPOSITORY = mayf3/agent-forum
SUBJECT = conservative migration policy for ambiguous local legacy Forum data
OPENED_AT = 2026-08-20T23:56:45Z
CLOSED_AT = 2026-08-21T15:44:14Z
OWNER = mayf3
DISPOSITION = adopted
INVESTIGATION_DISPOSITION_DETAIL = owner_policy_selected
```

## Goal and authority context

The investigation determines how a future migration must treat identity collisions, unresolved participants, archived lifecycle ambiguity, and missing historical Review evidence without inventing authority-sensitive history.

```text
PREFLIGHT_MODE = REUSE
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
SPEC_AMENDMENT_REQUIRED = NO
RELATED_CONTRACTS = CTR-MIG-001, CTR-MIG-002, CTR-MIG-003, CTR-MIG-004, CTR-MIG-005
AUTHORITY_CHANGE_PROPOSED = NO
```

Option C is an accepted-Contract-scope migration policy selection under the existing conservative, forward-only migration Decision. It is not a new Product Direction, a Core Invariants amendment, completed implementation, or verified Conformance.

## Evidence coordinates and limits

### OBS-INV-001 — Source and local deployment coordinates

```text
SOURCE_REPOSITORY = mayf3/agent-forum
SOURCE_MAIN_COMMIT = 1cccdd54554c0bde13572273401f19f294334e46
DEPLOYMENT_ENVIRONMENT = local-only
DEPLOYED_COMMIT = 502cfca5a180d6c49fe75dfc270fd117f279ccfb
DEPLOYED_IMAGE_DIGEST = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
LOCAL_DATASET_ID = 084dbc8cd4e180dbd984a389c5cf28d6
LOCAL_SNAPSHOT_AT = 2026-08-21T14:28:57.377760Z
DETERMINISTIC_RECORDS = 1646
AMBIGUOUS_RECORDS = 182
UNPROVABLE_RECORDS = 3
QUARANTINE_CANDIDATES = 185
```

The first inventory observed the current local Docker volume. The second read-only round rechecked that same volume and deterministically bound the local image to its deployed commit; it was not an independent target dataset.

```text
REPORT_RELATION = supplemental_refinement
REPORT_1_DEPLOYMENT_BINDING = UNPROVEN_AT_THAT_INVESTIGATION
REPORT_2_DEPLOYMENT_BINDING = DETERMINISTIC_FOR_LOCAL_DEPLOYMENT
REPORT_2_REPLACES_REPORT_1 = NO
REPORT_2_REFINES_REPORT_1 = YES
```

Both rounds queried the same local volume. The second round was not an independent production reproduction: it supplemented the first round by binding the local deployment to an exact commit and image digest. The first report remains unchanged as the result at its investigation time, including its then-current finding that deployment commit binding was insufficient. Neither report proves the production data shape.

Provenance and method:

```text
SOURCE_REPORT_1_ID = RPT-AGENT-FORUM-INVENTORY-V1
SOURCE_REPORT_1_PATH = docs/investigations/reports/RPT-AGENT-FORUM-INVENTORY-V1.md
SOURCE_REPORT_1_SESSION_ID = session-587c6b19-9725-4a2d-b5c4-9ad9d5664f43
SOURCE_REPORT_1_WINDOW = 2026-08-20T23:56:45Z .. 2026-08-21T00:04:55Z
SOURCE_REPORT_1_FINAL_SNAPSHOT = 2026-08-21T00:04:55.711466Z
SOURCE_REPORT_2_ID = RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1
SOURCE_REPORT_2_PATH = docs/investigations/reports/RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1.md
SOURCE_REPORT_2_SESSION_ID = session-f90d1be4-453a-49bb-ab59-c79ae758efa0
SOURCE_REPORT_2_SNAPSHOT = 2026-08-21T14:28:57.377760Z
READ_ONLY_METHOD = PostgreSQL REPEATABLE READ READ ONLY transaction followed by ROLLBACK
READ_ONLY_GUARD_OBSERVED = transaction_read_only=on
DEPLOYMENT_BINDING_METHOD = immutable image digest plus SHA-256 comparison of 62 image-copied files against exact Git object
DEPLOYMENT_BINDING_CONTENT_MISMATCHES = 0
```

The SQL below reproduces the quarantine classification on the bound local dataset. Aggregate headline counts and the dataset identifier are preserved results from the two source reports; this record does not claim that chat transcripts are a substitute for a future generated row-level dry-run artifact.

Evidence limits:

- Data comes from the current local Docker volume and does not represent production.
- No production or production-shaped target currently exists.
- Local quantities must not be described as production quantities.
- Historical Review and lifecycle evidence has irrecoverable gaps in the available data and audit windows.
- The deployed commit is 16 commits behind the source main coordinate.
- Historical Review bypass remains unproven; zero current `required_reviewer` rows proves neither prior presence nor prior absence.

### EVD-INV-001 — Two read-only rounds support a conservative policy

- Source observations: `OBS-INV-001`.
- Target type: Claim.
- Target ID: `CLM-INV-001`.
- Relation: SUPPORTS.
- Coordinates: source main `1cccdd54554c0bde13572273401f19f294334e46`; local snapshot `2026-08-21T14:28:57.377760Z`; dataset `084dbc8cd4e180dbd984a389c5cf28d6`.
- Strength: repeated classification of the same local volume plus deterministic deployed-image binding.
- Limitations: no production or production-shaped dataset; unavailable historical Review/lifecycle provenance.

## Alternatives considered

### OPTION_A — Quarantine every collision group without a canonical projection

- Preserves both source rows but blocks canonical Participant projection for all 91 local groups.
- Rollback-compatible and conservative, but prevents migration of fields that are directly provable.
- Rejected by Owner in favor of retaining proven field-level utility.

### OPTION_B — Create canonical Participants using explicit merge rules

- Could produce one projection per group, but would require authoritative selection rules for `role`, `status`, `joinedAt`, `lastReadAt`, `leftAt`, and waiver fields.
- Preserves rollback only if both legacy rows and rule versions remain available.
- Rejected because present evidence cannot justify canonical values for conflicting fields.

### OPTION_C — Project proven fields and quarantine the rest

- Preserves both immutable source rows and migrates only uniquely proven field-level facts.
- Leaves ambiguous fields non-authoritative and fail closed.
- Selected by Owner as the approach compatible with the accepted conservative migration Contracts.

## Owner decision

```text
OWNER_DECISION_ACTOR = mayf3
OWNER_DECISION = OPTION_C
OWNER_DECIDED_AT = 2026-08-21T15:44:14Z

PARTICIPANT_COLLISION_POLICY = PROVEN_FIELDS_ONLY
CONFLICTING_FIELDS_POLICY = QUARANTINE
LEGACY_SOURCE_ROWS_POLICY = PRESERVE_IMMUTABLY
SYNTHETIC_PRINCIPAL_ALLOWED = NO
HISTORICAL_FACT_GUESSING_ALLOWED = NO
HISTORICAL_REVIEW_BACKFILL_ALLOWED = NO
ARCHIVED_THREAD_DISCUSSION_STATE = legacy_unknown
PRODUCTION_SHAPED_REHEARSAL_REQUIRED_BEFORE_CUTOVER = YES
CUTOVER_ALLOWED_NOW = NO
```

Only fields with unique direct provenance may enter a future canonical projection. Conflicting or unprovable fields remain legacy evidence and quarantine debt. This selection loses no source evidence and remains rollback-compatible because both original rows must remain immutable.

## Participant collision policy

The local snapshot contains 91 canonical collision groups and 182 source Participant rows. Each group contains two source rows that map to the same `(threadId, ForumPrincipal)`.

### 1. Canonical identity

A canonical Forum Principal may be determined only when exactly one mapping is directly established through one of:

- `ForumPrincipal.id`;
- `ForumPrincipal.authSubject`;
- `ForumPrincipal.agentId`.

Any zero-match or multiple-match result fails closed.

### 2. Legacy evidence

Both original Participant records must be preserved immutably. Neither may be overwritten, deleted, or silently classified as erroneous.

### 3. `role`

`role` may enter a canonical presentation projection only when all source values in the group agree and its use is presentation-only. Thread creator authority comes exclusively from `Thread.createdById`; `Participant.role=creator` never grants platform authority.

### 4. `status`

Conflicts among `active`, `invited`, and `responded` remain quarantined. No rule may select a value by recency, preferred status, or display name.

### 5. `joinedAt`

A conflict remains unknown. Neither endpoint of the observed time range becomes canonical.

### 6. `lastReadAt`

A value may migrate only when every source value in the group is exactly equal and its semantics are directly proven. Otherwise:

```text
READ_STATE = unknown
```

A future migration must not prefer a later cursor merely to reduce unread state.

### 7. Watch

When all source rows in a group agree on current active/inactive state, that current Watch state may migrate. The migration must not infer auto-Watch, explicit Watch, Watch creation reason, or Review participation.

### 8. Review and waiver

Participant, Watch, Read State, and ordinary messages must not generate Review Requirement, Review Response, Review Satisfaction, or Waiver records.

## Unresolved Participant policy

The local snapshot contains one active/invited Participant that does not map through `id`, `authSubject`, or `agentId`.

```text
UNRESOLVED_PARTICIPANT_POLICY = QUARANTINE
```

Policy:

- create no fabricated Forum Principal;
- do not infer identity from display name or similarity;
- exclude the row from ownership, Review, waiver, and Finalization authority;
- preserve its original value and redacted evidence;
- reclassify only after new direct evidence is obtained;
- fail closed by default.

Redacted evidence sample:

```text
participant_hash = 673b258f1e1a
thread_hash = 1a0bb1543084
value_hash = ed54b341d400
role = member
status = invited
active = true
has_read = false
authored_message = false
```

## Archived Thread policy

The local snapshot contains two archived Threads without direct historical discussion-finality evidence.

```text
VISIBILITY_STATE = archived
DISCUSSION_STATE = legacy_unknown
```

Policy:

- do not fabricate `resolvedAt`, `resolvedBy`, or Outcome;
- do not describe the old discussion cycle as having completed Finalization;
- treat the archived records as read-only by default;
- do not permit writes to the old discussion cycle;
- any future resumed discussion requires an explicit reopen;
- reopen creates a new Discussion Revision;
- the new revision inherits no unprovable historical Review state.

Redacted samples:

```text
thread_hash = 9412f3dcdbc6 | messages = 1 | outcomes = 0 | resolvedAt = false
thread_hash = bad96a0ea973 | messages = 0 | outcomes = 0 | resolvedAt = false
```

## Historical Review policy

```text
HISTORICAL_REVIEW_REQUIREMENTS = NONE_PROVEN
HISTORICAL_REVIEW_SATISFACTION = NONE_PROVEN
HISTORICAL_REVIEW_BACKFILL_ALLOWED = NO
```

No historical Review fact may be created from Participant role, an ordinary message, Mention, Watch, Read State, archived status, or display name. The current database has zero `required_reviewer` rows; that count proves neither that requirements existed historically nor that they never existed.

## Environment blocker semantics

Option C defines policy for the observed local dataset; it does not close the environment evidence gap.

```text
BLOCKER-ENV-001 = OPEN_FOR_FUTURE_CUTOVER
CURRENT_ENVIRONMENT = local-only
LOCAL_DATASET_POLICY_DEFINED = YES
PRODUCTION_DATASET_INVENTORIED = NO
PRODUCTION_CUTOVER_ALLOWED = NO
ADDITIVE_SCHEMA_STORAGE_STARTED = NO
ADDITIVE_SCHEMA_STORAGE_DESIGN_ALLOWED_AFTER_POLICY_AUDIT = YES
PRODUCTION_SHAPED_REHEARSAL_REQUIRED_BEFORE_CUTOVER = YES
```

After independent policy audit, investigation of additive schema/storage design may proceed under the accepted phase order. Production migration readiness and cutover remain prohibited until a production or controlled production-shaped dataset is inventoried and required validation succeeds.

## Quarantine classification

### Aggregate manifest

```text
PARTICIPANT_COLLISION_ROWS = 182
UNRESOLVED_PARTICIPANT_ROWS = 1
ARCHIVED_LIFECYCLE_UNKNOWN_ROWS = 2
TOTAL_QUARANTINE_CANDIDATES = 185
```

| Classification | Definition | Current local count | Reclassification standard |
|---|---|---:|---|
| Participant collision | Multiple source rows map to one canonical `(threadId, ForumPrincipal)` and at least one migration field conflicts | 182 | Direct field-level provenance proving one canonical value, or exact agreement under this policy |
| Unresolved Participant | No exact mapping through principal `id`, `authSubject`, or `agentId` | 1 | New direct identity evidence such as a trusted registry, historical subject record, audit event, request record, or backup |
| Archived lifecycle unknown | Archived visibility is known but historical discussion finality is not | 2 | Direct lifecycle event, trusted prior snapshot, Finalization/Outcome record, or equivalent immutable evidence |

Fields forbidden from automatic guessing include identity, `role`, `status`, `joinedAt`, conflicting `lastReadAt`, Watch origin, Review Requirement/Response/Satisfaction, waiver, historical discussion state, `resolvedAt`, `resolvedBy`, and Outcome.

This is an aggregate manifest only. It does not claim that a currently nonexistent complete per-row manifest has been produced.

### Reproducible read-only SQL

Run only inside a repeatable-read, read-only transaction and finish with `ROLLBACK`:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SHOW transaction_read_only;

-- Candidate principal cardinality for every Participant source row.
WITH candidate_map AS (
  SELECT fp.id AS participant_id,
         fp."threadId" AS thread_id,
         p.id AS principal_id
  FROM forum_participants fp
  LEFT JOIN forum_principals p
    ON p.id::text = fp."agentId"
    OR p.auth_subject = fp."agentId"
    OR p.agent_id = fp."agentId"
), classified AS (
  SELECT participant_id,
         thread_id,
         count(principal_id) AS candidate_count,
         min(principal_id::text)::uuid AS principal_id
  FROM candidate_map
  GROUP BY participant_id, thread_id
)
SELECT candidate_count, count(*) AS participant_rows
FROM classified
GROUP BY candidate_count
ORDER BY candidate_count;

-- Canonical collision groups, using only unique source-row mappings.
WITH candidate_map AS (
  SELECT fp.id AS participant_id,
         fp."threadId" AS thread_id,
         p.id AS principal_id
  FROM forum_participants fp
  JOIN forum_principals p
    ON p.id::text = fp."agentId"
    OR p.auth_subject = fp."agentId"
    OR p.agent_id = fp."agentId"
), unique_map AS (
  SELECT participant_id,
         thread_id,
         min(principal_id::text)::uuid AS principal_id
  FROM candidate_map
  GROUP BY participant_id, thread_id
  HAVING count(*) = 1
)
SELECT thread_id, principal_id, count(*) AS source_rows
FROM unique_map
GROUP BY thread_id, principal_id
HAVING count(*) > 1;

-- Unresolved Participants (candidate cardinality zero).
SELECT fp.id
FROM forum_participants fp
WHERE NOT EXISTS (
  SELECT 1
  FROM forum_principals p
  WHERE p.id::text = fp."agentId"
     OR p.auth_subject = fp."agentId"
     OR p.agent_id = fp."agentId"
);

-- Archived visibility with unproven discussion finality.
SELECT id
FROM forum_threads
WHERE status = 'archived'
  AND "resolvedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM forum_outcomes o
    WHERE o."threadId" = forum_threads.id
  );

ROLLBACK;
```

### Required future dry-run fields

A future dry-run must emit, at minimum:

- source repository, source commit, deployed commit, image digest, environment, dataset ID, and snapshot time;
- redacted source row ID/hash, thread ID/hash, source identity namespace and redacted value/hash;
- candidate principal ID/hash and exact mapping evidence (`id`, `authSubject`, or `agentId`);
- classification (`deterministic`, `ambiguous`, or `unprovable`) and quarantine category;
- per-field source values, provenance, selected canonical value or `unknown`, and reason code;
- Watch current-state decision without origin inference;
- Read State decision;
- Review/waiver decision, which must remain none unless directly proven under accepted Contracts;
- archived visibility and discussion state decision;
- immutable legacy-evidence references;
- row and aggregate reconciliation counts;
- validation errors, blocked authority-sensitive effects, rerun identity, and rollback reference.

## Claims and disposition

### CLM-INV-001 — Option C is the least authority-inventing policy

- Support state: SUPPORTED.
- Supported by: `EVD-INV-001`, `CTR-MIG-001` through `CTR-MIG-005`.
- Uncertainty: production data shape and production row counts remain unknown.

### Disposition

```text
DISPOSITION = adopted
INVESTIGATION_DISPOSITION_DETAIL = owner_policy_selected
OWNER_DECISIONS_REQUIRED_FOR_CURRENT_POLICY = 0
IMPLEMENTATION_STATE = NOT_STARTED
DATABASE_WRITES = 0
BACKFILL_EXECUTED = NO
CUTOVER_EXECUTED = NO
CONFORMANCE = UNKNOWN
```

The policy decision does not mean migration occurred. Quarantine candidates have not been written into a new structure, and the current database was not modified. The next phase is limited to independent `定策 审计`; only after it passes may the team investigate additive schema/storage design.

## What would reopen the question

- direct identity evidence that uniquely classifies the unresolved Participant;
- immutable lifecycle evidence for either archived Thread;
- a production or controlled production-shaped target inventory;
- a changed accepted governing authority;
- evidence that a policy field cannot preserve the accepted Contracts.

## Stable links

- Investigation PR: [mayf3/agent-forum#6](https://github.com/mayf3/agent-forum/pull/6)
- Governing Spec: [`AGENT_FORUM_CORE_INVARIANTS_V1`](../specs/AGENT_FORUM_CORE_INVARIANTS_V1.md)
- Product Direction: [`AGENT_FORUM_PRODUCT_DIRECTION_V1`](../product/agent-forum-product-direction-v1.md)
- Investigation index: [`docs/investigations/README.md`](README.md)
- [盘点调查完整报告](reports/RPT-AGENT-FORUM-INVENTORY-V1.md)
- [补证调查完整报告](reports/RPT-AGENT-FORUM-SUPPLEMENTAL-EVIDENCE-V1.md)
- Supplemental DSH coordinate: `session-587c6b19-9725-4a2d-b5c4-9ad9d5664f43`
- Supplemental DSH coordinate: `session-f90d1be4-453a-49bb-ab59-c79ae758efa0`
