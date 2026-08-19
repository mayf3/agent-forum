---
spec_id: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
status: proposed
spec_kind: invariant
authority_level: governing_spec
implementation_authority: none
scope:
  - mayf3/agent-forum
governed_by: []
external_authorities:
  - repository: mayf3/agent-development-governance
    authority_id: AGENT_DEVELOPMENT_GOVERNANCE_BOOTSTRAP_V0
    revision: 46f78c3f00d768d99a4c8c2da975b124bce042f9
    relation: constrained_by
supersedes: []
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1

## 1. Goal

Adopt an exact, reviewable revision of the shared Agent Development Governance distribution for Agent Forum while preserving this repository's local product authority and avoiding a parallel Forum-specific governance fork.

```text
GOAL = establish a reusable Spec-first development-management baseline
SUCCESS_OUTCOME = future non-mechanical work follows one pinned grammar, local authority map, exact-review binding, and Contract-by-Contract conformance process
```

## 2. Scope and non-goals

### In scope

- exact vendoring of `development-governance-v0`;
- a proposed adoption lock;
- Agent Forum's local authority precedence and actors;
- a thin Agent entrypoint and local Spec index;
- forward-only use for future non-mechanical work;
- explicit future update and rollback boundaries.

### Out of scope

- any Forum product behavior, API, schema, identity, permission, lifecycle, deployment, or test change;
- accepting this adoption without independent review and owner action;
- bulk migration of historical documents;
- implementing a deterministic Spec syntax gate or base-branch merge gate;
- claiming branch protection or semantic CI that is not active;
- authorizing `AGENT_FORUM_CORE_INVARIANTS_V1` implementation.

## 3. Authority and dependencies

```text
SOURCE_REPOSITORY = mayf3/agent-development-governance
SOURCE_COMMIT = 46f78c3f00d768d99a4c8c2da975b124bce042f9
DISTRIBUTION_VERSION = 0.1.0-draft.1
MANIFEST_SHA256 = 58b5b28bb801538fe62be0ac98a7bc539ff34ec24fa368c48996dd40d8653ba0
LOCAL_ACCEPTANCE_ACTOR = mayf3
IMPLEMENTATION_AUTHORITY = none
```

The external repository supplies shared grammar and protocol content. It cannot own or supersede Agent Forum Product Direction, Architecture, local Specs, acceptance decisions, code, or runtime behavior.

This adoption is a top-level repository-governance authority, not a product authority. When accepted locally, it registers the existing `docs/product/agent-forum-product-direction-v1.md` as `AGENT_FORUM_PRODUCT_DIRECTION_V1`, the highest named local product authority.

## 4. Current State

### STATE-ADOPT-001 — Agent Forum governance before shared adoption

- Subject: `mayf3/agent-forum` repository governance surface
- As of commit: base `502cfca5a180d6c49fe75dfc270fd117f279ccfb`; previous PR candidate head `060e0fe231707687dabbf6d4ec84940cecd635fb`
- Environment: GitHub repository, `main`, and Draft PR #4
- Observed at: `2026-08-19T14:32:45Z`
- Projection: `main` contains the Product Direction but no active shared-governance adoption or accepted governing Spec under `docs/specs/`; PR #4 held a four-file custom governance candidate; branch protection was not configured.
- Basis: `OBS-ADOPT-002`, `OBS-ADOPT-004`

### STATE-ADOPT-002 — Proposed shared-governance candidate

- Subject: the replacement candidate for Draft PR #4
- As of artifact: source `46f78c3f00d768d99a4c8c2da975b124bce042f9`, candidate distributed tree `0e106c190c96e8067ebc0cf848a701ac029134c7`
- Environment: uncommitted Git tree prepared through GitHub's Git Data API
- Observed at: `2026-08-19T14:32:45Z`
- Projection: 17 manifest-governed files match the source Git blob identities and sizes; local files remain separately owned; adoption metadata remains proposed.
- Basis: `OBS-ADOPT-001`, `OBS-ADOPT-003`, `CLM-ADOPT-001`

## 5. Observations

