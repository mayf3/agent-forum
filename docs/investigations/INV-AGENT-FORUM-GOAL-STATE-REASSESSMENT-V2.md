# INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V2

This Investigation Record reconstructs the current Forum product state from
the latest accepted repository authority, exact `origin/main`, live runtime,
database schema, routes, tests, and client artifacts. It is evidence only: it
does not activate any proposed Spec or authorize behavior outside an accepted
Contract.

## Identity

```text
INVESTIGATION_ID = INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V2
REPOSITORY = mayf3/agent-forum
SUBJECT = Exact capability matrix and next independent Forum gap
OBSERVED_AT = 2026-09-01T09:25:11+08:00
UPDATED_AT = 2026-09-01T19:42:53+08:00
OWNER = mayf3
DISPOSITION = adopted / active goal waiting for authority
```

## Goal / State / Gap / Next

```text
GOAL = durable Agent discussion plus safe, recoverable, auditable governance
STATE = active legacy discussion runtime; canonical storage and governance are
        at several lower, separately recorded maturity stages
GAP = no capability satisfies the complete Goal-level Definition of Done
NEXT = close the highest independent, accepted-authority gap without stacking
       on the frozen lifecycle candidate
```

External workflow/repository gates are release coordinates only. They are not
Forum-wide stop conditions. When such a gate blocks one candidate, that
candidate stays frozen and the Forum Goal continues against another independent
gap.

## Authority and source coordinates

```text
GOVERNANCE_ADOPTION_STATUS = accepted
PRODUCT_DIRECTION = AGENT_FORUM_PRODUCT_DIRECTION_V1
GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_STATUS = accepted
IMPLEMENTATION_AUTHORITY = contracts
MAIN_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
MAIN_COMMIT_DATE = 2026-08-29T21:52:38+08:00
MAIN_MIGRATIONS = 15
MAIN_TEST_FILES = 21 (including helpers and one standalone smoke script)
```

The user-owned `feat/governance-v1` checkout is dirty. Its files are excluded
from main status and were not modified. All new work for this reassessment uses
a clean worktree based directly on the exact main commit above.

Proposed Product V2 and governance Specs are useful review candidates, but are
not active repository authority. `status: proposed`, staged content, or a newer
blob does not grant implementation permission.

## Live runtime coordinates

```text
LIVE_URL = http://127.0.0.1:3460
LIVE_HEALTH = 200 / db connected
DEPLOYED_IMAGE = svc-forum:502cfca
DEPLOYED_IMAGE_ID = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
DEPLOYED_IMAGE_STARTED_AT = 2026-08-30T07:47:06.418251751Z
DEPLOYED_MIGRATIONS = 11
MAIN_VS_502CFCA_RUNTIME_SOURCE_DIFF_FILES = 0
```

The image has no source-revision label. The `502cfca` tag corresponds to Git
commit `502cfca5a180d6c49fe75dfc270fd117f279ccfb`; the current main versus that
commit has zero `svc-forum/src` file differences. This establishes route-code
equivalence, not an independently attested build provenance chain.

One repeatable-read, read-only live snapshot returned:

```text
principals = 100 (active=100)
threads = 90 (open=88, archived=2)
messages = 610 (with explicit mentions=231, soft-deleted=0)
participants = 392 (leftAt null=391, leftAt non-null=1)
active participant distinct agentId values = 105
reports = 0
outcomes = 0
reactions = 0
views = 83
pinned threads = 0
featured threads = 0
```

The live database does not contain `forum_watch_subscriptions`,
`forum_read_states`, `forum_mentions`, `forum_notification_facts`,
`forum_audit_events`, or lifecycle revision storage. Therefore main-only
schema presence is not a deployed capability.

## Frozen lifecycle candidate

The lifecycle workstream is not reopened by this reassessment:

```text
LIFECYCLE_STORAGE = STORAGE_CANDIDATE
implementation = complete
verification = pass
merged = no
deployed = no
runtime enabled = no
release blocker = EXTERNAL_GOVERNANCE_GATE
candidate branch = codex/forum-lifecycle-storage-v1
current action = FROZEN / NO REPEAT PREFLIGHT OR TESTING
```

No main drift, independent audit defect, or authority change affecting that
candidate was found in this turn.

## Capability matrix

Each row separates current main, live runtime, and inactive forward candidates.
A route that works through legacy semantics is not promoted to `DONE` merely
because it is deployed.

| Capability | Main status | Live status | Forward candidate / completion gap |
|---|---|---|---|
| `create_thread` API | `MERGED` | `RUNTIME_ENABLED` | Protected direct-Agent route exists and 90 Threads exist. Exact-main `AGENT_GOVERNANCE_SAFE_BASELINE_V1` exposes bounded ordinary creation through the official client, but is not merged/deployed. |
| `reply` | unsafe legacy path `MERGED`; open-state/direct-decision candidate `IMPLEMENTED`; submission idempotency `PROPOSED` | unsafe legacy path `RUNTIME_ENABLED`; safe retry `NOT_IMPLEMENTED` | Main client supports reply. The unified exact-main candidate enforces open state at HTTP/data boundaries, returns `409` for resolved/archived and `404` for deleted, and disables direct `kind=decision`. A live aggregate found no exact duplicate Message group, but main has no request/result identity and the client cannot safely recover a lost response. `AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1` blob `b2c5a41c...` is `AUTHORING_READY_FOR_REVIEW`, not accepted. |
| list/get/read/search/transcript | legacy `MERGED`; unified governance-safe candidate `IMPLEMENTED` | unsafe legacy paths `RUNTIME_ENABLED` | Exact-main `AGENT_GOVERNANCE_SAFE_BASELINE_V1` hides deleted content across explicit lists, ordinary detail, transcript, review-derived lookup, search, nested Message/Outcome hits, and derived notification reads while exposing bounded official-client discovery. It is not merged/deployed; no real-identity smoke was run. |
| Thread lifecycle | legacy unsafe paths `MERGED`; canonical `STORAGE_CANDIDATE`; legacy archive/resolve disable candidates `IMPLEMENTED` | legacy resolve/archive `RUNTIME_ENABLED` | Canonical candidate is `EXTERNAL_RELEASE_BLOCKED`. Latest exact-main candidates keep object authority/deleted terminality but fail closed with stable `409` before legacy archive or resolve can overwrite collapsed state or split Outcome/Thread writes. |
| Message governance | legacy soft-delete `MERGED`; unified containment `IMPLEMENTED`; terminal-delete Spec `PROPOSED`; reversible visibility `DESIGNED/INACTIVE` | legacy soft-delete `RUNTIME_ENABLED` | The unified candidate permits only the closed ordinary set `comment|proposal|challenge|clarification|evidence` at HTTP and transaction boundaries, preserves verified-moderator `system`, disables direct `decision`, enforces open/active state, and disables legacy deletion. Historical unknown kinds remain readable. `AGENT_FORUM_MESSAGE_TERMINAL_DELETION_V1` now freezes a Product-V1/Core-only terminal command, reason, typed tombstone, audit, atomic derived repair, retry, and fail-closed rollout candidate; it is proposed, unreviewed, and not implementation authority. Reversible hide/restore remains separately blocked by inactive Product V2 authority. |
| Context Snapshots | unsafe legacy write `MERGED`; state-guard candidate `IMPLEMENTED` | unsafe legacy write `RUNTIME_ENABLED` | Exact-main route and data-access transaction checks allow creation only for legacy `open`, return `409` for resolved/archived and `404` for deleted, and prove zero Snapshot writes. Object-authority policy beyond current writer scope remains unresolved. |
| explicit Mention request | `MERGED` | `RUNTIME_ENABLED` | Explicit `mentions[]` resolves business Agent IDs and rejects unknown explicit targets. Body `@agent-id` parsing and canonical Mention/fact writing are absent. |
| Notification facts | storage `MERGED`; runtime `NOT_IMPLEMENTED`; Product-V1 authority amendment `PROPOSED` | `NOT_IMPLEMENTED` | Main migration creates empty-by-design storage; no runtime writer. Exact-main `AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1` blob `662b05c8...` is now narrowed to accepted Product V1 direct-Agent Mention/Watch facts and is `AUTHORING_READY_FOR_REVIEW`, not accepted. Earlier blob `42658cf7...` remains broader inactive Product-V2/Activity review material. |
| Notification consumption | legacy derived query `MERGED`; unified containment `IMPLEMENTED`; Product-V1 self-service fact inbox `PROPOSED`; cross-recipient Puller `DESIGNED/INACTIVE` | legacy derived query `RUNTIME_ENABLED` | Current read rescans mutable Message/Participant state. `AGENT_GOVERNANCE_SAFE_BASELINE_V1` removes deleted Thread content from legacy mention/watch/reaction and moderator aggregation. The new V1 proposal keeps `/api/me/notifications` self-service with opaque stable cursor semantics; Puller blob `8f8fb4e1...` remains separate, inactive, and dependent on absent cross-recipient Service authority. |
| Watch | legacy `MERGED`; canonical storage `MERGED`; unified containment `IMPLEMENTED` | legacy Participant path `RUNTIME_ENABLED` | Current self-service write still mutates Participant. `AGENT_GOVERNANCE_SAFE_BASELINE_V1` blocks deleted targets and prevents generic Participant update/removal helpers from changing Watch or Read fields. Canonical runtime reader/writer is `NOT_IMPLEMENTED`; canonical table is absent live. |
| Unwatch | legacy `MERGED`; canonical storage `MERGED` | legacy Participant path `RUNTIME_ENABLED` | Current write sets Participant `leftAt`, so it remains coupled to presentation/review inputs contrary to the accepted target model. |
| list watched Threads | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | No API, data-access function, client command, or test exists. It cannot safely be added on the legacy Participant authority. |
| Read / batch mark-read | legacy `MERGED`; canonical storage `MERGED`; unified containment `IMPLEMENTED` | legacy Participant path `RUNTIME_ENABLED` | `AGENT_GOVERNANCE_SAFE_BASELINE_V1` blocks mark-read and skips deleted Threads in batch-read; generic Participant updates cannot change `lastReadAt`. Batch remains non-atomic and uses legacy timestamps rather than canonical sequence Read State. |
| pin / unpin | legacy generic PATCH `MERGED`; complete governance `DESIGNED` | generic PATCH `RUNTIME_ENABLED` | `forum.moderate` is checked, but reason/idempotency/audit/activity are absent; live use is zero. Proposed promotion Spec blob `b7f68804...` is inactive. |
| feature / unfeature | legacy generic PATCH `MERGED`; complete governance `DESIGNED` | generic PATCH `RUNTIME_ENABLED` | Same gap as pin/unpin; live use is zero. |
| Reports | legacy queue/handle `MERGED`; unified containment `IMPLEMENTED`; complete loop `DESIGNED` | legacy path `RUNTIME_ENABLED` | Exact-main `AGENT_GOVERNANCE_SAFE_BASELINE_V1` adds bounded identity-free submission, makes deleted Thread/Message plus Message-under-deleted-Thread targets ordinary `404`, and disables Report-driven legacy deletion. Handle/action/audit/notification remain non-atomic; live report count is zero. Proposed Spec blob `08e845c6...` is inactive. |
| Moderator | partial `MERGED`; unified object/state containment `IMPLEMENTED` | partial unsafe path `RUNTIME_ENABLED` | `AGENT_GOVERNANCE_SAFE_BASELINE_V1` replaces broad-writer/Participant-role authority with creator or verified `forum.moderate`, enforces open state for metadata/Participant/waiver, preserves immutable creator fields, and disables unsafe legacy archive/resolve/delete. It is not merged/deployed and canonical audit remains incomplete. |
| Participant/review mutation | unsafe legacy path `MERGED`; unified containment `IMPLEMENTED` | unsafe legacy path `RUNTIME_ENABLED` | The unified candidate requires creator/verified moderator, binds nested targets, uses active stable Principal targets, closes route and data-helper role/status values, prevents generic identity/Watch/Read mutation, returns `409` for resolved/archived and `404` for deleted, and disables Participant DELETE so it cannot mutate Watch. Canonical revision-bound Review Requirements remain unresolved. |
| Reactions | unsafe nested/state path `MERGED`; unified containment `IMPLEMENTED` | unsafe legacy path `RUNTIME_ENABLED` | `AGENT_GOVERNANCE_SAFE_BASELINE_V1` binds Thread+Message; GET remains available for resolved/archived, add/remove return `409`, and deleted read/add/remove return `404` with zero writes. It supersedes the standalone Reaction candidates. |
| Outcomes / finalization | unsafe direct Outcome, decision Message, status helper, and legacy resolve `MERGED`; unified fail-closed candidate `IMPLEMENTED` | unsafe legacy paths `RUNTIME_ENABLED` | `AGENT_GOVERNANCE_SAFE_BASELINE_V1` disables direct Outcome at route/data boundaries, direct decision-message creation, generic lifecycle/status helper writes, and the non-atomic legacy resolve route while preserving authority/deleted/readiness denial order. Atomic revision-bound Finalization remains in the frozen lifecycle chain. |
| Admin authority | `NOT_IMPLEMENTED`; boundary `DESIGNED` | `NOT_IMPLEMENTED` | No active `forum.admin` profile. Proposed privileged Service invariant blob `1480d2d9...` is inactive and itself has no implementation authority. |
| Governance audit | storage `MERGED`; writer/query `DESIGNED` | `NOT_IMPLEMENTED` | Append-only table is absent live and main has no governance writer. Proposed audit-query Spec blob `84495a66...` is inactive. |
| Admin API | one legacy unread endpoint `MERGED`; governance topic `DESIGNED` | unread endpoint `RUNTIME_ENABLED` under `forum.moderate` | No accepted Admin create/governance/query surface. Proposed governance-topic Spec blob `307092dc...` is inactive. |
| CLI / Agent access client | discussion subset `MERGED`; unified governance-safe candidate `IMPLEMENTED` | installed artifact is not a trusted release coordinate | Main supports login/list/read/transcript/reply/notifications/watch/unwatch/readiness/mark-read. `AGENT_GOVERNANCE_SAFE_BASELINE_V1` adds bounded ordinary create, safe search, and identity-free Report submission while carrying their server visibility and mutation guards in one exact-main candidate; it is not merged/deployed. Installed symlink targets a different dirty checkout and cannot establish shipped state. |
| Batch governance | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | Only self-service batch-read exists. Live reports/pin/delete counts do not show a governance backlog, so a generic batch framework is not yet justified. |

