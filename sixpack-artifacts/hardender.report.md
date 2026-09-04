# Hardender Stage Report: af-verifier-1

```text
STAGE = hardender
OWNERSHIP = mutation_hardening
SOURCE_CANDIDATE = 8e2f3bb
RESULT = CONDITIONAL_PASS_WITH_INTEGRATION_LIMITATIONS
PRODUCT_RUNTIME_BEHAVIOR_CHANGED = NO
SPEC_GAP = NO
```

## Scope and authority checked

- Read the accepted `BEHAVIOR_SPEC.md` and `QA_PROCEDURE.md` and kept this
  station within subscription-verifier test-tooling hardening.
- Reviewed the complete candidate delta from the specifier parent through the
  architect head. No runtime source, schema, migration, public API, backfill,
  cutover, deployment, or product acceptance behavior was changed.
- Confirmed the three accepted package commands remain the only exposed
  `test:subscription-*` commands.
- Confirmed no product-contract decision was missing. No `SPEC_GAP.md` was
  needed.

## Mutation hardening applied

Added `scripts/test-subscription-hardening-mutations.mjs`, an internal,
database-free mutation campaign. It creates isolated candidate copies beneath
`svc-forum`, runs the architecture property test against each copy, and removes
each copy in `finally`. It is intentionally not exposed in `package.json` and
is not executable QA automation.

The campaign killed 13 of 13 targeted mutants:

| Mutation family | Killed |
|---|---:|
| Reversed or broadened local dependency edges | 2/2 |
| Cleanup layer claiming coordinator-only global-zero ownership | 1/1 |
| Third-party import or exported entrypoint API | 2/2 |
| Coordinator ownership marker reduced to non-executable text | 1/1 |
| Required overall PASS removed from cleanup/coordinator/fault suite | 3/3 |
| Cleanup overall PASS moved before the final cleanup assertion | 1/1 |
| Package command redirected or command surface broadened | 2/2 |
| Private verifier control leaked into runtime source | 1/1 |
| **Total** | **13/13** |

The success-marker/order mutant exposed a real survivor in the incoming
candidate: `SUBSCRIPTION_VERIFIER_CLEANUP_FAULT_TESTS=PASS` was printed inside
the main `try`, before the harness `finally` and its terminal sentinel
assertions. The marker now prints only after
`HARNESS_OWNED_SENTINEL_CLEANUP=PASS`. The architecture property check was
tightened to require exactly one literal terminal marker per layer, exact
coordinator ownership emission, and post-recovery ordering. Comment-only and
diagnostic-string lookalikes no longer satisfy those properties.

## Post-hardening verification

| Check | Result |
|---|---|
| JavaScript syntax for cleanup, architecture, and mutation scripts | PASS |
| `node scripts/test-subscription-hardening-architecture.mjs` | PASS; 5/5 property markers |
| `node scripts/test-subscription-hardening-mutations.mjs` | PASS; mutation score 13/13 |
| Node test runner with experimental coverage over the two database-free checks | PASS; 2/2 tests, aggregate line/branch/function coverage reported as 100% |
| Three package hardening commands with both DB URL variables unset | PASS; each exited 2 and named the required disposable DB configuration before mutation |
| Changed-file whitespace check | PASS |
| Typecheck/build | NOT RUN TO ASSERTIONS; local dependencies are absent (`tsc: command not found`) |
| Existing unit suite | NOT RUN TO ASSERTIONS; local `tsx` package is absent, so all ten test files failed at loader startup |

## Post-hardening CRAP gate

The changed-file default gate is **PASS (`max CRAP <= 10`)** for the executable
hardener delta. Structural cyclomatic review gives a maximum changed-function
complexity of 3 (`replaceOnce`; all other added/changed functions are at most
2). The database-free hardening command exercised all added functions and
Node's test coverage report returned 100% aggregate line, branch, and function
coverage. Under the standard formula
`CRAP = C^2 * (1 - coverage)^3 + C`, the maximum post-hardening CRAP is therefore
3. The cleanup marker move adds no branch or function complexity.

This CRAP result applies only to this station's executable delta. It does not
replace the cleaner's explicitly unmeasured integrated CRAP assessment for the
three large database orchestration harnesses.

## Limitations and downstream handoff

- Database-backed mutants were not run. This branch does not contain
  `scripts/verify-subscription-storage.mjs` or the PR #15 additive subscription
  schema/migrations, and neither `SUBSCRIPTION_STORAGE_DATABASE_URL` nor
  `DATABASE_URL` was supplied. Running against an unconfirmed database would
  violate the accepted disposable-database boundary.
- The integrated candidate must still run database mutation operators over
  marker-qualified DELETE predicates, exact session-name matching, metadata
  validation, cleanup retry/error aggregation, and final baseline assertions.
  Those survivors, if any, cannot honestly be classified in this worktree.
- Dependency installation was not attempted because network access is not
  available in this station. Typecheck, build, existing tests, all three
  database suites, product-core regression, and final QA remain downstream
  checks rather than claims of this report.
- This report is mutation-hardening evidence only; it is not executable QA
  automation or a final QA receipt.