### OBS-ADOPT-001 — The source governance revision is exact and independently accepted upstream

- Subject: `mayf3/agent-development-governance`
- Repository/source: upstream `main`
- Commit/artifact: `46f78c3f00d768d99a4c8c2da975b124bce042f9`
- Environment: GitHub commit and repository tree
- Observed at: `2026-08-19T14:32:45Z`
- Method: inspect the exact branch head, merge commit, README, distribution manifest, and source blobs
- Result: the bootstrap Spec is accepted upstream; the final-head recheck passed with no semantic delta; the distribution is `0.1.0-draft.1`; no stable release tag was created.
- Provenance: upstream commit `46f78c3f00d768d99a4c8c2da975b124bce042f9`, `README.md`, and `distribution/manifest.json`

### OBS-ADOPT-002 — Existing Forum PR #4 is a non-authoritative parallel candidate

- Subject: Draft PR #4 before this adoption rewrite
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: base `502cfca5a180d6c49fe75dfc270fd117f279ccfb`, head `060e0fe231707687dabbf6d4ec84940cecd635fb`
- Environment: GitHub Draft PR #4
- Observed at: `2026-08-19T14:32:45Z`
- Method: inspect PR metadata, changed paths, and the four custom governance files
- Result: the candidate was unmerged and proposed, changed no product code, and independently redefined grammar and workflow already supplied by the central repository.
- Provenance: `https://github.com/mayf3/agent-forum/pull/4`

### OBS-ADOPT-003 — The proposed vendored bytes match the source distribution

- Subject: proposed Agent Forum governance snapshot
- Repository/source: source commit `46f78c3f00d768d99a4c8c2da975b124bce042f9`
- Commit/artifact: target candidate tree `0e106c190c96e8067ebc0cf848a701ac029134c7`
- Environment: GitHub Git Data objects
- Observed at: `2026-08-19T14:32:45Z`
- Method: create each target blob from the exact source content, then compare all 17 target Git blob SHAs, sizes, and executable mode with the source manifest/tree
- Result: all 17 distributed paths match; `.agents/tools/verify_governance.py` remains executable; the lock records the manifest digests and `adoption.status: proposed` with null acceptance metadata.
- Provenance: target candidate tree, source manifest, and `.agents/governance.lock.json`

### OBS-ADOPT-004 — Local authority and enforcement state are bounded

- Subject: Agent Forum local authority and GitHub enforcement
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main @ 502cfca5a180d6c49fe75dfc270fd117f279ccfb`
- Environment: repository files and live GitHub branch settings
- Observed at: `2026-08-19T14:32:45Z`
- Method: inspect Product Direction, repository tree, branch protection, and required checks
- Result: Product Direction exists at `docs/product/agent-forum-product-direction-v1.md`; no accepted local Architecture authority or governing Spec was indexed; `main` was not protected and required status checks were off.
- Provenance: Product Direction path and GitHub `main` branch settings

## 6. Claims and assumptions

### CLM-ADOPT-001 — Exact vendoring preserves revision identity without transferring product authority

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT-001`
- Contradicted by evidence: none known
- Uncertainty: distribution integrity does not itself establish local semantic acceptance or future product conformance.

### CLM-ADOPT-002 — Replacing the unmerged custom candidate reduces governance drift

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT-002`
- Contradicted by evidence: none known
- Uncertainty: repository-specific authority and actors still require local declaration and independent review.

### CLM-ADOPT-003 — Forward-only pilot adoption is compatible with current Forum work

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPT-003`
- Contradicted by evidence: none known
- Uncertainty: future real Spec cycles may justify a later update or stronger deterministic gates.

## 7. Evidence relations

### EVD-ADOPT-001 — Source and target identities support exact vendoring

- Source observations: `OBS-ADOPT-001`, `OBS-ADOPT-003`
- Target: `CLM-ADOPT-001`
- Relation: SUPPORTS
- Bound coordinates: source `46f78c3f00d768d99a4c8c2da975b124bce042f9`, target tree `0e106c190c96e8067ebc0cf848a701ac029134c7`, observed `2026-08-19T14:32:45Z`
- Strength/sufficiency: sufficient for exact-byte, file-set, mode, and lock identity
- Limitations: does not perform semantic review or local acceptance
- Provenance: source manifest, source and target Git trees, and governance lock