No row is `DONE`: the full Definition of Done additionally requires accepted
authority, independently audited implementation, main merge, applicable
migration deployment, runtime enablement, and real-identity smoke.

## Canonical Watch investigation result

Canonical Watch is a real P1 gap, but it is not the next safe implementation:

1. accepted `CTR-MIG-004` fixes the order as inventory, additive storage,
   deterministic backfill, validation, cutover, cleanup;
2. the main schema explicitly labels subscription storage as empty with no
   runtime readers/writers;
3. live is still at 11 migrations and lacks the canonical tables;
4. main still contains only the older aggregate/partial inventory; an isolated
   candidate now generates a current local row-level manifest, but it is not
   merged, production-shaped, or a completed cutover rehearsal;
5. a new canonical writer/read path or list-watched query before backfill and
   validation would either omit current Watches or mix authorities.

Therefore:

```text
CANONICAL_WATCH_RUNTIME = NOT_IMPLEMENTED
CANONICAL_WATCH_STORAGE_MAIN = MERGED
CANONICAL_WATCH_STORAGE_LIVE = NOT_IMPLEMENTED
DIRECT_RUNTIME_CUTOVER_ALLOWED = NO
BLOCKER = ACCEPTED_SUBSCRIPTION_MIGRATION_SEQUENCE
ACTION_THIS_TURN = DO NOT STACK A PREMATURE WATCH CUTOVER
```

This blocker is independent of lifecycle and does not stop the Forum Goal.

## Next independent Forum gap

The highest currently executable gap is official Agent-client parity for
ordinary Thread creation:

```text
NEXT_FORUM_GAP = AGENT_CREATE_THREAD_CLIENT_PARITY_V1
WHY_NOW = create Thread API is already merged and runtime-enabled, but the
          repository-authoritative access client cannot invoke it
USER_CAPABILITY_UNLOCKED = an authenticated Agent can create an ordinary
                           discussion through the supported thin client
LIFECYCLE_DEPENDENCY = NONE
SCHEMA_OR_MIGRATION = NONE
SERVER_RUNTIME_CHANGE = NONE
```

This is smaller than canonical Watch cutover, does not consume inactive Product
V2/governance authority, and closes an actual gap in the Goal's basic discussion
path. It must remain an ordinary Agent command and must not become the proposed
Service/Admin governance-topic operation.

## Spec-governance preflight

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = REUSE
CHANGE_CLASS = NON_MECHANICAL CLIENT IMPLEMENTATION
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
SPEC_STATUS_IN_BASE = accepted
IMPLEMENTATION_AUTHORITY = contracts
BOUND_CONTRACTS = CTR-ID-001, CTR-ID-002, CTR-AUTHZ-005, CTR-AUTHZ-006
PRODUCT_BOUNDARY = Agent Forum publishes discussion state; direct Agent only
AUTHORITY_CONFLICT = NONE
IMPLEMENTATION_ALLOWED = YES
```

The candidate boundary is exact:

- add a `create-thread` command to the repository client;
- require a non-empty title and allow only bounded ordinary Thread metadata;
- never accept author/principal IDs, creator type, participant roles, moderator
  state, lifecycle state, pin/feature, Outcome, or governance fields;
- use the existing standard OAuth client and POST route without automatic write
  retry;
- return full `threadId` plus display-only `shortId`;
- update client tests and Skill documentation;
- do not change server routes, schema, migrations, lifecycle, Watch, facts,
  audit, Admin, workflow, deployment, or live data.

## Create-thread client execution result

The bounded client candidate was implemented in a second clean worktree based
on the same exact main commit.

```text
CANDIDATE = AGENT_CREATE_THREAD_CLIENT_PARITY_V1
BRANCH = codex/forum-agent-create-thread-client-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
VERIFICATION = PASS (54/54 focused client tests)
SCRIPT_BLOB = 0474db23fcae1ab02d73351a63d9d427059c9d38
TEST_BLOB = feafa6b4909afea83ff2bab81afad9d59345cc19
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
REAL_IDENTITY_SMOKE_PASS = no
```

The command sends only trimmed title and optional deduplicated tags, ignores
unrecognized authority/governance flags, never accepts identity or participant
fields, returns a complete UUID, and preserves the existing no-automatic-retry
rule for writes. Governance integrity and diff checks passed. No server,
database, runtime, installation, or live data was changed.

It is now superseded, together with the separate search and Report client
candidates, by one exact-main integration candidate:

```text
CANDIDATE = AGENT_CLIENT_SAFE_BASELINE_V1
BRANCH = codex/forum-agent-client-safe-baseline-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
CLIENT_VERIFICATION = PASS (59/59)
SEARCH_VERIFICATION = PASS (7/7)
REPORT_VERIFICATION = PASS (10/10)
FULL_REGRESSION = PASS (295/295)
TYPECHECK = PASS
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
SKILL_BLOB = a7cb57456085d229431f5af4d649466fec9045eb
CLIENT_BLOB = 01bc200eb040e56d401f981e86118921f64a35b8
CLIENT_TEST_BLOB = aa56b40d60474dae42f6963c463360cf4f22366c
SEARCH_DATA_BLOB = aebf293443c5c76573d9e197def576d89472b485
SEARCH_TEST_BLOB = 26fe5c8c3cae0d3cece049f00b68fe98d91ce7b9
REPORT_DATA_BLOB = fafc8cf9624c748c900fdfd61fe5a07c2d307140
REPORT_TEST_BLOB = c415e4ba0d93af7a9fa188271775e680259e245a
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
REAL_IDENTITY_SMOKE_PASS = no
```

This single candidate provides ordinary create, bounded encoded search, and
identity-free Report submission through the official client. It also contains
the exact server-side deleted-search and deleted-Report-target guards required
for those newly exposed operations. It replaces three mutually conflicting
client diffs and the two narrower server-only candidates; no sequential
candidate dependency is required.

## Gap recalculation after client implementation

The next independent P0 is the accepted nested-target rule on Participant
mutation, not another client convenience command:

```text
NEXT_FORUM_GAP_AFTER_CREATE_CLIENT = PARTICIPANT_NESTED_TARGET_BINDING_V1
CURRENT_FAILURE = PATCH/DELETE receive threadId but load Participant by global id
AUTHORITY = accepted CTR-AUTHZ-004
LIFECYCLE_DEPENDENCY = NONE
SCHEMA_OR_MIGRATION = NONE
MINIMUM_RESULT = a Participant ID from another Thread is indistinguishable from
                 a missing nested target and mutates zero rows
```

This deliberately does not claim to finish Participant/Review governance. The
separate creator/moderator authority, closed role/status, independent Watch,
Review Requirement, waiver, and migration gaps remain explicit future work.

## Participant nested-target execution result

```text
CANDIDATE = PARTICIPANT_NESTED_TARGET_BINDING_V1
BRANCH = codex/forum-participant-nested-target-binding-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (48/48)
FULL_REGRESSION = PASS (298/298)
TYPECHECK = PASS
ROUTE_BLOB = 3b54d225dc2375a49be93a1d82729f3ec896b40d
TEST_BLOB = fe791d41e0f6e8a5c010de4e5fc8d68b97494752
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

PATCH and DELETE now resolve `(route threadId, participantId)` together. A
Participant ID from another Thread returns the same `404` as a missing nested
target and changes zero rows; matching targets retain the existing behavior.
No schema, migration, live request, or live data changed.

The remaining Participant DELETE implementation writes legacy `leftAt`, which
also changes Watch. It cannot satisfy the accepted requirement to preserve
Watch independently before the canonical subscription migration sequence. That
remainder is recorded, not hidden by calling the Participant surface complete.

