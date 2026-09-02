---
spec_id: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2
status: accepted
spec_kind: invariant
authority_level: governing_spec
implementation_authority: none
scope:
  - mayf3/agent-forum
governed_by: []
external_authorities:
  - repository: mayf3/agent-development-governance
    authority_id: AGENT_DEVELOPMENT_GOVERNANCE_V1
    revision: 902842735a69797b54016eeaa88d2f949f5879a9
    relation: constrained_by
supersedes:
  - AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2

## 1. Goal

Adopt the exact stable Agent Development Governance v1.0.0 distribution in
Agent Forum while preserving this repository's ownership of Product Direction,
Architecture, governing Specs, acceptance, code, runtime, and operations.

```text
GOAL = use independent Authority, Plan, and Assurance routing for future work
SUCCESS = exact vendored bytes + local review + authorized acceptance + merge
```

This owner-accepted successor candidate does not activate Governance V1 by
itself. The V1 adoption remains active on `main` until this exact acceptance
Head is independently rechecked and merged.

## 2. Scope and non-goals

### In scope

- vendor the 25 manifest-governed paths from upstream v1.0.0;
- pin source commit `902842735a69797b54016eeaa88d2f949f5879a9`;
- preserve distribution ID `development-governance-v0`;
- prepare `adoption.status: proposed` with null acceptance metadata;
- introduce Governance V1's independent Authority, Plan, and Assurance axes;
- preserve all Agent Forum local authority and acceptance actors;
- apply the adopted workflow only to future applicable work.

### Out of scope

- product code, schema, tests, deployment, permissions, credentials, or runtime;
- implementation of `AGENT_OPERATIONAL_LAYER_V1`;
- bulk rewriting historical tasks, Specs, reviews, or evidence;
- GitHub App, Broker, WORM, branch protection, or semantic CI construction;
- Ready-for-review transition, merge, or production activation.

## 3. Authority and dependencies

```text
SOURCE_REPOSITORY = mayf3/agent-development-governance
SOURCE_TAG = v1.0.0
SOURCE_TAG_TYPE = annotated
SOURCE_COMMIT = 902842735a69797b54016eeaa88d2f949f5879a9
DISTRIBUTION = development-governance-v0
DISTRIBUTION_VERSION = 1.0.0
LOCAL_ACCEPTANCE_ACTOR = mayf3
IMPLEMENTATION_AUTHORITY = none
```

The upstream distribution is a constrained governance dependency, not Agent
Forum Product Authority. Local precedence and actors remain defined by
`.agents/local/README.md`.

`AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1` was the active accepted
adoption in the independently reviewed proposed Head. This acceptance commit
atomically sets V2 to `accepted`, declares V1 in `supersedes`, and sets V1 to
`superseded` with
`superseded_by: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2`.

V1 remains the active repository authority on `main` until this exact
acceptance Head passes independent final-head recheck and is merged.

## 4. Current State

### STATE-ADOPT2-001 — Current local adoption

- Subject: Agent Forum governance adoption
- As of commit: `e0f220f9bd4e72ece6697d2c8b4de15f614fd8d5`
- Environment: `mayf3/agent-forum` authority branch `main`
- Observed at: `2026-09-01T23:40:26Z`
- Projection: V1 remains accepted and pins `0.1.0-draft.1` at
  `46f78c3f00d768d99a4c8c2da975b124bce042f9`.
- Basis: `OBS-ADOPT2-001`

### STATE-ADOPT2-002 — Stable upstream candidate

- Subject: upstream governance distribution
- As of artifact: annotated tag `v1.0.0`
- Environment: `mayf3/agent-development-governance`
- Observed at: `2026-09-01T23:40:26Z`
- Projection: the tag peels to source commit
  `902842735a69797b54016eeaa88d2f949f5879a9`; its manifest declares
  version `1.0.0`, distribution `development-governance-v0`, and 25 files.
- Basis: `OBS-ADOPT2-002`, `OBS-ADOPT2-003`

## 5. Observations

### OBS-ADOPT2-001 — Existing adoption is exact and locally accepted

- Subject: `.agents/governance.lock.json` before this proposal
- Source revision: Agent Forum `e0f220f9bd4e72ece6697d2c8b4de15f614fd8d5`
- Environment: GitHub `main`
- Observed at: `2026-09-01T23:40:26Z`
- Method: inspect the lock, V1 adoption Spec, and local authority map
- Result: adoption V1 is accepted at version `0.1.0-draft.1`; upstream movement
  has no effect without another local review and acceptance.
