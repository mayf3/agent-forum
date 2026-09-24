---
spec_id: AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1
title: Workflow Instance canonical context — DB-guaranteed one-thread-per-workflow-instance and context immutability
status: accepted
accepted_date: 2026-09-24
accepted_by: mayf3
accepted_reviewed_head: 06e5784689c4e23b948a7b1b967ac64452b1b5a1
acceptance_authority_basis: >-
  Owner ACCEPT via GOAL = WORKFLOW_EXECUTION_CONTROL_V1_CLOSURE_AND_DEPLOYMENT_
  READINESS (2026-09-24): "当前整体设计与实现方向接受，可以进入最终 closure / merge /
  deployment-ready 阶段", bound to the implementation head
  06e5784689c4e23b948a7b1b967ac64452b1b5a1 (feature branch
  goal/workflow-execution-control-v1 based on origin/main 2af4a71). This
  commit is the acceptance lifecycle transaction ONLY: the contract body is
  byte-identical to the reviewed head except this frontmatter. Preceding
  mandate record (proposal): GOAL = WORKFLOW_EXECUTION_CONTROL_V1 (2026-09-24),
  Scope A (canonical binding, idempotent create, stable query by contextId)
  and Scope G (system-written execution trace messages on the canonical
  thread).
spec_kind: implementation
authority_level: governing_spec
implementation_authority: contracts
scope:
  - svc-forum
governed_by:
  - AGENT_FORUM_CORE_INVARIANTS_V1
external_authorities: []
supersedes: []
superseded_by: null
owners:
  - mayf3
repo: mayf3/agent-forum
date: 2026-09-24
base_head: 2af4a716da482b572e653938f60a90540be30274 (origin/main)
revision: r1
companion_specs:
  - repository: mayf3/svc-workflow
    spec_id: SVC_WORKFLOW_EXECUTION_CONTROL_V1 (proposed, same date)
  - repository: mayf3/dsh-agent-core
    spec_id: AGENT_CORE_WORKFLOW_EXECUTION_CONTROL_V1 (proposed, same date)
---

# AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1

## 0. Intent

`ForumThread.contextType/contextId` already exists as a free, indexed pair.
When a workflow control plane needs a CANONICAL collaboration thread per
workflow instance, "at most one" must be guaranteed by the database, not by
client discipline. Forum stays a human-readable projection surface: it
gains no business authority, and nothing in forum state can change
workflow state.

## 1. Requirements (CTR-FWIC-*)

### CTR-FWIC-001 Canonical uniqueness (migration)

Partial unique index on `forum_threads`:

```
CREATE UNIQUE INDEX uq_forum_threads_workflow_instance_context
  ON forum_threads (context_id)
  WHERE context_type = 'workflow_instance'
    AND context_id IS NOT NULL;
```

Only `context_type = 'workflow_instance'` is constrained; every other
existing and future contextType keeps today's semantics (multiple threads
per context allowed).

### CTR-FWIC-002 Create conflict semantics

`POST /api/threads` with `contextType = 'workflow_instance'` when a thread
already exists for the same `contextId` ⇒ `409` with message
`WORKFLOW_CONTEXT_THREAD_EXISTS` (the existing error envelope). Clients
resolve canonical threads by re-running the context query; no auto-merge,
no silent second thread.

### CTR-FWIC-003 Context immutability for workflow_instance threads

`PATCH /api/threads/:id` must reject any request that changes
`contextType` or `contextId` when the EXISTING thread's `contextType` is
`workflow_instance` ⇒ `409 WORKFLOW_CONTEXT_IMMUTABLE`. The canonical
binding cannot drift after creation. All other patches (title, tags, …)
behave exactly as before.

### CTR-FWIC-004 Query stability (no change)

`GET /api/threads?contextType=workflow_instance&contextId=<uuid>` keeps
working unchanged (existing filter) and is the canonical resolution path
for both companion services.

## 2. Explicit non-goals

- No message schema change: system execution events are ordinary
  `kind=comment` messages with `metadata` (forum.moderate is NOT required
  and NOT granted for this).
- No workflow-specific read/write scopes; `forum.read`/`forum.write` as
  today (CTR-AUTHZ-006 unchanged).
- Forum never derives or stores workflow business state.

## 3. Test obligations

- Duplicate create with same (workflow_instance, contextId) ⇒ 409; the
  pre-existing thread is returned by the context query (real-DB smoke for
  the partial index).
- PATCH context drift on a workflow_instance thread ⇒ 409.
- PATCH context on other contextTypes unchanged (regression).
