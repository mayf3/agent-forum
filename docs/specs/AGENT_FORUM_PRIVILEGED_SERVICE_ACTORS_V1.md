---
spec_id: AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1
status: proposed
spec_kind: invariant
authority_level: governing_spec
implementation_authority: none
scope:
  - svc-forum privileged Service Principal authentication and authorization boundary
governed_by:
  - AGENT_FORUM_PRODUCT_DIRECTION_V2
  - AGENT_FORUM_CORE_INVARIANTS_V1
external_authorities:
  - repository: mayf3/auth-service
    authority_id: MINIMAL_AUTH_FOUNDATION_V2
    revision: 05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
    relation: constrained_by
supersedes: []
superseded_by: null
owners:
  - mayf3
---

# AGENT_FORUM_PRIVILEGED_SERVICE_ACTORS_V1

## 1. Goal

Define the fail-closed identity, token-profile, route, scope, local-principal,
and audit boundary for the two privileged Service actors authorized by the
proposed Agent Forum Product Direction V2, without weakening any direct-Agent
Forum V1 surface or conflating administration with notification consumption.

```text
GOAL = make privileged Service access explicit, least-privilege, non-impersonating, and independently auditable
SUCCESS_OUTCOME = a Service token can reach only its one exact privileged route class after exact identity/scope binding, while every ordinary Agent route and the other Service class remains denied
```

This invariant is docs-only and grants no implementation authority. Product
Direction V2 and Governance Adoption V2 are still proposed and inactive; the
required auth-service Audience, identities, Clients, and Grants do not yet
exist as accepted external authority.

## 2. Scope and non-goals

### In scope

- direct Machine Service Access Token validation for `aud=svc-forum`;
- exactly two Service actor classes:
  `governance_admin` and `notification_puller`;
- immutable binding among actor class, Auth Subject, OAuth Client, local Forum
  Principal, and exact singleton Forum scope;
- exact route-class admission and default-deny behavior;
- preservation of direct-Agent-only ordinary Forum surfaces;
- local service-principal creation, conflict, disablement, history, and
  non-impersonation rules;
- authentication/authorization ordering, denial semantics, infrastructure
  failure, redaction, observability, migration, compatibility, and rollback;
- prerequisites that future implementation Specs must bind before code starts.

### Out of scope

- accepting, merging, or implementing this invariant;
- selecting actual Service Principal UUIDs, Client IDs, credentials, or
  credential custody locations;
- changing auth-service Audience registration, Principal/Client/Grant data,
  Token issuance, secrets, or production state;
- defining Admin topic, audit query, batch-governance, Notification Fact query,
  cursor, payload, delivery, moderation, report, or `moderator_notice` business
  behavior;
- accepting Service tokens on ordinary thread/message/search/watch/read/report/
  reaction/review/finalization/moderation surfaces;
- Human, delegated/OBO, token exchange, wildcard scope, prefix scope, role
  claim, request-body actor, shared credential, or personal credential access;
- `forum.moderate` supply or Moderator Agent behavior;
- hard deletion, data backfill, production cutover, or deployment;
- a generic policy engine, generic Service access, or generic superuser.

## 3. Authority and dependencies

```text
REPOSITORY = mayf3/agent-forum
AUTHORITY_BRANCH = main
AUTHORING_BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
CLASSIFICATION = NEW
IMPLEMENTATION_AUTHORITY = none

PROPOSED_PARENT = AGENT_FORUM_PRODUCT_DIRECTION_V2
PROPOSED_PARENT_FILE_BLOB = 79dccec43883adc939077abcb2dcf0b7b7502f4a
PROPOSED_PARENT_STAGED_DIFF_SHA256 = 1a646b4110d63f6fba698581b4669fcbc536f779ca58f630c4d8af7c37a9186b
PROPOSED_PARENT_ACTIVE_ON_MAIN = NO

ACCEPTED_REFINEMENT_PARENT = AGENT_FORUM_CORE_INVARIANTS_V1
ACCEPTED_REFINEMENT_PARENT_BLOB = f4645e2882706afd5d3a71330ae2ffc201187d2d
ACCEPTED_REFINEMENT_PARENT_SHA256 = db9f08579b12f0043026ac5766b84b900061b200e536d51e346a045f67a08dd5

EXTERNAL_AUTHORITY = mayf3/auth-service:MINIMAL_AUTH_FOUNDATION_V2
EXTERNAL_AUTHORITY_REVISION = 05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
EXTERNAL_AUTHORITY_BLOB = 576b7a75e4be278f20fee71ee4ba5e263bd958c7
```

Product Direction V2 defines the two non-interchangeable Service actors and
their capabilities. Core V1 remains the authority for ordinary direct-Agent
Forum V1 surfaces. Core V1 explicitly states that Service remains rejected
until a separate accepted Forum Spec authorizes it; this invariant uses that
seam only for new, exact, disjoint privileged Service route classes and changes
no Core V1 Contract.

If any future design accepts Service on a route currently governed by Core V1,
changes `CTR-ID-001`/`CTR-ID-003`, weakens a Core V1 denial, or makes an existing
Agent route dual-profile, this `NEW` classification is invalid and Core V1 must
be whole-superseded before implementation.

