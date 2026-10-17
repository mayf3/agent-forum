---
spec_id: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2
status: proposed
spec_kind: invariant
authority_level: governing_spec
implementation_authority: none
scope:
  - mayf3/agent-forum repository governance
governed_by: []
external_authorities:
  - repository: mayf3/agent-development-governance
    authority_id: AGENT_DEVELOPMENT_GOVERNANCE_BOOTSTRAP_V0
    revision: 46f78c3f00d768d99a4c8c2da975b124bce042f9
    relation: constrained_by
supersedes:
  - AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2

## 1. Goal

Preserve Agent Forum's exact, locally accepted Development Grammar and
Spec-governance adoption while making a future whole-authority Product
Direction V2 transition possible without silently rewriting the accepted V1
governance-adoption meaning.

```text
GOAL = preserve the accepted governance distribution and replace only the local Product Direction registration lifecycle
SUCCESS_OUTCOME = one atomic docs-only transition can register an accepted AGENT_FORUM_PRODUCT_DIRECTION_V2, retain both V1 histories, and grant no product implementation authority
```

This Spec is a proposed whole successor to
`AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1`. It does not accept Product
Direction V2, supersede either V1 authority on `main`, alter the governance
lock, refresh vendored bytes, or authorize product implementation.

## 2. Scope and non-goals

### In scope

- exact preservation of the already accepted
  `development-governance-v0@46f78c3f00d768d99a4c8c2da975b124bce042f9`
  distribution and 17-file lock;
- whole-Spec replacement of the V1 governance-adoption authority;
- a future atomic lifecycle transaction for Product Direction V2, Product
  Direction V1, Governance Adoption V2, and Governance Adoption V1;
- the repository-local authority registry, navigation index, acceptance actors,
  persistence locations, enforcement truth, forward-only adoption, update, and
  rollback boundaries;
- an explicit compatibility boundary preventing the accepted Core V1 from
  authorizing new Product Direction V2 Service/Admin/Puller behavior.

### Out of scope

- accepting or merging this proposal;
- independently reviewing or accepting
  `AGENT_FORUM_PRODUCT_DIRECTION_V2`;
- modifying Product Direction V1 or V2 in this authoring candidate;
- modifying `.agents/governance.lock.json`, any vendored `.agents` distribution
  path, `AGENTS.md`, or `.agents/local/README.md` in this authoring candidate;
- any Forum product behavior, code, test, schema, migration, route, identity,
  permission, token, Grant, credential, deployment, runtime, or production-data
  change;
- changing the external governance distribution or claiming authority over its
  source repository;
- changing Core V1 Contract meaning, reparenting Core V1, or authorizing a Core
  V2 implementation;
- implementing a Spec syntax gate, base-branch gate, required branch
  protection, ruleset, or semantic CI reviewer.

## 3. Authority and dependencies

```text
REPOSITORY = mayf3/agent-forum
AUTHORITY_BRANCH = main
AUTHORING_BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
CLASSIFICATION = SUPERSEDE
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
PRIMARY_GOVERNING_SPEC_BLOB = 67225af9ad37d2adfffdb938ba324a205b96c46d
PRIMARY_GOVERNING_SPEC_SHA256 = 6ab9022e852e02a2d55030862da897ff87394413a64a7b502dc4c9067ce18f6d
PRIMARY_GOVERNING_SPEC_BODY_FROM_TITLE_SHA256 = 0523850d42412685a62dd5a13d17216db6824666a61d2c4169d509d02b2eebfe
IMPLEMENTATION_AUTHORITY = none

EXTERNAL_SOURCE_REPOSITORY = mayf3/agent-development-governance
EXTERNAL_SOURCE_AUTHORITY = AGENT_DEVELOPMENT_GOVERNANCE_BOOTSTRAP_V0
EXTERNAL_SOURCE_REVISION = 46f78c3f00d768d99a4c8c2da975b124bce042f9
DISTRIBUTION = development-governance-v0
DISTRIBUTION_VERSION = 0.1.0-draft.1
DISTRIBUTION_MANIFEST_SHA256 = 58b5b28bb801538fe62be0ac98a7bc539ff34ec24fa368c48996dd40d8653ba0
DISTRIBUTED_PATH_COUNT = 17
```

This Spec remains a top-level repository-governance authority with
`governed_by: []`. Product Direction does not govern the adoption mechanism;
the adoption mechanism registers and orders locally owned Product Direction.
The external governance source remains a constrained, exact dependency and
does not own Agent Forum product meaning.

The proposed Product Direction dependency observed during authoring is:

