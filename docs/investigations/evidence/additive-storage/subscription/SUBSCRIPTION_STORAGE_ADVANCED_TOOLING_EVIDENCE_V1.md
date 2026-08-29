# SUBSCRIPTION_STORAGE_ADVANCED_TOOLING_EVIDENCE_V1

Advanced, non-blocking acceptance-tooling evidence split from Draft PR #13 at exact source head `ae037012568183810d00702d7c3d4d888b8a2a9a`.

```text
TASK_NAME = 拆分 执行
TASK_TYPE = 执行
SOURCE_PR = #13
SOURCE_HEAD = ae037012568183810d00702d7c3d4d888b8a2a9a
PRODUCT_BASE = agent/forum-subscription-storage-core-v1
TOOLING_CLASS = NON_BLOCKING_ADVANCED_ACCEPTANCE_TOOLING
PRODUCT_MERGE_BLOCKER = NO
DEPENDS_ON_PRODUCT_PR = YES
R5_FINAL_REVIEW = ACCEPT_WITH_TOOLING_DEBT
HARD_PRODUCT_BLOCKERS = NONE
SIGKILL_CLEANUP_GUARANTEED = NO
HOST_CRASH_CLEANUP_GUARANTEED = NO
RUNTIME_CUTOVER = NO
BACKFILL = NO
DEPLOYMENT = NO
```

## Tooling included

- `test-subscription-verifier-cleanup.mjs`
- `test-subscription-verifier-parallel-isolation.mjs`
- `test-subscription-coordinator-failure-recovery.mjs`
- their three package scripts

The Product/Core PR owns the schema, subscription migration, SQL-029..SQL-040, and core verifier. This stacked PR changes none of them.

## Per-run ownership and cleanup harness

Each verifier run uses unique fixture IDs and an ownership marker. Setup commits Principal, Thread, and ReadState atomically. Cleanup is marker-qualified, idempotent for owned fixtures, and preserves unrelated or foreign-marker rows. Catchable process failures and SIGINT, SIGTERM, and SIGHUP receive best-effort child termination, joining, and cleanup. Uncaught exceptions and unhandled rejections use the same guarded path.

```text
CONCURRENCY_FIXTURE_IDENTITY = UNIQUE_PER_RUN
CONCURRENCY_FIXTURE_OWNERSHIP = MARKER_VERIFIED
SETUP_ATOMICITY = PASS
SETUP_CONFLICT_NONDESTRUCTIVE = PASS
CLEANUP_OWNERSHIP_VERIFIED = PASS
PREEXISTING_ROWS_PRESERVED = PASS
CLEANUP_IDEMPOTENT_FOR_OWNED_FIXTURES = PASS
SIGINT_CLEANUP = PASS
SIGTERM_CLEANUP = PASS
SIGHUP_CLEANUP = PASS
UNCAUGHT_EXCEPTION_CLEANUP = PASS
UNHANDLED_REJECTION_CLEANUP = PASS
```

SIGKILL, host crash, forced container deletion, and permanent database outage cannot guarantee execution of `finally` or signal handlers. Such residue remains identifiable by prespawned IDs and unique markers and requires external recovery.

## Parallel isolation and external coordinator

The external coordinator owns global five-table zero assertions. Parallel normal, injected-failure, signal, and SIGKILL cases use distinct run IDs, markers, committed fixture IDs, transaction-only fixture IDs, and run-scoped database application names.

```text
PARALLEL_VERIFIER_RUN_ISOLATION = PASS
CROSS_RUN_DELETE_PROTECTION = PASS
CROSS_RUN_SESSION_TERMINATION_PROTECTION = PASS
PER_RUN_GLOBAL_ZERO_ASSUMPTION_REMOVED = YES
BASELINE_CAPTURE = EXACT
BASELINE_PRESERVATION = PASS
NONEMPTY_EXACT_BASELINE_PRESERVATION = PASS
LOOKALIKE_MARKER_BASELINE_PRESERVATION = PASS
GLOBAL_ZERO_ASSERTION_OWNER = EXTERNAL_COORDINATOR
HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE = PASS
HARNESS_EXTERNAL_RECOVERY = PASS
```

