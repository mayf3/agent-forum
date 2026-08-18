---
name: spec-governance
description: Use in mayf3/agent-forum when planning any non-mechanical change, deciding whether an existing Spec governs the work, authoring or amending a Spec, independently reviewing a Spec, or checking an implementation against accepted Contracts. Covers REUSE/AMEND/SUPERSEDE/NEW preflight, Spec syntax, semantic review, and contract-to-evidence compliance.
---

# Governing Agent Forum Specs

Use this workflow for four modes:

```text
PREFLIGHT
AUTHOR
REVIEW
COMPLIANCE
```

The source of truth is [`.agents/README.md`](../../README.md). This skill applies that document; it does not redefine it.

## Sources of truth

Read, in order:

1. Root [`AGENTS.md`](../../../AGENTS.md).
2. [Development Grammar & Spec Governance](../../README.md).
3. [`docs/product/agent-forum-product-direction-v1.md`](../../../docs/product/agent-forum-product-direction-v1.md) when product boundaries are relevant.
4. [`docs/specs/`](../../../docs/specs/) and every potentially governing Spec.
5. The exact base and head commits in scope.
6. Current code, schema, tests, configuration, deployment files, and runtime evidence needed to establish State and Observations.

Do not use chat history, a PR description, or an agent report as the sole source of truth when repository or runtime evidence is available.

## Resolve the mode

Choose exactly one primary mode before editing:

- `PREFLIGHT`: determine whether the change is mechanical and whether the correct disposition is REUSE, AMEND, SUPERSEDE, or NEW.
- `AUTHOR`: investigate and write a proposed Spec or proposed amendment/superseding Spec.
- `REVIEW`: independently decide whether a proposed Spec is ready to become accepted.
- `COMPLIANCE`: map an implementation to an accepted Spec and decide whether conformance is VERIFIED, PARTIAL, or DRIFTED.

A single agent must not use `AUTHOR` and then declare its own work accepted under `REVIEW`.

## Establish exact repository state

Before semantic work:

1. Fetch the live base ref.
2. Record the exact base commit and exact head commit.
3. Check whether the base moved since earlier analysis.
4. Inspect the changed paths and enough surrounding code to understand authority and behavior.
5. Mark every material factual statement as `VERIFIED`, `INFERRED`, or `UNVERIFIED`.

If the base moved, reconcile the Spec or review against the new base before continuing. Do not rely on stale audit findings without rechecking the affected paths.

## PREFLIGHT mode

### 1. Decide whether a Spec is required

A Spec is required when the work changes any of the following:

```text
observable behavior
API or protocol obligations
authentication or authorization
security or trust semantics
schema, persistence, or migration
compatibility promises
architecture or ownership boundaries
cross-file or cross-service conventions
testing policy
deployment or repository process
durable rationale future maintainers may revisit
```

A change is mechanical only when none of those change. Small size is not sufficient.

For a mechanical exemption, require:

```text
SPEC_REQUIRED = NO
MECHANICAL_REASON = <specific reason>
```

### 2. Search for governing authority

Search product docs and all active Specs by:

- product concept;
- affected API, schema, route, service, or capability;
- Contract IDs;
- rejected alternatives;
- supersession links.

Do not create a duplicate Spec merely because the existing title differs.

### 3. Classify the disposition

Choose exactly one:

```text
REUSE
AMEND
SUPERSEDE
NEW
```

Use:

- `REUSE` when an accepted Spec already covers the full change.
- `AMEND` when the same Goal, authority, and core Decision remain, but Contracts or wording need correction or completion.
- `SUPERSEDE` when the core Decision, product meaning, compatibility promise, or authority changes.
- `NEW` when the work introduces an independent Goal or Contract set.

Do not disguise a supersession as an amendment to avoid creating a new authority record.

### 4. Check the implementation gate

For implementation work, verify that the governing Spec:

- has `status: accepted`;
- exists in the implementation PR's base branch;
- is not superseded for the relevant scope;
- contains the Contracts the implementation claims to satisfy.

If any condition fails:

