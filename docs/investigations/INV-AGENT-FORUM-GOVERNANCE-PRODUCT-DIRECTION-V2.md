```text
INVESTIGATION_ID =
INV-AGENT-FORUM-GOVERNANCE-PRODUCT-DIRECTION-V2

REPOSITORY =
mayf3/agent-forum

SUBJECT =
Forum governance Product Direction and privileged-actor separation

OPENED_AT =
2026-08-31T23:44:00Z

OWNER =
mayf3

DISPOSITION =
proposed_authority_candidate

PRIMARY_ACTIVE_AUTHORITY =
AGENT_FORUM_PRODUCT_DIRECTION_V1

PROPOSED_AUTHORITY =
AGENT_FORUM_PRODUCT_DIRECTION_V2

SOURCE_BASE_COMMIT =
2c5e4d8a3c3926e53a878092cd8988964ffbd2db

AUTHORITY_CHANGE_PROPOSED =
YES

IMPLEMENTATION_STARTED =
NO
```

# Agent Forum Governance Product Direction V2 Investigation

## 1. Goal and preflight result

Identify the smallest governing action needed after the already frozen Forum
lifecycle, message-visibility, and notification-fact candidates, without
conflating external notification consumption, moderation, and product
administration or treating current code/runtime as authority.

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT -> AUTHOR
PREFLIGHT_MODE = SUPERSEDE
CHANGE_CLASS = NON_MECHANICAL
MECHANICAL_EXEMPTION_REVIEW = NOT_APPLICABLE
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = NONE (top-level Product Direction supersession)
PRIMARY_RELATED_AUTHORITY = AGENT_FORUM_PRODUCT_DIRECTION_V1
GOVERNING_AUTHORITY_BLOB = e00e7302ffb8478c0a82dcbf235babc0e59946f8
AUTHORITY_PRESENT_IN_BASE = YES
AUTHORITY_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = none
IMPLEMENTATION_ALLOWED = NO
```

The gap is a parent Product Direction gap. V1 authorizes an external Puller but
does not authorize an inbound service identity/capability for it, and it does
not define Admin governance or `moderator_notice`. Because V1 also closes the
Notification meaning to Mention and watched replies, this cannot be repaired by
a lower-level implementation Spec or a companion exception document.

## 2. Scope and non-goals

In scope:

- current Product Direction and accepted Core authority;
- current Forum source and schema only as descriptive state;
- current deployed container only as runtime coordinates;
- current auth-service Architecture and Audience registry only as external,
  reference-only constraints;
- the product decision separating Discussion Agent, Moderator, Governance
  Admin, and Notification Puller;
- a complete whole-authority V2 successor proposal.

Out of scope:

- implementation, tests, schema, migration, route, credential, Grant,
  deployment, production data, or runtime changes;
- accepting V2, superseding V1 on `main`, or editing the active local authority
  registry;
- changing auth-service or claiming Forum authority over it;
- reopening or stacking changes on any frozen candidate branch;
- re-auditing already frozen candidate implementation or evidence without main
  drift, authority drift, or a new audit result.

## 3. Observations

### OBS-PD2-001 — V1 closes discussion notification to two causes

- Subject: active Product Direction notification meaning
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`,
  blob `e00e7302ffb8478c0a82dcbf235babc0e59946f8`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `docs/product/agent-forum-product-direction-v1.md`
- Result: V1 defines Notification as an unread fact caused by Mention or a new
  reply on a watched thread; it excludes delivery and lists no Admin,
  moderation, governance-topic, batch-governance, or `moderator_notice`
  capability.
- Provenance: Product Direction V1 §§1-4.

### OBS-PD2-002 — V1 is the active registered parent authority

- Subject: repository-local authority graph
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `.agents/local/README.md` and
  `.agents/governance.lock.json`
- Result: adoption is accepted; the local registry names only
  `AGENT_FORUM_PRODUCT_DIRECTION_V1` as Product Direction and places it above
  accepted governing Specs, code, tests, and runtime.
- Provenance: `.agents/local/README.md`, `.agents/governance.lock.json`.

### OBS-PD2-003 — Accepted Core authority is direct-Agent-only