```text
PROPOSED_PRODUCT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2
PROPOSED_PRODUCT_BRANCH = codex/forum-product-direction-v2
PROPOSED_PRODUCT_BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
PROPOSED_PRODUCT_FILE_BLOB = 79dccec43883adc939077abcb2dcf0b7b7502f4a
PROPOSED_PRODUCT_STAGED_DIFF_SHA256 = 1a646b4110d63f6fba698581b4669fcbc536f779ca58f630c4d8af7c37a9186b
PROPOSED_PRODUCT_STATUS = proposed
PROPOSED_PRODUCT_IMPLEMENTATION_AUTHORITY = none
```

These coordinates bind the authoring Observation only. If that Product
Direction candidate changes, review of this Spec must re-evaluate the new exact
revision. Acceptance of this Spec is forbidden until the Product Direction's
exact final content has independent semantic review and authorized Owner
acceptance in the same atomic lifecycle candidate.

## 4. Current State

### STATE-ADOPTV2-001 — Governance adoption is accepted and byte-pinned

- Subject: Agent Forum shared-governance adoption
- As of commit: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository source and local governance verifier
- Observed at: `2026-08-31T23:53:41Z`
- Projection: Adoption V1 is accepted; the lock names source commit
  `46f78c3f00d768d99a4c8c2da975b124bce042f9`; all 17 vendored paths match; the
  distribution remains `0.1.0-draft.1`.
- Basis: `OBS-ADOPTV2-001`, `OBS-ADOPTV2-002`, `EVD-ADOPTV2-001`

### STATE-ADOPTV2-002 — Active local governance registers Product Direction V1

- Subject: local Product Direction registration and precedence
- As of commit: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository authority files
- Observed at: `2026-08-31T23:53:41Z`
- Projection: Adoption V1, `.agents/local/README.md`, and
  `docs/specs/README.md` identify `AGENT_FORUM_PRODUCT_DIRECTION_V1` as the
  active highest Product Direction; Product Direction V2 is absent from main.
- Basis: `OBS-ADOPTV2-003`, `EVD-ADOPTV2-002`

### STATE-ADOPTV2-003 — Product Direction V2 is a frozen proposal only

- Subject: proposed Product Direction successor
- As of artifact: branch `codex/forum-product-direction-v2`, file blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`, staged-diff SHA-256
  `1a646b4110d63f6fba698581b4669fcbc536f779ca58f630c4d8af7c37a9186b`
- Environment: separate local worktree based on Forum main
- Observed at: `2026-08-31T23:53:41Z`
- Projection: V2 is proposed, docs-only, unmerged, inactive, and grants no
  implementation authority; its lifecycle section requires an Adoption V1
  whole successor before activation.
- Basis: `OBS-ADOPTV2-004`, `EVD-ADOPTV2-003`

### STATE-ADOPTV2-004 — Enforcement remains manual

- Subject: repository enforcement
- As of commit/environment: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db` and GitHub repository settings
- Observed at: `2026-08-31T23:53:41Z`
- Projection: distribution-integrity verification is available; full Spec
  syntax and base-branch gates are not implemented; GitHub reports main as not
  protected and returns no repository rulesets.
- Basis: `OBS-ADOPTV2-005`, `EVD-ADOPTV2-004`

## 5. Observations

### OBS-ADOPTV2-001 — Adoption V1 is active exact authority

- Subject: Governance Adoption V1 lifecycle
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`,
  blob `67225af9ad37d2adfffdb938ba324a205b96c46d`
- Environment: repository source
- Observed at: `2026-08-31T23:53:41Z`
- Method: inspect Spec frontmatter and `.agents/governance.lock.json`
- Result: the Spec and lock are accepted; lock acceptance is attributed to
  `mayf3` at `2026-08-20T00:21:44Z`.
- Provenance: `docs/specs/AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1.md`,
  `.agents/governance.lock.json`.

### OBS-ADOPTV2-002 — Vendored governance bytes still match

- Subject: accepted governance distribution integrity
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: clean V2 authoring worktree
- Observed at: `2026-08-31T23:53:41Z`
- Method: execute
  `python3 .agents/tools/verify_governance.py --target . --require-accepted`
- Result: verifier reports all vendored bytes match the lock and adoption is
  accepted; the lock contains 17 distributed paths, source commit
  `46f78c3f00d768d99a4c8c2da975b124bce042f9`, version
  `0.1.0-draft.1`, and manifest SHA-256
  `58b5b28bb801538fe62be0ac98a7bc539ff34ec24fa368c48996dd40d8653ba0`.
- Provenance: command output and `.agents/governance.lock.json`.

### OBS-ADOPTV2-003 — Accepted V1 meaning fixes Product Direction V1

- Subject: local Product Direction registration
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: accepted authority and local registry
- Observed at: `2026-08-31T23:53:41Z`
- Method: inspect Adoption V1 §3, `DEC-ADOPT-003`, `CTR-ADOPT-003`,
  `ACC-ADOPT-003`, `.agents/local/README.md`, and `docs/specs/README.md`
- Result: all identify Product Direction V1 as the active highest local Product
  Direction. V1's accepted Decision cannot be changed under the same Spec ID.
- Provenance: the named files and stable V1 items.

### OBS-ADOPTV2-004 — Proposed Product Direction V2 requires an adoption successor

- Subject: frozen Product Direction V2 proposal
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: proposed file blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`, staged-diff SHA-256
  `1a646b4110d63f6fba698581b4669fcbc536f779ca58f630c4d8af7c37a9186b`