- Provenance: repository files at the stated commit

### OBS-ADOPT2-002 — v1.0.0 is an annotated exact-release tag

- Subject: upstream `v1.0.0`
- Source revision: tag object `bb98937d176890088da736fa4a45f48279f19d50`
- Environment: upstream Git repository
- Observed at: `2026-09-01T23:40:26Z`
- Method: inspect tag object type and peel the tag
- Result: object type is `tag`; peeled commit is
  `902842735a69797b54016eeaa88d2f949f5879a9`.
- Provenance: upstream Git tag and commit objects

### OBS-ADOPT2-003 — The release manifest is exact

- Subject: `distribution/manifest.json`
- Source revision: `902842735a69797b54016eeaa88d2f949f5879a9`
- Environment: upstream clean checkout
- Observed at: `2026-09-01T23:40:26Z`
- Method: run the upstream vendor source validation and manifest digest checks
- Result: all 25 declared files match their exact SHA-256 and size.
- Provenance: upstream manifest and vendor validation output

### OBS-ADOPT2-004 — Local extensions remain repository-owned

- Subject: Agent Forum local authority files
- Source revision: candidate derived from
  `e0f220f9bd4e72ece6697d2c8b4de15f614fd8d5`
- Environment: isolated adoption write surface
- Observed at: `2026-09-01T23:40:26Z`
- Method: compare pre/post SHA-256 for `AGENTS.md`, `.agents/local/**`, Product
  Direction, Core Invariants, and the accepted V1 adoption Spec
- Result: all compared local files are byte-identical.
- Provenance: local digest receipt generated during preparation

## 6. Claims and assumptions

### CLM-ADOPT2-001 — Exact vendoring prevents silent upstream drift

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT2-001`
- Contradicted by evidence: none known
- Uncertainty: integrity does not replace semantic review or local acceptance.

### CLM-ADOPT2-002 — Governance V1 is a material governance update

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT2-002`
- Contradicted by evidence: none known
- Uncertainty: repository-specific routing still depends on local authority.