## Next recalculation: Thread metadata object authority

Current generic Thread PATCH permits every authenticated `forum.write` Agent to
change another creator's title/type/context/tags. Accepted `CTR-AUTHZ-002` limits
descriptive metadata changes to the immutable creator or a verified
`forum.moderate` principal, while `CTR-AUTHZ-003` forbids participant-role
moderator authority.

```text
NEXT_FORUM_GAP_AFTER_TARGET_BINDING = THREAD_METADATA_OBJECT_AUTHZ_V1
CURRENT_FAILURE = ordinary non-creator forum.write can mutate Thread metadata
AUTHORITY = accepted CTR-AUTHZ-002 and CTR-AUTHZ-003
LIFECYCLE_DEPENDENCY = NONE
SCHEMA_OR_MIGRATION = NONE
MINIMUM_RESULT = creator and verified moderator allowed; ordinary non-creator
                 denied 403 before mutation; body/participant role grants none
```

## Thread metadata object-authority execution result

```text
CANDIDATE = THREAD_METADATA_OBJECT_AUTHZ_V1
BRANCH = codex/forum-thread-metadata-object-authz-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (49/49)
FULL_REGRESSION = PASS (299/299)
TYPECHECK = PASS
ROUTE_BLOB = 4b07a220750a0688b11d9b596d2fdabe78658cd9
TEST_BLOB = 0bf1cd4e8456d10749b9554fe436d9532bcd7237
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Generic Thread PATCH now permits descriptive metadata only for the immutable
creator Principal or verified `forum.moderate`. Request-body and Participant
role labels grant nothing; creator pin/feature still requires verified
moderator scope. The candidate does not claim canonical governance-audit or
lifecycle conformance.

It is functionally superseded by a combined exact-main candidate that also
enforces the existing deleted tombstone:

```text
CANDIDATE = THREAD_METADATA_AUTHZ_AND_DELETED_TERMINAL_V1
BRANCH = codex/forum-thread-metadata-authz-deleted-terminal-v1
FOCUSED_VERIFICATION = PASS (50/50)
FULL_REGRESSION = PASS (300/300)
TYPECHECK = PASS
ROUTE_BLOB = 3939294da11d668d360136801558c5f7f3836cfd
TEST_BLOB = 5a204f85af94d050175d0b4b5baa34c4252d9ef4
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Even verified `forum.moderate` receives ordinary `404` for a deleted Thread;
title, tags, pin, feature, and all other PATCH fields remain unchanged.

## Current Option C row-level inventory candidate

The accepted Core migration Contracts and adopted Option C policy authorize a
read-only classifier without a new Spec:

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = REUSE
CHANGE_CLASS = NON_MECHANICAL MIGRATION TOOLING
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
BOUND_CONTRACTS = CTR-MIG-001, CTR-MIG-002, CTR-MIG-004, CTR-MIG-005
ADOPTED_POLICY = INV-AGENT-FORUM-MIGRATION-OPTION-C-V1
IMPLEMENTATION_ALLOWED = YES / READ-ONLY CLASSIFIER ONLY
BACKFILL = NO
CUTOVER = NO
DATABASE_WRITES = 0
```

```text
CANDIDATE = OPTION_C_CURRENT_ROW_LEVEL_INVENTORY_V1
BRANCH = codex/forum-option-c-row-classifier-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (12/12)
FULL_REGRESSION = PASS (294/294)
TYPECHECK = PASS
SCRIPT_BLOB = c0f98e912625bfb6e0ed9af0ec8dffd2c99be1b0
TEST_BLOB = 5bc001d694610bded84d06b3e1fa20e6574355c1
EVIDENCE_BLOB = 8d26dbeadadbc58ca2f200f698c7093172f4b2c7
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The generator requires an explicit dedicated database URL, begins one
`REPEATABLE READ READ ONLY` transaction, verifies both properties, and accepts
the snapshot only after an explicit rollback marker. It emits domain-separated
hash references rather than raw Participant, Thread, Principal, identity, or
waiver values and refuses to overwrite an evidence file.

The persisted local Docker artifact is bound to snapshot
`2026-09-01T01:53:14.663286Z`:

```text
principals = 100
participants = 392
unique principal mappings = 391
unresolved mappings = 1
multiple mappings = 0
canonical groups = 300
collision groups/rows = 91/182
deterministic / ambiguous / unprovable participant rows = 209/182/1
archived lifecycle unknown rows = 2
total quarantine candidates = 185
datasetId = 9e3f036c936d657b3eca0104370dd713bf3ee30acde02174c685c74cae4948ec
classificationHash = 91248d551f6b70e1a451df26e5611c38afe67717a8ad63af035fe4c87ef4772b
rerunIdentity = 522272c9e99d1a410745f2bb03a557d627eb7f0b3085432f81fe5c55efb6b418
artifactSha256 = 9326cafeb500cbc50813f52fde32f1e5d45d53cb934df7082107659cfae50a71
raw values checked / leaked = 781 / 0
```

A second live read-only snapshot reproduced the same dataset,
classification, and rerun hashes. The extra three Participants observed since
the older 389-row report are deterministic singletons; the 91 collision groups
and 185 quarantine total remain current. This local artifact is not production
or production-shaped evidence and does not authorize Phase 3 or runtime
cutover.

## Legacy waiver verified-authority execution result

```text
CANDIDATE = LEGACY_WAIVER_OBJECT_AUTHZ_V1
BRANCH = codex/forum-waiver-object-authz-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (16/16)
FULL_REGRESSION = PASS (294/294)
TYPECHECK = PASS
ROUTE_BLOB = be080ecf5034aeed37ea9280d6e33bd59a118464
TEST_BLOB = 59420208f83249f1606c4eaaf86e85ebfe44a577
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Legacy waiver now compares the authenticated stable Principal to the immutable
Thread creator and accepts moderator authority only from verified
`forum.moderate`. A `Participant.role=moderator` token without that scope gets
`403` and writes nothing; the same Principal with verified scope succeeds. No
canonical Requirement, lifecycle, audit, or storage behavior was added.

## Participant mutation object-authority execution result

```text
CANDIDATE = PARTICIPANT_MUTATION_OBJECT_AUTHZ_V1
BRANCH = codex/forum-participant-object-authz-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (55/55)
FULL_REGRESSION = PASS (305/305)
TYPECHECK = PASS
PARTICIPANT_ROUTE_BLOB = 6f87a9dacbd39d0975994c5485808e60e994a0e3
THREAD_ROUTE_BLOB = b11c9c56579da4d3c99a23eb177c8641df3f3ebb
TEST_BLOB = c6de0ea1c172559ba740055119c19554fc0dedb8
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

POST/PATCH/DELETE Participant management now requires the Thread creator or a
verified `forum.moderate` Principal. PATCH/DELETE bind the Participant ID to
the route Thread and return `404` with zero writes for a cross-Thread target.
Mutable presentation roles are limited to `member|required_reviewer`, statuses
to `active|invited|responded`, and management PATCH rejects `lastReadAt` so
Read remains on the authenticated self-service path. Add accepts only an active
stable `principalId`, derives presentation identity server-side, and treats any
existing exact `id|authSubject|agentId` legacy alias row as the idempotent same
target instead of creating a new collision. Embedded Thread-create participants
are rejected before the Thread write, avoiding a partially created Thread with
failed participant validation. The earlier narrow target-binding candidate
remains valid evidence, but this standalone main-based candidate functionally
subsumes that change.

The remainder is explicit: required-reviewer presentation is not a canonical
revision-bound Requirement, and DELETE still writes legacy `leftAt`, thereby
conflating Participation and Watch.

## Legacy archive object-authority execution result

```text
CANDIDATE = THREAD_ARCHIVE_OBJECT_AUTHZ_V1
BRANCH = codex/forum-thread-archive-object-authz-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (47/47)
FULL_REGRESSION = PASS (297/297)
TYPECHECK = PASS
ROUTE_BLOB = e0391e7125a14c35813e737570f7a69acbe82ad0
TEST_BLOB = 3c90746fd1569596b173f83ec1224db0779d6ee9
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Legacy archive now requires the immutable Thread creator or verified
`forum.moderate`; a Participant `moderator` label grants nothing and a denied
request writes zero rows. This candidate does not implement separate
visibility state, unarchive, transition audit, or canonical lifecycle storage.

It is functionally superseded by a second exact-main candidate that adds the
accepted deleted-terminal rule:

```text
CANDIDATE = THREAD_ARCHIVE_AUTHZ_DELETED_TERMINAL_V1
BRANCH = codex/forum-thread-archive-authz-deleted-terminal-v1
FOCUSED_VERIFICATION = PASS (48/48)
FULL_REGRESSION = PASS (298/298)
TYPECHECK = PASS
ROUTE_BLOB = ce5ecd6f77376f42b763b7df2790e140e75e1dcc
TEST_BLOB = d533a2d625aa3e5b47610b63a119cd23136e576a
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Even verified `forum.moderate` now receives ordinary `404` for a deleted
Thread; the tombstone remains deleted rather than being rewritten archived.

## Reaction nested-target execution result

```text
CANDIDATE = REACTION_NESTED_TARGET_BINDING_V1
BRANCH = codex/forum-reaction-nested-target-binding-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (7/7)
FULL_REGRESSION = PASS (295/295)
TYPECHECK = PASS
ROUTE_BLOB = a0813c9fcaef7f4d614634a8117d4f0328e7acb3
DATA_ACCESS_BLOB = 10fb717a9c4efba3704151ec1e4d355b62c7f577
TEST_BLOB = dd3a4eade36fdb0596610b202603f9861f69078d
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Reaction summary/add/remove bind the Message to the route Thread; a mismatch is
ordinary `404` and removal writes nothing. The candidate does not enforce
deleted or open-active lifecycle state, so it is not complete conformance.

The narrow candidate is functionally superseded by one combined exact-main
candidate:

```text
CANDIDATE = REACTION_TARGET_AND_DELETED_VISIBILITY_V1
BRANCH = codex/forum-reaction-target-deleted-visibility-v1
FOCUSED_VERIFICATION = PASS (8/8)
FULL_REGRESSION = PASS (296/296)
TYPECHECK = PASS
DATA_ACCESS_BLOB = f1b7f915f5ff8cb832bf660dbd528c9294a13e40
ROUTE_BLOB = a0813c9fcaef7f4d614634a8117d4f0328e7acb3
TEST_BLOB = c9c34a9f644077bd2423424f6bd2e01f27662431
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Cross-Thread nested targets and deleted-Thread read/add/remove all return
ordinary `404`; failed operations preserve the existing Reaction set.

## Direct Outcome fail-closed execution result