- Environment: branch `codex/forum-product-direction-v2`, separate worktree
- Observed at: `2026-08-31T23:53:41Z`
- Method: inspect frontmatter and §§12-14; verify branch status and hashes
- Result: V2 is proposed with `implementation_authority: none`, whole-
  supersedes Product Direction V1, and requires a whole successor to Governance
  Adoption V1 in its future atomic acceptance transaction.
- Provenance: proposed Product Direction V2 candidate.

### OBS-ADOPTV2-005 — Deterministic enforcement has not expanded

- Subject: governance enforcement truth
- Repository/source: local files plus GitHub API
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: local worktree and `mayf3/agent-forum` GitHub settings
- Observed at: `2026-08-31T23:53:41Z`
- Method: inspect `AGENTS.md` and `.agents/local/README.md`; call GitHub branch
  protection and repository-ruleset APIs
- Result: files report manual policy, no full syntax/base gate, and no required
  branch protection; GitHub returns `404 Branch not protected` and an empty
  ruleset list.
- Provenance: local files and GitHub API responses.

### OBS-ADOPTV2-006 — Core V1 cannot authorize new V2 actor surfaces

- Subject: downstream implementation-authority boundary
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: Core V1 blob
  `f4645e2882706afd5d3a71330ae2ffc201187d2d`
- Environment: accepted authority on main
- Observed at: `2026-08-31T23:53:41Z`
- Method: inspect Core V1 frontmatter, §§2-3, and its inbound identity Contract
- Result: Core V1 is governed by Product Direction V1, accepts direct Agent
  access tokens, and rejects Service/Human/delegated profiles until a separate
  accepted Forum authority exists.
- Provenance: `docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md`.

## 6. Claims and assumptions

### CLM-ADOPTV2-001 — The registry change requires whole supersession

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPTV2-002`, `EVD-ADOPTV2-003`
- Contradicted by evidence: none known
- Uncertainty: none for classification; Product Direction V2 acceptance remains
  a separate future act.

### CLM-ADOPTV2-002 — Revendoring would create unrelated risk

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPTV2-001`
- Contradicted by evidence: none known
- Uncertainty: a future distribution update may be useful, but it is not needed
  for this authority lifecycle change.

### CLM-ADOPTV2-003 — Atomic lifecycle alignment prevents split authority

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPTV2-002`, `EVD-ADOPTV2-003`
- Contradicted by evidence: none known
- Uncertainty: the exact final Product Direction V2 revision remains subject to
  independent review and Owner acceptance.

### CLM-ADOPTV2-004 — Adoption acceptance cannot authorize V2 implementation

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPTV2-003`, `EVD-ADOPTV2-005`
- Contradicted by evidence: none known
- Uncertainty: future child Specs determine implementation slices.

### CLM-ADOPTV2-005 — Enforcement labels must remain unchanged

- Support state: SUPPORTED
- Supported by evidence: `EVD-ADOPTV2-004`
- Contradicted by evidence: none known
- Uncertainty: future repository settings may change and would require fresh
  evidence before changing the labels.

```text
OPEN_ASSUMPTIONS = NONE
```

## 7. Evidence relations

### EVD-ADOPTV2-001 — Lock and verifier support exact preservation

- Source observations: `OBS-ADOPTV2-001`, `OBS-ADOPTV2-002`
- Target: `STATE-ADOPTV2-001`, `CLM-ADOPTV2-002`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`, observed
  `2026-08-31T23:53:41Z`
- Strength/sufficiency: sufficient for current lock status, source pin, file
  count, manifest digest, and byte integrity
- Limitations: does not semantically review the distribution or future V2
  authority
- Provenance: lock, verifier output, Adoption V1.

### EVD-ADOPTV2-002 — Active files support the V1 registry State

- Source observations: `OBS-ADOPTV2-003`
- Target: `STATE-ADOPTV2-002`, `CLM-ADOPTV2-001`, `CLM-ADOPTV2-003`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`, observed
  `2026-08-31T23:53:41Z`
