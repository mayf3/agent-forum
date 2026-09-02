# Agent Forum repository-local governance

This file is owned by `mayf3/agent-forum`. It is not part of the vendored distribution and is not overwritten by governance updates.

## Repository identity

```text
REPOSITORY = mayf3/agent-forum
AUTHORITY_BRANCH = main
GOVERNANCE_LOCK = .agents/governance.lock.json
GOVERNANCE_ADOPTION_SPEC = the adoption Spec with status `accepted` in docs/specs/README.md within the current tree; a proposed successor in the same index is review material, not active repository authority
```

The source distribution supplies shared grammar, protocol, schemas, templates, and a workflow Skill. It does not own Agent Forum product meaning, Specs, acceptance actions, code, or runtime decisions.

## Local authority registry

When the governance adoption is accepted and merged, the existing Product Direction is registered as:

```text
AUTHORITY_ID = AGENT_FORUM_PRODUCT_DIRECTION_V1
STATUS = accepted
AUTHORITY_KIND = product_direction
OWNING_REPOSITORY = mayf3/agent-forum
PATH = docs/product/agent-forum-product-direction-v1.md
```

At adoption time:

```text
ACCEPTED_ARCHITECTURE_AUTHORITIES = NONE
ACCEPTED_LONG_LIVED_INVARIANT_AUTHORITIES = NONE
```

`.arch-grandfather.yml`, source code, tests, CI documents, operational records, and runtime behavior are descriptive material. They are not Product Direction or accepted governing Specs.

## Authority precedence

```text
AGENT_FORUM_PRODUCT_DIRECTION_V1
> accepted local Architecture / long-lived Invariant authorities
> accepted local governing Specs
> code, tests, runtime, and operational records
```

Lower-level authorities may refine higher-level authorities. They may not silently override, weaken, reinterpret, bypass, or supersede them.

The vendored governance protocol permits only whole-authority local Spec supersession. Partial or per-Contract supersession is forbidden until a later accepted governance revision introduces an explicit machine-readable authority graph.

External authorities are reference-only and must be identified by owning repository, stable authority ID, exact revision, and relationship. Agent Forum may not accept, amend, reject, govern, or supersede authority owned by another repository.

## Acceptance and review actors

```text
GOVERNANCE_ADOPTION_ACCEPTANCE_ACTOR = mayf3
SPEC_ACCEPTANCE_ACTORS = mayf3 or a maintainer explicitly delegated in a persistent PR record
MECHANICAL_EXEMPTION_REVIEWERS = an actor independent of the change author
EMERGENCY_AUTHORIZATION_ACTORS = mayf3 or an explicitly delegated incident actor
```

The semantic Reviewer must be independent of the exact authoring act. A review recommendation is not acceptance. Final-head recheck and acceptance binding follow the vendored protocol.

## Governing and persistence locations

```text
PRODUCT_DIRECTION = docs/product/agent-forum-product-direction-v1.md
ARCHITECTURE_AUTHORITIES = NONE at adoption; future accepted paths must be indexed here
SPECS = docs/specs/
SPEC_REVIEWS_AND_ACCEPTANCE = persistent GitHub PR review/conversation records
INVESTIGATIONS = GitHub Issues or investigation PRs with stable INV-* identity
CONFORMANCE_REPORTS = implementation PR records; repository reports when evidence spans environments
INCIDENTS = stable GitHub Issue or equivalent incident reference
```

Important rejected, no-change, reuse, and deferred investigations must not exist only in chat.

## Enforcement truth

```text
GOVERNANCE_ADOPTION_STATUS = read from .agents/governance.lock.json
ENFORCEMENT_LEVEL = MANUAL_POLICY
DISTRIBUTION_INTEGRITY_CHECK = AVAILABLE
SPEC_FRONTMATTER_SCHEMA = AVAILABLE
FULL_SPEC_SYNTAX_GATE = NOT_IMPLEMENTED
BASE_BRANCH_GATE = NOT_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
SEMANTIC_REVIEW = independent human/Agent judgment, not CI
```

The presence of instructions, templates, schemas, or nested workflow files must not be described as an unbypassable GitHub merge gate.

## Local extensions

- Adoption is forward-only. Do not bulk-rewrite historical documents.
- Reconcile historical material only when it becomes governing, is cited by new work, or conflicts with an active authority.
- A governing Spec and the product implementation it authorizes must remain in separate PRs.
- A Program Spec normally has `implementation_authority: none`; child implementation requires its own accepted Contract authority.
- Emergency action is limited to rollback, disablement, shutdown, credential revocation, isolation, or containment. Durable repair follows the normal Spec-first process.
- The pinned distribution version and source commit are recorded in `.agents/governance.lock.json` together with the adoption status derived from it. Upstream movement has no local effect until a separate docs-only update is reviewed, accepted, and merged.