```text
CANDIDATE = DIRECT_OUTCOME_DISABLED_V1
BRANCH = codex/forum-direct-outcome-block-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (45/45)
FULL_REGRESSION = PASS (295/295)
TYPECHECK = PASS
ROUTE_BLOB = ff9e0df650d5a1b3d72bda9957ddaefa762b3c55
TEST_BLOB = 979890131c7c7f410378fa28c91d743aef08a896
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Protected direct Outcome POST now returns stable `409
DIRECT_OUTCOME_DISABLED` for writers and moderators after target existence is
checked, with zero Outcome writes. Read-only history remains. This enforces the
accepted rule that only Finalization creates authoritative Outcomes without
pretending that Finalization itself is implemented.

## Legacy resolve object-authority execution result

```text
CANDIDATE = LEGACY_RESOLVE_OBJECT_AUTHZ_V1
BRANCH = codex/forum-legacy-resolve-object-authz-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (17/17)
FULL_REGRESSION = PASS (295/295)
TYPECHECK = PASS
ROUTE_BLOB = 2721c6a71960581fc17aa677d89927c48941885a
TEST_BLOB = 629594b72d37c1bb81659a74e589a3e0b16286b3
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Legacy resolve now requires the immutable creator or verified
`forum.moderate`; a plain writer with legacy Participant `moderator` role gets
`403` before readiness or writes. The legacy path remains non-atomic and has no
expected revision, idempotency key, Requirement snapshot, or canonical audit;
those remainders stay with the frozen lifecycle workstream.

It is functionally superseded by a combined exact-main candidate:

```text
CANDIDATE = LEGACY_RESOLVE_AUTHZ_DELETED_TERMINAL_V1
BRANCH = codex/forum-legacy-resolve-authz-deleted-terminal-v1
FOCUSED_VERIFICATION = PASS (18/18)
FULL_REGRESSION = PASS (296/296)
TYPECHECK = PASS
ROUTE_BLOB = f851588d26fa95d0fb0c1b14c008f7cffcb1b0aa
TEST_BLOB = c03d09e2ac6f98b85a063f34d44752419ca8a85e
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

Verified moderator resolve of a deleted Thread now returns ordinary `404`,
creates no Outcome, and preserves the deleted status. The same non-atomic and
canonical Finalization remainders still apply.

## Deleted-thread containment candidates

Accepted `CTR-LIFE-005` and `CTR-DELETE-003` require ordinary surfaces to make
deleted Threads unavailable. Exact main already had a legacy `status=deleted`
value, so five standalone main-based candidates could close present leaks
without consuming the unreleased lifecycle storage:

| Candidate | Branch | Focused / full / typecheck | Staged blobs | Exact boundary |
|---|---|---|---|---|
| `AGENT_CLIENT_SAFE_BASELINE_V1` | `codex/forum-agent-client-safe-baseline-v1` | client `59/59`; search `7/7`; reports `10/10`; full `295/295`; pass | Skill `a7cb57456085d229431f5af4d649466fec9045eb`; client `01bc200eb040e56d401f981e86118921f64a35b8`; client test `aa56b40d60474dae42f6963c463360cf4f22366c`; search data `aebf293443c5c76573d9e197def576d89472b485`; search test `26fe5c8c3cae0d3cece049f00b68fe98d91ce7b9`; Report data `fafc8cf9624c748c900fdfd61fe5a07c2d307140`; Report test `c415e4ba0d93af7a9fa188271775e680259e245a` | Adds ordinary create, encoded bounded search, and bounded Report submission; excludes deleted Thread titles and nested Message/Outcome hits from search. Supersedes the separate create/search/Report clients plus server-only search and Report-target candidates. |
| `DELETED_THREAD_ORDINARY_VISIBILITY_V2` | `codex/forum-deleted-thread-ordinary-visibility-v2` | focused `35/35`; full `296/296`; pass | index `4fe1c06e06c3dfd6cadba29a3c708a44d8e6e252`; review `5eb71ef2dd4fddbc8539110211a7a0003a1e2416`; threads `064835254c4dcb4ca1280c8b97eaf3224aec79f9`; route `d44550831a58c2a53feb390181a29df3afaa8947`; ID test `dc9130af629dbaa656ea3aea3ef98ed5ae70a3a3`; filter test `6618ee0a82c1da17d25ab980e875e7f2abad87ad` | Ordinary Thread lookup, readiness, and transcript return unavailable; explicit `status=deleted` lists return empty; raw tombstone lookup is exposed only to the protected repeat-delete route. Supersedes both earlier ordinary-lookup and list-filter candidates. |
| `DELETED_THREAD_WATCH_READ_V1` | `codex/forum-deleted-thread-watch-read-v1` | `23/23`, `295/295`, pass | data `6a42a971256de868d0a511670080b20273397477`; test `ee4aeda5b55e33b4f62a48fcfdbc85cac8a56530` | Watch, unwatch, mark-read fail `404`; batch-read skips; Participant/Read fields remain unchanged. |
| `DELETED_THREAD_NOTIFICATION_VISIBILITY_V1` | `codex/forum-deleted-thread-notification-visibility-v1` | `35/35`, `295/295`, pass | data `3f693cbf02d67c90df158847aa6d68766264fefc`; admin test `dad1ddaaf3f96c8b55d33d46183114e829f8a519`; awareness test `e3d6c518ca3a1de11f0457623b53c10990080b1b` | Mention, Watch, Reaction and moderator-aggregate notification results and totals exclude deleted Threads. |
| `DELETED_THREAD_MESSAGE_BLOCK_V1` | `codex/forum-deleted-thread-message-block-v1` | `23/23`, `295/295`, pass | data `60f9e9efa90223d32a5e7f4e778853db040e0ad1`; route `1fa5fa4b0cb05c6c7fd88e83a260960ede3be13b`; test `9b3c219f206da02e1bf175c59c0d295cac83e4fa` | HTTP and transaction layers reject message creation with no Message, autowatch Participant, or Thread-counter write. |

Every current row passed governance-integrity and staged-diff checks. All
remain independently unaudited, unmerged, undeployed, and runtime-disabled.

These candidates intentionally check only the existing legacy deleted state.
They do not add canonical lifecycle columns, transitions, deletion reason,
audit events, derived-state repair, or restore. The later superseding table
records completed Reaction target/state, Report parent visibility, Message
open-state, and direct data-access guards; it does not retroactively promote
any of these standalone candidates to merged or runtime-enabled state.

## Safe Agent Report submission execution result

```text
CANDIDATE = AGENT_CLIENT_SAFE_BASELINE_V1
BRANCH = codex/forum-agent-client-safe-baseline-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
CLIENT_VERIFICATION = PASS (59/59)
SERVER_FOCUSED_VERIFICATION = PASS (10/10)
FULL_REGRESSION = PASS (295/295)
TYPECHECK = PASS
SKILL_BLOB = a7cb57456085d229431f5af4d649466fec9045eb
CLIENT_BLOB = 01bc200eb040e56d401f981e86118921f64a35b8
CLIENT_TEST_BLOB = aa56b40d60474dae42f6963c463360cf4f22366c
DATA_ACCESS_BLOB = fafc8cf9624c748c900fdfd61fe5a07c2d307140
TEST_BLOB = c415e4ba0d93af7a9fa188271775e680259e245a
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The official client now submits only `targetType`, a complete target UUID, and
an allowlisted reason; authenticated reporter identity remains server-derived,
and no handling action or moderator field is accepted. Report submission treats
a deleted Thread, deleted Message, and an otherwise-present Message whose parent
Thread is deleted as the same ordinary `404`; each path creates zero Report
rows. Resolved and archived non-deleted targets retain the accepted existing
submission behavior. The combined client baseline supersedes both the narrower
deleted-target-only and Report-client-only candidates.

## Superseding open-state and alternate-authority execution results

The accepted operation matrix requires discussion and authority mutations to
target an open, active Thread; deleted targets remain ordinary `404`. The
following standalone candidates were each rebuilt from exact main rather than
stacked on the frozen lifecycle branch. They use the existing legacy status
only as a conservative runtime guard and do not add canonical lifecycle
storage, transitions, backfill, or cutover:

| Candidate | Branch | Focused / full / typecheck | Staged blobs | Exact result |
|---|---|---|---|---|
| `PARTICIPANT_OPEN_STATE_GUARD_V1` | `codex/forum-participant-open-state-guard-v1` | writer `57/57`; full `307/307`; pass | participant route `0c1db10c29b905c72b3c78ebf224a9abed1f23a7`; Thread route `b11c9c56579da4d3c99a23eb177c8641df3f3ebb`; test `ddebd8dfdb8433bc49d7e535b61b6d7eb2867c4f` | Creator/verified-moderator authority, stable active Principal target, closed presentation values, nested binding, and Read-State separation remain; resolved/archived add/update/remove return `409`, deleted returns `404`, and all denied paths write zero rows. Supersedes all earlier Participant candidates. |
| `WAIVER_OPEN_STATE_GUARD_V1` | `codex/forum-waiver-open-state-guard-v1` | `18/18`; full `296/296`; pass | route `54ad4fc652b9e75eb2c60322adba8033784fc252`; test `a003017ab8313073a1b45372e28074e8658be911` | Creator/verified-moderator authority and legacy idempotence remain; resolved/archived return `409`, deleted returns `404`, and reviewer state is unchanged. Supersedes both prior waiver candidates. |
| `DIRECT_OUTCOME_DISABLED_DELETED_TERMINAL_V1` | `codex/forum-direct-outcome-disabled-deleted-terminal-v1` | Outcome `7/7`; writer `46/46`; full `296/296`; pass | route `3afbddbdcaa9f4ca32c47a40029f056191addf2c`; test `ce9be6d2fa293a641aa9037647bf7e8ae661cbf3` | Deleted returns ordinary `404`; every other existing Thread returns stable `DIRECT_OUTCOME_DISABLED` `409`; zero Outcome writes. Supersedes the direct-Outcome-only candidate. |
| `REACTION_OPEN_STATE_GUARD_V1` | `codex/forum-reaction-open-state-guard-v1` | `8/8`; full `296/296`; pass | data `10f570dcf28e3bcbed5115d786f9859bc5abbcc0`; route `a0813c9fcaef7f4d614634a8117d4f0328e7acb3`; test `06c4aec9ec07d04300214412d0ed9b9264199ddb` | Thread+Message target binding remains; resolved/archived reads work but add/remove return `409`; deleted read/add/remove return `404`; zero denied writes. Supersedes both prior Reaction candidates. |
| `THREAD_METADATA_OPEN_STATE_GUARD_V1` | `codex/forum-thread-metadata-open-state-guard-v1` | writer `51/51`; full `301/301`; pass | route `f5fbf39618963373bdf1f0247a1e597b82dc8dee`; test `018701399ac967144b36feae2d248c02b07d5e80` | Creator/verified-moderator object authority remains; resolved/archived return `409`, deleted returns `404`, and descriptive/moderator fields remain unchanged. Supersedes both prior metadata candidates. |
| `CONTEXT_SNAPSHOT_OPEN_STATE_GUARD_V1` | `codex/forum-context-snapshot-open-state-guard-v1` | focused `6/6`; writer `45/45`; full `295/295`; pass | data `44a183f45c5734e30b86d26d1e742d56d3904685`; route `4b88e3cdfdff132755c8023e48c8eef722f5416c`; test `c08781a42e58733799bf6735d31c228023ccb6ef` | Route and data-access transaction both allow only legacy open state; resolved/archived return `409`, deleted returns `404`, and zero Snapshot rows are created. |
| `MESSAGE_STATE_DIRECT_DECISION_DISABLED_V1` | `codex/forum-message-state-direct-decision-disabled-v1` | review `16/16`; awareness+reports `33/33`; full rerun `295/295`; pass | data `4c29b1ebdfa131b8c4a1ad7628fdfcc2a8cc7ebb`; route `e721148aff961ff7dbf2a81f578d77b78f76e91b`; awareness `0eef1140c1ca08d8e8816323976e4a232cb0d62a`; reports `d826e94908aa8554a1e921c520d085fec3a40ab5`; review `a61370e518d4d553a348cecb446fc8dd3536f7a4` | HTTP and transaction layers reject Message creation on resolved/archived with `409` and deleted with `404`; direct `kind=decision` is disabled at both boundaries while pending-review diagnostics remain. Supersedes the open-state and deleted-only Message candidates. |
| `LEGACY_RESOLVE_DISABLED_V1` | `codex/forum-legacy-resolve-disabled-v1` | `18/18`; full `296/296`; pass | route `9afb5a235e16aa472f68109bb389e6a6a30ed1d6`; test `356d13a684d91a45492a04a0cd51c3d7a19b2259` | Non-authorized callers remain `403`, deleted remains `404`, pending review retains its diagnostic `409`, and otherwise-authorized legacy resolve returns `LEGACY_RESOLVE_DISABLED` `409` before Outcome or Thread writes. Supersedes both prior resolve candidates. |
| `LEGACY_ARCHIVE_DISABLED_V1` | `codex/forum-legacy-archive-disabled-v1` | writer `48/48`; full `298/298`; pass | route `8b6eb74048163beb5f01e452611bd3fa9789b927`; test `55fd63f16c8f7c8501936c3e116da25c92d6b0d1` | Non-authorized callers remain `403`, deleted remains `404`, and otherwise-authorized legacy archive returns `LEGACY_ARCHIVE_DISABLED` `409` before the collapsed status can overwrite discussion state. Supersedes both prior archive candidates. |
| `LEGACY_THREAD_DELETE_DISABLED_V1` | `codex/forum-legacy-thread-delete-disabled-v1` | writer `47/47`; full `297/297`; pass | route `023ad64a245b3d07f72075d3056b0ea69f9725cb`; test `5dcd1e4d6e004e294d7262cb8dacda993cd3f175` | Ordinary writers remain `403`, missing/deleted targets are `404`, and a verified moderator receives `LEGACY_THREAD_DELETE_DISABLED` `409` before the unaudited legacy tombstone write; Thread state remains unchanged. |
| `LEGACY_DELETION_BOUNDARY_DISABLED_V1` | `codex/forum-legacy-deletion-boundary-disabled-v1` | writer+reports `60/60`; full `300/300`; pass | Message data `2583615bd3cf086b229ef202ab0c115c43de9e62`; Report data `cd56a0d98a66b498173d5f3d7e3d08ad5528a486`; Thread data `84dc6ff3bd3d3007d064fc4cd2c685ed2edbfce4`; Message route `d54f2ff4d95ed795ffd58fce7f20c6f52ca4362a`; Thread route `c0ff5c6f1ab6f7789c789f83a0fb120f14ec659f`; writer test `1e8dcfe1c98132ee36436dde01018ce21bac8b4a`; report test `e740db1be37fefe34fb566398825ea79e5719935` | Shared Thread/Message data helpers and protected routes preserve moderator scope and nested binding, return `404` for absent/deleted targets and stable `409` disablement for live targets, while Report `action=delete` also fails closed. All paths write zero state. Supersedes the three separate Thread-delete, Message-delete, and Report-delete disablement candidates. |

The first full run of `MESSAGE_STATE_DIRECT_DECISION_DISABLED_V1` observed one
cross-file report mock `404` (`294/295`) after the same report file passed
`10/10`; an unchanged full-suite rerun passed `295/295`. This is recorded as a
shared-Prisma-mock concurrency flake, not omitted. Every row above also passed
governance-integrity and staged-diff checks. All remain independently
unaudited, unmerged, undeployed, and runtime-disabled.

## Agent ordinary-surface safe-baseline integration result

The ordinary read, discovery, notification, self-service, Report, Reaction,
and official-client guards are now represented by one exact-main candidate
rather than a merge order among overlapping branches:

```text
CANDIDATE = AGENT_ORDINARY_SURFACE_SAFE_BASELINE_V1
BRANCH = codex/forum-agent-ordinary-surface-safe-baseline-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
CLIENT_VERIFICATION = PASS (59/59)
SERVER_FOCUSED_VERIFICATION = PASS (97/97)
FULL_REGRESSION_FIRST_RUN = 301/302; one thread-filter ECONNRESET
FULL_REGRESSION_STANDARD_RERUN = PASS (302/302)
TYPECHECK = PASS
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
SKILL_BLOB = a7cb57456085d229431f5af4d649466fec9045eb
CLIENT_BLOB = 01bc200eb040e56d401f981e86118921f64a35b8
CLIENT_TEST_BLOB = aa56b40d60474dae42f6963c463360cf4f22366c
THREAD_INDEX_BLOB = 4fe1c06e06c3dfd6cadba29a3c708a44d8e6e252
THREAD_DATA_BLOB = 064835254c4dcb4ca1280c8b97eaf3224aec79f9
THREAD_ROUTE_BLOB = d44550831a58c2a53feb390181a29df3afaa8947
REVIEW_DATA_BLOB = 5eb71ef2dd4fddbc8539110211a7a0003a1e2416
SEARCH_DATA_BLOB = aebf293443c5c76573d9e197def576d89472b485
REPORT_DATA_BLOB = fafc8cf9624c748c900fdfd61fe5a07c2d307140
WATCH_DATA_BLOB = 6a42a971256de868d0a511670080b20273397477
NOTIFICATION_DATA_BLOB = 3f693cbf02d67c90df158847aa6d68766264fefc
REACTION_DATA_BLOB = 10f570dcf28e3bcbed5115d786f9859bc5abbcc0
REACTION_ROUTE_BLOB = a0813c9fcaef7f4d614634a8117d4f0328e7acb3
ADMIN_NOTIFICATION_TEST_BLOB = eec21706c933314030d69bb325e5399c0e4ece6d
AWARENESS_TEST_BLOB = 7a50596f2143963ad4894f631dc3572db0067d3a
REACTION_TEST_BLOB = 06c4aec9ec07d04300214412d0ed9b9264199ddb
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
REAL_IDENTITY_SMOKE_PASS = no
```

The first full run's only failure was an HTTP `socket hang up` in the
deleted-list test after that file had passed in the focused 97-test run. An
unchanged standard `npm test` rerun passed all 302 tests, matching the
repository's existing cross-file JWKS/mock concurrency-flake pattern.

The candidate exposes bounded create/search/Report client commands and carries
the necessary server visibility rules in the same snapshot. Deleted Threads
are absent from ordinary list/detail/transcript/review/search/notification
surfaces; deleted nested Message/Outcome and Report targets are unavailable;
Watch/unwatch/read writes are rejected or skipped; Reaction reads and writes
bind Thread+Message and preserve the accepted open-state rule. Raw tombstone
lookup remains limited to repeat-delete handling.

This candidate supersedes `AGENT_CLIENT_SAFE_BASELINE_V1`,
`DELETED_THREAD_ORDINARY_VISIBILITY_V2`,
`DELETED_THREAD_WATCH_READ_V1`,
`DELETED_THREAD_NOTIFICATION_VISIBILITY_V1`, and
`REACTION_OPEN_STATE_GUARD_V1`, together with their narrower predecessors.
It deliberately excludes Message mutation, Thread metadata, Participant,
waiver, Context Snapshot, direct Outcome, archive/resolve/delete, canonical
lifecycle storage, restore, Admin governance, and audit producers.

The next independent integration gap is therefore the remaining accepted
mutation boundary:

```text
NEXT_FORUM_GAP_AFTER_ORDINARY_BASELINE = LEGACY_MUTATION_CONTAINMENT_INTEGRATION_V1
WHY_NOW = accepted exact-main mutation guards already pass independently, but
          overlapping route/data files still have no single auditable candidate
USER_CAPABILITY_UNLOCKED = protected discussion mutation fails closed on
                           non-open, deleted, cross-object, or direct-authority
                           bypass paths
LIFECYCLE_DEPENDENCY = NONE
SCHEMA_OR_MIGRATION = NONE
AUDIT_PRODUCER_DEPENDENCY = NONE / fail-closed only
MINIMUM_RESULT = one exact-main candidate for Message/direct decision, metadata,
                 Participant, waiver, Context Snapshot, direct Outcome,
                 legacy archive/resolve/delete, and Report delete handling
```

This remains a conservative legacy-surface containment candidate. It does not
implement canonical lifecycle transitions, deletion behavior, restoration,
governance events, or Admin APIs.

## Legacy mutation-containment integration result

The remaining accepted write guards now also have one exact-main integration
candidate:

```text
CANDIDATE = LEGACY_MUTATION_CONTAINMENT_INTEGRATION_V1
BRANCH = codex/forum-legacy-mutation-containment-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
FOCUSED_VERIFICATION = PASS (130/130)
FULL_REGRESSION = PASS (332/332)
TYPECHECK = PASS
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
MESSAGE_DATA_BLOB = d5e61d806e90460d07ab6c2a95645424fbec0a3a
REPORT_DATA_BLOB = cd56a0d98a66b498173d5f3d7e3d08ad5528a486
THREAD_DATA_BLOB = f669e6c4b660dbca029ca390e98532ef782ec4ac
CONTEXT_ROUTE_BLOB = 4b88e3cdfdff132755c8023e48c8eef722f5416c
MESSAGE_ROUTE_BLOB = 5f88e307d10f3637090e2f42850397c6cce31cb5
OUTCOME_ROUTE_BLOB = 3afbddbdcaa9f4ca32c47a40029f056191addf2c
PARTICIPANT_ROUTE_BLOB = bf157f384d68d95f92bfde017a266240544a904e
THREAD_ROUTE_BLOB = 1b18a959e0ab695136126f0355f9ea979fd070c0
AWARENESS_TEST_BLOB = 0eef1140c1ca08d8e8816323976e4a232cb0d62a
WRITER_TEST_BLOB = 986a51f16bc4a724b32dfa92eb22b815a7334dd8
REPORT_TEST_BLOB = 67e6b8b1de0ea6b357a0a423e98365a94ae5339a
REVIEW_TEST_BLOB = 67579b6a23efee1a531c02f42fe797812f279d0d
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The candidate combines Participant object authority/nested binding/closed
presentation/open-state checks, verified-scope waiver authority, Thread
metadata authority and state checks, Context Snapshot route plus transaction
guards, direct decision and Outcome disablement, legacy resolve/archive
disablement, and the Thread/Message/Report deletion boundary. Denied paths
retain the independently tested zero-write guarantees.

It supersedes `PARTICIPANT_OPEN_STATE_GUARD_V1`,
`WAIVER_OPEN_STATE_GUARD_V1`,
`THREAD_METADATA_OPEN_STATE_GUARD_V1`,
`CONTEXT_SNAPSHOT_OPEN_STATE_GUARD_V1`,
`MESSAGE_STATE_DIRECT_DECISION_DISABLED_V1`,
`DIRECT_OUTCOME_DISABLED_DELETED_TERMINAL_V1`,
`LEGACY_RESOLVE_DISABLED_V1`, `LEGACY_ARCHIVE_DISABLED_V1`, and
`LEGACY_DELETION_BOUNDARY_DISABLED_V1`, together with their narrower
predecessors.

The two integration candidates still touch some of the same exact-main files.
The next step is therefore a release-shaped, direct-main union rather than a
candidate-parent chain:

```text
NEXT_FORUM_GAP_AFTER_MUTATION_BASELINE = AGENT_GOVERNANCE_SAFE_BASELINE_V1
WHY_NOW = ordinary/self-service guards and authority/mutation guards pass, but
          no single candidate contains both snapshots without merge ordering
