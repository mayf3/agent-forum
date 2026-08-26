```text
INVESTIGATION_ID =
INV-AGENT-FORUM-READ-STATE-MONOTONICITY-AMENDMENT-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
ForumReadState known-to-unknown monotonicity seam

OPENED_AT =
2026-08-26T15:10:00Z

CLOSED_AT =
OPEN

OWNER =
mayf3

DISPOSITION =
open

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_CORE_INVARIANTS_V1

AFFECTED_CONTRACTS =
CTR-AUTHZ-005, CTR-REVIEW-001, CTR-MIG-002

AMENDS_DESIGN =
INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1

PRIOR_DESIGN_BASE =
5fbccebba92e114a85ca13915f88ff1c2c17630c

PRIOR_DESIGN_BLOB =
01aba6f47ef3cc75feb31542247055381a9b9d5b

AFFECTED_WORKSTREAM =
订阅

AFFECTED_SQL_OBJECTS =
SQL-038, SQL-039

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

# ForumReadState Known-to-Unknown Monotonicity Amendment V1

## 1. Goal

Close the adopted storage design seam that lets an already-proven `ForumReadState` cursor regress from `known` to `unknown`, and correct the subscription acceptance table count, without changing the governing Spec or starting subscription implementation.

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
AUTHORITY_CHANGE_PROPOSED = NO
SUBSCRIPTION_IMPLEMENTATION_ALLOWED = NO
```

`AGENT_FORUM_CORE_INVARIANTS_V1` remains the governing authority. This Investigation Record is non-governing design knowledge and grants no implementation permission.

## 2. Authority and scope

The accepted Spec already stores Read State independently (`CTR-AUTHZ-005`, `CTR-REVIEW-001`, `CTR-MIG-002`) and never authorizes destroying a proven read cursor. The adopted design itself declares `cursor 单调前进`（§8.3 D）as the intended semantics. This amendment changes no product meaning and proposes no authority change.

Product direction unchanged:

- ReadState is an independent fact, separate from Watch/Review;
- `unknown` means a provable cursor is lacking;
- `unknown` may be upgraded to `known` once evidence exists;
- a `known` cursor must never regress to `unknown`;
- a `known` cursor must never decrease numerically;
- this amendment adds no `last_read_at` time-monotonicity rule.

In scope:

- amend SQL-038 so a known state cannot regress to unknown, keeping its stable ID and function name;
- keep SQL-039 unchanged in ID, name, and event binding, amending only registry PURPOSE / NEGATIVE_TEST text;
- freeze the complete ReadState transition matrix and its acceptance coverage;
- correct the subscription acceptance table count from 六表 0 to 五表 0 (editorial).

Out of scope:

- any new SQL object (no SQL-076), any change to SQL-039 identity, any change to the SQL-036 three-branch shape CHECK;
- any `last_read_at` comparison or time-monotonicity rule;
- Schema, migration, verifier, package, product code, runtime mark-read path, notification logic, tests, backfill, database, dual-read/dual-write, cutover, deployment, or merge changes;
- any later subscription, lifecycle, review, finalization, or deletion Schema workstream.

## 3. Observations

### OBS-READ-001 — The subscription workstream has exactly five models

- Coordinates: `mayf3/agent-forum` at `5fbccebba92e114a85ca13915f88ff1c2c17630c`; adopted design blob `01aba6f47ef3cc75feb31542247055381a9b9d5b`.
- Method: inspect `INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1` §14 订阅 执行 row and §8.3 B/C/D/Q.
- Result: the explicit models are `ForumParticipation`, `ForumWatchSubscription`, `ForumReadState`, `ForumMention`, `ForumNotificationFact` — 5 models / 5 tables.
- Provenance: [`INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1`](INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md).

### OBS-READ-002 — §17.2 alone says 六表 0

- Coordinates: same base and design blob; §17.2 订阅 row.
- Method: search the adopted design for 六表 and cross-check against the model list.
- Result: §17.2 alone writes 六表 0; no sixth model, table, Contract dependency, or registry object exists for the subscription workstream. It is an editorial count error.
- Provenance: adopted design §17.2.

### OBS-READ-003 — The current SQL-038 comparison is NULL-unsafe

