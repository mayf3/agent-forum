---
spec_id: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2
status: proposed
spec_kind: invariant
authority_level: governing_spec
implementation_authority: none
scope:
  - mayf3/agent-forum
governed_by: []
external_authorities:
  - repository: mayf3/agent-development-governance
    authority_id: AGENT_DEVELOPMENT_GOVERNANCE_V1
    revision: b69e8dbadc68f2323a5117e7c22b147ae3f5f175
    relation: constrained_by
supersedes: []
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2

## 1. Goal

Adopt the exact stable Agent Development Governance v1.0.2 distribution in
Agent Forum while preserving this repository's ownership of Product Direction,
Architecture, governing Specs, acceptance, code, runtime, and operations.

```text
GOAL = use independent Authority, Plan, and Assurance routing for future work
SUCCESS = exact vendored bytes + local review + authorized acceptance + merge
```

This proposed successor does not activate Governance V1 by itself. The accepted
V1 adoption remains active until an independently reviewed, owner-accepted,
atomically closed successor is merged into `main`.

## 2. Scope and non-goals

### In scope

- vendor the 25 manifest-governed paths from upstream v1.0.2;
- pin source commit `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`;
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
- acceptance, Ready-for-review transition, merge, or production activation.

## 3. Authority and dependencies

```text
SOURCE_REPOSITORY = mayf3/agent-development-governance
SOURCE_TAG = v1.0.2
SOURCE_TAG_TYPE = annotated
SOURCE_COMMIT = b69e8dbadc68f2323a5117e7c22b147ae3f5f175
DISTRIBUTION = development-governance-v0
DISTRIBUTION_VERSION = 1.0.2
LOCAL_ACCEPTANCE_ACTOR = mayf3
IMPLEMENTATION_AUTHORITY = none
```

The upstream distribution is a constrained governance dependency, not Agent
Forum Product Authority. Local precedence and actors remain defined by
`.agents/local/README.md`.

`AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1` is the current accepted
adoption. If V2 is later accepted, the acceptance change must atomically set V2
to `accepted`, declare V1 in `supersedes`, and set V1 to `superseded` with
`superseded_by: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2`.

## 4. Current State

### STATE-ADOPT2-001 — Current local adoption

- Subject: Agent Forum governance adoption
- As of commit: `b9f11af1ec44dd1f5c623c6e151b9a2bca6b425f`
- Environment: `mayf3/agent-forum` authority branch `main`
- Observed at: `2026-09-07T23:42:57Z`
- Projection: V1 remains accepted and pins `0.1.0-draft.1` at
  `46f78c3f00d768d99a4c8c2da975b124bce042f9`.
- Basis: `OBS-ADOPT2-001`

### STATE-ADOPT2-002 — Stable upstream candidate

- Subject: upstream governance distribution
- As of artifact: annotated tag `v1.0.2`
- Environment: `mayf3/agent-development-governance`
- Observed at: `2026-09-07T23:42:57Z`
- Projection: the tag peels to source commit
  `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`; its manifest declares
  version `1.0.2`, distribution `development-governance-v0`, and 25 files.
- Basis: `OBS-ADOPT2-002`, `OBS-ADOPT2-003`

### STATE-ADOPT2-003 — Retargeted proposed candidate