## Amendment history

### R2 — cleanup fault injection

Covered fixed-UUID collisions, post-commit acknowledgement failure, transient cleanup retry, first- and second-session failures, lock and statement timeouts, real catchable signals, and the honest SIGKILL boundary. Marker-qualified cleanup preserved unrelated preexisting parents.

### R3 — parallel isolation

Added concurrent verifier isolation, exact baseline preservation, cross-run deletion/session protection, controlled metadata parsing, coordinator-owned global-zero assertions, and external recovery for a killed harness.

### R4 — fail-closed coordinator recovery

The coordinator became the prespawn identity authority. Missing, partial, duplicate, mixed-kind, or forged child metadata fails closed. Primary, recovery, and final-assertion errors are retained together. Recovery verifies child/process-group termination, exact run-scoped database sessions, owned rows, sentinels, exact baseline, and final global zero. No success claim is printed before all recovery and final assertions pass.

```text
COORDINATOR_IDENTITY_AUTHORITY = PRESPAWN_EXPECTED_IDENTITY
COORDINATOR_PARSE_FAILURE_PROPAGATION = PASS
COORDINATOR_RECOVERY_FAILURE_PROPAGATION = PASS
COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION = PASS
COORDINATOR_BASELINE_FINAL_ASSERTION = PASS
RUN_SCOPED_SESSION_FINAL_ASSERTION = PASS
PROCESS_GROUP_KILL_FAILURE_PROPAGATION = PASS
OTHER_SESSION_PRESERVATION = PASS
CHILD_KIND_BINDING = PASS
AMBIGUOUS_OUTPUT_REJECTED = PASS
PRIMARY_ERROR_PRESERVED = PASS
RECOVERY_ERROR_PRESERVED = PASS
COMBINED_ERROR_REPORTING = PASS
SUCCESS_LOG_AFTER_FINAL_RECOVERY = YES
```

### R5 — sentinel terminal assertion and fault-suite self-cleanup

Cleanup authorization remains marker-qualified. Receipt-gated ID-only terminal assertions detect coordinator-created sentinels even after marker tampering without authorizing deletion of foreign-marker rows. The fault suite prespawns every case identity, has unconditional per-case and top-level `finally` paths, preserves primary and cleanup errors, terminates exact process groups/sessions, restores the exact baseline, removes its prespawned IDs, and proves no case-owned backend remains. SIGKILL remains an external-recovery boundary.

```text
SENTINEL_ID_ONLY_FINAL_ASSERTION = PASS
CREATION_RECEIPT_TRACKING = PASS
MARKER_MISMATCH_FAIL_CLOSED = PASS
FOREIGN_MARKER_NOT_DELETED_BY_COORDINATOR = PASS
FAULT_SUITE_TAMPERED_FIXTURE_RECOVERED = PASS
FAULT_SUITE_IDENTITY_AUTHORITY = PRESPAWN_EXPECTED_IDENTITY
FAULT_SUITE_TOP_LEVEL_FINALLY = PASS
FAULT_SUITE_SELF_FAILURE_CLEANUP = PASS
FAULT_SUITE_PRIMARY_ERROR_PRESERVED = PASS
FAULT_SUITE_CLEANUP_ERROR_PRESERVED = PASS
FAULT_SUITE_COMBINED_ERROR_REPORTING = PASS
FAULT_SUITE_BASELINE_FINAL_ASSERTION = PASS
FAULT_SUITE_OWNED_ID_FINAL_ASSERTION = PASS
FAULT_SUITE_SESSION_FINAL_ASSERTION = PASS
FAULT_SUITE_SIGTERM_CLEANUP = PASS
FAULT_SUITE_SIGKILL_CLEANUP_GUARANTEED = NO
```

## Tooling debt disposition

This evidence records advanced tooling behavior and known hard boundaries only. It does not modify the R5 product verdict, create a product blocker, authorize direct merge of source PR #13, claim guaranteed SIGKILL/host-crash cleanup, or claim deployment.