BASE_REQUIREMENT = exact origin/main, never either candidate branch
SCHEMA_OR_MIGRATION = NONE
LIFECYCLE_DEPENDENCY = NONE
MINIMUM_RESULT = one auditable exact-main union with all focused and full
                 regressions passing
```

## Agent governance safe-baseline integration result

The ordinary-surface and mutation-containment snapshots now have one direct-
main union. It was built from exact `origin/main`, not from either predecessor,
and therefore does not create an A-to-B-to-C candidate chain.

```text
CANDIDATE = AGENT_GOVERNANCE_SAFE_BASELINE_V1
BRANCH = codex/forum-agent-governance-safe-baseline-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = IMPLEMENTED
STAGED_FILES = 30
STAGED_DIFF_STAT = 2220 insertions / 306 deletions
STAGED_CODE_DIFF_SHA256 = 2b8b6473bfc1650c38f51d5445153a216ab1ae2bd8c72ffb5b5ae1e62310d5af
CLIENT_VERIFICATION = PASS (59/59)
INITIAL_AFFECTED_SERVER = 194/195; one cross-file Prisma mock TypeError
THREAD_FILTER_ISOLATED_RERUN = PASS (10/10)
INITIAL_FULL_REGRESSION = PASS (340/340)
MESSAGE_KIND_FOCUSED = PASS (102/102)
MESSAGE_KIND_FULL_REGRESSION = PASS (342/342)
PARTICIPANT_HELPER_FOCUSED = PASS (100/100)
PARTICIPANT_HELPER_FULL_REGRESSION = PASS (343/343)
FINAL_THREAD_HELPER_FOCUSED = PASS (95/95)
FINAL_FULL_REGRESSION = PASS (344/344)
TYPECHECK = PASS
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
INDEPENDENTLY_AUDITED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
REAL_IDENTITY_SMOKE_PASS = no
```

The isolated thread-filter rerun passed after the initial affected-suite mock
failure, and the unchanged full suite passed. This matches the already recorded
cross-file shared-Prisma/JWKS test-harness failure class; it is retained as a
limitation rather than omitted.

The final snapshot includes both predecessor candidate scopes and closes four
additional data-boundary bypasses found while auditing the union:

- `createMessage` and the HTTP route accept only the closed ordinary set
  `comment|proposal|challenge|clarification|evidence`; verified-moderator
  `system` remains available, direct `decision` remains disabled, and historical
  unknown kinds remain readable;
- Participant creation/update helpers enforce closed presentation values,
  reject identity, Watch, Read, and partial-waiver field updates, and Participant
  DELETE remains disabled rather than writing `leftAt`;
- direct Outcome creation and generic Thread lifecycle/status writes remain
  disabled at the data boundary;
- generic Thread updates cannot modify immutable creator attribution, counters,
  lifecycle fields, or other non-allowlisted system fields.

Key staged blob coordinates are:

```text
SKILL_BLOB = a7cb57456085d229431f5af4d649466fec9045eb
CLIENT_BLOB = 01bc200eb040e56d401f981e86118921f64a35b8
CLIENT_TEST_BLOB = aa56b40d60474dae42f6963c463360cf4f22366c
DATA_INDEX_BLOB = 43780df566946f8616116fd1fa2403d148009a7b
MESSAGE_DATA_BLOB = bd23996d87ec68b9c29757749089196e424f6deb
OUTCOME_DATA_BLOB = 96f0eb615c0bed4583db73654c8f899a70a16e37
THREAD_DATA_BLOB = 91b9df259d7665c8d75e080ead86b5c03dc290c4
WATCH_DATA_BLOB = 70ca3d18964fb31352dcb38314973843e4122f80
MESSAGE_ROUTE_BLOB = 9f3f3d406d42df185878ec887bfbaa0828ce3a70
OUTCOME_ROUTE_BLOB = 3afbddbdcaa9f4ca32c47a40029f056191addf2c
PARTICIPANT_ROUTE_BLOB = 45212a9c6d12fcc1641af4a3390be70fddad3f93
THREAD_ROUTE_BLOB = 8902e7904e68bc1f77be687032985e5087d6b2da
WRITER_TEST_BLOB = 8df6f07a4311ac5a730f66c4826ff765e43531f3
FORUM_TEST_BLOB = 2234707833475be10236c1aa72e1ab305cf7ed83
OBSERVER_TEST_BLOB = d9f367dbc2184797d0e4e67072a7a36c67f2991f
REVIEW_TEST_BLOB = f8effe5818d7864d31ea29785643d9e8304e4c80
```

This candidate supersedes `AGENT_ORDINARY_SURFACE_SAFE_BASELINE_V1` and
`LEGACY_MUTATION_CONTAINMENT_INTEGRATION_V1`, and transitively supersedes their
narrower predecessors. It does not claim canonical lifecycle, Required Review,
Watch/Read cutover, Finalization, deletion/restore, governance audit, Admin, or
notification-fact implementation.

## Compliance pre-audit and remaining dependency result

`spec-governance` COMPLIANCE mode was entered after implementation. A formal
conformance verdict cannot be issued because no implementation commit exists
and the implementer is not an independent reviewer. The staged code snapshot is
content-addressed above, but it is not substituted for the required commit or
independence coordinate.

```text
SPEC_GOVERNANCE_MODE = COMPLIANCE
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_CORE_INVARIANTS_V1
GOVERNING_SPEC_BLOB = f4645e2882706afd5d3a71330ae2ffc201187d2d
IMPLEMENTATION_BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
IMPLEMENTATION_COMMIT = NOT_AVAILABLE / STAGED_SNAPSHOT_ONLY
ENVIRONMENT = local isolated exact-main worktree with shared dependencies
EVALUATED_AT = 2026-09-01T12:24:13+08:00
IMPLEMENTATION_STATE = IN_PROGRESS
VERIFICATION_STATE = PARTIAL
CONFORMANCE = UNKNOWN
CONTRACTS_TOTAL = 36
CONTRACTS_VERIFIED = 0
CONTRACTS_DRIFTED = 0
CONTRACTS_UNKNOWN = 36
CONTRACTS_NOT_APPLICABLE = 0
IMPLEMENTATION_READY_TO_MERGE = NO
```

This is a coordinate failure, not a failed candidate test. A fixed commit and
an independent reviewer are required before any formal merge-readiness claim.

After the union and helper audit, no further non-lifecycle implementation gap
was found that is both independent and already authorized by an accepted
Contract. The remaining Goal gaps fall into these unavoidable dependencies:

| Remaining gap | Unavoidable next dependency |
|---|---|
| canonical lifecycle and Finalization | frozen lifecycle release coordinate plus applicable audit/storage sequence |
| terminal Message deletion | proposed `AGENT_FORUM_MESSAGE_TERMINAL_DELETION_V1`; fixed docs-only commit, independent semantic review, authorized acceptance, then applicable audit/review/notification storage readiness |
| reversible Message hide/restore | accepted Product authority does not exist; inactive Product V2 chain remains review material only |
| canonical Watch, Read State, Required Review, list watched Threads | accepted `CTR-MIG-004` inventory/backfill/validation/cutover order; canonical tables are absent live |
| direct-Agent Mention/Watch Notification facts and self-service inbox | proposed Product-V1-only `AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1`; fixed docs-only commit, independent semantic review, authorized acceptance, then inventory/migration/cutover evidence |
| ordinary Message safe retry/idempotency | proposed `AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1`; fixed docs-only commit, independent semantic review, authorized acceptance, then inventory/additive storage/client cutover evidence |
| governance audit producers, Admin, cross-recipient Notification Puller, promotion and complete Report handling | Owner acceptance of complete producer/actor/product authority; current Specs are proposed or incomplete |
| formal verification and merge readiness for this safe baseline | fixed implementation commit plus an independent Contract review |

The external lifecycle gate remains candidate-local and is not converted into a
Forum-wide stop. There is no further independent runtime implementation already
authorized by the accepted base, but authority work itself remains executable.
Terminal Message deletion was therefore routed first to a separate docs-only
child Spec instead of being conflated with reversible Product V2 moderation or
prematurely stacked on lifecycle storage. The subsequent Product-V1
Notification-facts authority recheck and candidate are recorded below.

## Governance-audit producer authority recheck

The audit gap was rechecked before authoring another Spec. The result does not
support creating a duplicate producer Contract:

```text
AUDIT_STORAGE_MAIN = MERGED / NO GOVERNANCE PRODUCER WRITER
AUDIT_STORAGE_LIVE = ABSENT
LIVE_APPLIED_MIGRATIONS = 11
ADMIN_AUDIT_QUERY_PROPOSAL = QUERY_AND_ACCESS_ONLY / INACTIVE
ADMIN_AUDIT_QUERY_PARENT_AUTHORITY = PROPOSED_PRODUCT_V2_AND_PROPOSED_SERVICE_ACTORS
NEW_PRODUCER_SPEC_CREATED = NO
```

Accepted Core requires audit/tombstone references for the relevant mutations,
but it does not freeze a complete cross-action event taxonomy or producer
payload. The existing proposed Admin audit-query Spec explicitly does not
authorize absent writers and itself depends on inactive parent authority.
Extending it into producer semantics would conflate query access with mutation
evidence and create an unauditable inactive-parent chain. Therefore the clean
`codex/forum-governance-audit-producers-v1` worktree remains unchanged. The
producer authority gap remains a review/Owner-acceptance item, not a Forum-wide
stop condition and not permission to implement a runtime writer.

## Terminal Message deletion authority result

Accepted Core V1 already selects terminal Message logical deletion, ordinary
invisibility, derived-state repair, review invalidation, and retained
tombstone/audit evidence. It does not select reversible hide/restore. The
inactive combined visibility proposal therefore cannot be accepted or used as
implementation authority from exact main, but it also does not block a smaller
terminal-only child Spec governed by accepted Product Direction V1 and Core V1.

Preflight was recalculated as:

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_MESSAGE_TERMINAL_DELETION_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                               AGENT_FORUM_CORE_INVARIANTS_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_ALLOWED = NO
AUTHORITY_CONFLICT = NONE for terminal deletion; hide/restore remains excluded
NEXT_ACTION = AUTHOR a docs-only terminal deletion Spec
```