auth-service owns Token authenticity, signed claims, Audience registration,
Principal/Client binding, Grants, credentials, and issuance. Forum owns which
signed profile, exact actor binding, scope, and object/route operation it
accepts. This Spec cannot register or grant either new scope externally.

## 4. Current State

### STATE-PSA-001 — Current Forum inbound authentication is Agent-only

- Subject: `svc-forum` inbound access-token verifier and middleware
- As of commit: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: repository source and tests
- Observed at: `2026-09-01T00:02:00Z`
- Projection: the one production verifier requires `principal_type=agent` and
  non-empty `agent_id`; middleware always constructs an Agent user and resolves
  `ForumPrincipal.principalType=agent`; Service tokens reject before route
  authorization.
- Basis: `OBS-PSA-001`, `EVD-PSA-001`

### STATE-PSA-002 — Storage can describe a Service Principal but runtime cannot

- Subject: local Forum Principal storage
- As of commit: `2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: Prisma schema and principal resolver
- Observed at: `2026-09-01T00:02:00Z`
- Projection: `ForumPrincipal` stores a string `principalType`, unique
  `authSubject`, and nullable unique `agentId`; the resolver accepts a type
  parameter, but the only inbound middleware supplies `agent` and an Agent ID.
- Basis: `OBS-PSA-002`, `EVD-PSA-001`

### STATE-PSA-003 — External architecture supports Service profile, Forum Audience does not

- Subject: auth-service Direct Machine profile and `svc-forum` Audience
- As of commit: auth-service
  `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`
- Environment: accepted Architecture and executable registry
- Observed at: `2026-09-01T00:02:00Z`
- Projection: Direct Machine Token permits `principal_type=service`, requires
  `client_id`, and forbids `agent_id` for Service; the current `svc-forum`
  Audience accepts only Agent and registers only `forum.read`/`forum.write`.
- Basis: `OBS-PSA-004`, `OBS-PSA-005`, `EVD-PSA-003`

### STATE-PSA-004 — Both privileged actor authorities are proposals only

- Subject: Forum Product/Adoption/Service authority chain
- As of artifacts: Product V2 blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`; Adoption V2 Spec blob
  `44543c713f350c03c671e432054295d80eedaee1`
- Environment: separate staged docs-only candidate worktrees
- Observed at: `2026-09-01T00:02:00Z`
- Projection: Product V2 and Adoption V2 are proposed, unmerged, inactive, and
  implementation-forbidden. No accepted local authority yet authorizes Admin
  or Puller Service tokens.
- Basis: `OBS-PSA-003`, `EVD-PSA-002`

## 5. Observations

### OBS-PSA-001 — The verifier hard-rejects Service profile

- Subject: inbound Token verification and request user construction
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: source
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect `svc-forum/src/lib/auth-jwt.ts` and
  `svc-forum/src/middleware/auth.ts`
- Result: verifier requires `principal_type=agent`, `agent_id`, and `client_id`;
  result type is statically Agent-only; middleware resolves and emits
  `principalType=agent`. A Service token returns `TOKEN_CONTRACT_INVALID`.
- Provenance: `auth-jwt.ts:67-79,108-175`, `auth.ts:97-125,152-195`.

### OBS-PSA-002 — Principal storage is type-capable but not type-governed for Service runtime

- Subject: local principal schema and resolver
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: source
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect `svc-forum/prisma/schema.prisma` and
  `svc-forum/src/lib/forum-principal.ts`
- Result: `authSubject` is unique, `principalType` is an unconstrained string
  defaulting to Agent, and `agentId` is nullable/unique. Resolver accepts a
  caller-supplied type and optional Agent ID, but it has no immutable
  Service-actor-class/Client binding or privileged-route admission policy.
- Provenance: schema lines 185-221 and principal resolver.

### OBS-PSA-003 — Proposed Product Direction requires distinct Service actors

- Subject: proposed product actor model
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: Product V2 file blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`
- Environment: staged docs-only candidate
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect Product V2 §§4, 9, 12-14
- Result: Admin and Puller must use different Service Subjects, Clients,
  credentials, local identities, scopes, and audit attribution; scopes do not
  inherit; service tokens are restricted to exact privileged routes.
- Provenance: `AGENT_FORUM_PRODUCT_DIRECTION_V2` proposal.

### OBS-PSA-004 — External Direct Machine Service Token has no Agent ID

- Subject: auth-service Direct Machine Access Token profile
- Repository/source: `mayf3/auth-service`
- Commit/artifact: `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`,
  accepted `MINIMAL_AUTH_FOUNDATION_V2` blob
  `576b7a75e4be278f20fee71ee4ba5e263bd958c7`
- Environment: accepted Architecture and versioned bundle
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect exact-incorporated
  `claims-and-profiles.md#Direct Machine Access Token`, migration CCR, and
  `token-profiles.schema.json`
- Result: Service Direct Machine Token uses `principal_type=service`, has
  server-bound `sub`/`client_id`, `token_use=access`, `type=access`,
  `version=v1`, scope, `jti/iat/nbf/exp`, contains no `agent_id`, and contains
  no OBO `act`/`azp`; maximum TTL is 10 minutes.
- Provenance: auth-service current main exact files.

### OBS-PSA-005 — Current svc-forum Audience cannot mint either Service token