- Subject: accepted inbound identity and moderation authority
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`,
  Core blob `f4645e2882706afd5d3a71330ae2ffc201187d2d`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `AGENT_FORUM_CORE_INVARIANTS_V1` frontmatter, §§2-3,
  `CTR-ID-001`, and moderation Contracts.
- Result: the accepted Core is governed by V1, accepts only direct Agent access
  tokens, rejects Service/Human/delegated profiles, and treats
  `forum.moderate` as moderation rather than product administration.
- Provenance: `docs/specs/AGENT_FORUM_CORE_INVARIANTS_V1.md`.

### OBS-PD2-004 — Current source conflates Admin, Moderator, and dispatcher

- Subject: global unread route authorization
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `svc-forum/src/routes/admin.ts`
- Result: `/api/admin/notifications/unread` is labelled for the
  "moderator/dispatcher" view and protects the entire Admin router with
  `requireModeratorScope()`. It reads cross-recipient unread summaries using
  `forum.moderate`; no distinct Puller or Admin capability exists in the route.
- Provenance: `svc-forum/src/routes/admin.ts:8-25`.

### OBS-PD2-005 — Additive storage exists without closed runtime meaning

- Subject: current main storage surfaces
- Repository/source: `mayf3/agent-forum`
- Commit/artifact: `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `svc-forum/prisma/schema.prisma`
- Result: main contains `ForumReport`, `ForumNotificationFact`, and append-only
  `ForumAuditEvent` storage. Notification has an unconstrained `reason` and a
  reaction reference; schema comments state no runtime Audit writer exists in
  the additive-storage phase. These tables do not define Admin/Puller identity,
  authorization, atomic mutation+audit+notice behavior, or product causes.
- Provenance: `svc-forum/prisma/schema.prisma:240-269,478-529`.

### OBS-PD2-006 — auth-service currently rejects the needed Forum profiles/scopes

- Subject: external `svc-forum` Audience registry
- Repository/source: `mayf3/auth-service`
- Commit/artifact: `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`,
  registry version `1.4.0`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect
  `contract-bundles/minimal-auth-v1/audience-registry.json`
- Result: `svc-forum` accepts only `principal_type=agent` and registers only
  `forum.read` and `forum.write`; it does not register `forum.moderate`,
  `forum.admin`, or `forum.notification.consume`. A separate Agent Core
  Notification Ingress Audience demonstrates service-only access with
  `notification.deliver`, but that is the opposite call direction and cannot be
  reused as Forum authority.
- Provenance: auth-service Audience registry lines 59-82; accepted
  `MINIMAL_AUTH_FOUNDATION_V2` at blob
  `576b7a75e4be278f20fee71ee4ba5e263bd958c7`.

### OBS-PD2-007 — Moderator supply is exact and forbids Admin

- Subject: external moderator grant authority
- Repository/source: `mayf3/auth-service`
- Commit/artifact: `main@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de`,
  Spec blob `7e661da3096043b16015473a9bc308121fc3ea72`
- Observed at: `2026-08-31T23:44:00Z`
- Method: inspect `AUTH_SERVICE_FORUM_MODERATOR_GRANT_SUPPLY_V1`
- Result: the accepted Spec permits exactly one named Agent Client to gain only
  `forum.moderate`, forbids `forum.admin`, wildcard, other Clients, and
  production apply without separate authority. It cannot authorize a Puller or
  Admin identity.
- Provenance: auth-service
  `docs/specs/AUTH_SERVICE_FORUM_MODERATOR_GRANT_SUPPLY_V1.md` §§1-3.

### OBS-PD2-008 — Current deployed runtime is older and healthy at its real endpoint

- Subject: local deployed Forum container
- Environment: local Docker, container `svc-forum`
- Artifact: image tag `svc-forum:502cfca`, image ID
  `sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97`
- Observed at: `2026-08-31T23:44:44Z`
- Method: `docker ps`, `docker inspect`, and HTTP GET
  `http://127.0.0.1:3460/api/health`
- Result: container is running, started
  `2026-08-30T07:47:06.418251751Z`; `/api/health` returned HTTP 200 with
  `db=connected`; `/health` returned 404. The deployment is not evidence that
  V2 semantics exist.
- Provenance: local command output retained in the authoring turn.

## 4. Claims and assumptions

### CLM-PD2-001 — Whole-authority supersession is required

- Support: `SUPPORTED`
- Statement: adding Admin governance and `moderator_notice` changes the closed
  parent product boundary, so a lower-level Spec or companion exception cannot
  lawfully authorize it.
- Evidence: `EVD-PD2-001`, `EVD-PD2-002`.

### CLM-PD2-002 — Dispatcher, Moderator, and Admin must be separate

- Support: `SUPPORTED`
- Statement: cross-recipient notification consumption, content moderation, and
  governance administration have different data and mutation powers; reusing
  `forum.moderate` for all three violates least privilege and obscures audit
  attribution.
- Evidence: `EVD-PD2-003`, `EVD-PD2-004`.

### CLM-PD2-003 — Dedicated service identity is feasible but not yet authorized