### EVD-ADOPT-002 — The unmerged custom candidate supports replacement rather than supersession

- Source observations: `OBS-ADOPT-002`
- Target: `CLM-ADOPT-002`
- Relation: SUPPORTS
- Bound coordinates: Forum base `502cfca5a180d6c49fe75dfc270fd117f279ccfb`, previous candidate `060e0fe231707687dabbf6d4ec84940cecd635fb`
- Strength/sufficiency: sufficient to show the old text never became repository authority and may be replaced inside the same Draft PR
- Limitations: does not approve the new adoption candidate
- Provenance: PR #4 metadata and diff

### EVD-ADOPT-003 — Local inventory supports forward-only adoption

- Source observations: `OBS-ADOPT-004`
- Target: `CLM-ADOPT-003`
- Relation: SUPPORTS
- Bound coordinates: Agent Forum `main @ 502cfca5a180d6c49fe75dfc270fd117f279ccfb`, observed `2026-08-19T14:32:45Z`
- Strength/sufficiency: sufficient for a forward-only governance pilot with no historical rewrite
- Limitations: enforcement remains manual until repository-specific gates and branch protection are actually activated
- Provenance: repository tree, local authority declaration, and live branch settings

## 8. Decisions

### DEC-ADOPT-001 — Adopt an exact vendored source revision

- Decision owner: `mayf3`
- Decision: use source commit `46f78c3f00d768d99a4c8c2da975b124bce042f9` and record every distributed digest in the local lock.
- Rejected alternatives: floating `main`, `latest`, runtime fetch, and an uninitialized default submodule.
- Reason: every clone and implementation base contains reviewable exact bytes, and upstream movement cannot silently alter local governance.
- Owner decision remaining: NONE

### DEC-ADOPT-002 — Replace the parallel Draft candidate with shared distribution plus local extensions

- Decision owner: `mayf3`
- Decision: PR #4 will vendor the shared grammar/protocol and retain only Forum-owned entrypoint, authority map, lock, Spec index, and adoption Spec.
- Rejected alternative: maintain a 1,652-line Forum-specific fork of the shared governance model.
- Reason: one reusable source reduces semantic divergence while local files preserve repository ownership.
- Owner decision remaining: NONE

### DEC-ADOPT-003 — Preserve Agent Forum product authority

- Decision owner: `mayf3`
- Decision: `AGENT_FORUM_PRODUCT_DIRECTION_V1` remains above all lower-level local Specs; the external governance repository is only a constrained dependency.
- Rejected alternative: treat the central repository as remote product authority.
- Reason: repository ownership and cross-repository authority boundaries.
- Owner decision remaining: NONE

### DEC-ADOPT-004 — Use a forward-only manual-policy pilot

- Decision owner: `mayf3`
- Decision: apply governance from the next non-mechanical change forward, truthfully label enforcement as manual, and pilot real Spec cycles before adding broad CI gates.
- Rejected alternative: bulk rewrite history or claim an unimplemented merge gate.
- Reason: minimize bureaucracy and preserve enforcement truth.
- Owner decision remaining: NONE

## 9. Contracts

### CTR-ADOPT-001 — Exact source identity

The repository MUST vendor all 17 distribution-manifest paths from source commit `46f78c3f00d768d99a4c8c2da975b124bce042f9`. The lock MUST record the exact commit, distribution version, manifest digest, per-file SHA-256, and size. A floating reference MUST NOT activate governance.

### CTR-ADOPT-002 — Truthful adoption transition

The prepared snapshot MUST remain `adoption.status: proposed` with `accepted_by: null` and `accepted_at: null`. Only `mayf3`, after independent review, MAY prepare the accepted transition. The adoption becomes active only after the accepted final head is merged into `main`.

### CTR-ADOPT-003 — Local authority ownership

