---
name: spec-governance
description: Use in mayf3/agent-forum when planning any non-mechanical change, resolving governing authority, deciding whether an existing Spec governs the work, authoring or additively amending a Spec, independently reviewing an exact Spec commit, or checking an implementation against accepted Contracts. Covers REUSE/AMEND/SUPERSEDE/NEW preflight, Spec syntax, review binding, and qualified contract-to-evidence conformance.
---

# Governing Agent Forum Specs

Use this workflow for exactly four primary modes:

```text
PREFLIGHT
AUTHOR
REVIEW
COMPLIANCE
```

The source of truth is [`.agents/README.md`](../../README.md). This skill applies that document; it does not redefine it.

```text
ENFORCEMENT_STATUS = MANUAL_POLICY
DETERMINISTIC_SPEC_VERIFIER = NOT_IMPLEMENTED
BASE_BRANCH_SPEC_GATE = NOT_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
```

Outputs from this Skill are governance judgments. They are not proof that GitHub technically blocks a violating merge.

## Sources of truth and authority

Read, in order:

1. Root [`AGENTS.md`](../../../AGENTS.md).
2. [Development Grammar & Spec Governance](../../README.md).
3. The named Product Direction under [`docs/product/`](../../../docs/product/).
4. [`docs/specs/`](../../../docs/specs/) and every potentially governing local Spec.
5. Every declared external governing dependency at its immutable repository revision.
6. The exact base and head commits in scope.
7. Current code, schema, tests, configuration, deployment files, and runtime evidence needed to establish Observations and a Current State projection.

Within this repository:

```text
Product Direction
> accepted lower-level Specs
> implementation state
```

A lower-level Spec may refine Product Direction but may not supersede, weaken, reinterpret, or bypass it.

External governing dependencies remain owned by their source repositories. Agent Forum may reference them, align to them, or report conflicts; it may not amend, accept, reject, or supersede them.

Do not use chat history, a PR description, or an agent report as the sole source of truth when repository or runtime evidence is available.

## Resolve the mode

Choose exactly one primary mode before editing:

- `PREFLIGHT`: determine authority, whether the change is mechanical, and whether the correct disposition is REUSE, AMEND, SUPERSEDE, or NEW.
- `AUTHOR`: investigate and write a proposed Spec, an editorial/strictly-additive amendment, or a complete superseding Spec.
- `REVIEW`: independently decide whether an exact proposed Spec commit is ready to become accepted and bind that judgment to exact commits and reviewer identity.
- `COMPLIANCE`: map an implementation commit to an accepted Spec revision and produce qualified conformance for a named environment, evaluation time, and evidence set.

A single agent must not use `AUTHOR` and then declare its own work accepted under `REVIEW`.

## Establish exact repository state

Before semantic work:

1. Fetch the live base ref.
2. Record the exact base commit and exact head commit.
3. Check whether the base moved since earlier analysis.
4. Inspect the changed paths and enough surrounding code to understand authority and behavior.
5. Build load-bearing Observations with provenance.
6. Build the Current State as a versioned projection over those Observations and explicit Claims.
7. Label Claims as `SUPPORTED`, `INFERRED`, or `UNVERIFIED`; never use `VERIFIED CLAIM`.

If the base moved, reconcile the Spec or review against the new base before continuing. Do not rely on stale audit findings without rechecking affected paths.

Current State is not an unsourced factual authority. Every material State statement must point to supporting Observation provenance or be marked as a Claim/assumption.

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

### 2. Resolve governing authority

Search by:

- Product Direction concepts and boundaries;
- affected API, schema, route, service, or capability;
- local Spec IDs and Contract IDs;
- external governing dependencies;
- rejected alternatives;
- full supersession links.

Report the authority chain explicitly.

Reject the preflight when:

- a lower-level Spec conflicts with Product Direction;
- a local Spec claims to supersede Product Direction;
- a local Spec claims to govern or supersede another repository;
- an external dependency is referenced without an immutable revision;
- a purported supersession is only partial or scoped by prose.