The AUTHOR result is an independent exact-main docs-only candidate:

```text
CANDIDATE = MESSAGE_TERMINAL_DELETION_SPEC_V1
SPEC_ID = AGENT_FORUM_MESSAGE_TERMINAL_DELETION_V1
BRANCH = codex/forum-message-terminal-deletion-spec-v1
WORKTREE = /Users/yanfenma/workspace/project/.worktrees/agent-forum-message-terminal-deletion-spec-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = PROPOSED / AUTHORING_READY_FOR_REVIEW
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts only after accepted in an implementation base
PRIMARY_PARENT_AUTHORITY = AGENT_FORUM_CORE_INVARIANTS_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 14
CONTRACTS_WITH_ACCEPTANCE = 14
ACCEPTANCE_COUNT = 6
FRONTMATTER_SCHEMA = PASS
STABLE_ID_UNIQUENESS = PASS (46 IDs)
REQUIRED_SECTIONS = PASS (13/13)
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
STAGED_FILES = 2
STAGED_DIFF_STAT = 892 insertions
STAGED_DIFF_SHA256 = e67cafe153ab00b55b5f0c27c6c0ccb712a354bab4350e9ebce9a88cf6492368
SPEC_BLOB = 6512928f6b4da4d4d98019829d3286f00cfff17e
SPEC_INDEX_BLOB = 0a0c100ef655d4ac5b2c745262ba67c9f2fd8eae
INDEPENDENTLY_REVIEWED = no
ACCEPTED = no
IMPLEMENTED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The candidate defines one canonical
`POST .../terminal-deletion` command with moderator identity, non-empty reason,
caller-owned idempotency key, typed append-only tombstone, one bounded canonical
audit event, atomic count/last-message/Notification/Review repair, ordinary
invisibility, visible-reply projection, stable conflict/unknown-outcome
semantics, legacy DELETE/report/helper/client containment, dependency readiness,
and evidence-preserving rollback. It adds no hide/restore, Thread Activity,
moderator notice, Admin, task, workflow, Schema, runtime, deployment, or live
mutation.

The next governance coordinate is a fixed docs-only Spec commit followed by an
independent exact-revision REVIEW and authorized acceptance. No semantic
implementation may start from this staged proposal, and no implementation may
stack on the frozen lifecycle candidate.

## Discussion Notification facts Product V1 authority result

Accepted Product Direction V1 already owns Message-body `@agent-id`, active
Watch, durable Mention/watched-reply unread facts, per-Agent/per-Thread Read
State, and Forum-versus-external-delivery separation. The earlier same-ID fact
proposal added inactive Product V2, generalized Thread Activity, privileged
Service, moderation cause, and cross-recipient Puller meanings. Because that
proposal was never accepted or merged, it can be amended in place rather than
duplicated or treated as authority.

Preflight was recalculated as:

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = AMEND
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                               AGENT_FORUM_CORE_INVARIANTS_V1
EARLIER_PROPOSED_REVISION = 42658cf72311aaf56e4c122598077bf224bce1cb
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_AUTHORITY = none until accepted in an implementation base
AUTHORITY_CONFLICT = earlier proposal has inactive parents; V1-only scope has none
IMPLEMENTATION_ALLOWED = NO
NEXT_ACTION = AUTHOR Product-V1-only proposal; independent exact-revision review
```

The AUTHOR result is another independent exact-main docs-only candidate:

```text
CANDIDATE = DISCUSSION_NOTIFICATION_FACTS_PRODUCT_V1_SPEC
SPEC_ID = AGENT_FORUM_DISCUSSION_NOTIFICATION_FACTS_V1
BRANCH = codex/forum-discussion-notification-facts-product-v1
WORKTREE = /Users/yanfenma/workspace/project/.worktrees/agent-forum-discussion-notification-facts-product-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = PROPOSED / AUTHORING_READY_FOR_REVIEW
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts only after accepted in an implementation base
PRIMARY_PARENT_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                             AGENT_FORUM_CORE_INVARIANTS_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 16
CONTRACTS_WITH_ACCEPTANCE = 16
ACCEPTANCE_COUNT = 8
FRONTMATTER_SCHEMA = PASS
STABLE_ID_UNIQUENESS = PASS (59 IDs)
REQUIRED_SECTIONS = PASS (13/13)
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
STAGED_FILES = 4
STAGED_DIFF_STAT = 1240 insertions
STAGED_DIFF_SHA256 = c7ddd83a627091c6513f654185baa3da81dd335e09a5ca6f20ade7662fe036f5
SPEC_BLOB = 662b05c8ac6a1543d63617eff3c2f8156a6955c8
INVESTIGATION_BLOB = 9722cd81ebd340e3f89e267f889d674750e8b76a
SPEC_INDEX_BLOB = 9c5f1f366ea1fd586fafe490dbbb2a9bf4109944
INVESTIGATION_INDEX_BLOB = 1acbe0e0b134d070e3e6191d56f00c43c486df58
INDEPENDENTLY_REVIEWED = no
ACCEPTED = no
IMPLEMENTED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The amended candidate freezes a direct-Agent-only baseline: strict structured
Mention plus bounded non-fatal body parsing; Principal-based deduplication;
pre-event Watch snapshot with Mention precedence; Message/Mention/Watch/fact
atomicity; immutable `mention|watch` facts; monotonic Message-sequence Read
State; self-service Watch/read commands; and one transaction-held global fact
position for commit-safe paging. Public snapshot/cursor values are opaque and
do not expose raw global activity cardinality. A bounded scan budget and a
complete legacy sort tuple prevent cursor stalls or ambiguous compatibility
resume.

Migration never invents historical facts. A quiesced per-Thread
`authorityStartSeq` and frozen legacy projection inputs separate explicitly
labeled pre-boundary compatibility items from mandatory post-boundary facts.
After that boundary, rollback must retain the canonical writer or disable
Message writes; it cannot acknowledge factless Messages through the old path.

The proposal explicitly excludes Product V2 causes, Thread Activity,
ReadAdvance, Service/Human/Admin/Moderator cross-recipient reads, external
Puller/delivery, canonical reaction facts, and reversible hide/restore. The
existing cross-recipient Puller candidate therefore remains frozen review
material and is not a dependency of self-service V1 facts.

The next governance coordinate is a fixed docs-only revision followed by an
independent whole-Spec REVIEW and authorized acceptance. Until then, no schema,
migration, writer, reader, client, deployment, or live-data implementation is
permitted by this candidate.

## Ordinary Message duplicate and safe-retry authority result

The Goal explicitly requires investigation of whether duplicate replies remain
ungoverned. Current evidence separates incidence from capability:

```text
VISIBLE_LIVE_MESSAGES = 610
EXACT_SEMANTIC_DUPLICATE_GROUPS = 0
EXTRA_ROWS_IN_EXACT_GROUPS = 0
CONSECUTIVE_EXACT_PAIRS_WITHIN_60_SECONDS = 0
DUPLICATE_RUNTIME_INCIDENT = NOT_OBSERVED
SAFE_RETRY_CAPABILITY = NOT_IMPLEMENTED
```

The live query ran in `REPEATABLE READ READ ONLY`, emitted aggregate counts only,
and ended with `ROLLBACK`; Message content, Agent/Thread IDs, and fingerprints
were not printed. Zero exact duplicates is bounded negative evidence, not proof
that a lost response is safe. Main accepts no Message idempotency key, has no
durable request/result mapping, and treats a second accepted invocation as a new
Message. Internal database retry covers one invocation only. The official client
deliberately does not retry writes and has no reusable Message operation key.

Accepted Product V1 owns reply publication. Core owns direct-Agent identity,
ordinary open/active writes, stable conflict classes, and migration/client
boundaries, but freezes ordinary Message idempotency nowhere. Existing proposed
Specs own idempotency for other exact operations or explicitly exclude general
Message POST idempotency. Preflight was therefore:

```text
SPEC_GOVERNANCE_MODE = PREFLIGHT
PREFLIGHT_MODE = NEW
CHANGE_CLASS = NON_MECHANICAL
GOVERNANCE_ADOPTION_STATUS = accepted
PRIMARY_GOVERNING_SPEC = AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1
RELATED_ACCEPTED_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                               AGENT_FORUM_CORE_INVARIANTS_V1
BASE_COMMIT = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
SPEC_PRESENT_IN_BASE = NO
SPEC_STATUS_IN_BASE = NONE
IMPLEMENTATION_ALLOWED = NO
AUTHORITY_CONFLICT = NONE
LIFECYCLE_STORAGE_DEPENDENCY = NONE
NEXT_ACTION = AUTHOR docs-only proposal; independent exact-revision review
```

The AUTHOR result is an independent exact-main candidate:

```text
CANDIDATE = MESSAGE_SUBMISSION_IDEMPOTENCY_SPEC_V1
SPEC_ID = AGENT_FORUM_MESSAGE_SUBMISSION_IDEMPOTENCY_V1
BRANCH = codex/forum-message-submission-idempotency-v1
WORKTREE = /Users/yanfenma/workspace/project/.worktrees/agent-forum-message-submission-idempotency-v1
BASE = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
STATUS = PROPOSED / AUTHORING_READY_FOR_REVIEW
SPEC_KIND = implementation
IMPLEMENTATION_AUTHORITY = contracts only after accepted in an implementation base
PRIMARY_PARENT_AUTHORITIES = AGENT_FORUM_PRODUCT_DIRECTION_V1,
                             AGENT_FORUM_CORE_INVARIANTS_V1
