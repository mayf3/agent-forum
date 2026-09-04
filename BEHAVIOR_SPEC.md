# AF-VERIFIER-1 Behavior Specification

```text
TASK_ID = af-verifier-1
ARTIFACT = behavior_specification
STATUS = proposed_for_pipeline_delivery
SCOPE = subscription verifier hardening only
PRODUCT_RUNTIME_BEHAVIOR_CHANGED = NO
```

## 1. Authority and interpretation

This specification is limited to the advanced acceptance tooling represented by
open PR #15, `agent/forum-subscription-advanced-tooling-v1`, observed locally at
head `c2f7a74ed7572bab048ed44ff03d1e4e25ead81f`. It does not specify a new Forum
API, schema, migration, runtime write path, backfill, cutover, or deployment.

The governing product behavior remains:

- `AGENT_FORUM_PRODUCT_DIRECTION_V1`: Watch is a discussion subscription,
  Notification is an unread discussion fact, and Read State records a
  principal's reading position.
- accepted `AGENT_FORUM_CORE_INVARIANTS_V1`, especially `CTR-AUTHZ-005`,
  `CTR-REVIEW-001`, and `CTR-MIG-002`.
- the adopted additive-storage design's subscription verification plan: verify
  the five additive subscription tables, preserve old behavior, start with no
  backfill or runtime cutover, and run against disposable PostgreSQL.
- the product-core subscription evidence at `f1da1651fe28e26518bd4a47f2f10026e4bc4b42`,
  which deliberately leaves advanced verifier cleanup and parallel tooling out
  of the product acceptance blocker set.

The obligations below are contracts for test tooling, not product contracts.
Existing source or tests are reference material and do not override the
authorities above.

## 2. Observable interface

The hardening contribution shall expose these repository-local commands from
`svc-forum/package.json`:

```text
npm run test:subscription-verifier-cleanup
npm run test:subscription-verifier-parallel-isolation
npm run test:subscription-coordinator-failure-recovery
```

Each command:

1. requires `SUBSCRIPTION_STORAGE_DATABASE_URL`, with `DATABASE_URL` accepted as
   the existing fallback;
2. operates only on a freshly migrated, disposable PostgreSQL database;
3. exits nonzero when its prerequisite is absent, a child fails unexpectedly,
   metadata is invalid or ambiguous, cleanup/recovery fails, or a final
   assertion fails; and
4. prints its overall `...=PASS` marker only after all cleanup/recovery and
   terminal assertions for that command have succeeded.

Test-only environment variables and diagnostic markers are private acceptance
tooling interfaces. They are not supported production configuration or public
Forum API.

## 3. Deterministic behavior contracts

### AFV-BEH-001 — Per-run identity and atomic setup

Every verifier invocation shall have a unique run UUID, Principal UUID, Thread
UUID, two Watch UUIDs, and an ownership marker derived from that run UUID. IDs
within one fixture and IDs across concurrent fixtures shall be distinct.

Fixture Principal, Thread, and initial Read State setup shall commit atomically.
If any requested ID collides with a pre-existing row, the verifier shall fail
without reporting setup committed, shall not alter/delete the colliding row,
and shall leave no partially created sibling fixture row.

### AFV-BEH-002 — Marker-qualified cleanup

Automatic deletion shall be authorized by both the prespawned exact IDs and the
expected ownership marker on fixture parents. Cleanup shall remove only rows
owned by that verifier run, be safe to repeat for already-removed owned rows,
and preserve unrelated rows, old fixed-ID lookalikes, foreign-marker rows, and
other runs' fixtures.

A marker mismatch shall fail closed: report the mismatch, do not delete the
foreign-marker row, and do not claim terminal success while it remains.

### AFV-BEH-003 — Normal and catchable failure cleanup

Owned fixture rows and run-scoped database sessions shall be absent after:

- normal completion;
- setup committed but acknowledgement failed;
- failure before or after the first session becomes ready;
- second-session failure;
- lock timeout;
- statement timeout;
- uncaught exception;
- unhandled rejection; and
- receipt of `SIGINT`, `SIGTERM`, or `SIGHUP`.

Cleanup shall tolerate one injected transient cleanup failure by retrying. If
cleanup remains unsuccessful, the original failure and cleanup failure shall
both remain observable and the command shall exit nonzero.

### AFV-BEH-004 — Honest uncatchable boundary

The tooling shall not claim in-process cleanup guarantees for `SIGKILL`, host
crash, forced container deletion, or permanent database outage. A killed run's
residue shall remain identifiable from prespawned IDs and its unique marker.
External recovery shall remove only that owned residue, terminate only its
exact run-scoped sessions, be safe to repeat, and preserve unrelated state.

### AFV-BEH-005 — Parallel run isolation

At least two verifier runs shall be shown concurrently present with disjoint
identities. For each normal, injected-failure, catchable-signal, and `SIGKILL`
pair:

- failure or termination of one run shall not make a healthy peer fail;
- cleanup/recovery for one run shall not delete the peer's rows;
- session termination shall match exact run-scoped database application names
  and shall not terminate a foreign control session; and
- both runs shall satisfy their expected terminal state before an isolation
  PASS is emitted.

An individual verifier shall not own a global-empty assertion. Only the
external coordinator may make the terminal five-table assertion after all
children are joined or recovered.

### AFV-BEH-006 — Exact baseline preservation

The coordinator shall capture the exact starting contents of these tables:

```text
forum_participations
forum_watch_subscriptions
forum_read_states
forum_mentions
forum_notification_facts
```