V0 permits only complete local Spec-to-Spec supersession. Partial supersession is forbidden until a separate governance change introduces an explicit machine-readable per-authority/per-Contract model.

### 3. Classify the disposition

Choose exactly one:

```text
REUSE
AMEND
SUPERSEDE
NEW
```

Use:

- `REUSE` when an accepted Spec revision already covers the full change.
- `AMEND` for a proposed Spec, or after acceptance only for editorial-only or strictly additive changes using new IDs without changing any existing normative meaning.
- `SUPERSEDE` when any accepted Decision, Contract, compatibility promise, authority, boundary, exception, or product meaning changes. Supersession must be complete in V0.
- `NEW` when the work introduces an independent Goal or Contract set and does not change existing authority meaning.

Do not disguise a normative change as AMEND. Do not create a duplicate Spec merely because the existing title differs.

### 4. Enforce accepted-Spec immutability

For an accepted Spec, ask:

```text
Does this change narrow, broaden, contradict, deprecate,
replace, reinterpret, or add an exception to existing meaning?
```

If yes:

```text
DISPOSITION = SUPERSEDE
```

Editorial-only clarification is allowed only when normative meaning is unchanged. Strictly additive changes must use new Decision/Contract IDs and must not alter the interpretation or obligations of any existing ID.

Contract IDs and numbered Decision IDs are permanent. Never repurpose an old ID, including after deletion or supersession.

### 5. Check the implementation rule

For implementation work, verify that the governing Spec revision:

- has `status: accepted`;
- exists in the implementation PR's base branch;
- is not completely superseded;
- contains the Contracts the implementation claims to satisfy;
- has valid Review Binding for its final accepted head.

If any condition fails:

```text
IMPLEMENTATION_ALLOWED = NO
```

Do not start or expand implementation.

Because enforcement is manual, this output does not imply an automatic repository gate exists.

### PREFLIGHT output

```text
SPEC_PREFLIGHT = PASS | BLOCKED
ENFORCEMENT_STATUS = MANUAL_POLICY
SPEC_REQUIRED = YES | NO
DISPOSITION = REUSE | AMEND | SUPERSEDE | NEW | MECHANICAL
PRODUCT_DIRECTION_AUTHORITY = <path and revision>
GOVERNING_SPEC = <spec_id or NONE>
GOVERNING_SPEC_REVISION = <commit or NONE>
GOVERNING_SPEC_STATUS_IN_BASE = accepted | proposed | superseded | missing
EXTERNAL_AUTHORITIES = NONE | <repository / authority_id / revision>
AUTHORITY_CONFLICT = NONE | <description>
PARTIAL_SUPERSESSION_ATTEMPT = NO | YES
REVIEW_BINDING_IN_BASE = VALID | INVALID | MISSING | NOT_APPLICABLE
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
Current State projection
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

- `State`: Is this a versioned projection of the system at a fixed commit/environment/time, backed by Observations and explicit Claims?
- `Observation`: Was this directly read, reproduced, measured, or observed with provenance?
- `Claim`: Is this an interpretation that evidence could weaken?
- `Decision`: Is this the selected direction among alternatives?
- `Contract`: Is this an obligation the implementation must satisfy?

Move sentences to the correct section when they mix types.

Never label a Claim `VERIFIED`. Use:

```text
SUPPORTED CLAIM
INFERRED CLAIM
UNVERIFIED ASSUMPTION
```

### 3. Record provenance

Each load-bearing Observation must identify the best available provenance:

```text
commit
path and symbol or line range
test command and result
request and response
query result
runtime log, environment, and observation time
external source and scope
```

Never upgrade an inference into an Observation because it makes the Spec easier to write.

### 4. Link evidence to claims

For important Claims, state which Observations:

```text
SUPPORT
CONTRADICT
DO NOT DISCRIMINATE
```

Use LOW/MEDIUM/HIGH for reliability, directness, scope match, or discriminative power only when those distinctions affect the Decision. Avoid fake numeric confidence.

### 5. Align authority before Decisions

Before freezing Decisions:

1. Identify the named Product Direction authority.
2. Show how the proposed Spec refines it.
3. List accepted local Specs that constrain the Decision.
4. List external authorities by repository, authority ID, and immutable revision.
5. Block any conflict instead of selecting a local override.

A lower-level Spec cannot supersede Product Direction. A local Spec cannot govern another repository.

### 6. Freeze decisions before contracts

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

### 7. Write complete Contracts

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

A Contract names observable obligations, not file names or preferred class structure unless the structure itself is the architecture Decision.

Once accepted, a Contract ID is permanently bound to its meaning. A complete superseding Spec uses new Contract IDs. Old IDs remain historical and may not be reassigned.

### 8. Write discriminating Acceptance

Each acceptance item must cite the Contract IDs it verifies:

```text
AC-001 verifies CTR-REVIEW-001, CTR-REVIEW-002
```

Prefer Given/When/Then when it improves precision. Include negative cases and bypass paths. “Tests pass,” “endpoint works,” or “code matches the design” are not acceptance criteria.

### 9. Record real alternatives

For every important alternative actually considered, include:

```text
Rejected because:
...