- Coordinates: same base and design blob; §9.3 SQL-038 registry row.
- Method: inspect the guard condition `NEW.last_read_seq IS DISTINCT FROM OLD.last_read_seq AND NEW.last_read_seq < OLD.last_read_seq` under SQL three-valued logic.
- Result: when `NEW.last_read_seq` is `NULL` (the `known → unknown` update), the `<` comparison yields `NULL`, the PL/pgSQL `IF` does not reject, and the transition passes.
- Provenance: adopted design §9.3 and PostgreSQL NULL comparison semantics.

### OBS-READ-004 — Prior disposable PostgreSQL measurement

- Coordinates: disposable PostgreSQL 16.15 environment of the prior seam audit.
- Method: execute the prior SQL-038 guard against seeded `forum_read_states` rows.
- Result: `known(0) → unknown = ACCEPT`, `known(5) → unknown = ACCEPT`, `known(5) → known(4) = REJECT 23514`.
- Provenance: prior audit of the adopted design at blob `01aba6f47ef3cc75feb31542247055381a9b9d5b`.

### OBS-READ-005 — This round's disposable validation of the amended guard

- Coordinates: disposable PostgreSQL 16.14 (aarch64) container, script `/tmp/af-readstate-amendment/validate.sql`; no source database involved.
- Method: install the SQL-036 shape CHECK, first the prior SQL-038 function then the amended SQL-038 function, bind SQL-039 as `BEFORE UPDATE FOR EACH ROW`, and drive every matrix cell plus the four shape negatives.
- Result (prior guard): `known(0) → unknown = ACCEPT`; `known(5) → unknown = ACCEPT`; `known(5) → known(4) = REJECT 23514` — the seam reproduces.
- Result (amended guard): `unknown → unknown = ACCEPT`; `unknown → known(0) = ACCEPT`; `unknown → known(5) = ACCEPT`; `known(0) → unknown = REJECT 23514`; `known(5) → unknown = REJECT 23514`; `known(5) → known(4) = REJECT 23514`; `known(5) → known(5) = ACCEPT`; `known(5) → known(6) = ACCEPT`.
- Result (shape negatives unchanged): `unknown + non-NULL cursor = REJECT 23514`; `known seq>0 + NULL time = REJECT 23514`; `negative cursor = REJECT 23514`; `invalid state = REJECT 23514`. Catalog: trigger and function present.
- Provenance: this amendment's disposable run, recorded in §10 of the task output.

## 4. Claims

### CLM-READ-001 — 六表 0 is an editorial count error

- Support state: SUPPORTED.
- Supported by: `OBS-READ-001`, `OBS-READ-002`.
- Result: 六表 0 does not stand for a missing sixth table; the subscription workstream is five tables.
- Uncertainty: none.

### CLM-READ-002 — The current SQL-038 does not fully implement the adopted cursor-forward semantics

- Support state: SUPPORTED.
- Supported by: `OBS-READ-003`, `OBS-READ-004`, `OBS-READ-005`.
- Result: the adopted design's own declared `cursor 单调前进` semantics is incomplete at the `known → unknown` seam.
- Uncertainty: none for normal database operation paths.

### CLM-READ-003 — Repairing known→unknown needs no new Owner product decision

- Support state: SUPPORTED.
- Supported by: the accepted Spec (`CTR-AUTHZ-005`, `CTR-REVIEW-001`, `CTR-MIG-002`) never authorizes destroying a proven cursor; the fix only closes the design-implementation gap against semantics the adopted design already declares.
- Uncertainty: none.

## 5. Selected repair

Frozen ReadState transition matrix:

```text
UNKNOWN_TO_UNKNOWN        = ACCEPT
UNKNOWN_TO_KNOWN_ZERO     = ACCEPT
UNKNOWN_TO_KNOWN_POSITIVE = ACCEPT

KNOWN_ZERO_TO_UNKNOWN     = REJECT_23514
KNOWN_POSITIVE_TO_UNKNOWN = REJECT_23514

KNOWN_SAME_TO_SAME        = ACCEPT
KNOWN_TO_HIGHER_CURSOR    = ACCEPT
KNOWN_TO_LOWER_CURSOR     = REJECT_23514
```

Interpretation:

- `unknown → known` is knowledge gained from new evidence;
- `known → unknown` destroys an already-proven cursor and is a regression;
- a numeric decrease of a known cursor is a regression;
- neither state nor cursor may regress through the mark-read path.

Not frozen this round:

```text
LAST_READ_AT_MONOTONICITY = NO_NEW_RULE
```