- Subject: auth-service `svc-forum` Audience
- Repository/source: `mayf3/auth-service`
- Commit/artifact: `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`,
  registry `1.4.0`
- Environment: executable Contract bundle
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect
  `contract-bundles/minimal-auth-v1/audience-registry.json`
- Result: `accepted_principal_types=[agent]` and
  `registered_scopes=[forum.read,forum.write]`; neither Service type nor
  `forum.admin`/`forum.notification.consume` is registered.
- Provenance: registry lines 59-69.

### OBS-PSA-006 — Core V1 leaves a separate-Spec Service seam

- Subject: accepted Core identity boundary
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: Core V1 blob
  `f4645e2882706afd5d3a71330ae2ffc201187d2d`
- Environment: accepted authority on main
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect Core V1 §§2-3 and `CTR-ID-001`/`CTR-ID-003`
- Result: Core V1 restricts its V1 inbound surfaces to direct Agent tokens and
  rejects Service, while §3 explicitly says Service remains rejected until a
  separate accepted Forum Spec authorizes it.
- Provenance: Core V1 lines 53-65, 121-130, 506-535.

### OBS-PSA-007 — Current Admin-labelled route reuses Moderator authority

- Subject: current cross-recipient unread route
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Environment: source
- Observed at: `2026-09-01T00:02:00Z`
- Method: inspect `svc-forum/src/routes/admin.ts`
- Result: `/api/admin/notifications/unread` uses `forum.moderate` and labels the
  caller "moderator/dispatcher"; it has no distinct Service profile or scope.
- Provenance: `admin.ts:8-25`.

## 6. Claims and assumptions

### CLM-PSA-001 — A new disjoint invariant is the correct authority shape

- Support state: SUPPORTED
- Supported by evidence: `EVD-PSA-002`, `EVD-PSA-004`
- Contradicted by evidence: none known
- Uncertainty: any future overlap with a Core V1 route invalidates this shape and
  requires whole Core supersession.

### CLM-PSA-002 — Scope-only admission is insufficient

- Support state: SUPPORTED
- Supported by evidence: `EVD-PSA-002`, `EVD-PSA-003`, `EVD-PSA-005`
- Contradicted by evidence: none known
- Uncertainty: exact Subject/Client identifiers remain future external
  authority inputs, not owner decisions in this invariant.

### CLM-PSA-003 — Trust-on-first-use would make a misgrant persistent

- Support state: SUPPORTED
- Supported by evidence: `EVD-PSA-001`, `EVD-PSA-003`
- Contradicted by evidence: none known
- Uncertainty: none; current resolver persists a new subject after verifier
  success, so Service admission must bind before persistence.

### CLM-PSA-004 — One generic dual-profile middleware risks widening Agent routes

- Support state: INFERRED
- Supported by evidence: `EVD-PSA-001`, `EVD-PSA-002`, `EVD-PSA-005`
- Contradicted by evidence: none known
- Uncertainty: implementation structure may vary, but equivalent route-first
  default-deny proof is mandatory.

### CLM-PSA-005 — External auth authority is a real implementation prerequisite

- Support state: SUPPORTED
- Supported by evidence: `EVD-PSA-003`
- Contradicted by evidence: none known
- Uncertainty: actual Service identities/Clients/Grants do not yet exist as
  accepted authority.

```text
OPEN_ASSUMPTIONS = NONE
```

## 7. Evidence relations

### EVD-PSA-001 — Source supports the Agent-only and pre-persistence Claims

- Source observations: `OBS-PSA-001`, `OBS-PSA-002`
- Target: `STATE-PSA-001`, `STATE-PSA-002`, `CLM-PSA-003`, `CLM-PSA-004`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Strength/sufficiency: direct verifier, middleware, schema, and resolver source
- Limitations: does not prove future implementation structure or production
  data cardinality
- Provenance: named source files.

### EVD-PSA-002 — Proposed product and accepted Core support disjoint route classes

- Source observations: `OBS-PSA-003`, `OBS-PSA-006`
- Target: `STATE-PSA-004`, `CLM-PSA-001`, `CLM-PSA-002`, `CLM-PSA-004`
- Relation: SUPPORTS
- Bound coordinates: Product V2 blob
  `79dccec43883adc939077abcb2dcf0b7b7502f4a`, Core V1 blob
  `f4645e2882706afd5d3a71330ae2ffc201187d2d`
- Strength/sufficiency: direct proposed parent plus accepted refinement boundary
- Limitations: Product V2 is not active; acceptance is blocked
- Provenance: Product V2 and Core V1.

### EVD-PSA-003 — External architecture and registry support the profile and prerequisite Claims

- Source observations: `OBS-PSA-004`, `OBS-PSA-005`
- Target: `STATE-PSA-003`, `CLM-PSA-002`, `CLM-PSA-003`, `CLM-PSA-005`
- Relation: SUPPORTS
- Bound coordinates: auth-service
  `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`
- Strength/sufficiency: accepted Architecture plus current executable registry
- Limitations: reference-only; it does not grant Forum permission or create the
  missing external identities/scopes
- Provenance: auth-service exact files.

### EVD-PSA-004 — Core seam supports NEW rather than automatic SUPERSEDE