### CLM-ADOPT2-003 — A whole-authority successor preserves accepted history

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT2-003`
- Contradicted by evidence: none known
- Uncertainty: the atomic supersession transition remains a later acceptance act.

## 7. Evidence relations

### EVD-ADOPT2-001 — Tag, source, manifest, vendored files, and lock agree

- Source observations: `OBS-ADOPT2-002`, `OBS-ADOPT2-003`
- Target: `CLM-ADOPT2-001`
- Relation: SUPPORTS
- Bound coordinates: upstream
  `902842735a69797b54016eeaa88d2f949f5879a9`
- Strength/sufficiency: sufficient for exact byte and revision identity
- Limitations: does not establish local semantic acceptance
- Provenance: tag object, manifest, vendor output, and governance verifier

### EVD-ADOPT2-002 — Protocol delta supports successor treatment

- Source observations: `OBS-ADOPT2-001`, `OBS-ADOPT2-003`
- Target: `CLM-ADOPT2-002`
- Relation: SUPPORTS
- Bound coordinates: old pin `46f78c3f...`, new pin `90284273...`
- Strength/sufficiency: sufficient to show changed long-lived governance meaning
- Limitations: does not itself authorize acceptance
- Provenance: old/new protocol and manifest comparison

### EVD-ADOPT2-003 — Local ownership and atomic closure preserve history

- Source observations: `OBS-ADOPT2-001`, `OBS-ADOPT2-004`
- Target: `CLM-ADOPT2-003`
- Relation: SUPPORTS
- Bound coordinates: Agent Forum Base and proposed candidate
- Strength/sufficiency: sufficient for proposed successor routing
- Limitations: final backlinks require owner acceptance and final-head review
- Provenance: local authority digest receipt and transition validator

## 8. Decisions

### DEC-ADOPT2-001 — Pin the stable release commit, not a floating ref

- Decision owner: `mayf3`
- Decision: use exact source commit
  `902842735a69797b54016eeaa88d2f949f5879a9`.
- Rejected alternative: pin upstream `main`, a merge alias, or `latest`.
- Reason: upstream movement must remain inert in this repository.

### DEC-ADOPT2-002 — Adopt independent Authority, Plan, and Assurance routing

- Decision owner: `mayf3`
- Decision: future applicable work independently classifies long-lived
  obligation, execution complexity, and failure consequence.
- Rejected alternative: infer planning and assurance from Spec need alone.
- Reason: the three axes govern different facts and must not be conflated.

### DEC-ADOPT2-003 — Preserve all Agent Forum product authority

- Decision owner: `mayf3`
- Decision: retain local precedence, acceptance actors, Product Direction, Core
  Invariants, Specs, code, runtime, and operational ownership unchanged.
- Rejected alternative: treat upstream governance as central product authority.
- Reason: cross-repository governance is dependency-only.

### DEC-ADOPT2-004 — Separate preparation from acceptance

- Decision owner: `mayf3`
- Decision: preparation remained proposed with null acceptance metadata; after
  independent review of exact Head `c6dbc86cec0b20e254fe1d895232f3f12f626fe3` and explicit Owner
  authorization, this separate acceptance commit records local acceptance.
- Rejected alternative: activate v1.0.0 merely because upstream released it.
- Reason: preparation, independent review, Owner acceptance, final-head recheck,
  and merge remain separate attributable acts.

## 9. Contracts

### CTR-ADOPT2-001 — Exact stable source identity

The repository MUST vendor every path in the v1.0.0 manifest from source commit
`902842735a69797b54016eeaa88d2f949f5879a9`. The lock MUST record repository,
source commit, version `1.0.0`, distribution `development-governance-v0`,
manifest digest, and per-file digests and sizes.

### CTR-ADOPT2-002 — Truthful staged adoption

Preparation MUST set `adoption.status` to `proposed` and MUST set `accepted_by`
and `accepted_at` to null. Authorized acceptance MUST set `adoption.status` to
`accepted` with attributable, non-null acceptance metadata only after exact-Head
independent review. The accepted candidate MUST NOT be treated as active
repository authority until final-head recheck and merge.

### CTR-ADOPT2-003 — Atomic supersession

Authorized acceptance MUST atomically change V2 acceptance and both V1/V2
whole-authority supersession backlinks. The resulting exact Head MUST be
independently rechecked before merge.

### CTR-ADOPT2-004 — Local authority preservation

Vendoring MUST NOT overwrite `AGENTS.md`, `.agents/local/**`, Product Direction,
Architecture/invariant authorities, existing local Specs, or acceptance actors.

### CTR-ADOPT2-005 — Three-axis routing and stop control

Once V2 is accepted and merged, applicable work MUST independently classify
Authority, Plan, and Assurance. Work MUST stop when `DONE_WHEN` is met and no
`EXPANSION_TRIGGER` has fired.

### CTR-ADOPT2-006 — No product or operational change

This adoption preparation MUST NOT modify product code, tests, schema, runtime,
production state, permissions, credentials, Grants, or Secrets, and MUST NOT
implement `AGENT_OPERATIONAL_LAYER_V1`.

### CTR-ADOPT2-007 — Forward-only adoption and exact rollback

Adoption MUST be forward-only. Historical material MUST NOT be bulk rewritten.
Rollback MUST revert the complete accepted update commit so lock and vendored
bytes return to one exact prior version together.

## 10. Acceptance

### ACC-ADOPT2-001 — Release identity and bytes

- Contracts: `CTR-ADOPT2-001`
- Method: verify annotated tag, peeled commit, manifest, all vendored bytes, lock
- Environment: exact upstream checkout and exact Agent Forum candidate
- Required evidence: tag object, source commit, vendor plan/apply, verifier output
- Expected result: every identity and digest agrees
- Failure condition: any floating ref, missing file, byte, size, or digest mismatch

### ACC-ADOPT2-002 — Proposed state cannot fabricate acceptance

- Contracts: `CTR-ADOPT2-002`, `CTR-ADOPT2-003`
- Method: inspect lock, Spec lifecycle, old authority, and transition validation
- Environment: Draft PR across the proposed Head and owner-accepted successor Head
- Required evidence: exact Base/Head, lock, Spec records, independent review, and
  explicit Owner authorization
- Expected result: proposed metadata is null at `c6dbc86cec0b20e254fe1d895232f3f12f626fe3`; accepted
  metadata and closed V1/V2 backlinks appear only in the acceptance commit
- Failure condition: preparation fabricates acceptance, an unauthorized actor
  accepts, backlinks are partial, or semantic content changes without review

### ACC-ADOPT2-003 — Local authority is byte-preserved

- Contracts: `CTR-ADOPT2-004`
- Method: compare pre/post SHA-256 of all named local authority files
- Environment: isolated candidate write surface
- Required evidence: digest receipt and changed-path list
- Expected result: every protected local file is unchanged
- Failure condition: vendor or manual change alters a protected local file

### ACC-ADOPT2-004 — Governance V1 tools are valid and runnable

- Contracts: `CTR-ADOPT2-005`
- Method: run integrity verification, lock/schema validation, whole-authority
  transition validation, and a positive Governance V1 route validation
- Environment: exact adoption candidate
- Required evidence: executed commands and outputs
- Expected result: all deterministic checks pass
- Failure condition: any validator rejects the candidate or cannot run

### ACC-ADOPT2-005 — Scope remains governance/docs only

- Contracts: `CTR-ADOPT2-006`, `CTR-ADOPT2-007`
- Method: inspect diff, run repository tests, and compare product tree
- Environment: Base `e0f220f9bd4e72ece6697d2c8b4de15f614fd8d5`
  and exact candidate Head
- Required evidence: changed paths, test result, product-code identity
- Expected result: only shared governance and adoption metadata change
- Failure condition: product/runtime/configuration/Secret change appears

### Contract coverage

| Contract | Acceptance | Covered |
|---|---|---|
| `CTR-ADOPT2-001` | `ACC-ADOPT2-001` | YES |
| `CTR-ADOPT2-002` | `ACC-ADOPT2-002` | YES |
| `CTR-ADOPT2-003` | `ACC-ADOPT2-002` | YES |
| `CTR-ADOPT2-004` | `ACC-ADOPT2-003` | YES |
| `CTR-ADOPT2-005` | `ACC-ADOPT2-004` | YES |
| `CTR-ADOPT2-006` | `ACC-ADOPT2-005` | YES |
| `CTR-ADOPT2-007` | `ACC-ADOPT2-005` | YES |

## 11. Alternatives and disposition

### ALT-ADOPT2-001 — Modify accepted V1 adoption in place

- Disposition: rejected
- Reason: Governance V1 changes accepted long-lived routing meaning.
- What would reopen: none; accepted history remains immutable.

### ALT-ADOPT2-002 — Pin the annotated tag object or upstream main

- Disposition: rejected
- Reason: the machine pin must identify the exact source commit.
- What would reopen: none for this adoption.

### ALT-ADOPT2-003 — Overlay local edits into vendored files

- Disposition: rejected
- Reason: local rules belong in `.agents/local/**`, not the shared byte set.
- What would reopen: upstream distribution becomes unusable without a new release.

## 12. Migration, compatibility, and rollback

```text
MIGRATION = exact replacement of shared vendored governance bytes and lock
PRODUCT_MIGRATION = none
HISTORICAL_REWRITE = none
COMPATIBILITY = Product Direction, Core Invariants, product code, and runtime unchanged
PREPARATION_ROLLBACK = delete or close the unmerged Draft candidate
ACCEPTED_ROLLBACK = revert the complete adoption update commit
```

## 13. Open questions

```text
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE
PARTIAL_SUPERSESSION = NONE
OWNER_ACCEPTANCE = RECORDED
ACCEPTANCE_ACTOR = mayf3
ACCEPTANCE_REVIEWER = openai-chatgpt:gpt-5.6-pro/AF-GOVERNANCE-ADOPTION-PR17-C6DBC86-R1
ACCEPTANCE_REVIEWED_HEAD = c6dbc86cec0b20e254fe1d895232f3f12f626fe3
READY_FOR_FINAL_HEAD_RECHECK = YES
READY_TO_MERGE = NO
```

Owner acceptance by `mayf3` is recorded after independent review of
`c6dbc86cec0b20e254fe1d895232f3f12f626fe3`. This exact acceptance Head must now receive an independent
final-head recheck before the Draft PR can be marked Ready or merged.

## 14. Owner acceptance record

```text
ACCEPTED_BY = mayf3
ACCEPTED_AT = 2026-09-02T12:59:46Z
REVIEWER_ID = openai-chatgpt:gpt-5.6-pro/AF-GOVERNANCE-ADOPTION-PR17-C6DBC86-R1
REVIEWED_PROPOSED_HEAD = c6dbc86cec0b20e254fe1d895232f3f12f626fe3
REVIEW_RESULT = ACCEPT
BLOCKERS = 0
HIGH = 0
ACCEPTANCE_DELTA = lifecycle metadata + V1/V2 backlinks + lock + index only
FINAL_HEAD_RECHECK_REQUIRED = YES
MERGE_PERFORMED = NO
```
