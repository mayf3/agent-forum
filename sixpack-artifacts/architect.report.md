# Architect Stage Report: af-verifier-1

## Scope and authority

This station evaluated architecture and property-test coverage only. The
accepted behavior authority is `BEHAVIOR_SPEC.md`; the manual acceptance flow
is `QA_PROCEDURE.md`. Neither document was changed, and no product behavior,
runtime source, schema, migration, deployment path, implementation test, or QA
automation was added.

The candidate entering this station consisted of three package command entries
and three test-only orchestration scripts. The product-core
`scripts/verify-subscription-storage.mjs` and the subscription schema/migrations
belong to the PR #15 integration context and are not present in this isolated
branch.

## Boundary and dependency-direction evaluation

The intended dependency graph is acyclic and points inward toward the
product-core verifier:

```text
coordinator failure-recovery suite
  -> parallel-isolation coordinator
       -> cleanup/fault harness
            -> product-core verifier
       -> product-core verifier
```

- The cleanup/fault harness references only the product-core verifier.
- The parallel-isolation coordinator composes the verifier and cleanup harness.
- The outer failure-recovery suite references only the coordinator.
- All three hardening scripts import only Node built-ins; they do not import
  runtime, route, Prisma, migration, or third-party application modules.
- No file under `src/` or `prisma/` refers back to a hardening harness, its
  test-only environment controls, or its private ownership-marker namespace.
- Global five-table emptiness remains owned by external coordination layers;
  neither the cleanup harness nor the individual verifier is allowed to assume
  that unrelated runs or customer-like baseline rows are absent.
- The three accepted package commands remain the only exposed
  `test:subscription-*` hardening surface. Test-only controls remain private
  process interfaces rather than production configuration or public APIs.

No dependency-direction violation or information-hiding breach was found in
the incoming candidate. The repeated recovery/SQL routines were not extracted:
their independence is part of the cross-checking boundary and a shared helper
would create a common-mode recovery failure.

## Changes made

Added
`svc-forum/scripts/test-subscription-hardening-architecture.mjs`, a database-free
architecture property test. It rejects:

1. a changed, reversed, or broadened local orchestration edge;
2. imports of application or third-party modules into the hardening harnesses;
3. a module API exported from an entrypoint-only harness;
4. coordinator-only global-empty ownership moving into the cleanup harness or
   individual verifier;
5. private fault controls, harness identities, or script dependencies leaking
   into `src/` or `prisma/`; and
6. drift in the accepted three-command package surface.

The architecture test was deliberately not added to `package.json`, because
doing so would broaden the observable hardening command surface accepted by
the behavior specification.

Accepted behavior is unchanged: this station added only a read-only static
test and this report.

## Verification

| Check | Result |
|---|---|
| `node scripts/test-subscription-hardening-architecture.mjs` | PASS; all five architecture/property markers emitted |
| `node --check` for the three incoming harnesses | PASS |
| `node --check scripts/test-subscription-hardening-architecture.mjs` | PASS |
| All three package-target harnesses with both database URL variables explicitly unset | PASS; each exited `2` before mutation and named the required disposable-database configuration |
| Candidate scope and dependency review | PASS; test-only changes plus station reports, with no runtime/schema/migration change |

## Limitations and handoff

- Database-backed properties were not executed. No disposable PostgreSQL URL
  was supplied, and running these suites against an unconfirmed database would
  violate the accepted safety boundary.
- The product-core verifier and subscription storage migrations are absent in
  this branch, so the optional verifier-side global-ownership scan could only
  validate the required dependency edge. When this artifact is applied in the
  PR #15 context, the same test also scans the verifier source.
- Full integration, mutation hardening, and executable/final QA remain owned by
  the hardener and QA stations. This report is not a QA receipt or integration
  readiness claim.