```text
IMPLEMENTATION_ALLOWED = NO
```

Do not start or expand implementation.

### PREFLIGHT output

```text
SPEC_PREFLIGHT = PASS | BLOCKED
SPEC_REQUIRED = YES | NO
DISPOSITION = REUSE | AMEND | SUPERSEDE | NEW | MECHANICAL
GOVERNING_SPEC = <spec_id or NONE>
GOVERNING_SPEC_STATUS_IN_BASE = accepted | proposed | superseded | missing
PRODUCT_BOUNDARY_CONFLICT = NONE | <description>
EVIDENCE_GAPS = NONE | <items>
IMPLEMENTATION_ALLOWED = YES | NO
NEXT_ACTION = <one concrete action>
```

## AUTHOR mode

`AUTHOR` is Spec-only work unless the user explicitly scopes a separate repository-governance bootstrap. Do not modify product code, schema, migrations, deployment, or tests while authoring a governing product or architecture Spec.

### 1. Build the reasoning chain

Write the Spec in this order:

```text
Goal
Current State
Observations
Claims / Assumptions
Decision
Contracts
Acceptance
Alternatives
```

Do not start with an implementation plan and backfill rationale afterward.

### 2. Separate the primitives

Apply these tests:

- `State`: Is this merely what the system is at the fixed commit?
- `Observation`: Was this directly read, reproduced, measured, or observed?
- `Claim`: Is this an interpretation that evidence could weaken?
- `Decision`: Is this the selected direction among alternatives?
- `Contract`: Is this an obligation the implementation must satisfy?

Move sentences to the correct section when they mix types.

### 3. Record provenance

Each load-bearing Observation must identify the best available provenance:

```text
commit
path and symbol or line range
test command and result
request and response
query result
runtime log or deployment evidence
external source and scope
```

Never upgrade an inference into a verified fact because it makes the Spec easier to write.

### 4. Link evidence to claims

For important Claims, state which Observations:

```text
SUPPORT
CONTRADICT
DO NOT DISCRIMINATE
```

Use LOW/MEDIUM/HIGH for reliability, directness, scope match, or discriminative power only when those distinctions affect the Decision. Avoid fake numeric confidence.

### 5. Freeze decisions before contracts

The `Decision` section must resolve product and architecture choices that would otherwise be left to the Implementation Agent.

A proposed Spec is not ready for acceptance if implementation still has to choose among materially different:

- identities;
- permission models;
- lifecycle semantics;
- failure behavior;
- migration strategies;
- compatibility promises;
- ownership boundaries;
- externally visible response fields or operations.

### 6. Write complete Contracts

Every Contract has a stable unique ID:

```text
CTR-<DOMAIN>-<NNN>
```

Cover the relevant dimensions rather than forcing empty headings:

```text
normal behavior
authorization and ownership
security and trust
invalid input and denial paths
lifecycle and state transitions
transactionality and idempotency
persistence and migration
compatibility and rollout
operational failure
performance or resource bounds
```

A Contract names observable obligations, not file names or preferred class structure unless the structure itself is the architecture decision.

### 7. Write discriminating Acceptance

Each acceptance item must cite the Contract IDs it verifies:

```text
AC-001 verifies CTR-REVIEW-001, CTR-REVIEW-002
```

Prefer Given/When/Then when it improves precision. Include negative cases and bypass paths. “Tests pass,” “endpoint works,” or “code matches the design” are not acceptance criteria.

### 8. Record real alternatives

For every important alternative actually considered, include:

```text
Rejected because:
...

Reopen when:
...
```

Do not invent alternatives for formatting compliance. Do not omit a tempting rejected design merely because it is not in the final architecture.

### 9. Control unresolved questions

A proposed Spec may carry explicit blockers. Before acceptance, reject any unresolved item that affects product behavior, permissions, data meaning, compatibility, or migration.

Accepted Specs must not contain implementation-defining:

```text
TBD
TODO
choose during implementation
one of A/B/C
future team decides
```

Non-blocking follow-up work must be clearly outside the accepted Contract scope.