Reopen when:
...
```

Do not invent alternatives for formatting compliance. Do not omit a tempting rejected design merely because it is not in the final architecture.

### 10. Control unresolved questions

A proposed Spec may carry explicit blockers. Before acceptance, reject any unresolved item that affects product behavior, permissions, data meaning, compatibility, migration, or authority precedence.

Accepted Specs must not contain implementation-defining:

```text
TBD
TODO
choose during implementation
one of A/B/C
future team decides
```

Non-blocking follow-up work must be clearly outside the accepted Contract scope.

### 11. Classify amendment correctly

For a post-acceptance AMEND, explicitly output:

```text
AMENDMENT_KIND = EDITORIAL_ONLY | STRICTLY_ADDITIVE
EXISTING_DECISION_MEANING_CHANGED = NO
EXISTING_CONTRACT_MEANING_CHANGED = NO
EXISTING_ID_REPURPOSED = NO
```

If any answer is `YES`, stop AUTHOR mode and reclassify as complete `SUPERSEDE`.

### 12. Control implementation detail

Allow domain-specific sections for schema, wire format, migration, threat model, or rollout when the detail is required to remove ambiguity.

Do not turn the Spec into a per-file task list. File paths and current symbols belong in Current State or Implementation Sequencing unless they are themselves normative architecture.

### AUTHOR output

```text
SPEC_AUTHORING = COMPLETE | BLOCKED
ENFORCEMENT_STATUS = MANUAL_POLICY
SPEC_ID = ...
STATUS = proposed | accepted
DISPOSITION = AMEND | SUPERSEDE | NEW
AMENDMENT_KIND = NOT_APPLICABLE | EDITORIAL_ONLY | STRICTLY_ADDITIVE
BASE_COMMIT = ...
PRODUCT_DIRECTION_ALIGNMENT = PASS | FAIL
EXTERNAL_AUTHORITIES = NONE | <items>
PARTIAL_SUPERSESSION = NO | YES
VERIFIED_OBSERVATIONS = <count>
SUPPORTED_CLAIMS = <count>
INFERRED_CLAIMS = <count>
UNVERIFIED_ASSUMPTIONS = <count>
CONTRACTS = <count>
ACCEPTANCE_ITEMS = <count>
BLOCKING_QUESTIONS = NONE | <items>
READY_FOR_INDEPENDENT_REVIEW = YES | NO
```

## Syntax pass

Run an existing deterministic Spec verifier when the repository provides one. Until that gate exists, perform the equivalent manual pass and report that enforcement is manual.

Check:

1. The file is under `docs/specs/<SPEC_ID>.md`.
2. Frontmatter contains `spec_id`, `status`, `scope`, `supersedes`, and `external_authorities`.
3. `status` is exactly `proposed`, `accepted`, or `superseded`.
4. `superseded` Specs contain `superseded_by`.
5. `spec_id` is unique across `docs/specs/`.
6. All required sections from `.agents/README.md` exist.
7. Every Contract ID is unique, matches `CTR-<DOMAIN>-<NNN>`, and is not repurposed.
8. Every Acceptance item references existing Contract IDs.
9. Supersession targets exist, are local same-level Specs, and links are mutually consistent.
10. Supersession is complete rather than partial.
11. External authorities have repository, authority ID, and immutable revision.
12. Accepted Specs contain no blocking TBD/TODO or unresolved product choice.
13. Relative Markdown links resolve.
14. The Spec path does not encode lifecycle.

Report:

```text
SPEC_SYNTAX = PASS | FAIL
ENFORCEMENT_STATUS = MANUAL_POLICY
DETERMINISTIC_GATE = NOT_YET_IMPLEMENTED
BASE_BRANCH_GATE = NOT_YET_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
MANUAL_SYNTAX_CHECK = PASS | FAIL | NOT_RUN
```

A syntax pass never establishes semantic readiness.

## REVIEW mode

Review the exact proposed Spec commit against the exact live base. Do not edit the Spec while acting as the independent Reviewer unless the user explicitly switches the task from review to authoring.

### 1. Bind the review before reasoning

Record:

```text
REVIEW_BASE_COMMIT = <exact base sha>
REVIEWED_SPEC_COMMIT = <exact head sha>
REVIEWER_IDENTITY = <platform-bound identity, e.g. github:login>
REVIEWED_AT = <timestamp>
```

A review of “the PR,” “the latest version,” or a file path without exact commits is invalid.

The Reviewer must be independent of the Spec Author. Platform-bound identity is preferred over free-text identity.

### 2. Semantic review

Check:

1. **Authority precedence** — Product Direction is named and remains higher authority.
2. **Refinement only** — the lower-level Spec refines but does not supersede Product Direction.
3. **No partial supersession** — no chapter-, Decision-, Contract-, or prose-scoped partial replacement.
4. **External ownership** — external authority is fixed by immutable revision and remains governed by its source repository.
5. **Goal quality** — a user or system outcome, not an implementation list.
6. **Current-state support** — fixed commit/environment/time and backed by Observations/Claims rather than unsourced assertions.
7. **Type separation** — State, Observation, Claim, Decision, and Contract are not conflated.
8. **Primitive vocabulary** — Claims use SUPPORTED/INFERRED/UNVERIFIED, never VERIFIED.
9. **Evidence quality** — provenance exists; external or mock evidence is not overstated.
10. **Decision completeness** — implementation is not left to choose product semantics.
11. **Contract coverage** — normal, negative, authorization, lifecycle, failure, transaction, migration, and compatibility paths are covered where relevant.
12. **Accepted immutability** — AMEND is editorial-only or strictly additive; existing meaning and IDs remain unchanged.
13. **Acceptance strength** — each scenario would fail on the intended regression and cites Contracts.
14. **Disposition correctness** — REUSE/AMEND/SUPERSEDE/NEW was classified honestly.
15. **Alternatives** — real rejected options and reopen conditions are preserved.
16. **Scope discipline** — Non-goals block unrelated architecture or feature growth.
17. **Independent implementability** — a team without chat history can implement the Spec.
18. **Migration safety** — historical data and rollout uncertainty are acknowledged rather than assumed away.
19. **Verification feasibility** — required evidence can be produced through real entry paths and qualified conformance records.

Do not approve merely because the document is detailed, well formatted, or agrees with existing code.

### 3. Review invalidation

The review binds only `REVIEWED_SPEC_COMMIT`.

Any semantic change after review invalidates the result, including changes to:

```text
Decision
Contract
Acceptance
authority alignment
scope or exception semantics
risk disposition
migration or compatibility meaning
```

After a semantic change, run a complete new REVIEW against the new exact commit.

A status flip or other claimed mechanical change does not automatically inherit the result; it proceeds only to final accepted-head recheck.

### REVIEW output

```text
SPEC_REVIEW = ACCEPT | REVISE
ENFORCEMENT_STATUS = MANUAL_POLICY
SPEC_ID = ...
REVIEW_BASE_COMMIT = ...
REVIEWED_SPEC_COMMIT = ...
REVIEWER_IDENTITY = ...
REVIEWED_AT = ...
SYNTAX = PASS | FAIL
PRODUCT_DIRECTION_ALIGNMENT = PASS | FAIL
PARTIAL_SUPERSESSION = NO | YES
ACCEPTED_MEANING_MUTATED = NO | YES | NOT_APPLICABLE
PRODUCT_DECISION_REQUIRED = NONE | <items>
BLOCKERS = NONE | <items>
NON_BLOCKING_IMPROVEMENTS = NONE | <items>
EVIDENCE_GAPS = NONE | <items>
CONFLICTS_WITH_EXISTING_AUTHORITY = NONE | <items>
READY_TO_MARK_ACCEPTED = YES | NO
FINAL_ACCEPTED_HEAD = PENDING
REVIEW_BINDING = PENDING | INVALID
IMPLEMENTATION_ALLOWED_NOW = NO
```

`IMPLEMENTATION_ALLOWED_NOW` remains `NO` until the final accepted head is independently rechecked, the Spec-only PR is merged, and that accepted revision exists in the implementation branch's base.

## Accepting a Spec and final-head recheck

Acceptance is a repository governance action, not an author assertion.

After an independent `SPEC_REVIEW = ACCEPT` and explicit Product Owner or authorized Reviewer approval:

1. Change `status: proposed` to `status: accepted`.
2. Resolve every blocking question.
3. Do not introduce semantic changes without invalidating and rerunning REVIEW.
4. Identify the exact final PR head.
5. Independently compare `REVIEWED_SPEC_COMMIT..FINAL_ACCEPTED_HEAD`.
6. Confirm that no semantic change occurred, or invalidate the review and run REVIEW again.
7. Re-run the manual syntax pass.
8. Record the final Review Binding in the GitHub PR review/conversation.
9. Merge the Spec-only PR.
10. Verify the accepted Spec revision exists in the new `main` commit.
11. Create the implementation branch from that updated base.

Final binding record:

```text
SPEC_ID = ...
REVIEW_BASE_COMMIT = ...
REVIEWED_SPEC_COMMIT = ...
REVIEWER_IDENTITY = ...
FINAL_ACCEPTED_HEAD = ...
FINAL_RECHECK_REVIEWER_IDENTITY = ...
FINAL_RECHECKED_AT = ...
SEMANTIC_CHANGE_SINCE_ACCEPTED_REVIEW = NONE | <description>
FINAL_RECHECK_RESULT = PASS | FAIL
REVIEW_BINDING = VALID | INVALID
```

The final rechecker must be independent of the Spec Author. It may be the original independent Reviewer or another independent Reviewer.

Do not implement from the pre-merge Spec branch.

## COMPLIANCE mode

Compliance review starts from the accepted Spec revision in the implementation PR's base, not from a possibly edited copy in the head.

### 1. Verify authority

Confirm:

```text
Product Direction authority and revision
spec_id
accepted spec revision commit in base
valid Review Binding for final accepted head
not completely superseded
exact Contract set
external authorities and immutable revisions
```

If the Implementation PR changes a governing Decision or Contract, classify it as blocked and require an allowed additive AMEND or a complete superseding Spec in a separate PR.

### 2. Bind the conformance relation

Before evaluating, record:

```text
SPEC_REVISION_COMMIT = <exact accepted spec revision>
IMPLEMENTATION_COMMIT = <exact implementation head>
ENVIRONMENT = <named environment and relevant versions/config>
EVALUATED_AT = <timestamp>
EVIDENCE_REFS = <commands, logs, artifacts, runs, queries>
```

Conformance is a relation over these values. `VERIFIED` is never an unqualified or permanent property of a Spec.

### 3. Build the Contract map

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

### 4. Test bypasses and alternate callers

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

### 5. Judge evidence strength

Prefer evidence through the shipped entry path and real persistence or authentication dependencies when the Contract depends on them. Mock-only tests may support a unit Contract but do not prove deployment, migration, identity, or cross-service behavior.

Record exact commands and evidence references. Do not claim evidence from a test that was not executed.

### 6. Detect scope expansion

Flag:

- new product behavior not authorized by a Contract;
- speculative abstractions;
- compatibility paths not requested by the Spec;
- rejected alternatives reintroduced under a new name;
- README or Skill claims that exceed shipped behavior;
- implementation choices that silently alter Product Direction or governing authority.

### 7. Handle drift

When code and accepted Spec conflict:

- do not rewrite the Spec during compliance review;
- identify the violated Contract;
- preserve the accepted meaning and ID;
- classify whether implementation is wrong or a separate additive AMEND / complete SUPERSEDE is required;
- block merge until the authority chain is repaired.

### COMPLIANCE output

```text
SPEC_COMPLIANCE = PASS | FAIL
ENFORCEMENT_STATUS = MANUAL_POLICY
SPEC_ID = ...
SPEC_REVISION_COMMIT = ...
SPEC_STATUS_IN_BASE = accepted | missing | wrong_status | superseded
REVIEW_BINDING_IN_BASE = VALID | INVALID | MISSING
IMPLEMENTATION_COMMIT = ...
ENVIRONMENT = ...
EVALUATED_AT = ...
EVIDENCE_REFS = ...
CONFORMANCE = VERIFIED | PARTIAL | DRIFTED
VERIFIED_CONTRACTS = ...
PARTIAL_CONTRACTS = ...
VIOLATED_CONTRACTS = ...
UNTESTED_CONTRACTS = ...
COVERAGE_GAPS = ...
SCOPE_EXPANSION = NONE | <items>
REJECTED_ALTERNATIVE_REINTRODUCED = NO | <items>
REAL_ENTRY_EVIDENCE = YES | PARTIAL | NO
IMPLEMENTATION_READY_TO_MERGE = YES | NO
```

Never report only `CONFORMANCE = VERIFIED`. The spec revision, implementation commit, environment, evaluation time, and evidence references are mandatory qualifiers.

## Required discipline

Never:

- invent repository or runtime evidence;
- treat Current State as an unsourced factual authority;
- label a Claim VERIFIED;
- treat an agent's narrative as proof when primary evidence is available;
- let a lower-level Spec supersede Product Direction;
- claim authority over another repository;
- use partial supersession in V0;
- change accepted Decision or Contract meaning under the same stable ID;
- repurpose a Contract ID;
- mark your own authored Spec accepted;
- accept a review without exact base/head/reviewer binding;
- carry an ACCEPT result across a semantic change;
- skip independent final accepted-head recheck;
- start implementation from a proposed or unbound Spec;
- create and implement a governing Spec in the same PR;
- silently rewrite accepted Contracts to match code;
- call a change mechanical merely because it is small;
- treat green tests as complete conformance;
- call VERIFIED an unqualified permanent Spec property;
- let an Implementation Agent choose unresolved product semantics;
- claim deterministic enforcement, base-branch gate, or required branch protection exists before implementation;
- add a large policy engine, workflow system, scheduler, runtime, or compatibility layer unless an accepted Contract requires it.

Prefer one substantiated blocker over many speculative suggestions. Preserve uncertainty explicitly when evidence is incomplete.
