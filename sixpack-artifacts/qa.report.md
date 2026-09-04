# Final QA Receipt: af-verifier-1

```text
STAGE = qa
OWNERSHIP = executable_qa_automation; final_qa_receipt
VERDICT = BLOCKED_NOT_ACCEPTED
TERMINAL_CANDIDATE_HEAD = a898a94b360bfba86c0c1d708da851679f086d80
TERMINAL_CANDIDATE_TREE = cce2655d8a8bc800134147403a1421ea95a7e59a
TERMINAL_CANDIDATE_UNCHANGED_BY_QA = YES
OWNER_ACCEPTANCE_CLAIMED = NO
MERGE_AUTHORITY_CLAIMED = NO
SPEC_GAP = NO
```

## Receipt scope

This receipt binds the committed candidate delivered by the hardender station,
before the QA-owned automation and this receipt are added by the delivery
helper. QA did not modify the accepted behavior specification, QA procedure,
runtime source, schema, migrations, product API, or any committed candidate
blob. The candidate HEAD and tree remained unchanged throughout this station.

The accepted behavior is sufficiently decided; the failures below are
mechanical execution and integration-context blockers, so no `SPEC_GAP.md` was
created.

## QA-owned change

Added `sixpack-artifacts/qa.verify.mjs`, a fail-closed executable QA runner. It:

- records and rechecks the exact candidate commit, tree, repository HEAD, and
  tracked-worktree state, resolving the hardender parent explicitly when run
  after the delivery helper creates the QA artifact commit;
- checks the specifier/cleaner/architect/hardender handoff and the exact three
  command manifest entries;
- rejects runtime, Prisma, or deployment changes in the pipeline delta;
- runs the database-free architecture and mutation checks;
- requires two distinct, explicitly confirmed disposable PostgreSQL targets;
- invokes install, generation, typecheck, build, existing tests, product-core
  verification, and all three public npm hardening commands;
- points both Prisma's `DATABASE_URL` and the verifier-specific variable at the
  same confirmed target, runs the database procedure twice on distinct
  databases, and validates the complete required marker set and terminal
  success ordering for every public command; and
- independently asserts all five target tables, every parseable emitted
  Principal/Thread/Watch identity, and exact run-scoped sessions are absent
  after each hardening command.

The runner hashes child output on failure and does not include command
arguments in diagnostics, preventing database URLs from entering the receipt.

## Handoff and manifest consistency

| Check | Result |
|---|---|
| Pipeline commit order | PASS: specifier `b89f370`, coder `6e03818`, cleaner `c01c642`, architect `8e2f3bb`, hardender `a898a94` |
| Required upstream artifacts | PASS: behavior spec, QA procedure, and all three prior station reports are present |
| Package command manifest | PASS: exactly three `test:subscription-*` entries, each bound to its required script |
| Product-boundary scope | PASS: pipeline delta contains no `svc-forum/src/**`, `svc-forum/prisma/**`, or deploy change |
| Whitespace gate | FAIL: `BEHAVIOR_SPEC.md:253` has an inherited blank line at EOF |
| Standalone pipeline manifest | NOT PRESENT: consistency was checked against Git ancestry, required artifacts, package scripts, and their targets |

QA did not repair the whitespace finding because `behavior_specification` is
outside this station's ownership.

## Executed checks

Environment: CLI Node `v26.7.0`, npm `11.19.0`, PostgreSQL client `16.14`.

| Check | Result |
|---|---|
| `node --check sixpack-artifacts/qa.verify.mjs` | PASS |
| QA procedure-to-runner marker audit | PASS; all 79 explicitly enumerated terminal markers are enforced by the runner |
| Hardening architecture properties | PASS; 5 terminal property markers |
| Hardening mutation campaign | PASS; 13/13 targeted mutants killed |
| Node coverage over architecture + mutation checks | PASS; 2/2, 100% line/branch/function |
| Three hardening npm commands with both DB URL variables unset | PASS fail-closed behavior; each exited 2 and named the required configuration |
| QA runner local preflight | Expected nonzero; candidate identity emitted, then whitespace gate rejected the handoff |
| `npm ci` | BLOCKED; produced no output while waiting on the restricted package source and was interrupted after more than 60 seconds; its partial ignored `node_modules` was removed |
| `npm run typecheck` | BLOCKED before assertions; `tsc` is not installed |
| `npm run build` | BLOCKED before assertions; `tsc` is not installed |
| `npm test` | BLOCKED before assertions; all 10 test files failed at loader startup because `tsx` is not installed (npm lifecycle diagnostics used Node `v25.6.1`) |

Sanitized missing-configuration command evidence:

| Public command | Exit | Output SHA-256 |
|---|---:|---|
| `test:subscription-verifier-cleanup` | 2 | `27cb8a1791cea4062759790556f1e841c688256b30168af26008a09b379ddb36` |
| `test:subscription-verifier-parallel-isolation` | 2 | `5fc1f01a5ebbbfbcb0a3928111cdfa377205b7832f16258d43c08f6e296dab94` |
| `test:subscription-coordinator-failure-recovery` | 2 | `d7c453f1b9a599a7d86bf0fc6f28a757cb2a4c1441982566857a504016ee5e81` |

No database URL, credential, or database output was recorded.

## Public-boundary and end-to-end verdict

The required end-to-end verification through the repository's public npm
command boundary was **not executable**. This branch does not contain
`svc-forum/scripts/verify-subscription-storage.mjs` or the additive subscription
schema/migrations, and neither an explicitly confirmed disposable database nor
the two fresh database URLs required for repeatability were supplied.

Consequently, QA did not run or claim:

- product-core `verify:subscription-storage` regression;
- the cleanup, parallel-isolation, or coordinator fault suite against a
  database;
- AFV-BEH-001 through AFV-BEH-010 integrated coverage;
- terminal five-table baseline restoration or session absence; or
- production execution, deployment, runtime cutover, owner acceptance, or
  merge readiness.

## Terminal CRAP and DRY checks

The two database-free architecture/mutation checks have 100% reported line,
branch, and function coverage; the previously reported maximum
changed-function CRAP for that executable hardening delta remains 3. This
coverage does not include the QA runner or the three database orchestration
harnesses.

The three database orchestration harnesses have no truthful integrated
coverage result in this worktree, so their final CRAP gate is **BLOCKED**, not
PASS. A conservative zero-coverage token screen remains high (cleanup 5,550;
parallel coordinator 32,942; fault suite 9,312) and is only a triage proxy, not
canonical per-function CRAP.

The final DRY scan found 63 shared normalized lines between cleanup and
parallel, 51 between cleanup and fault recovery, and 90 between parallel and
fault recovery. The duplication is concentrated in independently implemented
recovery, SQL, and exact-session checks. It is accepted as deliberate
cross-checking for this candidate; extracting it without integrated mutation
evidence would create a common-mode recovery dependency.

## Final decision and handoff limitation

Final QA is **BLOCKED_NOT_ACCEPTED**. To obtain a PASS receipt, apply these
artifacts to the PR #15 integration candidate containing the product-core
verifier and subscription migrations, install dependencies, provision two
distinct fresh PostgreSQL 16 disposable databases, and run
`node sixpack-artifacts/qa.verify.mjs` with the runner's explicit disposable
database confirmation and two URL variables. The inherited whitespace defect
must also be resolved by its owning stage before the handoff gate can pass.

No cleanup guarantee is claimed for `SIGKILL`, host crash, forced container
deletion, or permanent database outage.
