---
spec_id: AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1
title: Workflow Instance canonical context — DB-guaranteed one-thread-per-workflow-instance and context immutability
status: accepted
accepted_date: 2026-09-24
accepted_by: mayf3
accepted_reviewed_head: 2fb3f9f3a3a66c9428fdc582df7284b0951acfd2
acceptance_authority_basis: >-
  Owner mayf3 exact-head acceptance in
  PRODUCTION_DEPLOYMENT_CONTROL_PLANE_V1 continuation (2026-09-24),
  bound to corrected r2 reviewed head
  2fb3f9f3a3a66c9428fdc582df7284b0951acfd2. This lifecycle
  transaction changes only acceptance metadata; the normative contract
  body remains byte-identical to the independently reviewed r2 candidate.
spec_kind: implementation
authority_level: governing_spec
implementation_authority: contracts
scope:
  - svc-forum
governed_by:
  - AGENT_FORUM_CORE_INVARIANTS_V1
external_authorities:
  - repository: mayf3/svc-workflow
    authority_id: SVC_WORKFLOW_EXECUTION_CONTROL_V1
    revision: 797b72059614ff3ee444207a26c2231b7dc5f7ab
    relation: interoperates_with
  - repository: mayf3/dsh-agent-core
    authority_id: AGENT_CORE_WORKFLOW_EXECUTION_CONTROL_V1
    revision: 50d8a69bc1996eb28029272f2fa7f8edb4f3baca
    relation: interoperates_with
supersedes: []
superseded_by: null
owners:
  - mayf3
repo: mayf3/agent-forum
date: 2026-09-24
base_head: 2af4a716da482b572e653938f60a90540be30274 (origin/main)
revision: r2
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
CREATE UNIQUE INDEX "uq_forum_threads_workflow_instance_context"
  ON "forum_threads"("contextId")
  WHERE "contextType" = 'workflow_instance'
    AND "contextId" IS NOT NULL;
```

Only `contextType = 'workflow_instance'` is constrained; every other
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