- Strength/sufficiency: direct accepted local authority and registry evidence
- Limitations: does not accept Product Direction V2
- Provenance: Adoption V1, `.agents/local/README.md`, `docs/specs/README.md`.

### EVD-ADOPTV2-003 — Product proposal supports the atomic successor need

- Source observations: `OBS-ADOPTV2-004`
- Target: `STATE-ADOPTV2-003`, `CLM-ADOPTV2-001`,
  `CLM-ADOPTV2-003`, `CLM-ADOPTV2-004`
- Relation: SUPPORTS
- Bound coordinates: Product proposal blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`, observed
  `2026-08-31T23:53:41Z`
- Strength/sufficiency: sufficient for the proposed lifecycle dependency
- Limitations: proposal is inactive and may change after review
- Provenance: Product Direction V2 candidate.

### EVD-ADOPTV2-004 — Files and GitHub settings support manual enforcement

- Source observations: `OBS-ADOPTV2-005`
- Target: `STATE-ADOPTV2-004`, `CLM-ADOPTV2-005`
- Relation: SUPPORTS
- Bound coordinates: Forum main and GitHub settings, observed
  `2026-08-31T23:53:41Z`
- Strength/sufficiency: sufficient for the observed enforcement surfaces
- Limitations: GitHub settings are time-sensitive and must be rechecked at
  review and acceptance
- Provenance: `AGENTS.md`, `.agents/local/README.md`, GitHub API.

### EVD-ADOPTV2-005 — Core authority supports the no-implementation leap Claim

- Source observations: `OBS-ADOPTV2-006`
- Target: `CLM-ADOPTV2-004`
- Relation: SUPPORTS
- Bound coordinates: Core V1 blob
  `f4645e2882706afd5d3a71330ae2ffc201187d2d`, Forum main
- Strength/sufficiency: direct accepted Contract boundary
- Limitations: does not define the future Core V2
- Provenance: Core V1.

## 8. Decisions

### DEC-ADOPTV2-001 — Whole-supersede Adoption V1

- Decision owner: `mayf3`
- Decision: use a new complete V2 invariant with new stable IDs and preserve V1
  as historical authority after the atomic accepted transition.
- Rejected alternative: edit `DEC-ADOPT-003` or `CTR-ADOPT-003` in place.
- Reason: accepted meaning is immutable and the registered Product Direction ID
  changes.
- Owner decision remaining: NONE.

### DEC-ADOPTV2-002 — Preserve the exact distribution and lock

- Decision owner: `mayf3`
- Decision: keep the source commit, 17 vendored files, manifest digest, and
  accepted lock byte-for-byte unchanged in both authoring and acceptance.
- Rejected alternative: combine this lifecycle change with an upstream refresh.
- Reason: no distribution gap exists; combining changes would enlarge review
  and rollback scope without advancing the Product Direction transition.
- Owner decision remaining: NONE.

### DEC-ADOPTV2-003 — Require one atomic authority transition

- Decision owner: `mayf3`
- Decision: Product V2 acceptance, Product V1 supersession, Adoption V2
  acceptance, Adoption V1 supersession, local registry switch, and navigation
  update must be one complete docs-only candidate and merge.
- Rejected alternative: merge one-sided status, backlink, or registry changes.
- Reason: partial activation would create conflicting authority signals.
- Owner decision remaining: NONE.

### DEC-ADOPTV2-004 — Preserve local ownership and no implementation authority

- Decision owner: `mayf3`
- Decision: Product Direction V2 becomes the highest locally owned product
  authority only after activation; the external distribution remains
  dependency-only; Adoption V2 retains `implementation_authority: none`.
- Rejected alternative: infer product or implementation authority from the
  governance source or adoption acceptance.
- Reason: preserve repository ownership and Spec-first implementation gates.
- Owner decision remaining: NONE.

### DEC-ADOPTV2-005 — Preserve manual enforcement labels

- Decision owner: `mayf3`
- Decision: keep current enforcement declarations unchanged until the actual
  repository controls change and are independently evidenced.
- Rejected alternative: describe policy files as branch protection or semantic
  CI enforcement.
- Reason: enforcement claims must match observable reality.
- Owner decision remaining: NONE.

### DEC-ADOPTV2-006 — Keep Core V1 bounded to preserved V1 meanings

- Decision owner: `mayf3`
- Decision: Product/Adoption V2 activation does not modify Core V1 or authorize
  new Service/Admin/Puller implementation; those slices require a separate
  accepted Core-level authority and child implementation Specs. A whole Core
  successor is required only if that authority overlaps or changes a Core V1
  surface or Contract rather than defining disjoint privileged Service routes.
- Rejected alternative: treat the higher-level Product change as direct child
  Contract authorization.
- Reason: Product Direction and governance adoption both have implementation
  authority `none`, while Core V1 authorizes only direct Agent identity on its
  V1 surfaces and reserves any Service profile to separate accepted Forum
  authority.
- Owner decision remaining: NONE.

## 9. Contracts

### CTR-ADOPTV2-001 — Exact distribution identity is preserved

The repository MUST retain all 17 manifest-governed paths from source commit
`46f78c3f00d768d99a4c8c2da975b124bce042f9`, distribution version
`0.1.0-draft.1`, and manifest SHA-256
`58b5b28bb801538fe62be0ac98a7bc539ff34ec24fa368c48996dd40d8653ba0`.
This Product Direction lifecycle transition MUST NOT modify the accepted lock,
source pin, vendored file bytes, sizes, modes, or digests.

### CTR-ADOPTV2-002 — Proposed authorities remain inactive

While this Spec or Product Direction V2 remains proposed or absent from
`main`, Adoption V1 and Product Direction V1 remain active. Proposal creation,
review, labels, staging, commits on non-authority branches, or acceptance-looking
metadata outside `main` MUST NOT switch local authority or authorize
implementation.

### CTR-ADOPTV2-003 — Product Direction acceptance is an exact prerequisite

Adoption V2 MUST NOT be marked accepted unless the exact complete Product
Direction V2 content in the same lifecycle candidate has received independent
semantic review, authorized Owner acceptance, final-head recheck, and
`SEMANTIC_DELTA_AFTER_REVIEW = NONE`. Any change to Product Goal, scope,
identity, capability, notification, governance, security, compatibility, or
lifecycle meaning invalidates the prior Adoption V2 review and MUST be
re-reviewed.

### CTR-ADOPTV2-004 — Authority lifecycle transition is atomic

The future accepted candidate MUST contain all of the following in one
docs-only Git transition:

1. Product Direction V2: `status: accepted`,
   `supersedes: [AGENT_FORUM_PRODUCT_DIRECTION_V1]`;
2. Product Direction V1: `status: superseded`,
   `superseded_by: AGENT_FORUM_PRODUCT_DIRECTION_V2`, with its historical body
   preserved;
3. Adoption V2: `status: accepted`,
   `supersedes: [AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1]`;
4. Adoption V1: `status: superseded`,
   `superseded_by: AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2`, with its
   historical body from the `# AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1`
   title through EOF preserved at SHA-256
   `0523850d42412685a62dd5a13d17216db6824666a61d2c4169d509d02b2eebfe`;
