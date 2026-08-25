```text
INVESTIGATION_ID =
INV-AGENT-FORUM-ALIAS-PERMANENCE-AMENDMENT-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
ForumPrincipalAlias physical permanence seam

OWNER =
mayf3

DISPOSITION =
adopted

CLOSED_AT =
2026-08-25T14:02:29Z

INVESTIGATION_RESULT =
independent_review_accepted

FINAL_INDEPENDENT_REVIEWER =
AF-ALIAS-PERMANENCE-AUDIT-R1

FINAL_REVIEWED_HEAD =
41e67ff88468573c9047ee50a7d656561088956a

INVESTIGATION_REVIEW =
ACCEPT

READY_TO_MARK_ADOPTED =
YES

ARCHIVE_TRANSACTION_ALLOWED =
YES

NEW_BLOCKERS =
0

BLOCKERS =
NONE

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_CORE_INVARIANTS_V1

AFFECTED_CONTRACT =
CTR-ID-002

AMENDS_DESIGN =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

PRIOR_DESIGN_BASE =
a2fb6e1009efb376f7d3fbbf6a4b7a84247e4f31

PRIOR_DESIGN_BLOB =
45ab9530a690c0cbd0a592d24d589241f609c145

AUTHORITY_CHANGE_PROPOSED =
NO

SPEC_GAP =
NO

DESIGN_GAP =
YES

OWNER_DECISION_REQUIRED =
NO

IMPLEMENTATION_STARTED =
NO
```

# ForumPrincipalAlias Physical Permanence Amendment V1

## 1. Goal

Close the adopted storage design seam that permits a permanent Forum Principal alias to be physically removed and then reused, without changing the governing Spec or starting identity implementation.

```text
PREFLIGHT_MODE = AMEND
CHANGE_CLASS = NON_MECHANICAL
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_PRESENT_IN_BASE = YES
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
GOVERNING_SPEC_GAP = NO
ADOPTED_DESIGN_GAP = YES
OWNER_DECISION_REQUIRED = NO
IDENTITY_IMPLEMENTATION_ALLOWED = NO
```

`AGENT_FORUM_CORE_INVARIANTS_V1` remains the governing authority. This Investigation Record is non-governing design knowledge and grants no implementation permission.

## 2. Authority and scope

`CTR-ID-002` already requires a non-null Agent ID to remain bound to at most one Forum Principal and forbids reassignment after disablement, deletion, or rename. This amendment changes no product meaning and proposes no authority change.

In scope:

- reject physical `DELETE` of a `ForumPrincipalAlias` row;
- reject `TRUNCATE` of `forum_principal_aliases`;
- preserve the existing one-way `retired_at` transition;
- keep `(namespace,value)` occupied by its original Principal after retirement or a failed deletion attempt;
- amend SQL-019 and SQL-020 and add SQL-075 without renumbering SQL-001..SQL-074.

Out of scope:

- protection against a database owner or superuser acting adversarially;
- Schema, migration, verifier, package, product code, runtime resolver, test, backfill, database, deployment, or merge changes;
- any later subscription, lifecycle, review, finalization, or deletion Schema workstream.

## 3. Observations

### OBS-ALIAS-001 — SQL-020 does not intercept physical DELETE

- Coordinates: `mayf3/agent-forum` at `a2fb6e1009efb376f7d3fbbf6a4b7a84247e4f31`; adopted design blob `45ab9530a690c0cbd0a592d24d589241f609c145`; SQL-019/SQL-020 registry entries.
- Method: inspect `INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1` §9.3.
- Result: SQL-020 is defined only as `BEFORE UPDATE`, so it cannot prevent physical `DELETE`.
- Provenance: [`INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1`](INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md).

### OBS-ALIAS-002 — Deletion releases the unique alias key

- Coordinates: same base and design blob; `ForumPrincipalAlias` candidate model in §8.3 A.
- Method: compare the candidate `UNIQUE(namespace,value)` constraint with the SQL-019/SQL-020 event coverage.
- Result: after the alias row is deleted, the unique key no longer occupies `(namespace,value)`; inserting the same alias for a different Principal satisfies every constraint in the prior adopted design.
- Provenance: adopted design §§8.3 A, 9.1, and 9.3.

### OBS-ALIAS-003 — Row triggers do not cover TRUNCATE

- Coordinates: PostgreSQL trigger event model applied to the adopted row-level alias trigger design.
- Method: inspect the SQL-020 `FOR EACH ROW` trigger shape and the separate `TRUNCATE` trigger event boundary.
- Result: a row-level `UPDATE OR DELETE` trigger does not fire for `TRUNCATE`; complete physical permanence requires a statement-level `BEFORE TRUNCATE` trigger.
- Provenance: adopted design SQL registry and PostgreSQL trigger semantics.