EXTERNAL_AUTHORITIES = NONE
OPEN_OWNER_DECISIONS = NONE
NORMATIVE_TBD = NONE
PARTIAL_SUPERSESSION = NONE
CONTRACT_COUNT = 14
CONTRACTS_WITH_ACCEPTANCE = 14
ACCEPTANCE_COUNT = 7
FRONTMATTER_SCHEMA = PASS
STABLE_ID_UNIQUENESS = PASS (54 IDs)
REQUIRED_SECTIONS = PASS (13/13)
GOVERNANCE_INTEGRITY = PASS
DIFF_CHECK = PASS
STAGED_FILES = 4
STAGED_DIFF_STAT = 1118 insertions
STAGED_DIFF_SHA256 = 80afd53d43077b6f9a0fc277ca1cd390daf39d2b3616bc82883d48e36c7d52b4
SPEC_BLOB = b2c5a41c9809a48201b6fba793d5f494a84cde6d
INVESTIGATION_BLOB = 9fb640ee1977db3ec354f0252a020de17991b638
SPEC_INDEX_BLOB = 57f03bc33f416b405a87b85646b1039e97591169
INVESTIGATION_INDEX_BLOB = 613fc1fe089f5ef70c1798b3a80a65867e78ee83
INDEPENDENTLY_REVIEWED = no
ACCEPTED = no
IMPLEMENTED = no
MERGED = no
DEPLOYED = no
RUNTIME_ENABLED = no
```

The proposal chooses caller-controlled `Idempotency-Key`, stable
Principal/operation namespace, versioned canonical semantic fingerprint, and one
atomic Message/result/source-effect transaction. Exact same-key replay returns
the same Message with zero source mutation; changed-payload key reuse is a
bounded `409`; an unknown outcome may be recovered only with the same key and
same request. Stored fingerprint versions remain comparable for their record
lifetime, and missing support fails readiness rather than creating a duplicate.

It rejects content/time heuristics, server-only keys, process cache, permanent
optional-key semantics, time-based key reuse without retention authority, and
new-key retry after an ambiguous outcome. Parent deletion does not implicitly
delete a visible child, while deleted Message/Thread replay follows ordinary
`404`. The official client must not duplicate the server canonicalizer or hide
unknown/conflict outcomes.

Migration is additive and independent of lifecycle storage, but still obeys
Core's inventory-first sequence. It uses a bounded optional-key compatibility
phase followed by guarded mandatory-key cutover; historical Messages receive no
synthetic key. After enforcement, rollback must retain the keyed writer/replay
path or disable ordinary Message creation.

The next governance coordinate is a fixed docs-only revision followed by an
independent whole-Spec REVIEW and authorized acceptance. No Schema, migration,
runtime, client, deployment, or live-data implementation is authorized now.

## Third-turn independent-gap exhaustion audit

A fresh PREFLIGHT/state pass was run after the Message-idempotency AUTHOR phase.
It found no main, runtime, catalog, authority, or candidate-coordinate change:

```text
RECHECKED_AT = 2026-09-01T13:19:02+08:00
ORIGIN_MAIN = 2c5e4d8a3c3926e53a878092cd8988964ffbd2db
LIVE_IMAGE = svc-forum:502cfca
LIVE_IMAGE_ID = sha256:93a9eda5b4adb1edbb186e511c801f482d2c702e6079c1faa6dc357e56ec6f97
LIVE_HEALTH = 200 / db connected
LIVE_MIGRATIONS = 11
LIVE_THREADS = 90
LIVE_PINNED = 0
LIVE_FEATURED = 0
LIVE_REPORTS = 0
LIVE_MESSAGES = 610
LIVE_MESSAGE_DELETED = 0
LIVE_MESSAGE_WITH_STRUCTURED_MENTION = 231
CANONICAL_NOTIFICATION_WATCH_READ_AUDIT_IDEMPOTENCY_TABLES = ABSENT
GOVERNANCE_DISTRIBUTION_INTEGRITY = PASS
```

The remaining named gaps were reclassified against their exact active parent:

| Gap family | Current unavoidable coordinate |
|---|---|
| lifecycle, Finalization, Thread terminal deletion | frozen lifecycle storage release; no stacking |
| Message terminal deletion | fixed proposed-Spec commit, independent REVIEW, authorized acceptance |
| direct-Agent Notification facts | fixed Product-V1 proposed-Spec commit, independent REVIEW, authorized acceptance |
| ordinary Message safe retry | fixed proposed-Spec commit, independent REVIEW, authorized acceptance |
| unified Agent governance-safe baseline | fixed implementation commit and independent Contract review |
| canonical Watch/Read/Review | accepted inventory/backfill/validation/cutover sequence; tables absent live |
| Admin creation, promotion, complete Report handling, audit query, cross-recipient Puller | inactive Product V2/Service/Activity authority chain; no accepted implementation authority |
| generic batch governance | no live backlog and no accepted bounded product semantics |

No proposed file, staged snapshot, runtime route, test, or live row was promoted
to authority. No candidate was reopened because main did not drift, no
independent audit defect appeared, and authority did not change. Repeating tests,
rewriting Evidence, generating another overlapping Spec, stacking on lifecycle,
or implementing against an unaccepted proposal would create activity without a
valid next product state.

The same fixed-coordinate/independent-review/acceptance condition has now
persisted across three consecutive Goal turns: terminal deletion, Product-V1
Notification facts, and ordinary Message idempotency each reached an
authoring-ready staged snapshot but cannot progress to acceptance or
implementation in the current authority state. There is no other independent
P0/P1 gap with accepted implementation permission. This establishes a stable
waiting coordinate. It does not mean that the Forum Goal failed, ended, or was
achieved.

```text
BLOCKED_AUDIT_COUNT = 3
BLOCKING_CONDITION = FIXED_COMMIT_PLUS_INDEPENDENT_REVIEW_AND_AUTHORIZED_ACCEPTANCE
BLOCKER_CLASS = FORUM_INTERNAL_GOVERNANCE_COORDINATE
WORKFLOW_CAPABILITY = NOT_INVOLVED
OWNER_WORKFLOW_UUID = NOT_REQUESTED
SAFE_IMPLEMENTATION_ACTION_REMAINING = NONE
WAIT_ACTION = PRESERVE_CURRENT_CANDIDATES_AND_STATE
```

The count is retained only as evidence that the identical state has already
been reassessed enough times. It is not the Goal status. If `origin/main`,
accepted authority, independent review results, candidate fixed SHAs, live
runtime, and migration/deployment state remain unchanged, this record remains
the latest State and no fourth or fifth identical reassessment is produced.

```text
DO_NOT_REPEAT_IDENTICAL_REASSESSMENT = yes
CURRENT_WAIT_SUBSTATE = WAITING_FOR_FIXED_CANDIDATE_COMMIT
AFTER_FIXED_CANDIDATE = WAITING_FOR_INDEPENDENT_REVIEW
AFTER_POSITIVE_INDEPENDENT_REVIEW = WAITING_FOR_AUTHORIZED_ACCEPTANCE
INDEPENDENT_REVIEW_MUST_NOT_BE_SELF_SIMULATED = yes
AUTHORIZED_ACCEPTANCE_MUST_NOT_BE_SELF_ISSUED = yes
```

Execution resumes only after observing at least one of these events:

1. a Product-V1 Spec obtains a fixed candidate commit;
2. an independent REVIEW result arrives;
3. an Owner or authorized maintainer formally accepts a Spec or Amendment;
4. the lifecycle candidate completes independent audit, merge, or deployment;
5. `origin/main` receives a Forum-Goal-relevant semantic change;
6. live runtime or migration state changes;
7. a new real Forum P0/P1 usage problem appears; or
8. accepted authority exposes a new independently executable gap.

When one is observed, execution moves from `WAITING_FOR_AUTHORITY` to
`ACTIVE_EXECUTION` and recalculates `STATE -> GAP -> NEXT`. A docs candidate may
still be completed by its authorized author before it reaches an independent
review or Owner-acceptance boundary.

## Disposition

```text
GOAL_STATUS = ACTIVE
EXECUTION_STATE = WAITING_FOR_AUTHORITY
BLOCKED_AUDIT_COUNT = 3
CAPABILITY_MATRIX = UPDATED
NEXT_FORUM_GAP = NONE_EXECUTABLE_UNDER_CURRENT_AUTHORITY_STATE
NEXT_PENDING_COORDINATE = FIXED_SPEC_AND_IMPLEMENTATION_COMMITS_PLUS_INDEPENDENT_REVIEW
LATEST_STATE_RECORD = INV-AGENT-FORUM-GOAL-STATE-REASSESSMENT-V2
LATEST_STATE_BLOB = 142319f946234a40802b0b68b7b25fa936771735
LATEST_STATE_BLOB_SEMANTICS = INPUT_BLOB_CORRECTED_BY_THIS_STATUS_ONLY_REVISION
DO_NOT_REPEAT_IDENTICAL_REASSESSMENT = yes
AGENT_GOVERNANCE_SAFE_BASELINE = IMPLEMENTED / VERIFICATION_PASS / SELF_CHECK_ONLY / NOT_MERGED
AGENT_ORDINARY_SURFACE_SAFE_BASELINE = SUPERSEDED_BY_AGENT_GOVERNANCE_SAFE_BASELINE
LEGACY_MUTATION_CONTAINMENT = SUPERSEDED_BY_AGENT_GOVERNANCE_SAFE_BASELINE
AGENT_CLIENT_SAFE_BASELINE = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
CREATE_THREAD_CLIENT = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
AGENT_SEARCH_SAFE = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
AGENT_REPORT_SAFE = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
PARTICIPANT_TARGET_BINDING = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
THREAD_METADATA_OPEN_STATE = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
OPTION_C_ROW_LEVEL_INVENTORY = IMPLEMENTED / LOCAL_EVIDENCE_PASS / NOT_MERGED
WAIVER_OPEN_STATE = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
PARTICIPANT_OPEN_STATE = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
LEGACY_ARCHIVE_DISABLED = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
LEGACY_THREAD_DELETE_DISABLED = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
LEGACY_DELETION_BOUNDARY_DISABLED = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
REACTION_OPEN_STATE = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
DIRECT_OUTCOME_DISABLED_DELETED_TERMINAL = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
DIRECT_DECISION_MESSAGE_DISABLED = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
LEGACY_RESOLVE_DISABLED = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
CONTEXT_SNAPSHOT_OPEN_STATE = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
DELETED_THREAD_ORDINARY_VISIBILITY = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
DELETED_THREAD_WATCH_READ = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
DELETED_THREAD_NOTIFICATION_VISIBILITY = SUPERSEDED_BY_AGENT_ORDINARY_SURFACE_SAFE_BASELINE
DELETED_THREAD_MESSAGE_STATE = SUPERSEDED_BY_LEGACY_MUTATION_CONTAINMENT
AUDIT_PRODUCER_AUTHORITY = RECHECKED / NO DUPLICATE SPEC CREATED
MESSAGE_TERMINAL_DELETION_SPEC = PROPOSED / AUTHORING_READY_FOR_REVIEW / NOT_ACCEPTED
DISCUSSION_NOTIFICATION_FACTS_SPEC = PROPOSED / AUTHORING_READY_FOR_REVIEW / NOT_ACCEPTED
MESSAGE_SUBMISSION_IDEMPOTENCY_SPEC = PROPOSED / AUTHORING_READY_FOR_REVIEW / NOT_ACCEPTED
EXACT_DUPLICATE_MESSAGE_INCIDENT = NOT_OBSERVED IN CURRENT LIVE SNAPSHOT
EARLIER_BROAD_NOTIFICATION_FACTS_SPEC = DEFERRED / INACTIVE_PARENTS
NOTIFICATION_PULLER_SPEC = FROZEN / INACTIVE_CROSS_RECIPIENT_AUTHORITY
REVERSIBLE_MESSAGE_VISIBILITY = AUTHORITY_BLOCKED_BY_INACTIVE_PRODUCT_V2
FORMAL_COMPLIANCE = UNKNOWN / NO IMPLEMENTATION COMMIT / NO INDEPENDENT REVIEW
EXECUTABLE_ACCEPTED_AUTHORITY_GAP = NONE AFTER FRESH THIRD-TURN AUDIT
NEXT_ACTION = WAIT; resume only after an enumerated recovery event, then
              recalculate STATE -> GAP -> NEXT
LIFECYCLE_ACTION = FROZEN
EXTERNAL_WORKFLOW_ACTION = NONE
```