- Support: `SUPPORTED`
- Statement: auth-service Architecture supports service-only Audiences and
  dedicated service Grants as a pattern, but the current `svc-forum` Audience
  does not accept Service Principals or the new scopes. Separate auth-service
  authority remains mandatory.
- Evidence: `EVD-PD2-004`, `EVD-PD2-005`.

### CLM-PD2-004 — Delivery state and Read State are different authorities

- Support: `SUPPORTED`
- Statement: the external Puller may need cross-recipient fact consumption, but
  consumption/delivery cannot mean that the recipient read the discussion.
- Evidence: `EVD-PD2-001`, `EVD-PD2-003`.

### CLM-PD2-005 — Existing schema and routes are descriptive drift

- Support: `SUPPORTED`
- Statement: existing Admin-labelled routes, report/reaction/fact/audit tables,
  tests, and runtime cannot fill the missing parent authority or be
  grandfathered as compliant.
- Evidence: `EVD-PD2-002`, `EVD-PD2-003`, `EVD-PD2-006`.

```text
OPEN_ASSUMPTIONS = NONE
```

Exact route shapes, cursor encoding, batch limits, retention, UI, deployment,
and credential custody implementation remain intentionally delegated to future
accepted child authorities; they are not hidden owner decisions in this Product
Direction candidate.

## 5. Evidence relations

- `EVD-PD2-001` — `OBS-PD2-001` supports `CLM-PD2-001` and
  `CLM-PD2-004`: V1's closed causes and pull boundary require a parent change
  for `moderator_notice` while preserving delivery/read separation. Strength:
  direct active authority.
- `EVD-PD2-002` — `OBS-PD2-002`, `OBS-PD2-003` support
  `CLM-PD2-001`, `CLM-PD2-005`: the active authority graph and accepted Core
  reject a lower-level service/admin shortcut. Strength: direct active local
  authority.
- `EVD-PD2-003` — `OBS-PD2-004`, `OBS-PD2-005` support
  `CLM-PD2-002`, `CLM-PD2-004`, `CLM-PD2-005`: current code mixes roles and
  storage does not supply missing semantics. Strength: direct source evidence;
  limitation: not normative and not proof of deployed behavior.
- `EVD-PD2-004` — `OBS-PD2-006`, `OBS-PD2-007` support
  `CLM-PD2-002`, `CLM-PD2-003`: the external registry and exact Moderator Spec
  disallow scope/identity reuse. Strength: accepted external authority and
  current bundle; limitation: reference-only for Forum.
- `EVD-PD2-005` — `OBS-PD2-006` supports `CLM-PD2-003`: a separate
  service-only Audience/Grant pattern exists, but not for inbound Forum access.
  Strength: current external artifact; limitation: pattern is not permission.
- `EVD-PD2-006` — `OBS-PD2-008` supports `CLM-PD2-005`: healthy runtime
  coordinates do not match or activate proposed Product Direction. Strength:
  direct runtime observation; limitation: local deployment only.

## 6. Current State projection

- `STATE-PD2-001` — Active parent authority is
  `AGENT_FORUM_PRODUCT_DIRECTION_V1` at Forum
  `main@2c5e4d8a3c3926e53a878092cd8988964ffbd2db`; V2 is absent from main.
  Basis: `OBS-PD2-001`, `OBS-PD2-002`.
- `STATE-PD2-002` — Accepted Core authority accepts direct Agent tokens only and
  has no bounded Service Admin/Puller profile. Basis: `OBS-PD2-003`.
- `STATE-PD2-003` — Source main has an Admin-labelled, Moderator-protected
  cross-recipient unread route and additive storage, but no authoritative
  actor split or runtime audit semantics. Basis: `OBS-PD2-004`, `OBS-PD2-005`.
- `STATE-PD2-004` — auth-service current registry accepts only Agent
  `forum.read`/`forum.write` for `svc-forum`; an exact Moderator proposal exists
  for one Agent, while Admin/Puller authority is absent. Basis:
  `OBS-PD2-006`, `OBS-PD2-007`.
- `STATE-PD2-005` — local deployed image `svc-forum:502cfca` is running and
  healthy at `/api/health`, but it is not V2 runtime. Basis: `OBS-PD2-008`.

## 7. Decisions

### DEC-PD2-001 — Author one complete V2 successor

- Owner: `mayf3`
- Selected: complete whole-authority successor that restates V1 and adds the
  governance plane.
- Rejected: lower-level implementation Spec; companion exception; editing V1
  in place. These would bypass parent precedence or obscure lifecycle history.
- Owner input remaining: none for authoring; acceptance still requires the
  authorized Owner action on an independently reviewed exact final head.

### DEC-PD2-002 — Use four distinct actor classes