- Source observations: `OBS-PSA-006`
- Target: `CLM-PSA-001`
- Relation: SUPPORTS
- Bound coordinates: Core V1 blob
  `f4645e2882706afd5d3a71330ae2ffc201187d2d`
- Strength/sufficiency: explicit accepted text permitting a separate accepted
  Forum Spec for Service
- Limitations: only disjoint new surfaces; no existing Contract may change
- Provenance: Core V1 §3 and identity Contracts.

### EVD-PSA-005 — Current conflation supports exact actor/route separation

- Source observations: `OBS-PSA-007`
- Target: `CLM-PSA-002`, `CLM-PSA-004`
- Relation: SUPPORTS
- Bound coordinates: Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Strength/sufficiency: direct current route source
- Limitations: descriptive drift, not product authority or deployed-behavior
  proof
- Provenance: `svc-forum/src/routes/admin.ts`.

## 8. Decisions

### DEC-PSA-001 — Define exactly two non-interchangeable Service actor classes

- Decision owner: `mayf3`
- Decision: the only privileged Service classes are `governance_admin` and
  `notification_puller`; each has one distinct Subject, Client, local Principal,
  exact singleton Forum scope, and route class.
- Rejected alternatives: generic Service access, one shared service identity,
  one `forum.admin` super-scope, Moderator reuse, or a personal credential.
- Reason: least privilege and unambiguous audit attribution.
- Owner decision remaining: NONE.

### DEC-PSA-002 — Pre-register bindings; never trust first use

- Decision owner: `mayf3`
- Decision: future implementation must receive exact Subject/Client/class/scope
  bindings from independently accepted external and local child authorities;
  it must validate the complete binding before local Principal persistence.
- Rejected alternative: create a Service Principal for the first valid token
  and infer its class from whatever scope it carries.
- Reason: a mistaken or malicious external Grant must not become persistent
  local identity authority.
- Owner decision remaining: NONE.

### DEC-PSA-003 — Preserve Agent-only middleware as the default

- Decision owner: `mayf3`
- Decision: ordinary and optional Agent routes keep an Agent-only admission
  path. Service admission uses an explicit service-route class and default deny;
  a generic dual-profile middleware may exist only if machine evidence proves
  every route is classified and unclassified routes remain Agent-only.
- Rejected alternative: broaden the current global `authRequired` and rely only
  on downstream scope checks.
- Reason: scope guards currently execute after identity resolution and route
  mistakes must fail before persistence or domain access.
- Owner decision remaining: NONE.

### DEC-PSA-004 — Use exact singleton scopes with no inheritance

- Decision owner: `mayf3`
- Decision: Admin Service accepts only `forum.admin`; Puller accepts only
  `forum.notification.consume`; extra Forum scope, wildcard, wrong class, wrong
  Client, or wrong Subject rejects.
- Rejected alternative: union scopes, prefixes, `forum.*`, Agent read/write,
  moderation scope, or role-name inference.
- Reason: the Product Direction declares the capabilities independent.
- Owner decision remaining: NONE.

### DEC-PSA-005 — Reuse the external direct Service profile exactly

- Decision owner: `mayf3`
- Decision: accept only RS256/JWKS direct Machine Access Token with Service
  profile, exact Forum audience, no Agent/OBO claims, and maximum 10-minute TTL.
- Rejected alternative: HS256, introspection fallback, OBO, Human, Agent token,
  token exchange, missing `token_use`, or synthetic `agent_id`.
- Reason: preserve external Architecture and offline resource verification.
- Owner decision remaining: NONE.

### DEC-PSA-006 — Keep this invariant non-implementing

- Decision owner: `mayf3`
- Decision: this invariant has `implementation_authority: none`; future Admin
  and Puller implementation Specs independently bind exact routes, payloads,
  external authorities, migration, verification, and activation.
- Rejected alternative: implement auth middleware from a proposed Product
  Direction or from the external generic Service profile alone.
- Reason: local parent activation and external Audience/Grant authorities are
  absent.
- Owner decision remaining: NONE.

## 9. Contracts

### CTR-PSA-001 — Closed Service actor set and immutable binding

Forum MUST recognize exactly these two Service actor classes:

| Actor class | Required principal type | Exact Forum scope | Distinct binding |
|---|---|---|---|
| `governance_admin` | `service` | `forum.admin` | one pre-registered Auth Subject, OAuth Client, and Forum Principal |
| `notification_puller` | `service` | `forum.notification.consume` | a different pre-registered Auth Subject, OAuth Client, and Forum Principal |

The two rows MUST differ in Auth Subject, Client ID, local Forum Principal ID,
scope, credential, and audit actor attribution. One Subject, Client, Principal,
credential, or Grant MUST NOT satisfy both classes. Actor class MUST be
immutable for the binding lifetime.

### CTR-PSA-002 — Exact direct Service Access Token profile

An admitted Service request MUST present one RS256-signed direct Machine Access
Token with:

```text
valid kid and signature
exact iss
exact aud = svc-forum
sub = UUID and exact pre-registered Service Auth Subject
principal_type = service
client_id = exact pre-registered Client for the actor class
token_use = access
type = access
version = v1
scope = exact singleton scope for the actor class
jti = non-empty string of at least 16 characters; uniqueness is owned by auth-service
valid iat, nbf, exp
0 < exp - iat <= 600 seconds
agent_id absent
act absent
azp absent
```