`.agents/local/README.md` MUST identify Agent Forum Product Direction, precedence, acceptance actors, mechanical-exemption reviewers, emergency actors, and persistence locations. The external distribution MUST NOT govern or supersede Agent Forum product authority.

### CTR-ADOPT-004 — No implementation authorization

This adoption Spec MUST use `implementation_authority: none`. The adoption PR MUST NOT change Forum product code, schema, tests, deployment, authentication, authorization, or runtime behavior, and MUST NOT authorize a later product implementation without a separate accepted implementation-authorizing Spec in its base.

### CTR-ADOPT-005 — Honest enforcement

Repository documentation MUST separately identify manual policy, available distribution-integrity verification, schema availability, unimplemented full Spec syntax gate, unimplemented base-branch gate, and unconfigured required branch protection.

### CTR-ADOPT-006 — Explicit updates and rollback

No later upstream commit or tag MAY change Agent Forum governance until a separate docs-only update is reviewed, accepted, and merged locally. Rollback MUST restore the prior lock and complete vendored file set together by reverting the adoption/update commit.

### CTR-ADOPT-007 — Forward-only use

The repository MUST NOT bulk rewrite historical documents as part of adoption. Historical material is reconciled only when it becomes governing, is cited by new work, or conflicts with active authority.

## 10. Acceptance

### ACC-ADOPT-001 — Source, manifest, tree, and lock agree

- Contracts: `CTR-ADOPT-001`
- Method: compare source commit, manifest digest, all 17 source/target blob identities and sizes, executable mode, and lock entries
- Environment: exact source commit and exact Forum adoption candidate
- Required evidence: source manifest, source and target Git trees, lock, and `python3 .agents/tools/verify_governance.py --target .`
- Expected result: all identities match and the verifier passes without requiring accepted status
- Failure condition: any missing path, byte/size/mode mismatch, wrong source commit, or floating identity fails acceptance

### ACC-ADOPT-002 — Proposed state cannot fabricate acceptance

- Contracts: `CTR-ADOPT-002`
- Method: inspect proposed lock, review record, authorized acceptance action, accepted lock transition, and final-head recheck
- Environment: Draft adoption PR before and after explicit owner acceptance
- Required evidence: proposed lock, exact independent review, accepted lock, acceptance actor identity, final accepted head, and semantic-delta result
- Expected result: proposed metadata remains null; accepted metadata appears only after authorized action; final recheck passes with semantic delta `NONE`
- Failure condition: preparation claims acceptance, an unauthorized actor accepts, or semantic content changes after review

### ACC-ADOPT-003 — Local authority map is complete and repository-owned

- Contracts: `CTR-ADOPT-003`
- Method: review `.agents/local/README.md` against Product Direction, actors, and persistence locations
- Environment: exact adoption candidate
- Required evidence: local file, Product Direction path, and independent reviewer finding
- Expected result: every required authority and actor is explicit; the central repository is dependency-only
- Failure condition: precedence is ambiguous, an actor is missing, or external governance is treated as product authority

### ACC-ADOPT-004 — Diff is governance/docs only and grants no product implementation authority

- Contracts: `CTR-ADOPT-004`
- Method: compare `main @ 502cfca5a180d6c49fe75dfc270fd117f279ccfb` with the final candidate and inspect Spec frontmatter
- Environment: Draft PR #4
- Required evidence: changed-path list, diff statistics, and adoption Spec frontmatter
- Expected result: only `AGENTS.md`, `.agents/**`, and `docs/specs/**` change; `implementation_authority` is `none`
- Failure condition: any product, schema, test, deployment, or runtime change appears, or the Spec claims Contract implementation authority

### ACC-ADOPT-005 — Enforcement claims match reality

- Contracts: `CTR-ADOPT-005`
- Method: compare entrypoint/local declarations with live GitHub branch protection and repository gates
- Environment: repository files plus live GitHub settings
- Required evidence: branch settings, required checks, and governance files
- Expected result: manual and deterministic capabilities are separately and truthfully labeled
- Failure condition: branch protection, base gate, full syntax gate, or semantic CI is claimed active when it is not

