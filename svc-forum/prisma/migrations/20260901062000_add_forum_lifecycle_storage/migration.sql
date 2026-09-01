-- Phase 2 lifecycle storage only.
-- No backfill, runtime reader/writer, dual write, or authority cutover is enabled.

-- D10: revision history for the orthogonal discussion lifecycle.
CREATE TABLE "public"."forum_thread_revisions" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "discussion_state" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "opened_by_principal_id" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_principal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_thread_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_thread_revisions_thread_id_revision_key"
ON "public"."forum_thread_revisions"("thread_id", "revision");

ALTER TABLE "public"."forum_thread_revisions"
  ADD CONSTRAINT "forum_thread_revisions_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "public"."forum_threads"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "public"."forum_thread_revisions"
  ADD CONSTRAINT "forum_thread_revisions_opened_by_principal_id_fkey"
  FOREIGN KEY ("opened_by_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "public"."forum_thread_revisions"
  ADD CONSTRAINT "forum_thread_revisions_resolved_by_principal_id_fkey"
  FOREIGN KEY ("resolved_by_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-041: closed discussion-state set and exact open/resolved shape.
ALTER TABLE "public"."forum_thread_revisions"
  ADD CONSTRAINT "forum_thread_revisions_shape_ck"
  CHECK (
    (
      "discussion_state" = 'open'
      AND "resolved_at" IS NULL
      AND "resolved_by_principal_id" IS NULL
    )
    OR
    (
      "discussion_state" = 'resolved'
      AND "resolved_at" IS NOT NULL
      AND "resolved_by_principal_id" IS NOT NULL
    )
  );

-- SQL-042: current-revision pointer may remain unchanged or advance by one.
CREATE FUNCTION "public"."forum_guard_current_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.current_revision IS NULL THEN
    IF NEW.current_revision IS NOT NULL
       AND NEW.current_revision <> 1 THEN
      RAISE EXCEPTION 'initial revision must be 1'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.current_revision IS NULL
     OR NEW.current_revision < OLD.current_revision
     OR NEW.current_revision > OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'revision must remain unchanged or increment by one'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- SQL-043: bind the pointer guard to UPDATE only.
CREATE TRIGGER "forum_guard_current_revision_tg"
BEFORE UPDATE
ON "public"."forum_threads"
FOR EACH ROW
EXECUTE FUNCTION "public"."forum_guard_current_revision"();

-- SQL-044: revision rows must be inserted in exact sequence.
CREATE FUNCTION "public"."forum_thread_revisions_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cur integer;
BEGIN
  SELECT current_revision INTO cur
  FROM "public"."forum_threads"
  WHERE id = NEW.thread_id
  FOR SHARE;

  IF cur IS NULL THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'initial revision must be 1'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.revision <> cur + 1 THEN
    RAISE EXCEPTION 'revision must be exactly current + 1'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- SQL-045: bind the insert guard to revision INSERT only.
CREATE TRIGGER "forum_thread_revisions_insert_guard_tg"
BEFORE INSERT
ON "public"."forum_thread_revisions"
FOR EACH ROW
EXECUTE FUNCTION "public"."forum_thread_revisions_insert_guard"();

-- SQL-046 / D19: stage and validate the composite current-revision pointer.
ALTER TABLE "public"."forum_threads"
  ADD CONSTRAINT "forum_threads_current_revision_fk"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "public"."forum_thread_revisions"("thread_id", "revision")
  ON DELETE RESTRICT ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "public"."forum_threads"
  VALIDATE CONSTRAINT "forum_threads_current_revision_fk";

-- SQL-047 / SQL-048 are intentionally installed after Prisma migrate deploy by
-- scripts/apply-lifecycle-indexes.mjs. Prisma 5.22 wraps this migration in a
-- transaction, while PostgreSQL requires CREATE INDEX CONCURRENTLY to run as a
-- standalone statement.