- Subject: this adoption candidate (PR #17)
- As of commit: the proposed candidate derived from
  `b9f11af1ec44dd1f5c623c6e151b9a2bca6b425f` after the retarget commits
  `f9b8b67216c8287ecb26f2f424b5e9bbf08e98e7` (withdrawal) and
  `ed9ea4875f6c422099b3291ddf4082f3a52b5222` (re-vendor)
- Environment: `mayf3/agent-forum` adoption branch
  `agent/adopt-development-governance-v1.0.0`
- Observed at: `2026-09-07T23:42:57Z`
- Projection: the unmerged v1.0.0 lifecycle acceptance (`280d6bb`) was
  withdrawn history-preservingly; the candidate is re-vendored from v1.0.2
  and proposes `adoption.status: proposed` with null acceptance metadata.
- Basis: `OBS-ADOPT2-005`

## 5. Observations

### OBS-ADOPT2-001 — Existing adoption is exact and locally accepted

- Subject: `.agents/governance.lock.json` on the authority branch
- Source revision: Agent Forum `b9f11af1ec44dd1f5c623c6e151b9a2bca6b425f`
- Environment: GitHub `main`
- Observed at: `2026-09-07T23:42:57Z`
- Method: inspect the lock, V1 adoption Spec, and local authority map
- Result: adoption V1 is accepted at version `0.1.0-draft.1`; upstream movement
  has no effect without another local review and acceptance.
- Provenance: repository files at the stated commit

### OBS-ADOPT2-002 — v1.0.2 is an annotated exact-release tag

- Subject: upstream `v1.0.2`
- Source revision: tag object `503dd8b092cf8673c6cbc0a82ed87a3e051423fc`
- Environment: upstream Git repository
- Observed at: `2026-09-07T23:42:57Z`
- Method: fetch the annotated tag, inspect tag object type, and peel the tag
- Result: object type is `tag`; peeled commit is
  `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`.
- Provenance: upstream Git tag and commit objects

### OBS-ADOPT2-003 — The release manifest is exact

- Subject: `distribution/manifest.json`
- Source revision: `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`
- Environment: upstream clean checkout
- Observed at: `2026-09-07T23:42:57Z`
- Method: run the upstream vendor source validation and manifest digest checks
- Result: all 25 declared files match their exact SHA-256 and size; manifest
  digest `21e8dd6fbf35147c183e575d27407e715113116950171d9dffc2f8c17b906e14`.
- Provenance: upstream manifest and vendor validation output

### OBS-ADOPT2-004 — Local extensions remain repository-owned

- Subject: Agent Forum local authority files
- Source revision: re-vendor commit
  `ed9ea4875f6c422099b3291ddf4082f3a52b5222`
- Environment: adoption write surface derived from
  `b9f11af1ec44dd1f5c623c6e151b9a2bca6b425f`
- Observed at: `2026-09-07T23:42:57Z`
- Method: compare pre/post SHA-256 for `AGENTS.md`, `.agents/local/**`, Product
  Direction, Core Invariants, and the accepted V1 adoption Spec; inspect the
  vendor tool plan, which creates bootstrap templates only when missing
- Result: all compared local files are byte-identical; the working-tree delta
  of the re-vendor touches only `.agents/**` and the lock.
- Provenance: vendor tool plan/apply output and git diff

### OBS-ADOPT2-005 — The v1.0.0 acceptance was withdrawn and the candidate retargeted

- Subject: this candidate's lifecycle history on
  `agent/adopt-development-governance-v1.0.0`
- Source revision: withdrawal commit
  `f9b8b67216c8287ecb26f2f424b5e9bbf08e98e7`; re-vendor commit
  `ed9ea4875f6c422099b3291ddf4082f3a52b5222`
- Environment: `mayf3/agent-forum` adoption branch
- Observed at: `2026-09-07T23:42:57Z`
- Method: inspect the branch history and the withdrawal/vendor commit deltas
- Result: the v1.0.0 lifecycle acceptance `280d6bb` (Owner grant comment
  `5541956711`, reviewed ACCEPT) was withdrawn by exact inversion of its
  lifecycle-only delta with no reset, force-push, or history rewrite; the
  v1.0.0 -> v1.0.2 vendored byte delta is exactly 4 files
  (`.agents/README.md`, `spec-frontmatter.schema.json`,
  `GOVERNANCE_ADOPTION_SPEC_TEMPLATE.md`, `validate_spec_transition.py`);
  21 of 25 vendored files are byte-identical.
- Provenance: branch history and vendor tool plan/apply output

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
  `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`
- Strength/sufficiency: sufficient for exact byte and revision identity
- Limitations: does not establish local semantic acceptance
- Provenance: tag object, manifest, vendor output, and governance verifier

### EVD-ADOPT2-002 — Protocol delta supports successor treatment

- Source observations: `OBS-ADOPT2-001`, `OBS-ADOPT2-003`
- Target: `CLM-ADOPT2-002`
- Relation: SUPPORTS
- Bound coordinates: old pin `46f78c3f...`, new pin `b69e8dba...`
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
  `b69e8dbadc68f2323a5117e7c22b147ae3f5f175`.
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
- Decision: this candidate remains proposed with null acceptance metadata.
- Rejected alternative: activate v1.0.0 merely because upstream released it.
- Reason: local independent review and owner acceptance remain mandatory.

### DEC-ADOPT2-005 — Retarget the candidate from v1.0.0 to v1.0.2

- Decision owner: `mayf3` (Owner goal directive UPSTREAM_TARGET_RESELECTION)
- Decision: withdraw the unmerged v1.0.0 lifecycle acceptance
  history-preservingly and re-vendor the exact v1.0.2 release instead.
- Rejected alternatives: keep the v1.0.0 candidate
  (`VALID_BUT_NOT_TO_BE_MERGED`); adopt v1.0.1 directly.
- Reason: v1.0.2 is the published stable consumer-adoption target; it
  contains the v1.0.1 transition-validator technical fix and closes the
  v1.0.1 publication-provenance gap, so adopting v1.0.0 would knowingly pin
  a defective validator.

## 9. Contracts

### CTR-ADOPT2-001 — Exact stable source identity

The repository MUST vendor every path in the v1.0.2 manifest from source commit
`b69e8dbadc68f2323a5117e7c22b147ae3f5f175`. The lock MUST record repository,
source commit, version `1.0.2`, distribution `development-governance-v0`,
manifest digest, and per-file digests and sizes.

### CTR-ADOPT2-002 — Truthful proposed adoption

Preparation MUST set `adoption.status` to `proposed` and MUST set `accepted_by`
and `accepted_at` to null. Preparation MUST NOT claim that V2 is active or that
V1 is superseded.

### CTR-ADOPT2-003 — Atomic future supersession

If authorized acceptance occurs, V2 acceptance and the V1/V2 whole-authority
supersession backlinks MUST be changed atomically and independently rechecked.

### CTR-ADOPT2-004 — Local authority preservation

Vendoring MUST NOT overwrite `AGENTS.md`, `.agents/local/**`, Product Direction,
Architecture/invariant authorities, existing local Specs, or acceptance actors.
A repository-owned, coordinate-safe update to `.agents/local/README.md` in this
same adoption PR is a local routing correction by the repository, not a vendored
overwrite; every other protected local file MUST remain byte-identical.

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

### CTR-ADOPT2-008 — Staged adoption and lifecycle-only acceptance

Adoption MUST proceed through separate attributable stages: proposed candidate
→ exact-Head independent review → authorized Owner acceptance → independent
final-head recheck → Ready transition and merge. Local activation follows merge
only.

Independent review MUST bind to one exact proposed Head SHA. Any normative
semantic change after an ACCEPT recommendation invalidates that recommendation;
an invalid acceptance attempt MUST be withdrawn through a history-preserving
correction, and the resulting semantic delta MUST NOT be relabeled as lifecycle
metadata.

Authorized Owner acceptance MUST change ONLY this field set:

- V2 frontmatter: `status` (`proposed` → `accepted`) and `supersedes`
  (`[]` → `[AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1]`);
- V1 frontmatter: `status` (`accepted` → `superseded`) and `superseded_by`
  (`null` → `AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2`);
- `.agents/governance.lock.json`: `adoption.status`, `adoption.accepted_by`,
  `adoption.accepted_at`;
- `docs/specs/README.md`: the two lifecycle rows and the candidate-state
  navigation sentence;
- commit metadata and the persistent PR record.

Acceptance MUST NOT modify normative body text of either adoption Spec, vendored
distribution bytes, or any other file. Acceptance attribution MUST be recorded
in lock lifecycle fields, commit metadata, and the persistent PR record — not by
appending a new acceptance-record section to the normative body.

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
- Environment: Draft PR before owner acceptance
- Required evidence: exact Base/Head, lock, Spec records, independent review
- Expected result: V2 remains proposed, V1 remains accepted, null acceptance data
- Failure condition: preparation claims acceptance or mutates V1 lifecycle

### ACC-ADOPT2-003 — Local authority is byte-preserved

- Contracts: `CTR-ADOPT2-004`
- Method: compare pre/post SHA-256 of all named local authority files
- Environment: isolated candidate write surface
- Required evidence: digest receipt and changed-path list
- Expected result: every protected local file is unchanged except the
  explicitly reviewed `.agents/local/README.md` routing update made in this
  same PR, which remains repository-owned
- Failure condition: vendor or manual change alters any protected local file
  other than that explicit routing update

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
- Environment: Base `b9f11af1ec44dd1f5c623c6e151b9a2bca6b425f`
  and exact candidate Head
- Required evidence: changed paths, test result, product-code identity
- Expected result: only shared governance and adoption metadata change
- Failure condition: product/runtime/configuration/Secret change appears

### ACC-ADOPT2-006 — Acceptance delta is lifecycle-only and pre-defined

- Contracts: `CTR-ADOPT2-008`
- Method: define and mechanically preview the exact expected acceptance diff
  before independent review; after authorized acceptance, diff the acceptance
  commit against the reviewed proposed Head and run whole-authority transition
  validation and lock schema validation
- Environment: exact reviewed proposed Head and exact acceptance Head
- Required evidence: expected acceptance diff, actual acceptance commit diff,
  transition validator output, lock schema validation output
- Expected result: the acceptance commit equals the pre-defined lifecycle-only
  diff and contains no normative body change
- Failure condition: any semantic delta after review, a missing supersession
  backlink, or a change outside the permitted field set

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
| `CTR-ADOPT2-008` | `ACC-ADOPT2-006` | YES |

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
OPEN_OWNER_DECISIONS = NONE FOR PREPARATION
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE
PARTIAL_SUPERSESSION = NONE
READY_FOR_INDEPENDENT_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
```

Independent review of the exact candidate and authorized acceptance by `mayf3`
are still required. This execution Agent does not perform either action.