### 10. Control implementation detail

Allow domain-specific sections for schema, wire format, migration, threat model, or rollout when the detail is required to remove ambiguity.

Do not turn the Spec into a per-file task list. File paths and current symbols belong in Current State or Implementation Sequencing unless they are themselves normative architecture.

### AUTHOR output

```text
SPEC_AUTHORING = COMPLETE | BLOCKED
SPEC_ID = ...
STATUS = proposed
DISPOSITION = AMEND | SUPERSEDE | NEW
BASE_COMMIT = ...
VERIFIED_OBSERVATIONS = <count>
INFERRED_CLAIMS = <count>
UNVERIFIED_ASSUMPTIONS = <count>
CONTRACTS = <count>
ACCEPTANCE_ITEMS = <count>
BLOCKING_QUESTIONS = NONE | <items>
READY_FOR_INDEPENDENT_REVIEW = YES | NO
```

## Syntax pass

Run an existing deterministic Spec verifier when the repository provides one. Until that gate exists, perform this equivalent manual pass and report that it was manual.

Check:

1. The file is under `docs/specs/<SPEC_ID>.md`.
2. Frontmatter contains `spec_id`, `status`, `scope`, and `supersedes`.
3. `status` is exactly `proposed`, `accepted`, or `superseded`.
4. `superseded` Specs contain `superseded_by`.
5. `spec_id` is unique across `docs/specs/`.
6. All required sections from `.agents/README.md` exist.
7. Every Contract ID is unique and matches `CTR-<DOMAIN>-<NNN>`.
8. Every Acceptance item references existing Contract IDs.
9. Supersession targets exist and links are mutually consistent.
10. Accepted Specs contain no blocking TBD/TODO or unresolved product choice.
11. Relative Markdown links resolve.
12. The Spec path does not encode lifecycle.

Report:

```text
SPEC_SYNTAX = PASS | FAIL
DETERMINISTIC_GATE = PASS | FAIL | NOT_YET_IMPLEMENTED
MANUAL_SYNTAX_CHECK = PASS | FAIL | NOT_RUN
```

A syntax pass never establishes semantic readiness.

## REVIEW mode

Review the exact proposed Spec commit against the exact live base. Do not edit the Spec while acting as the independent Reviewer unless the user explicitly switches the task from review to authoring.

### Semantic review

Check:

1. **Goal quality** — a user or system outcome, not an implementation list.
2. **Current-state accuracy** — fixed commit, no desired-state fiction.
3. **Type separation** — State, Observation, Claim, Decision, and Contract are not conflated.
4. **Evidence quality** — provenance exists; external or mock evidence is not overstated.
5. **Decision completeness** — implementation is not left to choose product semantics.
6. **Contract coverage** — normal, negative, authorization, lifecycle, failure, transaction, migration, and compatibility paths are covered where relevant.
7. **Acceptance strength** — each scenario would fail on the intended regression and cites Contracts.
8. **Authority alignment** — no silent conflict with product direction or accepted Specs.
9. **Disposition correctness** — REUSE/AMEND/SUPERSEDE/NEW was classified honestly.
10. **Alternatives** — real rejected options and reopen conditions are preserved.
11. **Scope discipline** — Non-goals block unrelated architecture or feature growth.
12. **Independent implementability** — a team without chat history can implement the Spec.
13. **Migration safety** — historical data and rollout uncertainty are acknowledged rather than assumed away.
14. **Verification feasibility** — required evidence can be produced through real entry paths.

Do not approve merely because the document is detailed, well formatted, or agrees with the existing code.

### REVIEW output

```text
SPEC_REVIEW = ACCEPT | REVISE
SPEC_ID = ...
SYNTAX = PASS | FAIL
PRODUCT_DECISION_REQUIRED = NONE | <items>
BLOCKERS = NONE | <items>
NON_BLOCKING_IMPROVEMENTS = NONE | <items>
EVIDENCE_GAPS = NONE | <items>
CONFLICTS_WITH_EXISTING_AUTHORITY = NONE | <items>
READY_TO_MARK_ACCEPTED = YES | NO
IMPLEMENTATION_ALLOWED_NOW = NO
```

