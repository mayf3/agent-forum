# AGENTS.md

Agent Forum uses a spec-first development workflow for every non-mechanical change.

```text
ENFORCEMENT_STATUS = MANUAL_POLICY
```

The deterministic Spec verifier, automatic base-branch gate, and required branch protection do not yet exist. Follow the policy manually and never describe it as technically enforced.

Before changing behavior, architecture, persistence, authentication, authorization, protocols, deployment, testing policy, or repository process:

1. Read [`.agents/README.md`](.agents/README.md).
2. Read the named Product Direction under `docs/product/`; it is higher-level authority.
3. Find the governing Spec under `docs/specs/` and verify that an accepted revision with valid Review Binding already exists in the implementation branch's base.
4. Resolve any external governing dependency at an immutable revision without claiming authority over its repository.
5. Use [`.agents/skills/spec-governance/SKILL.md`](.agents/skills/spec-governance/SKILL.md) for PREFLIGHT, AUTHOR, REVIEW, or COMPLIANCE work.
6. Read current code and tests as implementation material, Observations, and Evidence; do not treat them as a substitute for governing authority.

Standing rules:

- Product Direction is the named higher-level authority. Lower-level Specs may refine it but may not supersede, weaken, reinterpret, or bypass it.
- V0 permits only complete local Spec-to-Spec supersession. Partial supersession is forbidden until an explicit machine-readable per-authority/per-Contract model exists.
- External governing dependencies may be referenced, but only their owner repository may govern, amend, accept, reject, or supersede them.
- An accepted Spec expresses intended behavior. Current State is a versioned projection backed by Observations and Claims. Code expresses current implementation material. A conflict is conformance drift and must be reported explicitly.
- Accepted Decision and Contract meaning may not change under the same stable ID. Post-acceptance AMEND is editorial-only or strictly additive; normative meaning changes require complete SUPERSEDE. Contract IDs are never repurposed.
- Every REVIEW binds exact base commit, reviewed Spec commit, reviewer identity, and final accepted head. Semantic change invalidates the review; the final accepted head requires independent recheck.
- Conformance is qualified by Spec revision, implementation commit, environment, evaluation time, and evidence. `VERIFIED` is never an unqualified permanent Spec property.
- Do not create a governing Spec and implement it in the same pull request.
- If implementation reveals a Spec defect or unresolved product choice, stop expanding implementation scope and amend additively or supersede completely before continuing.
- Purely mechanical or local edits may be exempt, but the pull request must state why no behavior, Contract, authority, architecture, process, or durable rationale changes.