Claims outside the exact accepted external Direct Machine profile MUST be
rejected and MUST NOT be used to infer identity or authority. Forum MUST NOT
accept HS256, unsigned,
wrong-audience, Human, Agent, delegated/OBO, exchanged, expired, not-yet-valid,
over-TTL, missing-claim, synthetic-Agent, or fallback tokens on Service routes.

### CTR-PSA-003 — Route classes are closed and default deny

Each future Service endpoint MUST be declared in exactly one closed route class:

```text
governance_admin_route
notification_puller_route
```

Unclassified routes remain ordinary Agent routes and MUST reject Service
tokens. A route MUST NOT belong to both classes. A generic router prefix,
method heuristic, handler name, request payload, or scope prefix MUST NOT infer
classification. The exact route manifest belongs to the relevant accepted
implementation Spec and MUST be reviewed against the shipped router tree.

### CTR-PSA-004 — Agent and Service admission paths do not overlap

Ordinary thread, message, search, Watch, Read State, report submission,
reaction, review, finalization, moderation, and optional-auth routes governed by
Core V1 MUST continue to accept only the direct Agent profile and MUST reject a
present Service token as `401 TOKEN_CONTRACT_INVALID`, never downgrade it to
anonymous.

A Service-only route MUST reject an Agent, Human, or delegated/OBO token as
`401 TOKEN_CONTRACT_INVALID`. This remains true even when the token carries the
route's scope text. Profile and route class are mandatory before scope.

### CTR-PSA-005 — Scope is exact, singleton, and non-inheriting

After profile and route-class validation, Forum MUST require the exact singleton
scope for that class. Missing scope, extra Forum scope, `forum.read`,
`forum.write`, `forum.moderate`, the other Service scope, both Service scopes,
wildcard, namespace wildcard, prefix match, case variant, duplicate semantic
alias, or unknown scope MUST fail with `403 INSUFFICIENT_SERVICE_AUTHORITY`.

`forum.admin` MUST NOT authorize moderation, ordinary discussion, or Puller
access. `forum.notification.consume` MUST NOT authorize ordinary read/write,
Read State mutation, moderation, Admin, or recipient impersonation.

### CTR-PSA-006 — Complete binding validation precedes local persistence

Forum MUST perform, in order:

1. signature, issuer, audience, time, and direct-token structural verification;
2. Service profile and forbidden-claim validation;
3. exact route-class and singleton-scope validation;
4. exact pre-registered Subject/Client/actor-class binding validation;
5. local Forum Principal conflict/disablement validation;
6. only then resolve or create the local Service Principal and enter domain
   authorization/business handling.

Any failure in steps 1-5 MUST create no Forum Principal, alias, Watch, Read
State, participant, message, Notification Fact, audit business event, or other
domain mutation. No trust-on-first-use, scope-first JIT, or failed-request
identity persistence is allowed.

### CTR-PSA-007 — Local Service Principal identity is permanent and non-impersonating

An admitted Service Auth Subject MUST map one-to-one to one local Forum
Principal with:

```text
principalType = service
agentId = null
immutable service actor class binding
```

It MUST NOT reuse or mutate an Agent Principal, claim an Agent ID, become a
thread/message Agent author, or be selected by Mention. An existing Subject
with `principalType!=service`, non-null Agent ID, another actor class, another
Client binding, multiple matches, or conflicting history MUST fail closed and
MUST NOT be repaired automatically. Labels and Client IDs remain audit/display
context, not actor identity.

### CTR-PSA-008 — Privileged capability boundaries remain negative by default

Governance Admin Service MAY enter only its child-Spec-defined Admin routes. It
MUST NOT moderate, impersonate an Agent, consume Puller data, mutate ordinary
discussion as an Agent, or administer auth-service credentials/Grants.

Notification Puller Service MAY enter only its child-Spec-defined fact-consume
routes. It MUST NOT read full discussion content through ordinary routes, post,
Watch, unwatch, mark any Principal read, mutate subscriptions, moderate,
administer, or impersonate a recipient. Fact consumption or delivery MUST NOT
change recipient Read State.

### CTR-PSA-009 — Identity, scope, and infrastructure failures are fail-closed

- missing/malformed/expired/bad-signature/wrong-profile/wrong-audience tokens:
  `401` with the stable token-error family;
- JWKS timeout, DNS/network failure, invalid JWKS, or upstream 5xx:
  `503 AUTH_JWKS_UNAVAILABLE` with no token refresh storm or fallback verifier;
- correct Service profile but wrong route class, singleton scope, registered
  Subject, Client, actor class, or local binding:
  `403 INSUFFICIENT_SERVICE_AUTHORITY`;
- disabled, ambiguous, or conflicting local Service Principal:
  `403 SERVICE_PRINCIPAL_UNAVAILABLE`.

Every case MUST stop before domain mutation. Error bodies MUST NOT reveal the
expected Subject, Client, other actor identity, Grant, credential, or secret.

### CTR-PSA-010 — Authentication and authorization are not request-controlled