`IMPLEMENTATION_ALLOWED_NOW` remains `NO` until the accepted Spec is merged into the implementation branch's base.

## Accepting a Spec

Acceptance is a repository governance action, not an author assertion.

After an independent `SPEC_REVIEW = ACCEPT` and explicit Owner or authorized Reviewer approval:

1. Change `status: proposed` to `status: accepted`.
2. Resolve every blocking question.
3. Re-run syntax and semantic checks.
4. Merge the Spec-only PR.
5. Verify the accepted Spec exists in the new `main` commit.
6. Create the implementation branch from that updated base.

Do not implement from the pre-merge Spec branch.

## COMPLIANCE mode

Compliance review starts from the accepted Spec in the implementation PR's base, not from a possibly edited copy in the head.

### 1. Verify authority

Confirm:

```text
spec_id
status in base = accepted
not superseded for this scope
exact Contract set
```

If the Implementation PR changes the governing Decision or Contracts, classify it as blocked and require a separate amendment or superseding Spec.

### 2. Build the contract map

For every Contract:

```text
Contract ID
→ implementation paths and behavior
→ focused tests
→ real-entry or runtime evidence
→ result
```

Use one of:

```text
VERIFIED
PARTIAL
VIOLATED
NOT_TESTED
NOT_APPLICABLE_WITH_JUSTIFICATION
```

### 3. Test bypasses and alternate callers

Trace the operation that enforces each denial or lifecycle rule. Exercise direct and alternate paths that could bypass:

- route middleware;
- helper APIs;
- direct data-access calls;
- nested routers;
- retries;
- stale identities;
- cross-object identifiers;
- deleted or archived state;
- partial transaction failure.

### 4. Judge evidence strength

Prefer evidence through the shipped entry path and real persistence or authentication dependencies when the Contract depends on them. Mock-only tests may support a unit Contract but do not prove deployment, migration, identity, or cross-service behavior.

Record the exact commands run and the commit tested. Do not claim evidence from a test that was not executed.

### 5. Detect scope expansion

Flag:

- new product behavior not authorized by a Contract;
- speculative abstractions;
- compatibility paths not requested by the Spec;
- rejected alternatives reintroduced under a new name;
- README or Skill claims that exceed shipped behavior;
- implementation choices that silently alter product authority.

### 6. Handle drift

When code and accepted Spec conflict:

- do not rewrite the Spec during compliance review;
- identify the violated Contract;
- classify whether the implementation is wrong or the Spec requires a separate amendment;
- block merge until the authority chain is repaired.

### COMPLIANCE output

```text
SPEC_COMPLIANCE = PASS | FAIL
SPEC_ID = ...
SPEC_STATUS_IN_BASE = accepted | missing | wrong_status | superseded
CONFORMANCE = VERIFIED | PARTIAL | DRIFTED
VERIFIED_CONTRACTS = ...
PARTIAL_CONTRACTS = ...
VIOLATED_CONTRACTS = ...
UNTESTED_CONTRACTS = ...
SCOPE_EXPANSION = NONE | <items>
REJECTED_ALTERNATIVE_REINTRODUCED = NO | <items>
REAL_ENTRY_EVIDENCE = YES | PARTIAL | NO
IMPLEMENTATION_READY_TO_MERGE = YES | NO
```

## Required discipline

Never:

- invent repository or runtime evidence;
- treat an agent's narrative as proof when primary evidence is available;
- mark your own authored Spec accepted;
- start implementation from a proposed Spec;
- create and implement a governing Spec in the same PR;
- silently rewrite accepted Contracts to match code;
- call a change mechanical merely because it is small;
- treat green tests as complete conformance;
- let an Implementation Agent choose unresolved product semantics;
- add a large policy engine, workflow system, scheduler, runtime, or compatibility layer unless an accepted Contract requires it.

Prefer one substantiated blocker over many speculative suggestions. Preserve uncertainty explicitly when evidence is incomplete.