5. `.agents/local/README.md`: Adoption V2 and Product Direction V2 registered as
   active; both V1 authorities indexed as superseded history;
6. `docs/specs/README.md`: navigation updated consistently;
7. `.agents/governance.lock.json` and all 17 distributed paths: unchanged.

Missing, inconsistent, or one-sided transition content MUST fail review and
MUST NOT be merged as an activation candidate. The accepted-looking branch is
still inactive until that exact complete transition is merged into `main`.

### CTR-ADOPTV2-005 — Local authority ownership and precedence remain explicit

After activation, `.agents/local/README.md` MUST declare:

```text
AGENT_FORUM_PRODUCT_DIRECTION_V2
> accepted local Architecture / long-lived Invariant authorities
> accepted local governing Specs
> code, tests, runtime, and operational records
```

It MUST retain the authorized acceptance/review/emergency actors and persistence
locations. The external governance repository MUST NOT own, accept, supersede,
or implement Agent Forum product authority.

### CTR-ADOPTV2-006 — No product implementation authorization

This Spec MUST retain `implementation_authority: none`. Its authoring,
acceptance, merge, or activation MUST NOT authorize any Forum product code,
schema, migration, API, identity, permission, credential, Grant, deployment,
runtime, or production-data change. Non-mechanical implementation still
requires an accepted implementation-authorizing child Spec in its base.

### CTR-ADOPTV2-007 — Core V1 cannot authorize new V2 actor behavior

Activation MUST record that `AGENT_FORUM_CORE_INVARIANTS_V1` remains applicable
only to the direct-Agent discussion meanings preserved by Product Direction V2.
It MUST NOT authorize Service Principal acceptance, `forum.admin`,
`forum.notification.consume`, new Admin/Puller routes, or `moderator_notice`.
Those behaviors require an independently reviewed, accepted, and merged
Core-level authority plus the relevant child implementation Specs. That
authority MAY coexist with Core V1 only when its privileged Service routes are
exact and disjoint and every Core V1 Contract remains unchanged; otherwise it
MUST whole-supersede Core V1.

### CTR-ADOPTV2-008 — Enforcement claims remain truthful

