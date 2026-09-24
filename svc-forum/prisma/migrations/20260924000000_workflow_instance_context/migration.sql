-- AGENT_FORUM_WORKFLOW_INSTANCE_CONTEXT_V1 (CTR-FWIC-001)
-- Canonical one-thread-per-workflow-instance: a partial unique index that
-- constrains ONLY context_type = 'workflow_instance'. Every other
-- contextType keeps today's semantics (multiple threads per context).

-- Pre-step (data remediation, required for the index to apply): the
-- free-form context field predates this Spec and real data already contains
-- multiple threads per workflow_instance contextId. Policy: the OLDEST
-- thread per contextId stays canonical (matches the control-plane protocol:
-- first create wins, races resolve to the existing thread); newer
-- duplicates keep ALL their content but lose the canonical context binding
-- (they degrade to ordinary threads — nothing is deleted).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY "contextId"
               ORDER BY "createdAt" ASC, id ASC
           ) AS rn
    FROM forum_threads
    WHERE "contextType" = 'workflow_instance'
      AND "contextId" IS NOT NULL
)
UPDATE forum_threads t
   SET "contextType" = NULL,
       "contextId" = NULL,
       "updatedAt" = now()
  FROM ranked r
 WHERE t.id = r.id
   AND r.rn > 1;

-- Prisma maps the model fields to QUOTED camelCase columns ("contextType" /
-- "contextId") — snake_case here would fail on any real database.
CREATE UNIQUE INDEX "uq_forum_threads_workflow_instance_context"
    ON "forum_threads"("contextId")
    WHERE "contextType" = 'workflow_instance' AND "contextId" IS NOT NULL;
