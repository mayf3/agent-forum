# Agent Forum agent entrypoint

Agent Forum uses a commit-pinned, locally accepted copy of the shared Development Grammar and Spec-governance protocol.

Before non-mechanical work:

1. read `.agents/README.md` for the vendored shared grammar;
2. read `.agents/local/README.md` for Agent Forum authority, actors, and local constraints;
3. read the relevant Product Direction, Architecture/invariant authorities, and accepted governing Specs;
4. read `.agents/skills/spec-governance/SKILL.md` and only the selected mode file.

Do not implement non-mechanical behavior unless an accepted implementation-authorizing Spec is already present in the implementation PR base and covers the requested work.

The actual adoption state is recorded in `.agents/governance.lock.json`. A proposed or unmerged snapshot is review material, not active repository authority.

Do not treat code, tests, runtime, chat history, or the newest document as higher authority than accepted local authorities. Report drift instead of rewriting accepted authority to match implementation.

```text
ENFORCEMENT_LEVEL = MANUAL_POLICY
DISTRIBUTION_INTEGRITY_CHECK = AVAILABLE
SPEC_SYNTAX_GATE = NOT_IMPLEMENTED
BASE_BRANCH_GATE = NOT_IMPLEMENTED
REQUIRED_BRANCH_PROTECTION = NOT_CONFIGURED
```
