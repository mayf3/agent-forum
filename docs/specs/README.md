# Agent Forum Specs

This directory contains normative, implementation-governing Specs for Agent Forum.

Read [the repository Development Grammar and Spec Governance](../../.agents/README.md) before adding or changing a Spec, and use [the Spec Governance skill](../../.agents/skills/spec-governance/SKILL.md) for PREFLIGHT, AUTHOR, REVIEW, and COMPLIANCE work.

```text
ENFORCEMENT_STATUS = MANUAL_POLICY
DETERMINISTIC_SPEC_VERIFIER = NOT_IMPLEMENTED
BASE_BRANCH_SPEC_GATE = NOT_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
```

These rules are normative but are not yet automatically enforced by repository gates.

## Authority

- `docs/product/` contains the named higher-level Product Direction authority.
- `docs/specs/` contains lower-level Specs that refine Product Direction into Decisions and Contracts.
- A lower-level Spec may refine Product Direction but may not supersede, weaken, reinterpret, or bypass it.
- Code and tests describe implementation material, Observations, and Evidence; they do not replace Product Direction or an accepted Spec.
- A non-mechanical implementation may begin only when its governing accepted Spec revision, with valid Review Binding, already exists in the implementation branch's base.

V0 allows only complete local Spec-to-Spec supersession. Partial supersession is forbidden unless a later governance revision introduces an explicit machine-readable per-authority/per-Contract model.

External governing dependencies may be referenced by repository, stable authority ID, and immutable revision. This repository may not amend, accept, reject, govern, or supersede authority owned by another repository.

## Stable paths

Specs use stable paths:

```text
docs/specs/<SPEC_ID>.md
```

Do not create lifecycle directories such as `proposed/`, `accepted/`, `implemented/`, or `rejected/`. Lifecycle is represented by frontmatter, and complete supersession is represented by explicit metadata and links.

## Minimum frontmatter

```yaml
---
spec_id: AGENT_FORUM_CORE_INVARIANTS_V1
status: proposed
scope:
  - svc-forum
supersedes: []
external_authorities: []
---
```

Allowed statuses are `proposed`, `accepted`, and `superseded`. A superseded Spec must name `superseded_by`.

`supersedes` and `superseded_by` apply only to complete supersession between local, same-level Specs. They may not target Product Direction or an external repository.

An external dependency uses an immutable reference, for example:

```yaml
external_authorities:
  - repository: mayf3/auth-service
    authority_id: AUTH_SERVICE_EXAMPLE_V1
    revision: <immutable commit>
```

## Accepted-Spec immutability

Once a Spec revision is accepted:

- existing Decision and Contract meaning may not change under the same stable ID;
- post-acceptance AMEND is editorial-only or strictly additive;
- strictly additive content uses new stable IDs and may not reinterpret existing obligations;
- any normative meaning change requires a complete superseding Spec with a new `spec_id`;
- V0 does not permit partial supersession;
- Contract IDs and numbered Decision IDs are never repurposed, including after supersession.

Every post-acceptance amendment requires a new exact revision review and valid final-head Review Binding.

## Review Binding

Every independent REVIEW records:

```text
REVIEW_BASE_COMMIT
REVIEWED_SPEC_COMMIT
REVIEWER_IDENTITY
REVIEWED_AT
SPEC_REVIEW
```

Any semantic change after review invalidates that result. Before acceptance, the exact final head must be independently rechecked and the PR record must include:

```text
FINAL_ACCEPTED_HEAD
FINAL_RECHECK_REVIEWER_IDENTITY
FINAL_RECHECKED_AT
SEMANTIC_CHANGE_SINCE_ACCEPTED_REVIEW
FINAL_RECHECK_RESULT
REVIEW_BINDING
```

The final rechecker must be independent of the Spec Author. V0 stores this manual binding in the GitHub PR review/conversation rather than inside the self-referential commit.

## Minimum sections

```text
Goal
Current state
Observations
Claims and assumptions
Decision
Contracts
Acceptance
Alternatives considered
Non-goals
Risks and unresolved questions
Implementation sequencing
```

Current State is a versioned projection backed by Observations and explicit Claims; it is not an unsourced factual authority. Claims use `SUPPORTED`, `INFERRED`, or `UNVERIFIED`, never `VERIFIED CLAIM`.

Every Contract has a stable `CTR-<DOMAIN>-<NNN>` ID. Every acceptance scenario cites the Contract IDs it verifies. Important rejected alternatives record both `Rejected because` and `Reopen when`.

## Qualified conformance

Conformance is recorded over:

```text
spec revision commit
implementation commit
environment
evaluation time
evidence references
```

`VERIFIED` is valid only inside that qualified relation. It is never a permanent, unqualified property of a Spec or system.

Do not use this README as a substitute for the complete rules in `.agents/README.md`.
