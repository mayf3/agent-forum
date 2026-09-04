# AF-VERIFIER-1 QA Procedure

```text
TASK_ID = af-verifier-1
ARTIFACT = qa_procedure
QA_SCOPE = verifier hardening acceptance only
EXECUTABLE_QA_AUTOMATION_OWNED_HERE = NO
```

This is a manual procedure for the downstream QA station. It specifies what to
run and how to judge the result; it does not supply executable QA automation or
a final QA receipt.

## 1. Preconditions

1. Check out the downstream candidate that contains the subscription storage
   core and the hardening artifacts. Record its exact commit SHA.
2. Confirm the candidate diff adds only acceptance tooling, evidence/docs, and
   package-script entry points. Any runtime source, Prisma schema, or migration
   change is a scope failure for this task.
3. Provision a dedicated PostgreSQL 16.x database that may be destroyed. Do not
   use development-shared, staging, or production data.
4. Apply every repository migration to that database and verify migration
   status is current.
5. Set `SUBSCRIPTION_STORAGE_DATABASE_URL` to that disposable database. Do not
   print the URL or credentials in the QA receipt.
6. Confirm the five target subscription tables are empty before the fault-suite
   command. If they are not empty, recreate the disposable database; do not
   delete unknown rows merely to satisfy the test.
7. Ensure `node`, `npm`, Prisma dependencies, and PostgreSQL `psql` are
   available. Record versions without recording secrets.

## 2. Static scope and command checks

From `svc-forum/`:

```sh
npm ci
npm run prisma:generate
npm run typecheck
npm run build
npm test
```

Then verify `package.json` exposes exactly these hardening entry points:

```text
test:subscription-verifier-cleanup
test:subscription-verifier-parallel-isolation
test:subscription-coordinator-failure-recovery
```

Fail QA if installation, generation, typecheck, build, or the existing suite
fails. Record command, exit code, test count where available, and a sanitized
output digest or concise error excerpt.

## 3. Product-core regression

Run:

```sh
npm run verify:subscription-storage
```

Pass only if it exits `0`, retains its normal subscription-storage success
markers, and leaves all five target tables in their documented core-verifier
terminal state. This proves the hardening did not replace or weaken product-core
verification; it is not by itself acceptance of the hardening.

## 4. Cleanup and failure-boundary suite

Run:

```sh
npm run test:subscription-verifier-cleanup
```

Require exit `0` and, at minimum, these terminal observations:

```text
EARLY_EXIT_ERROR_PRESERVATION=PASS
FIXTURE_PARSE_ERROR_CONTROLLED=PASS
FIXED_UUID_REGRESSION_TEST=PASS
SETUP_CONFLICT_NONDESTRUCTIVE=PASS
POST_COMMIT_ACK_FAILURE_CLEANUP=PASS
CLEANUP_RETRY_AFTER_TRANSIENT_FAILURE=PASS
FIRST_SESSION_FAILURE_CLEANUP=PASS
FIRST_SESSION_AFTER_READY_CLEANUP=PASS
SECOND_SESSION_FAILURE_CLEANUP=PASS
LOCK_TIMEOUT_CLEANUP=PASS
STATEMENT_TIMEOUT_CLEANUP=PASS
SIGINT_CLEANUP=PASS
SIGTERM_CLEANUP=PASS
SIGHUP_CLEANUP=PASS
UNCAUGHT_EXCEPTION_CLEANUP=PASS
UNHANDLED_REJECTION_CLEANUP=PASS
SIGKILL_BOUNDARY_TEST=PASS
SIGKILL_RESIDUE_OWNERSHIP_IDENTIFIABLE=PASS
PREEXISTING_PARENT_PRESERVATION=PASS
CLEANUP_IDEMPOTENT_FOR_OWNED_FIXTURES=PASS
HARNESS_FINALLY_REACHED=PASS
HARNESS_OWNED_SENTINEL_CLEANUP=PASS
SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS
```

