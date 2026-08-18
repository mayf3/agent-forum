# AGENTS.md

Agent Forum uses a spec-first development workflow for every non-mechanical change.

Before changing behavior, architecture, persistence, authentication, authorization, protocols, deployment, testing policy, or repository process:

1. Read [`.agents/README.md`](.agents/README.md).
2. Read the relevant product direction under `docs/product/`.
3. Find the governing Spec under `docs/specs/` and verify that an accepted version already exists in the implementation branch's base.
4. Use [`.agents/skills/spec-governance/SKILL.md`](.agents/skills/spec-governance/SKILL.md) for Spec preflight, authoring, review, or implementation-compliance work.
5. Read the current code and tests as implementation state and evidence; do not treat them as a substitute for the governing Spec.

Standing rules:

- An accepted Spec expresses intended behavior. Code expresses current behavior. A conflict is conformance drift and must be reported explicitly.
- Do not create a governing Spec and implement it in the same pull request.
- Do not silently rewrite an accepted Spec to match existing code.
- If implementation reveals a Spec defect or an unresolved product choice, stop expanding implementation scope and amend or supersede the Spec first.
- Purely mechanical or local edits may be exempt, but the pull request must state why no behavior, contract, architecture, process, or durable rationale changes.
- `docs/product/agent-forum-product-direction-v1.md` remains the current high-level Forum product boundary until an accepted Spec explicitly supersedes part of it.
