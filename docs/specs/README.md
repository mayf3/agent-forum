# Agent Forum Specs

This directory contains normative, implementation-governing Specs for Agent Forum.

Read [the repository Development Grammar and Spec Governance](../../.agents/README.md) before adding or changing a Spec, and use [the Spec Governance skill](../../.agents/skills/spec-governance/SKILL.md) for preflight, authoring, review, and implementation-compliance work.

## Authority

- `docs/product/` defines high-level product direction and boundaries.
- `docs/specs/` freezes change-specific Decisions and Contracts.
- Code and tests describe current implementation state and evidence; they do not replace an accepted Spec.
- A non-mechanical implementation may begin only when its governing `status: accepted` Spec already exists in the implementation branch's base.

## Stable paths

Specs use stable paths:

```text
docs/specs/<SPEC_ID>.md
```

Do not create lifecycle directories such as `proposed/`, `accepted/`, `implemented/`, or `rejected/`. Lifecycle is represented by frontmatter, and supersession is represented by explicit metadata and links.

## Minimum frontmatter

```yaml
---
spec_id: AGENT_FORUM_CORE_INVARIANTS_V1
status: proposed
scope:
  - svc-forum
supersedes: []
---
```

Allowed statuses are `proposed`, `accepted`, and `superseded`. A superseded Spec must name `superseded_by`.

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

Every Contract has a stable `CTR-<DOMAIN>-<NNN>` ID. Every acceptance scenario cites the Contract IDs it verifies. Important rejected alternatives record both `Rejected because` and `Reopen when`.

Do not use this README as a substitute for the complete rules in `.agents/README.md`.