Request body, query, route parameter, header other than the verified bearer
token, display name, role label, Agent ID, recipient ID, cursor owner, claimed
actor class, or idempotency key MUST NOT select or replace the authenticated
Service actor. The actor class is derived only from the exact pre-registered
Subject/Client/scope/route binding after cryptographic verification.

### CTR-PSA-011 — Security telemetry and audit attribution are bounded

Every admitted or denied Service request MUST produce bounded security
telemetry sufficient to correlate time, route class, allow/deny result, stable
error category, local Principal when resolved, Auth Subject, Client ID, and
request correlation ID. Child Specs determine which successful Admin or Puller
operations additionally create canonical `ForumAuditEvent` rows.

Telemetry and audit MUST NOT contain the bearer token, Authorization header,
credential, private key, raw secret, full Notification/message content,
unbounded request body, or unredacted stack trace. `client_id` and labels MUST
NOT replace the local Principal as audit actor.

### CTR-PSA-012 — External authority is a hard implementation prerequisite

No implementation Spec may authorize a Service actor until auth-service has
independently accepted exact authorities for:

- `svc-forum` Service principal-type acceptance;
- the actor's exact singleton scope registration;
- one exact Service Principal and Client binding;
- one exact least-privilege Grant;
- credential creation/custody/rotation/revocation and production-apply
  authority as separately required.

The Admin and Puller external authorities MUST be independent and MUST NOT reuse
the opposite-direction `agent-core-notification-ingress-v1` Audience,
`notification.deliver` scope, its Clients, Grants, or credentials. A generic
Service profile or current source code is not sufficient authority.

### CTR-PSA-013 — Identity rotation and revocation require explicit authority

V1 authorizes no automatic Subject, Client, scope, credential, or actor-class
rotation. Any rotation must use a separately accepted exact authority that
defines old/new bindings, overlap or no-overlap rule, maximum old-token drain
bounded by Token TTL, audit, conflict behavior, rollback, and revocation.

A disabled/revoked binding MUST reject new requests while preserving historical
Forum Principal and audit attribution. It MUST NOT transfer the old Subject,
Client, Agent ID, or local Principal to the other Service class.

### CTR-PSA-014 — Migration is inventory-first and no-backfill by default

Before implementation, an exact-base inventory MUST classify every existing
`ForumPrincipal` row with non-Agent `principalType`, null Agent ID, conflicting
Subject/type, or candidate Service identity. Unknown or ambiguous records MUST
quarantine or block activation; they MUST NOT be guessed, auto-bound, deleted,
or relabelled.

The initial implementation MUST create no historical Service binding and
perform no content/actor backfill. Service Principals may be created only after
the future accepted bindings are installed and one authorized request passes
`CTR-PSA-006`.

### CTR-PSA-015 — Compatibility and rollback preserve Agent authority

Before Service activation, every existing Agent auth/identity/authorization
acceptance case MUST remain byte/behavior compatible, including Service-token
rejection on ordinary routes. Service support MUST have an independent disable
seam that rejects both Service classes without disabling Agent access.

Rollback MUST disable Service route admission and preserve all Service Principal
and audit history. It MUST NOT change an existing Agent Principal, broaden an
Agent scope, erase security evidence, reassign an Auth Subject, or silently
enable the other Service class. Destructive cleanup requires separate authority.

## 10. Acceptance

### ACC-PSA-001 — Direct Service token profile matrix

- Contracts: `CTR-PSA-002`, `CTR-PSA-009`
- Method: table-driven verifier tests using real RS256 keys/JWKS and tokens that
  vary every required/forbidden claim, signature, time, TTL, audience, type,
  and profile dimension one at a time
- Environment: future exact implementation commit, local JWKS and simulated
  unavailable JWKS
- Required evidence: executed matrix, implementation commit, request results,
  zero-fallback/network trace for failures
- Expected result: only the exact direct Service profile reaches route
  authorization; JWT faults are 401 and JWKS infrastructure faults are 503
- Failure condition: any Human/Agent/OBO/HS256/fallback/over-TTL/Agent-ID token
  passes, or an infrastructure fault becomes a refresh/fallback path

### ACC-PSA-002 — Four-way actor/scope/route negative matrix

- Contracts: `CTR-PSA-001`, `CTR-PSA-003`, `CTR-PSA-004`, `CTR-PSA-005`,
  `CTR-PSA-008`
- Method: exercise Discussion Agent, Moderator Agent, Governance Admin Service,
  and Notification Puller Service tokens against every ordinary, moderation,
  Admin, and Puller route class, including extra/combined/wildcard scopes
- Environment: full router tree and real middleware
- Required evidence: generated route manifest, test matrix, executed responses,
  route coverage proof
- Expected result: each actor reaches only its exact route/capability; every
  cross-class case fails with the specified 401/403 family
- Failure condition: unclassified/dual-class route, scope inheritance, Service
  on ordinary route, Agent on Service route, or Admin/Puller crossover passes

### ACC-PSA-003 — Unauthorized Service requests create no local state

- Contracts: `CTR-PSA-006`, `CTR-PSA-010`
- Method: snapshot all relevant table counts/digests; send validly signed tokens
  with wrong scope, Subject, Client, class, route, and request-body identities;
  compare state after each request
