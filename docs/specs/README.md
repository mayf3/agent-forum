# Agent Forum governing Specs

Governing Specs live at stable paths:

```text
docs/specs/<SPEC_ID>.md
```

Syntax and lifecycle are governed by:

```text
.agents/protocol/SPEC_FORMAT_V0.md
.agents/protocol/SPEC_GOVERNANCE_V0.md
```

Lifecycle:

```text
proposed | accepted | superseded
```

Implementation progress, verification coverage, runtime state, and conformance are separate dimensions and are not written into Spec lifecycle.

The higher-level local Product Direction authority is:

```text
AGENT_FORUM_PRODUCT_DIRECTION_V1
docs/product/agent-forum-product-direction-v1.md
```

Before non-mechanical implementation:

```text
local governance adoption in implementation base = accepted
governing Spec status in implementation base = accepted
implementation_authority = contracts
requested work within active Contract scope = yes
```

A proposed adoption or proposed Spec cannot authorize implementation.

## Repository Spec index

| Spec ID | Status | Kind | Scope | Implementation authority | Supersedes |
|---|---|---|---|---|---|
| `AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1` | superseded | invariant | repository governance | none | — |
| `AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2` | accepted | invariant | repository governance v1.0.0 adoption | none | `AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V1` |
| `AGENT_FORUM_CORE_INVARIANTS_V1` | accepted | invariant | `svc-forum`, Forum access client | contracts | — |

Update this index when a governing Spec is added, accepted, or superseded. The table is navigation; the exact Spec file and revision remain authoritative.

`AGENT_FORUM_DEVELOPMENT_GOVERNANCE_ADOPTION_V2` is the owner-accepted whole-authority successor candidate. Within this candidate, V1 is superseded and V2 is accepted; V1 remains active on `main` until this exact acceptance Head passes independent final-head recheck and is merged.