Repository authority surfaces MUST continue to distinguish manual policy,
available distribution-integrity verification, schema availability,
unimplemented full Spec syntax gate, unimplemented base-branch gate, and
unconfigured branch protection/rulesets. A future enforcement change MUST be
recorded only after the actual control exists and current evidence supports it.

### CTR-ADOPTV2-009 — Future distribution updates remain separate and exact

A later upstream commit, tag, or release MUST have no local effect until a
separate docs-only distribution update pins exact source/manifest/file
identities, receives independent review and Owner acceptance, and is merged to
`main`. Product Direction lifecycle change MUST NOT silently refresh or float
the distribution.

### CTR-ADOPTV2-010 — Forward-only history and complete rollback

The transition MUST NOT bulk-rewrite unrelated historical material. V1 bodies
remain historical evidence under complete supersession metadata. Before
activation, abandoning or reverting a proposal leaves main unchanged. After
activation, rollback MUST revert the complete Product/Adoption V2 transition as
one Git change or fail loud; partial rollback that leaves mismatched statuses,
backlinks, registry entries, navigation, lock, or vendored bytes is forbidden.

## 10. Acceptance

### ACC-ADOPTV2-001 — Distribution and lock are unchanged

- Contracts: `CTR-ADOPTV2-001`, `CTR-ADOPTV2-009`
- Method: run the governance verifier, compare the lock blob and all 17
  vendored paths byte/size/mode/digest against the pre-transition main tree
- Environment: exact authoring/review/final lifecycle candidate
- Required evidence: base/final tree identities, lock digest, manifest digest,
  verifier output, changed-path list
- Expected result: verifier passes with accepted adoption; zero lock or
  distributed-path delta
- Failure condition: any source pin, lock field, byte, size, mode, digest, path,
  or distribution version changes

### ACC-ADOPTV2-002 — Proposed state has no authority effect

- Contracts: `CTR-ADOPTV2-002`
- Method: inspect `main`, proposal branches, frontmatter, registry, and
  implementation preflight behavior before activation
- Environment: current main plus proposed candidate branches
- Required evidence: exact main commit, candidate commits/blobs/status, local
  registry, and a preflight result
- Expected result: main continues to register both V1 authorities; all V2
  candidates report inactive and implementation forbidden
- Failure condition: a proposed/unmerged artifact is treated as active or used
  to authorize implementation

### ACC-ADOPTV2-003 — Product Direction dependency has exact review binding

- Contracts: `CTR-ADOPTV2-003`
- Method: compare reviewed Product V2 commit/blob with the final accepted
  candidate and acceptance record
- Environment: final docs-only lifecycle candidate
- Required evidence: reviewer identity, reviewed base and Product revision,
  acceptance actor/time, final-head recheck, semantic-delta statement
- Expected result: exact content is independently reviewed and Owner-accepted;
  final semantic delta is none
- Failure condition: missing review/acceptance, unauthorized actor, changed
  meaning, stale revision, or unresolved owner decision

### ACC-ADOPTV2-004 — Whole lifecycle transaction is complete

- Contracts: `CTR-ADOPTV2-004`
- Method: machine/read-only inspect the seven required transition surfaces and
  independently review lifecycle prose/backlinks
- Environment: exact final docs-only candidate
- Required evidence: changed paths, four authority frontmatters, V1 historical
  body digests, local registry, navigation index, lock/vendor no-diff proof
- Expected result: every required item is present and mutually consistent; no
  partial supersession or one-sided backlink exists
- Failure condition: any required item is absent, inconsistent, partially
  applied, or changes V1 historical stable-ID meaning

### ACC-ADOPTV2-005 — Local ownership and actor registry remain complete

- Contracts: `CTR-ADOPTV2-005`
- Method: compare `.agents/local/README.md` with Product V2, both Adoption
  authorities, actors, precedence, persistence locations, and external boundary
- Environment: exact final candidate
- Required evidence: local registry and independent authority review
- Expected result: Product V2 is the highest active product authority after
  merge; external governance remains dependency-only; V1 history is explicit
- Failure condition: precedence, actor, location, external ownership, or
  lifecycle state is ambiguous

### ACC-ADOPTV2-006 — Diff remains docs/governance only

- Contracts: `CTR-ADOPTV2-006`
- Method: compare base with authoring and final lifecycle candidates; inspect
  frontmatter and requested authority set
- Environment: candidate worktrees and final transition PR
- Required evidence: changed-path list, diff statistics, frontmatter
- Expected result: only Product/Spec/investigation/index/local-governance docs
  required for the transition change; implementation authority is none
- Failure condition: product code/test/schema/runtime/deployment/auth/grant data
  changes or any implementation authorization appears