Also inspect the log ordering: the overall suite PASS must occur only after its
owned cases complete, and the harness-finally markers must confirm the
top-level cleanup. The `SIGKILL` case passes by proving the limitation and
external recovery, not by claiming in-process cleanup.

After the command, query by the emitted harness/run UUIDs and exact
`application_name` values. Require zero owned fixture rows, zero harness
sentinels, and zero matching sessions. Confirm the pre-existing sentinel used
by individual cases was preserved until its harness-owned final cleanup.

## 5. Parallel isolation suite

Reconfirm the five target tables are empty, then run:

```sh
npm run test:subscription-verifier-parallel-isolation
```

Require exit `0` and these terminal observations:

```text
NONEMPTY_EXACT_BASELINE_PRESERVATION=PASS
LOOKALIKE_MARKER_BASELINE_PRESERVATION=PASS
OTHER_SESSION_PRESERVATION=PASS
HARNESS_ASSERTION_FAILURE_CLEANUP=PASS
HARNESS_SIGTERM_CLEANUP=PASS
PARALLEL_VERIFIER_RUN_ISOLATION=PASS
CROSS_RUN_DELETE_PROTECTION=PASS
CROSS_RUN_SESSION_TERMINATION_PROTECTION=PASS
GLOBAL_ZERO_ASSERTION_OWNER=EXTERNAL_COORDINATOR
FIVE_TABLES_EMPTY=PASS
HARNESS_SIGKILL_CLEANUP_GUARANTEED=NO
HARNESS_INTERRUPTION_RESIDUE_IDENTIFIABLE=PASS
HARNESS_EXTERNAL_RECOVERY=PASS
CHILD_KIND_BINDING=PASS
SENTINEL_ID_ONLY_FINAL_ASSERTION=PASS
CREATION_RECEIPT_TRACKING=PASS
COORDINATOR_OWNED_ROWS_FINAL_ASSERTION=PASS
COORDINATOR_HARNESS_SENTINEL_FINAL_ASSERTION=PASS
RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS
COORDINATOR_BASELINE_FINAL_ASSERTION=PASS
COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS
SUCCESS_LOG_AFTER_FINAL_RECOVERY=YES
SUBSCRIPTION_VERIFIER_PARALLEL_ISOLATION_TESTS=PASS
```

Verify from the detailed output that each tested pair was concurrently present,
their identity sets were disjoint, a failing/signaled/killed run did not damage
its healthy peer, and the foreign control database session survived exact
run-scoped recovery. Confirm the overall PASS is the last success phase after
recovery and final assertions.

After exit, independently require the original five-table digest, no exact
prespawned fixture/sentinel IDs, and no matching run-scoped database sessions.

## 6. Coordinator fail-closed fault suite

Reconfirm the five target tables are empty, then run:

```sh
npm run test:subscription-coordinator-failure-recovery
```

Require exit `0`. This outer command succeeds only because each injected inner
coordinator failure was detected, propagated, cleaned, and independently
asserted. Require the case markers:

```text
CHILD_PRE_METADATA_EXIT_RECOVERY=PASS
PARTIAL_METADATA_REJECTED=PASS
DUPLICATE_METADATA_REJECTED=PASS
AMBIGUOUS_OUTPUT_REJECTED=PASS
FORGED_METADATA_REJECTED=PASS
PROCESS_GROUP_KILL_FAILURE_PROPAGATION=PASS
TRANSIENT_CLEANUP_FAILURE_RECOVERED_WITH_RETRY=PASS
PERMANENT_CLEANUP_FAILURE_PROPAGATED=PASS
MARKER_MISMATCH_NO_CROSS_MARKER_DELETE=PASS
MARKER_MISMATCH_FAIL_CLOSED=PASS
SENTINEL_RECOVERY_FAILURE_PROPAGATED=PASS
DELIBERATE_RESIDUE_CAUGHT_BY_FINAL_ASSERTION=PASS
FAULT_SUITE_SIGTERM_CLEANUP=PASS
FAULT_SUITE_OUTPUT_PARSE_FAILURE_CLEANUP=PASS
FAULT_SUITE_ASSERTION_FAILURE_CLEANUP=PASS
FAULT_SUITE_COORDINATOR_TIMEOUT_CLEANUP=PASS
```