### ACC-ADOPT-006 — Upstream movement is inert until a local update and rollback is complete

- Contracts: `CTR-ADOPT-006`
- Method: inspect exact source pin, simulate a later update as a separate diff, and verify a full Git revert restores the previous lock/file set
- Environment: temporary or review branch derived from the accepted adoption
- Required evidence: before/after tree identities, update diff, and rollback diff
- Expected result: upstream movement has no effect without a consumer commit; rollback restores the complete prior snapshot
- Failure condition: local governance floats or partial rollback leaves mixed revisions

### ACC-ADOPT-007 — Historical files remain unchanged

- Contracts: `CTR-ADOPT-007`
- Method: inspect adoption diff and future first-pilot preflight
- Environment: Draft PR #4 and first post-adoption non-mechanical task
- Required evidence: changed paths and preflight record
- Expected result: no bulk historical rewrite; reconciliation is bounded to material that becomes governing or conflicting
- Failure condition: adoption rewrites unrelated historical docs or silently reclassifies them as accepted authority

### Contract coverage

| Contract | Acceptance | Covered |
|---|---|---|
| `CTR-ADOPT-001` | `ACC-ADOPT-001` | YES |
| `CTR-ADOPT-002` | `ACC-ADOPT-002` | YES |
| `CTR-ADOPT-003` | `ACC-ADOPT-003` | YES |
| `CTR-ADOPT-004` | `ACC-ADOPT-004` | YES |
| `CTR-ADOPT-005` | `ACC-ADOPT-005` | YES |
| `CTR-ADOPT-006` | `ACC-ADOPT-006` | YES |
| `CTR-ADOPT-007` | `ACC-ADOPT-007` | YES |

## 11. Alternatives and disposition

### ALT-ADOPT-001 — Keep the Forum-specific governance fork

- Disposition: rejected
- Reason: it duplicates the central grammar and creates two semantic sources to maintain.
- Evidence/Claims considered: `OBS-ADOPT-002`, `CLM-ADOPT-002`
- What would reopen: the central distribution becomes fundamentally incompatible with a required Forum authority rule that cannot be expressed as a local extension.

### ALT-ADOPT-002 — Follow upstream `main` or `latest`

- Disposition: rejected
- Reason: future upstream changes could silently change the rules governing a consumer base.
- Evidence/Claims considered: `OBS-ADOPT-001`, `CLM-ADOPT-001`
- What would reopen: NONE in V0; updates remain exact-commit local decisions.

### ALT-ADOPT-003 — Git submodule or runtime fetch

- Disposition: rejected
- Reason: Agents may not have initialized submodules or network access, and the exact governing bytes would not be guaranteed in every clone/base.
- Evidence/Claims considered: `CLM-ADOPT-001`
- What would reopen: a future repository platform provides deterministic, mandatory dependency materialization in every Agent environment.

### ALT-ADOPT-004 — Wait for the first stable upstream tag

- Disposition: deferred, not selected for the pilot
- Reason: the upstream bootstrap is already independently accepted and can be pinned exactly; the draft label is represented honestly and has no floating effect.
- Evidence/Claims considered: `OBS-ADOPT-001`, `CLM-ADOPT-003`
- What would reopen: creation of a stable tag or later accepted release triggers a separate local update review.

## 12. Migration, compatibility, and rollback

```text
MIGRATION = replace the unmerged four-file custom candidate with exact shared distribution plus local extensions
HISTORICAL_AUTHORITY_SUPERSESSION = none; the replaced candidate never became active authority
HISTORICAL_REWRITE = none
PRODUCT_COMPATIBILITY = unchanged
ROLLBACK = revert the complete adoption or later update commit
EMERGENCY_CONTAINMENT = not applicable to this docs-only adoption
```

## 13. Open questions

```text
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE
PARTIAL_SUPERSESSION = NONE
READY_TO_MARK_ACCEPTED = NO
```

Independent review of the exact candidate, owner acceptance metadata, and final-head recheck remain required before this proposed adoption may become active on `main`.