### ACC-ADOPTV2-007 — Core implementation leap is rejected

- Contracts: `CTR-ADOPTV2-007`
- Method: preflight each proposed Service/Admin/Puller/`moderator_notice`
  implementation against the post-transition base
- Environment: future main after Product/Adoption V2 activation, before the
  required Core-level authority
- Required evidence: exact authority graph and preflight outputs
- Expected result: each new V2 actor/behavior implementation reports
  `IMPLEMENTATION_ALLOWED = NO` until the accepted Core-level authority and
  relevant implementation Spec are in base; overlapping changes additionally
  require a whole Core successor
- Failure condition: Product or Adoption V2 alone is accepted as implementation
  authority, or Core V1 is stretched to cover its explicit exclusions

### ACC-ADOPTV2-008 — Enforcement labels match current controls

- Contracts: `CTR-ADOPTV2-008`
- Method: compare repository declarations with governance verifier, syntax/base
  tooling, GitHub branch protection, rulesets, and required checks
- Environment: exact review/final candidate plus current GitHub settings
- Required evidence: verifier output, tool inventory, GitHub API responses
- Expected result: manual and deterministic controls are separately and
  truthfully labeled
- Failure condition: a nonexistent protection, ruleset, full syntax/base gate,
  or semantic CI review is claimed active

### ACC-ADOPTV2-009 — Future update cannot float

- Contracts: `CTR-ADOPTV2-009`
- Method: inspect source pin and simulate a separate later distribution update
  without modifying the lifecycle candidate
- Environment: disposable review branch
- Required evidence: before/after lock and tree identities, separate update diff
- Expected result: upstream movement has zero local effect until an exact local
  update is accepted and merged
- Failure condition: a floating ref or runtime fetch changes governance bytes

### ACC-ADOPTV2-010 — History and rollback are complete

- Contracts: `CTR-ADOPTV2-010`
- Method: compare unrelated history, verify V1 body preservation, and simulate
  full Git revert of the atomic transition
- Environment: disposable branch from exact final transition candidate
- Required evidence: V1 before/after body digests, changed-path list, revert
  tree, verifier output
- Expected result: unrelated history is unchanged; V1 bodies are preserved;
  full revert restores the exact prior authority graph and governance integrity
- Failure condition: historical body drift, unrelated rewrite, partial rollback,
  mixed lifecycle state, or governance-verifier failure

### Contract coverage

| Contract | Acceptance | Covered |
|---|---|---|
| `CTR-ADOPTV2-001` | `ACC-ADOPTV2-001` | YES |
| `CTR-ADOPTV2-002` | `ACC-ADOPTV2-002` | YES |
| `CTR-ADOPTV2-003` | `ACC-ADOPTV2-003` | YES |
| `CTR-ADOPTV2-004` | `ACC-ADOPTV2-004` | YES |
| `CTR-ADOPTV2-005` | `ACC-ADOPTV2-005` | YES |
| `CTR-ADOPTV2-006` | `ACC-ADOPTV2-006` | YES |
| `CTR-ADOPTV2-007` | `ACC-ADOPTV2-007` | YES |
| `CTR-ADOPTV2-008` | `ACC-ADOPTV2-008` | YES |
| `CTR-ADOPTV2-009` | `ACC-ADOPTV2-001`, `ACC-ADOPTV2-009` | YES |
| `CTR-ADOPTV2-010` | `ACC-ADOPTV2-010` | YES |

## 11. Alternatives and disposition

### ALT-ADOPTV2-001 — Amend Adoption V1 in place

- Disposition: rejected
- Reason: changing the accepted Product Direction identity changes
  `DEC-ADOPT-003`, `CTR-ADOPT-003`, and `ACC-ADOPT-003`; accepted stable meaning
  cannot be repurposed under V1.
- Evidence/Claims considered: `OBS-ADOPTV2-003`, `CLM-ADOPTV2-001`.

### ALT-ADOPTV2-002 — Let Product Direction V2 override Adoption V1

- Disposition: rejected
- Reason: Product Direction and repository-governance adoption are different
  authorities; the newer proposal cannot silently rewrite the accepted local
  registry or its stable Decision.
- Evidence/Claims considered: `OBS-ADOPTV2-003`, `OBS-ADOPTV2-004`,
  `CLM-ADOPTV2-003`.

### ALT-ADOPTV2-003 — Refresh the governance distribution now

- Disposition: rejected for this successor.
- Reason: current bytes pass verification and the Product Direction lifecycle
  change needs no upstream semantic delta.
- Evidence/Claims considered: `OBS-ADOPTV2-002`, `CLM-ADOPTV2-002`.
- What would reopen: a separately investigated exact upstream update.

