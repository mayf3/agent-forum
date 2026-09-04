# Cleaner Stage Report: af-verifier-1

```text
STAGE = cleaner
OWNERSHIP = cleanup_and_local_quality_checks
SOURCE_CANDIDATE = 6e03818
RESULT = CONDITIONAL_PASS_WITH_EXECUTION_LIMITATIONS
PRODUCT_RUNTIME_BEHAVIOR_CHANGED = NO
```

## Scope checked

- Reviewed the accepted `BEHAVIOR_SPEC.md` and `QA_PROCEDURE.md` before assessing the coder delta.
- Compared `b89f370..6e03818`: the delta is limited to three `package.json` test entry points and three test-only subscription verifier harnesses. No runtime source, Prisma schema, migration, API, backfill, cutover, or deployment file changed.
- Verified each added harness blob is byte-for-byte identical to its counterpart at the locally available PR #15 reference commit `c2f7a74ed7572bab048ed44ff03d1e4e25ead81f`:
  - cleanup: `55c8b43d1ca7628a4ca06c44f4e14a6d20df49ab`
  - parallel isolation: `c4e9127acf4b6e5ff4bde943cb6044fee8217414`
  - coordinator failure recovery: `e5b66dc32c0f46f7c31dd8f68c3bc0891c95e538`
- Confirmed all three required npm command names resolve to the intended scripts.

## Changes made

No test-source refactor was made. The candidate already matches the PR #15 reference exactly. The repeated `assert`, `sqlLiteral`, `psql`, exact-session, and external-cleanup routines are intentional independent recovery paths: extracting them into one shared helper at this stage would introduce a common-mode failure into tests whose purpose is to independently recover and verify one another. Preserving the reference blobs is the safer local structure decision and leaves observable behavior unchanged.

This report is the cleaner-stage artifact added for handoff.

## Local quality checks

| Check | Result | Evidence |
|---|---|---|
| Changed-file scope | PASS | Four coder files only: three test harnesses and `svc-forum/package.json`. |
| Observable behavior unchanged | PASS (static) | No product-runtime files changed; harness blobs match the PR #15 reference hashes above. |
| JavaScript syntax | PASS | `node --check` passed for all three added `.mjs` files. |
| Package command binding | PASS | All three required script keys exist and point to the expected files. |
| TypeScript typecheck | PASS | `npm run typecheck`, exit 0. |
| Build | PASS | `npm run build`, exit 0. |
| Whitespace/error scan | PASS | `git diff --check b89f370..6e03818`, exit 0. |
| Missing-URL fail-closed check | PASS | `npm run test:subscription-verifier-cleanup -- --help` exited 2 and named `SUBSCRIPTION_STORAGE_DATABASE_URL` / `DATABASE_URL` before database mutation. |
| Existing unit suite | BLOCKED (environment) | `npm test` could not load `@esbuild/darwin-x64`; Node is x64 under Rosetta on an arm64 host. A no-save install retry was denied by restricted network access. No test assertion ran. |
| Hardening integration suites | BLOCKED (candidate context) | This isolated branch has neither `scripts/verify-subscription-storage.mjs` nor the subscription schema/migrations from PR #15, and no disposable PostgreSQL URL was supplied. |

## Coverage, CRAP, and DRY review

Executable coverage for the three new orchestration harnesses is **not measured** in this station. Reporting a percentage would be false because their prerequisite verifier/schema and disposable database are absent, and the repository test runner did not start assertions due to the esbuild platform package issue.

As a conservative zero-coverage risk screen only, a whole-file branch-token proxy produced the following non-production indicators. These are upper-bound triage values, not canonical cyclomatic complexity or coverage-backed CRAP scores:

| Harness | Lines | Branch-token proxy | Complexity proxy | Zero-coverage CRAP upper screen (`C^2 + C`) |
|---|---:|---:|---:|---:|
| coordinator failure recovery | 554 | 85 | 86 | 7,482 |
| verifier cleanup | 480 | 63 | 64 | 4,160 |
| parallel isolation | 1,051 | 162 | 163 | 26,732 |

The screen flags the parallel coordinator as the main maintainability hotspot, but it does not justify an untested refactor. The DRY scan found 16 occurrences of the core helper definitions across the three files and 89/63/51 shared normalized nonblank line shapes for parallel-vs-fault, cleanup-vs-parallel, and cleanup-vs-fault respectively. Most high-value duplication is recovery SQL and exact-session handling whose independence is useful for fail-closed verification. Revisit extraction only with mutation tests that demonstrate the outer recovery suite still detects defects in the inner coordinator.

## Limitations and downstream handoff

- This is not executable QA acceptance and not a final QA receipt.
- The architect/hardener/QA stages must evaluate the harnesses in the actual PR #15 integration context, with the referenced verifier, subscription migrations, PostgreSQL 16 disposable database, and native-platform esbuild dependency available.
- Coverage and a real per-function CRAP report must be generated from that integrated run and bound to its exact candidate SHA.
- No `SPEC_GAP.md` was created: the accepted behavior authority is sufficiently explicit; the blockers are mechanical execution/context limitations, not undecided product behavior.
