```text
INVESTIGATION_ID =
INV-AGENT-FORUM-GOVERNANCE-ADOPTION-V2

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Whole successor for Product Direction V2 governance registration

OPENED_AT =
2026-08-31T23:53:41Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PRIMARY_GOVERNING_SPEC =
AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1

PROPOSED_SUCCESSOR =
AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Governance Adoption V2 Investigation

## 1. Executive result

The accepted adoption authority cannot be edited in place to register Product
Direction V2. Its stable Decision and local-authority Contract name Product
Direction V1. The correct action is a docs-only whole successor that preserves
the exact shared distribution and changes only the future local authority
lifecycle transaction.

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = SUPERSEDE
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1, AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_REVISION = 67225af9ad37d2adfffdb938ba324a205b96c46d
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = YES
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = none
AUTHORITY_CONFLICT = Adoption V1 fixes Product Direction V1 as highest local Product Direction; Product V2 cannot activate without a whole Adoption successor
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = author docs-only AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2
```

## 2. Evidence summary

- Forum `origin/main` and the authoring base are exactly
  `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`.
- Adoption V1 is accepted at blob
  `67225af9ad37d2adfffdb938ba324a205b96c46d`, SHA-256
  `6ab9022e852e02a2d55030862da897ff87394413a64a7b502dc4c9067ce18f6d`.
- `.agents/governance.lock.json` is accepted and the verifier confirms all 17
  distributed paths still match the exact source pin.
- `.agents/local/README.md`, Adoption V1, and the Spec index all register
  Product Direction V1.
- Product Direction V2 is a separate proposed, staged, unmerged candidate at
  file blob `79dccec43883adc939077abcb2dcf0b7b7502f4a` and staged-diff SHA-256
  `1a646b4110d63f6fba698581b4669fcbc536f779ca58f630c4d8af7c37a9186b`.
- GitHub reports main is not branch-protected and repository rulesets are empty;
  enforcement declarations remain truthful manual-policy statements.

Detailed stable Observations, Claims, Evidence relations, Decisions, Contracts,
and Acceptance mappings are persisted in the proposed successor Spec rather
than duplicated here.

## 3. Scope disposition

In this authoring candidate:

- add the proposed V2 adoption Spec;
- add this Investigation Record;
- add navigation rows for both;
- do not change active V1 authorities or registries;
- do not change the governance lock or vendored distribution;
- do not change product code, tests, schema, runtime, deployment, auth-service,
  credentials, Grants, or production data.

The later acceptance transaction is intentionally not prepared now. It depends
on independent Product Direction V2 review and Owner acceptance of an exact
final head.

## 4. Authoring result

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2
SPEC_KIND = invariant
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = none
PRIMARY_PARENT_AUTHORITY = NONE
EXTERNAL_AUTHORITIES = mayf3/agent-development-governance:AGENT_DEVELOPMENT_GOVERNANCE_BOOTSTRAP_V0@46f78c3f00d768d99a4c8c2da975b124bce042f9
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 10
CONTRACTS_WITH_ACCEPTANCE = 10
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 5. What reopens this record

Re-run preflight or revise the candidate only if:

- Forum `origin/main` changes an authority, lock, distribution path, local
  registry, or enforcement fact relevant to this successor;
- Product Direction V2 changes semantic meaning or exact candidate revision;
- independent review finds a blocker;
- the Owner rejects or changes the atomic lifecycle direction;
- the external governance source is intentionally updated through a separate
  exact distribution-update process.