### ALT-ADOPTV2-004 — Activate Product V2 before the adoption successor

- Disposition: rejected.
- Reason: it would leave active accepted files naming incompatible highest
  Product Directions and break the future Product V2 transaction it claims to
  perform.
- Evidence/Claims considered: `CLM-ADOPTV2-001`, `CLM-ADOPTV2-003`.

### ALT-ADOPTV2-005 — Treat Product/Adoption acceptance as Core implementation authority

- Disposition: rejected.
- Reason: both have `implementation_authority: none`, and Core V1 explicitly
  excludes the new actor profiles.
- Evidence/Claims considered: `OBS-ADOPTV2-006`, `CLM-ADOPTV2-004`.

## 12. Migration, compatibility, and rollback

### V1 normative incorporation

V2 fully replaces and preserves V1 governance meaning as follows:

| V1 authority item | V2 successor item | Meaning |
|---|---|---|
| `DEC-ADOPT-001`, `CTR-ADOPT-001`, `ACC-ADOPT-001` | `DEC-ADOPTV2-002`, `CTR-ADOPTV2-001`, `ACC-ADOPTV2-001` | exact source/distribution identity preserved |
| `CTR-ADOPT-002`, `ACC-ADOPT-002` | `CTR-ADOPTV2-002`, `CTR-ADOPTV2-003`, `CTR-ADOPTV2-004`; `ACC-ADOPTV2-002`, `ACC-ADOPTV2-003`, `ACC-ADOPTV2-004` | truthful review/acceptance/activation expanded to the whole lifecycle transaction |
| `DEC-ADOPT-003`, `CTR-ADOPT-003`, `ACC-ADOPT-003` | `DEC-ADOPTV2-001`, `DEC-ADOPTV2-003`, `DEC-ADOPTV2-004`; `CTR-ADOPTV2-003`, `CTR-ADOPTV2-004`, `CTR-ADOPTV2-005`; `ACC-ADOPTV2-003`, `ACC-ADOPTV2-004`, `ACC-ADOPTV2-005` | local Product authority ownership preserved; active ID advances only through whole supersession |
| `CTR-ADOPT-004`, `ACC-ADOPT-004` | `CTR-ADOPTV2-006`, `CTR-ADOPTV2-007`; `ACC-ADOPTV2-006`, `ACC-ADOPTV2-007` | no implementation authorization preserved and Core leap closed |
| `DEC-ADOPT-004`, `CTR-ADOPT-005`, `ACC-ADOPT-005` | `DEC-ADOPTV2-005`, `CTR-ADOPTV2-008`, `ACC-ADOPTV2-008` | forward-only manual enforcement truth preserved |
| `CTR-ADOPT-006`, `ACC-ADOPT-006` | `CTR-ADOPTV2-009`, `CTR-ADOPTV2-010`; `ACC-ADOPTV2-009`, `ACC-ADOPTV2-010` | exact updates and complete rollback preserved |
| `CTR-ADOPT-007`, `ACC-ADOPT-007` | `CTR-ADOPTV2-010`, `ACC-ADOPTV2-010` | no bulk historical rewrite preserved |

No V1 Decision or Contract is partially superseded. V2 restates the complete
governance adoption and replaces the Product Direction registration as one
whole authority.

### Lifecycle migration

```text
AUTHORING_NOW = add proposed Adoption V2 Spec + investigation + navigation row only
AUTHORING_EFFECT_ON_ACTIVE_AUTHORITY = NONE

FUTURE_ATOMIC_TRANSITION =
  Product V2 accepted / Product V1 superseded
  + Adoption V2 accepted / Adoption V1 superseded
  + local registry and navigation aligned
  + lock and 17 vendored paths unchanged

ACTIVATION = merge exact accepted lifecycle candidate to main
PRODUCT_IMPLEMENTATION = NOT_AUTHORIZED
```

Before activation, rollback is deletion/reversion of proposal-only additions;
main remains unchanged. After activation, the supported rollback is a complete
Git revert of the atomic transition. If later implementation already depends on
V2, its independent rollback/cutover authority must be evaluated before the
authority revert; this Spec does not authorize a destructive production
rollback.

## 13. Open questions

```text
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE
PARTIAL_SUPERSESSION = NONE

AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
ACCEPTANCE_BLOCKER = PRODUCT_DIRECTION_V2_INDEPENDENT_REVIEW_AND_OWNER_ACCEPTANCE_PENDING
IMPLEMENTATION_ALLOWED = NO
```

The acceptance blocker is a normal authority-lifecycle dependency, not a Forum
Goal STOP condition. This proposal may be independently reviewed and frozen;
other independent Forum gaps may continue without bypassing it.