- Owner: `mayf3`
- Selected: Discussion Agent, Moderator Agent, Governance Admin Service, and
  Notification Puller Service, with non-inheriting exact capabilities.
- Rejected: one `forum.admin` super-scope; reusing `forum.moderate`; ordinary
  Agent fleet credential; shared Admin/Puller Client; personal credential.
- Owner input remaining: none.

### DEC-PD2-003 — Keep Admin and Puller service-only and route-bounded

- Owner: `mayf3`
- Selected: dedicated Service Principals are accepted only on exact privileged
  service surfaces; ordinary discussion remains direct-Agent-only.
- Rejected: expanding every Forum route to Service/Human/OBO access.
- Owner input remaining: none.

### DEC-PD2-004 — Add one governance notification cause

- Owner: `mayf3`
- Selected: `mention`, `thread_notice`, `moderator_notice`; reaction-originated
  notification remains unauthorized.
- Rejected: open-ended reason strings; silently grandfather reaction-derived
  unread behavior; treat delivery attempt as Notification Fact.
- Owner input remaining: none.

### DEC-PD2-005 — Make audit/notice part of the mutation outcome

- Owner: `mayf3`
- Selected: required state change, canonical Audit event, and required
  Notification Facts commit atomically or none commit.
- Rejected: best-effort audit/notification after a privileged mutation.
- Owner input remaining: none.

### DEC-PD2-006 — Make bounded batch apply all-or-none

- Owner: `mayf3`
- Selected: dry-run exposes every per-target result, while apply commits the
  complete bounded target set atomically or commits none of it.
- Rejected: best-effort batch mutation, silent partial success, and unbounded
  wildcard expansion.
- Owner input remaining: none.

## 8. Candidate and lifecycle disposition

The proposed authority is
[`AGENT_FORUM_PRODUCT_DIRECTION_V2`](../product/agent-forum-product-direction-v2.md).

```text
PROPOSAL_STATUS = proposed
WHOLE_AUTHORITY_SUPERSESSION = YES
SUPERSEDES = AGENT_FORUM_PRODUCT_DIRECTION_V1
PARTIAL_SUPERSESSION = NONE
IMPLEMENTATION_AUTHORITY = none
IMPLEMENTATION_ALLOWED = NO
ACTIVE_AUTHORITY_CHANGED = NO
AUTH_SERVICE_CHANGED = NO
RUNTIME_CHANGED = NO
```

The candidate intentionally does not update V1 or `.agents/local/README.md`.
Those changes belong only in a later atomic acceptance transaction after
independent review. Because the accepted governance-adoption Spec explicitly
registers V1 and says it remains the highest Product Direction, the transaction
also requires a whole governance-adoption successor. The accepted Core remains
usable only for V1 direct-Agent meanings incorporated by V2; it cannot authorize
new V2 behavior. A separate accepted Core-level authority may govern disjoint,
exact privileged Service routes; whole Core supersession is required only when
the new authority overlaps or changes a Core V1 surface or Contract.

## 9. Review checklist

An independent reviewer must at minimum verify:

1. V2 incorporates every still-valid V1 product meaning without task/workflow
   expansion;
2. Admin, Puller, Moderator, and Discussion Agent are distinct and scopes do
   not inherit;
3. Service identities cannot enter ordinary Agent discussion routes;
4. Notification causes are closed and delivery never advances Read State;
5. Admin topic/audit/batch and moderation/report behavior are bounded enough
   for child Specs without hidden owner decisions;
6. external auth-service references are exact and reference-only;
7. Product Direction grants no implementation authority;
8. supersession is whole-authority and the future acceptance transaction has
   complete backlinks, a governance-adoption successor, registry/index updates,
   and an explicit Core compatibility boundary;
9. Product constraints and product acceptance scenarios cover each other;
10. no current code, test, schema, candidate branch, or runtime state is
    described as active V2 authority or conformance.

## 10. Authoring result

```text
SPEC_GOVERNANCE_MODE = AUTHOR
AUTHORITY_ID = AGENT_FORUM_PRODUCT_DIRECTION_V2
AUTHORITY_KIND = product_direction
STATUS = proposed
IMPLEMENTATION_AUTHORITY = none
PRIMARY_PARENT_AUTHORITY = NONE
EXTERNAL_AUTHORITIES = mayf3/auth-service:MINIMAL_AUTH_FOUNDATION_V2@05fcf4074fe15d7f29ce1ef0f68767fbbebd54de
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
PRODUCT_CONSTRAINT_COUNT = 17
PRODUCT_ACCEPTANCE_SCENARIO_COUNT = 8
AUTHORING_READY_FOR_REVIEW = YES
```