Require the terminal aggregate markers:

```text
COORDINATOR_PARSE_FAILURE_PROPAGATION=PASS
COORDINATOR_RECOVERY_FAILURE_PROPAGATION=PASS
COORDINATOR_GLOBAL_ZERO_FINAL_ASSERTION=PASS
COORDINATOR_BASELINE_FINAL_ASSERTION=PASS
RUN_SCOPED_SESSION_FINAL_ASSERTION=PASS
PRIMARY_ERROR_PRESERVED=PASS
RECOVERY_ERROR_PRESERVED=PASS
COMBINED_ERROR_REPORTING=PASS
CHILD_KIND_BINDING=PASS
AMBIGUOUS_OUTPUT_REJECTED=PASS
FAULT_SUITE_IDENTITY_AUTHORITY=PRESPAWN_EXPECTED_IDENTITY
FAULT_SUITE_TOP_LEVEL_FINALLY=PASS
FAULT_SUITE_PRIMARY_ERROR_PRESERVED=PASS
FAULT_SUITE_CLEANUP_ERROR_PRESERVED=PASS
FAULT_SUITE_COMBINED_ERROR_REPORTING=PASS
FAULT_SUITE_BASELINE_FINAL_ASSERTION=PASS
FAULT_SUITE_OWNED_ID_FINAL_ASSERTION=PASS
FAULT_SUITE_SESSION_FINAL_ASSERTION=PASS
FAULT_SUITE_SIGKILL_CLEANUP_GUARANTEED=NO
FOREIGN_MARKER_NOT_DELETED_BY_COORDINATOR=PASS
FAULT_SUITE_TAMPERED_FIXTURE_RECOVERED=PASS
SUBSCRIPTION_COORDINATOR_FAILURE_RECOVERY_TESTS=PASS
```

For permanent cleanup, marker mismatch, sentinel tamper/recovery failure, and
deliberate residue cases, inspect the captured inner output and require:

- the inner coordinator exited nonzero;
- primary/recovery/final-assertion diagnostics were retained as applicable;
- false subordinate or overall PASS markers were absent; and
- outer cleanup subsequently removed only test-owned artifacts and restored the
  exact baseline.

After the outer command, independently require global zero across the five
target tables, no prespawned IDs, and no exact run-scoped sessions.

## 7. Repeatability and final decision

Run sections 3 through 6 a second time against a newly recreated disposable
database. This catches fixed identifiers and residue-dependent false passes.

QA passes only if both runs satisfy every expected exit code and terminal
database/session assertion, with no unexpected PASS emitted on an inner failure
path. Record a contract matrix mapping:

```text
AFV-BEH-001 -> setup collision + identity checks
AFV-BEH-002 -> preservation + marker mismatch checks
AFV-BEH-003 -> cleanup fault suite
AFV-BEH-004 -> SIGKILL boundary and external recovery checks
AFV-BEH-005 -> parallel pair and foreign-session checks
AFV-BEH-006 -> exact baseline digest checks
AFV-BEH-007 -> metadata fault cases
AFV-BEH-008 -> coordinator recovery fault cases
AFV-BEH-009 -> combined error and success-order checks
AFV-BEH-010 -> harness/fault-suite self-failure checks
```

The QA receipt must record the candidate SHA, database engine version,
sanitized command results, expected-marker presence/forbidden-marker absence,
terminal row/session assertions, and any limitations. It must explicitly state
that this tooling result does not claim deployment, runtime cutover, production
database execution, or guaranteed cleanup after `SIGKILL`/host crash.