Non-blocking observation recorded:

```text
KNOWN_SAME_CURSOR_EARLIER_LAST_READ_AT = CURRENTLY_NOT_PROHIBITED
```

Reasons:

- the current governing Spec defines no timestamp monotonicity;
- unread authority is derived from `last_read_seq`;
- this amendment only closes the confirmed state/cursor regressions;
- freezing `last_read_at` monotonicity later requires a separate investigation or design amendment.

## 6. SQL-038 amendment

SQL-038 keeps its stable ID and function name `forum_read_cursor_monotonic_guard` and is amended to exactly:

```sql
CREATE OR REPLACE FUNCTION public.forum_read_cursor_monotonic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'known'
     AND NEW.state = 'unknown' THEN
    RAISE EXCEPTION 'read state must not regress from known to unknown'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'known'
     AND NEW.state = 'known'
     AND NEW.last_read_seq < OLD.last_read_seq THEN
    RAISE EXCEPTION 'read cursor must not regress'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
```

Preserved:

- stable SQL_OBJECT_ID SQL-038;
- stable function name;
- SQLSTATE 23514;
- `unknown → known` legal;
- known same/higher legal;
- known lower rejected;
- `known → unknown` rejected;
- no new SQL object.

Forbidden:

- adding SQL-076;
- changing the SQL-039 ID or name;
- adding any `last_read_at` comparison;
- changing the SQL-036 three-branch shape CHECK.

## 7. SQL-039 and acceptance amendment

SQL-039 keeps `forum_read_cursor_monotonic_guard_tg`, still:

```text
BEFORE UPDATE
ON public.forum_read_states
FOR EACH ROW
EXECUTE FUNCTION public.forum_read_cursor_monotonic_guard()
```

Registry PURPOSE / NEGATIVE_TEST text is updated to cover explicitly:

- `known → unknown` rejected (both `known(0)` and `known(>0)`);
- numeric known cursor decrease rejected;
- `unknown → known` accepted;
- same / higher cursor accepted.

Subscription acceptance must verify the complete transition matrix cell by cell and must not test only the numeric `5 → 4` case.

## 8. Subscription table count correction

§17.2 changes 六表 0 to 五表 0. The five tables are exactly:

```text
forum_participations
forum_watch_subscriptions
forum_read_states
forum_mentions
forum_notification_facts

SUBSCRIPTION_MODELS = 5
SUBSCRIPTION_TABLES = 5
```

No new candidate model and no sixth table may be added.

## 9. Count and DDL impact

```text
RAW_SQL_CONSTRAINTS_REQUIRED = 75
SUBSCRIPTION_RAW_SQL_OBJECT_COUNT = 12

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

SQL-038 is an in-place function amendment inside existing D16 (`functions/triggers/grants`); it adds no DDL phase, no registry ID, and changes no migration lineage or phase order.

## 10. Disposition

```text
DISPOSITION = open
REASON = docs-only amendment authored; awaits independent 读态 审计 before adoption binding
IMPLEMENTATION_ALLOWED = governed by accepted Spec AGENT_FORUM_CORE_INVARIANTS_V1 after this amendment is adopted and merged into main
SUBSCRIPTION_IMPLEMENTATION_ALLOWED_BEFORE_MERGE = NO
SUBSCRIPTION_IMPLEMENTATION_ALLOWED_AFTER_MERGE = only after 读态 审计 and 归档 执行 complete
LAST_READ_AT_MONOTONICITY_CHANGED = NO
SPEC_CHANGED = NO
PRODUCT_CODE_CHANGED = NO
SCHEMA_CHANGED = NO
MIGRATION_CREATED = NO
NEXT_TASK = 读态 审计
```

## What would reopen the question

- new evidence: a proven need for legitimately forgetting a read cursor (e.g., an Owner-approved reset semantics);
- changed parent authority: the governing Spec adding explicit read-cursor or `last_read_at` monotonicity Contracts;
- changed operational constraint: subscription implementation discovering a matrix cell that fails against a real workload.

## Stable links

- Governing Spec: [`AGENT_FORUM_CORE_INVARIANTS_V1`](../specs/AGENT_FORUM_CORE_INVARIANTS_V1.md)
- Amended design: [`INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1`](INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1.md)
- Investigation index: [`docs/investigations/README.md`](README.md)
- Draft PR: to be bound by the Draft PR created for this record