Normal, failing, signaled, and recovered verifier executions shall restore
those exact contents, including a deliberately nonempty baseline and rows whose
values resemble ownership markers. A row-count-only check is insufficient.

The fault-recovery suite may require the five target tables to start globally
empty, but its own case sentinels and parent fixtures shall also be removed in
unconditional final cleanup.

### AFV-BEH-007 — Coordinator-owned identity and metadata validation

The coordinator shall generate expected child identities before spawn. Child
stdout is corroboration only and shall match the expected child kind and every
expected field exactly.

The coordinator shall reject and report:

- exit before metadata;
- missing or partial metadata;
- duplicate metadata keys;
- non-UUID values where UUIDs are required;
- duplicate IDs within one fixture;
- wrong run ID or ownership marker;
- otherwise well-formed foreign identity; and
- mixed verifier/harness metadata prefixes.

Invalid or ambiguous stdout shall never authorize cleanup. Recovery shall use
the coordinator's prespawned identity plan.

### AFV-BEH-008 — Fail-closed coordinated recovery

After any primary or metadata failure, the coordinator shall attempt, in a
bounded and observable manner, to:

1. terminate the exact child process group;
2. fall back to terminating exact run-scoped database sessions when needed;
3. clean marker-qualified owned fixtures;
4. recover coordinator-created sentinels;
5. join or verify termination of children;
6. assert no prespawned owned IDs or run-scoped sessions remain;
7. assert exact baseline restoration; and
8. perform the coordinator-owned five-table terminal assertion when the suite
   starts from the required empty baseline.

A transient external cleanup failure shall be retried and may recover. A
permanent cleanup failure, process-group kill failure, sentinel recovery
failure, deliberate residue, or any terminal assertion failure shall be
reported and force nonzero exit. No overall PASS or affected subordinate PASS
may be printed when its assertion is false.

### AFV-BEH-009 — Error retention and success ordering

Primary, metadata-validation, recovery, and final-assertion errors shall be
collected rather than overwritten. When multiple classes occur, output shall
identify each class. An expected injected primary failure does not convert the
coordinator run to success; only the outer fault suite may report that the
expected failure behavior passed after independent cleanup verification.

Top-level success markers shall be emitted only after the relevant `finally`
path completes and all error collections are empty.

### AFV-BEH-010 — Harness and fault-suite self-cleanup

The cleanup harness and coordinator fault suite shall use unconditional
top-level cleanup for their own sentinels, child fixtures, exact sessions, and
prespawned IDs. Their `SIGINT`, `SIGTERM`, and `SIGHUP` paths shall perform the
same best-effort recovery and exit nonzero.

The suite shall recover artifacts from an injected internal assertion and an
injected coordinator timeout while preserving the primary self-failure. The
suite shall not claim cleanup is guaranteed if the suite itself receives
`SIGKILL`; such residue remains an external-recovery case under AFV-BEH-004.

## 4. Enumerated failure cases

| Case | Required result |
|---|---|
| Missing disposable DB URL | Exit nonzero before mutation; name the required configuration. |
| Invalid test-only UUID or delay | Exit nonzero with controlled validation error; no unauthorized cleanup. |
| Pre-existing UUID collision | Preserve existing row; atomic setup leaves no sibling residue. |
| Post-commit/pre-ack failure | Preserve primary error; remove the owned committed fixture. |
| First/second session failure | Exit nonzero; remove owned rows and exact sessions. |
| Lock/statement timeout | Preserve timeout diagnosis; remove owned rows and exact sessions. |
| First cleanup attempt fails | Retry; succeed only if terminal assertions pass. |
| Cleanup remains failed | Preserve primary plus cleanup errors; suppress overall success. |
| `SIGINT`/`SIGTERM`/`SIGHUP` | Best-effort joined cleanup, nonzero/signal exit, terminal residue checks. |
| Uncaught exception/rejection | Preserve original error and execute guarded cleanup. |
| `SIGKILL`/host loss | Make no automatic-cleanup guarantee; require identity-bound external recovery. |
| Child metadata absent/partial/duplicate | Reject metadata; recover using prespawned identity; exit nonzero. |
| Child metadata forged/mixed kind | Reject as mismatch/ambiguous; never use it as cleanup authority. |
| Process-group kill fails | Report recovery failure, use exact backend fallback, suppress overall success. |
| Marker mismatch | Do not cross-marker delete; report residue and fail terminal assertion. |
| Sentinel marker tampered | Marker cleanup refuses deletion; exact-ID receipt assertion detects residue. |
| Sentinel recovery fails | Preserve recovery error; suppress sentinel/overall success. |
| Deliberate residue | Final assertion reports it and suppresses global/overall success. |
| Harness assertion/timeout | Top-level cleanup restores baseline and preserves the injected primary error. |
| Fault suite receives catchable signal | Clean prespawned artifacts/sessions and exit nonzero. |

## 5. Acceptance criteria

The change is acceptable only when all of the following are true:

- `AFV-BEH-001` through `AFV-BEH-010` each map to at least one executable test
  assertion or an explicitly bounded negative guarantee.
- All three commands complete successfully in the QA procedure on a disposable
  database and emit only post-recovery overall PASS markers.
- Negative fault cases exit nonzero internally and are recognized as expected
  only by their owning outer suite.
- After each command, the database baseline, prespawned IDs, and run-scoped
  sessions match their required terminal state.
- Existing subscription product verification still passes.
- No runtime source, schema, migration, public API, backfill, dual-read/write,
  cutover, deployment, or product acceptance-blocker semantics are added.