- Environment: real PostgreSQL and full middleware/data-access stack
- Required evidence: before/after counts/digests, SQL transaction evidence,
  request/response records
- Expected result: every request is denied before Principal resolution/domain
  mutation and all domain-state digests remain identical
- Failure condition: failed request creates/updates a Principal, alias, content,
  subscription, read, notification, audit business fact, or other domain row

### ACC-PSA-004 — Exact pre-registered bindings and no TOFU

- Contracts: `CTR-PSA-001`, `CTR-PSA-006`, `CTR-PSA-007`
- Method: load two exact accepted bindings; test correct tuples plus same
  Subject/different Client, different Subject/same Client, swapped class/scope,
  unknown tuple, existing Agent collision, and first-seen misgrant
- Environment: database-backed integration test
- Required evidence: binding fixture provenance, executed matrix, Principal and
  audit-state queries
- Expected result: only both exact tuples resolve/create the correct
  service/null-Agent-ID Principals after authorization; all conflicts deny
- Failure condition: scope-only or first-seen token creates authority, identities
  merge, class mutates, Agent ID appears, or one tuple satisfies both classes

### ACC-PSA-005 — Local lifecycle and conflict handling

- Contracts: `CTR-PSA-007`, `CTR-PSA-009`, `CTR-PSA-013`
- Method: exercise active, disabled, duplicate, type-conflict, Agent-ID-conflict,
  class-conflict, Client-conflict, and revoked binding states
- Environment: real PostgreSQL
- Required evidence: seeded state, requests, stable errors, unchanged history
- Expected result: active exact binding works; every conflict/revocation denies
  without mutation or attribution loss
- Failure condition: automatic repair, reassignment, history rewrite, wrong-class
  transfer, or disabled access succeeds

### ACC-PSA-006 — Request input cannot impersonate or redirect authority

- Contracts: `CTR-PSA-007`, `CTR-PSA-008`, `CTR-PSA-010`
- Method: vary actor, recipient, Agent, Client, class, scope, and owner fields in
  body/query/path/extra headers while holding the verified token constant
- Environment: full Admin/Puller route implementations
- Required evidence: executed requests and stored actor/target/audit rows
- Expected result: authenticated Service actor never changes; unauthorized
  target/class behavior denies; no Agent authorship or recipient Read mutation
- Failure condition: request data replaces actor, causes Agent attribution, or
  lets Puller/Admin act as the other class

### ACC-PSA-007 — Telemetry is attributable and secret-safe

- Contracts: `CTR-PSA-011`
- Method: run success and every denial family with marker secrets and bounded
  content; inspect logs, traces, audit rows, error bodies, and serialized metrics
- Environment: production-shaped logging configuration
- Required evidence: redaction scan, field allowlist, sample correlations,
  payload-size assertions
- Expected result: required identity/category/correlation fields exist; no
  token, credential, secret, full content, or unbounded body appears
- Failure condition: attribution missing/ambiguous, Client becomes actor, or any
  prohibited data leaks

### ACC-PSA-008 — External authority preflight fails closed

- Contracts: `CTR-PSA-012`
- Method: fixed-revision review of auth-service Product/Architecture, Audience,
  Principal, Client, Grant, credential, and production-apply authorities for
  each Service class
- Environment: exact future Forum implementation base plus exact auth-service
  authority revisions
- Required evidence: authority IDs/revisions/status, Audience/Grant fixtures,
  no-reuse comparison with notification ingress, preflight record
- Expected result: implementation remains forbidden until every exact external
  prerequisite is accepted; Admin and Puller closures are distinct
- Failure condition: generic profile, proposed authority, source code, opposite
  Audience, shared Client/credential, or absent production authority is treated
  as sufficient

### ACC-PSA-009 — Inventory, migration, and Agent compatibility

- Contracts: `CTR-PSA-014`, `CTR-PSA-015`
- Method: run exact-base Principal inventory; execute full pre-existing Agent
  auth/route suite before and after additive Service implementation; compare
  Agent results and database state
- Environment: production-shaped database copy or approved equivalent without
  production mutation
- Required evidence: inventory classifications/counts, quarantine/blockers,
  before/after Agent suite, schema/data diff
- Expected result: no guessing/backfill; ambiguous state blocks activation;
  Agent behavior is unchanged and Service remains rejected on ordinary routes
- Failure condition: historical mutation, auto-binding, Agent regression, or
  widened ordinary-route profile

### ACC-PSA-010 — Independent Service disable and rollback

- Contracts: `CTR-PSA-013`, `CTR-PSA-015`
- Method: activate both classes in a disposable environment, disable each
  independently, then execute the child-defined application rollback
- Environment: production-shaped disposable deployment
- Required evidence: route results, Agent canary, retained Principal/audit
  queries, configuration and rollback identities
- Expected result: disabled class denies, other class follows its own state,
  Agent access remains available, and all identity/audit history remains
- Failure condition: shared kill switch accidentally broadens/rewrites identity,
  rollback deletes history, Agent is disabled, or one class enables the other

### Contract coverage

