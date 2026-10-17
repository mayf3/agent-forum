```text
INVESTIGATION_ID =
INV-AGENT-FORUM-PRIVILEGED-SERVICE-ACTORS-V1

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Disjoint Governance Admin and Notification Puller Service actor boundary

OPENED_AT =
2026-09-01T00:02:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

PROPOSED_SPEC =
AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Privileged Service Actors Investigation V1

## 1. Preflight result

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = NONE (new disjoint Core-level Service invariant)
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_CORE_INVARIANTS_V1
PROPOSED_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2@79dccec43883adc939077abcb2dcf0b7b7502f4a
GOVERNING_SPEC_REVISION = NONE
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none
AUTHORITY_CONFLICT = NONE for a docs-only proposal; acceptance blocked until proposed parents activate
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = author docs-only AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
```

`NEW` is valid only because Core V1 explicitly reserves Service acceptance to a
separate accepted Forum Spec and this proposal defines new, exact Service-only
route classes. Any overlap with a Core V1 route or Contract changes the
classification to `SUPERSEDE`.

## 2. Key findings

- current Forum verifier and middleware are wholly Agent-only;
- existing storage can represent a nullable-Agent-ID Service Principal, but no
  immutable Service actor-class/Client binding or runtime admission exists;
- scope guards currently occur after Token verification and local Principal
  resolution, so widening the global verifier would allow unauthorized
  first-use persistence unless ordering changes;
- external Minimal Auth supports direct Service tokens with no `agent_id`, but
  the current `svc-forum` Audience accepts Agent only and lacks both new scopes;
- current Admin-labelled unread route conflates Moderator and dispatcher under
  `forum.moderate`;
- Product Direction V2 requires distinct Admin/Puller Subjects, Clients,
  credentials, scopes, local identities, and attribution.

## 3. Selected direction

The proposed invariant therefore freezes:

1. two actor classes only;
2. exact singleton scope per class;
3. immutable, pre-registered Subject/Client/class/local-Principal binding;
4. exact closed route classes and Agent-only default;
5. complete authorization before JIT persistence;
6. no impersonation, cross-capability inheritance, or credential reuse;
7. no implementation until local parents and exact external authorities are
   accepted.

No actual Service IDs or Clients are invented in this repository. Those remain
external authority inputs and must be bound by exact revision in future
implementation Specs.

## 4. Authoring result

```text
SPEC_GOVERNANCE_MODE = AUTHOR
SPEC_ID = AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
SPEC_KIND = invariant
STATUS = proposed
AUTHORITY_LEVEL = governing_spec
IMPLEMENTATION_AUTHORITY = none
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V2 (proposed)
RELATED_ACCEPTED_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
EXTERNAL_AUTHORITIES = mayf3/auth-service:MINIMAL_AUTH_FOUNDATION_V2@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 15
CONTRACTS_WITH_ACCEPTANCE = 15
AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
IMPLEMENTATION_ALLOWED = NO
```

## 5. What reopens this record

- Forum main changes relevant Core/token/principal/route authority or source;
- Product Direction V2 actor or capability meaning changes;
- a proposed Service route overlaps a Core V1 surface;
- auth-service main changes the referenced Service profile or Forum Audience;
- independent review identifies an identity, ordering, failure, migration, or
  compatibility blocker;
- the Owner changes the dedicated-Service direction.