## 4. Claim

### CLM-ALIAS-001 — The adopted design does not fully implement CTR-ID-002 permanence

- Support state: SUPPORTED.
- Supported by: `OBS-ALIAS-001`, `OBS-ALIAS-002`, `OBS-ALIAS-003`.
- Result: the current design is insufficient to fully implement the permanent ownership semantics already frozen by `CTR-ID-002`.
- Uncertainty: none for normal database operation paths; database-owner/superuser adversarial bypass remains explicitly out of scope.

## 5. Selected repair

```text
ALIAS_PHYSICAL_DELETE = REJECT
ALIAS_TRUNCATE = REJECT
ALIAS_REUSE_AFTER_RETIREMENT = REJECT
ALIAS_REUSE_AFTER_DELETE_ATTEMPT = REJECT
DB_OWNER_ADVERSARIAL_PROTECTION = OUT_OF_SCOPE
```

Normal database operation paths fail closed through triggers:

1. SQL-019 keeps the stable function name `public.forum_alias_owner_immutable_guard`, branches on `TG_OP` before reading `NEW`, and raises SQLSTATE `55000` for `DELETE` or `TRUNCATE`.
2. SQL-020 keeps `forum_alias_owner_immutable_guard_tg` and becomes a row-level `BEFORE UPDATE OR DELETE` trigger.
3. SQL-075 adds `forum_alias_owner_immutable_guard_truncate_tg` as a statement-level `BEFORE TRUNCATE` trigger on `public.forum_principal_aliases` using the exact SQL-019 function.
4. SQL-029 remains `forum_watch_subscriptions_state_ck`; SQL-001..SQL-074 retain their IDs and meanings.

Allowed `retired_at` transitions:

```text
NULL → NULL = ACCEPT
NULL → timestamp = ACCEPT
timestamp → same timestamp = ACCEPT
```

Rejected transitions:

```text
timestamp → NULL = REJECT 55000
timestamp → different timestamp = REJECT 55000
```

## 6. Count and DDL impact

```text
RAW_SQL_CONSTRAINTS_REQUIRED = 75
IDENTITY_RAW_SQL_OBJECTS = 12

基座 = 14
证据 = 3
身份 = 12
订阅 = 12
状态 = 8
评审 = 11
定稿 = 9
删除 = 6
TOTAL = 75

DDL_OPERATIONS_ANALYZED = 20
ROLLBACK_OPERATIONS_DEFINED = 20
```

SQL-075 belongs to existing D16 (`functions/triggers/grants`), so it adds no DDL phase and changes no migration lineage or phase order.

## 7. Acceptance amendment

Identity storage acceptance must prove all of the following against PostgreSQL rather than only through an application API:

- after additive apply, `forum_principal_aliases` has zero rows;
- `auth_subject` and `agent_id` namespaces are accepted; any other namespace is rejected with `23514`;
- changing `principal_id`, `namespace`, `value`, `first_seen_at`, or `created_at` is rejected with `55000`;
- `retired_at` permits only the transitions listed in §5;
- physical `DELETE` is rejected with `55000`;
- `TRUNCATE public.forum_principal_aliases` is rejected with `55000`;
- after failed deletion, the original row still occupies `(namespace,value)`;
- inserting the same `(namespace,value)` for another Principal is rejected with `23505`;
- catalog evidence proves SQL-075 is in `public`, targets exactly `public.forum_principal_aliases`, calls the exact SQL-019 function OID, is enabled, `BEFORE`, statement-level, and `TRUNCATE`-only.

## 8. Disposition

```text
DISPOSITION = adopted
REASON = independent review accepted; lifecycle and review binding archived for merge into main
IMPLEMENTATION_ALLOWED = governed by accepted Spec AGENT_FORUM_CORE_INVARIANTS_V1 after this adopted design amendment is merged into main
IDENTITY_IMPLEMENTATION_ALLOWED_BEFORE_MERGE = NO
IDENTITY_IMPLEMENTATION_ALLOWED_AFTER_MERGE = YES
NEXT_TASK = 身份 执行
```

## Stable links

- Governing Spec: [`AGENT_FORUM_CORE_INVARIANTS_V1`](../specs/AGENT_FORUM_CORE_INVARIANTS_V1.md)
- Amended design: [`INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1`](INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md)
- Investigation index: [`docs/investigations/README.md`](README.md)
- Draft PR: to be bound by the Draft PR created for this record