| Contract | Acceptance | Covered |
|---|---|---|
| `CTR-PSA-001` | `ACC-PSA-002`, `ACC-PSA-004` | YES |
| `CTR-PSA-002` | `ACC-PSA-001` | YES |
| `CTR-PSA-003` | `ACC-PSA-002` | YES |
| `CTR-PSA-004` | `ACC-PSA-002`, `ACC-PSA-009` | YES |
| `CTR-PSA-005` | `ACC-PSA-002` | YES |
| `CTR-PSA-006` | `ACC-PSA-003`, `ACC-PSA-004` | YES |
| `CTR-PSA-007` | `ACC-PSA-004`, `ACC-PSA-005`, `ACC-PSA-006` | YES |
| `CTR-PSA-008` | `ACC-PSA-002`, `ACC-PSA-006` | YES |
| `CTR-PSA-009` | `ACC-PSA-001`, `ACC-PSA-005` | YES |
| `CTR-PSA-010` | `ACC-PSA-003`, `ACC-PSA-006` | YES |
| `CTR-PSA-011` | `ACC-PSA-007` | YES |
| `CTR-PSA-012` | `ACC-PSA-008` | YES |
| `CTR-PSA-013` | `ACC-PSA-005`, `ACC-PSA-010` | YES |
| `CTR-PSA-014` | `ACC-PSA-009` | YES |
| `CTR-PSA-015` | `ACC-PSA-009`, `ACC-PSA-010` | YES |

## 11. Alternatives and disposition

### ALT-PSA-001 — Broaden the existing Agent verifier globally

- Disposition: rejected.
- Reason: it would overlap every Core V1 route, allow Service persistence before
  downstream scope checks, and require Core whole supersession.
- Evidence/Claims considered: `OBS-PSA-001`, `CLM-PSA-003`, `CLM-PSA-004`.

### ALT-PSA-002 — Use scope alone to identify the Service class

- Disposition: rejected.
- Reason: scope is necessary but a misgrant, shared Client, swapped Subject, or
  combined scope must not become local identity authority.
- Evidence/Claims considered: `CLM-PSA-002`, `CLM-PSA-003`.

### ALT-PSA-003 — Reuse the Moderator Agent

- Disposition: rejected.
- Reason: moderation, administration, and cross-recipient notification
  consumption are distinct product capabilities and audit actors.
- Evidence/Claims considered: `OBS-PSA-003`, `OBS-PSA-007`.

### ALT-PSA-004 — Reuse notification ingress Service credentials

- Disposition: rejected.
- Reason: that Audience and `notification.deliver` scope authorize Forum as a
  caller into Agent Core; they do not authorize a Puller or Admin caller into
  Forum.
- Evidence/Claims considered: `OBS-PSA-004`, `OBS-PSA-005`.

### ALT-PSA-005 — Trust the first valid Service token and JIT bind it

- Disposition: rejected.
- Reason: external misconfiguration would become durable local actor authority
  before exact identity review.
- Evidence/Claims considered: `OBS-PSA-002`, `CLM-PSA-003`.

### ALT-PSA-006 — Whole-supersede Core V1 now

- Disposition: rejected for the disjoint route design.
- Reason: Core V1 explicitly permits a separate accepted Forum Spec for Service,
  and no existing route or Contract changes here.
- What would reopen: any Service admission on a Core V1 surface or any change to
  an existing Core V1 stable meaning.
- Evidence/Claims considered: `OBS-PSA-006`, `CLM-PSA-001`.

## 12. Migration, compatibility, and rollback

```text
MIGRATION = future additive Service binding and route-class implementation only
HISTORICAL_AGENT_REWRITE = none
SERVICE_IDENTITY_BACKFILL = none
TRUST_ON_FIRST_USE = forbidden
ORDINARY_AGENT_ROUTE_DELTA = none
ACTIVATION = independently gated per Service class
ROLLBACK = disable Service admission; preserve Principal and audit history
HARD_DELETE = forbidden
```

Authority sequencing:

1. Product Direction V2 and Governance Adoption V2 become accepted and active
   through their atomic docs-only lifecycle transition.
2. This exact invariant receives independent review, Owner acceptance, and
   merge after parent revision alignment.
3. auth-service independently accepts and merges separate Admin and Puller
   Audience/identity/Client/Grant authorities; production apply remains its own
   state.
4. Forum authors separate implementation Specs for the shared authentication
   seam and each business route class, binding all exact external revisions.
5. Implementation, migration, deployment, and activation proceed only from
   bases containing their accepted Contracts; each state remains distinct.

This proposal does not stack code on Product, Adoption, lifecycle-storage,
message-visibility, or notification-facts candidates. If the parent Product
Direction changes, this proposal must be revised and re-reviewed before
acceptance.

## 13. Open questions

```text
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
UNRESOLVED_AUTHORITY_CONFLICT = NONE
PARTIAL_SUPERSESSION = NONE

AUTHORING_READY_FOR_REVIEW = YES
READY_TO_MARK_ACCEPTED = NO
ACCEPTANCE_BLOCKERS = PRODUCT_DIRECTION_V2_AND_GOVERNANCE_ADOPTION_V2_NOT_ACTIVE; EXTERNAL_ADMIN_AND_PULLER_AUTHORITIES_ABSENT
IMPLEMENTATION_ALLOWED = NO
```

The acceptance blockers do not stop the Forum Goal. This candidate can be
frozen while independent Forum gaps continue; no blocker may be bypassed to
start runtime work.
