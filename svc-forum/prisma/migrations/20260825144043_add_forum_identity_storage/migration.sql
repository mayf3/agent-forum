-- Phase 2 additive Forum identity storage only.
-- No alias import, actor backfill, runtime writer, resolver change, or cutover.

-- Add exactly 13 nullable columns with no database defaults.
ALTER TABLE "public"."forum_threads"
  ADD COLUMN "creator_principal_id" UUID,
  ADD COLUMN "visibility_state" TEXT,
  ADD COLUMN "current_revision" INTEGER;

ALTER TABLE "public"."forum_messages"
  ADD COLUMN "author_principal_id" UUID,
  ADD COLUMN "discussion_revision" INTEGER;

ALTER TABLE "public"."forum_thread_views"
  ADD COLUMN "viewer_principal_id" UUID;

ALTER TABLE "public"."forum_outcomes"
  ADD COLUMN "created_by_principal_id" UUID,
  ADD COLUMN "authority_kind" TEXT;

ALTER TABLE "public"."forum_context_snapshots"
  ADD COLUMN "taken_by_principal_id" UUID,
  ADD COLUMN "discussion_revision" INTEGER;

ALTER TABLE "public"."forum_reports"
  ADD COLUMN "reporter_principal_id" UUID,
  ADD COLUMN "handled_by_principal_id" UUID;

ALTER TABLE "public"."forum_reactions"
  ADD COLUMN "actor_principal_id" UUID;

-- Create the initially empty permanent alias ledger.
CREATE TABLE "public"."forum_principal_aliases" (
  "id" UUID NOT NULL,
  "principal_id" UUID NOT NULL,
  "namespace" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "retired_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_principal_aliases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forum_principal_aliases_principal_id_namespace_idx"
  ON "public"."forum_principal_aliases" ("principal_id", "namespace");

CREATE UNIQUE INDEX "forum_principal_aliases_namespace_value_key"
  ON "public"."forum_principal_aliases" ("namespace", "value");

ALTER TABLE "public"."forum_principal_aliases"
  ADD CONSTRAINT "forum_principal_aliases_principal_id_fkey"
  FOREIGN KEY ("principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-018: alias namespace closed set.
ALTER TABLE "public"."forum_principal_aliases"
  ADD CONSTRAINT "forum_principal_aliases_namespace_ck"
  CHECK ("namespace" IN ('auth_subject', 'agent_id'));

-- SQL-019: alias identity, retirement, and physical permanence guard.
-- id immutability is intentionally not required by the adopted design.
CREATE OR REPLACE FUNCTION "public"."forum_alias_owner_immutable_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'principal alias rows are permanent'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.principal_id IS DISTINCT FROM OLD.principal_id
     OR NEW.namespace IS DISTINCT FROM OLD.namespace
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'principal alias identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.retired_at IS NOT NULL
     AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'retired principal alias is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

-- SQL-020: exact row-level BEFORE UPDATE OR DELETE binding (tgtype 27).
CREATE TRIGGER "forum_alias_owner_immutable_guard_tg"
BEFORE UPDATE OR DELETE
ON "public"."forum_principal_aliases"
FOR EACH ROW
EXECUTE FUNCTION "public"."forum_alias_owner_immutable_guard"();

-- SQL-075: exact statement-level BEFORE TRUNCATE binding (tgtype 34).
CREATE TRIGGER "forum_alias_owner_immutable_guard_truncate_tg"
BEFORE TRUNCATE
ON "public"."forum_principal_aliases"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."forum_alias_owner_immutable_guard"();

-- SQL-021..SQL-028: exactly eight nullable Principal FKs, staged NOT VALID.
-- SQL-021: forum_threads.creator_principal_id.
ALTER TABLE "public"."forum_threads"
  ADD CONSTRAINT "forum_threads_creator_principal_fk"
  FOREIGN KEY ("creator_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-022: forum_messages.author_principal_id.
ALTER TABLE "public"."forum_messages"
  ADD CONSTRAINT "forum_messages_author_principal_fk"
  FOREIGN KEY ("author_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-023: forum_thread_views.viewer_principal_id.
ALTER TABLE "public"."forum_thread_views"
  ADD CONSTRAINT "forum_thread_views_viewer_principal_fk"
  FOREIGN KEY ("viewer_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-024: forum_outcomes.created_by_principal_id.
ALTER TABLE "public"."forum_outcomes"
  ADD CONSTRAINT "forum_outcomes_created_by_principal_fk"
  FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-025: forum_context_snapshots.taken_by_principal_id.
ALTER TABLE "public"."forum_context_snapshots"
  ADD CONSTRAINT "forum_context_snapshots_taken_by_principal_fk"
  FOREIGN KEY ("taken_by_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-026: forum_reports.reporter_principal_id.
ALTER TABLE "public"."forum_reports"
  ADD CONSTRAINT "forum_reports_reporter_principal_fk"
  FOREIGN KEY ("reporter_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-027: forum_reports.handled_by_principal_id.
ALTER TABLE "public"."forum_reports"
  ADD CONSTRAINT "forum_reports_handled_by_principal_fk"
  FOREIGN KEY ("handled_by_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- SQL-028: forum_reactions.actor_principal_id.
ALTER TABLE "public"."forum_reactions"
  ADD CONSTRAINT "forum_reactions_actor_principal_fk"
  FOREIGN KEY ("actor_principal_id") REFERENCES "public"."forum_principals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

-- Validate each staged FK before the migration completes.
ALTER TABLE "public"."forum_threads"
  VALIDATE CONSTRAINT "forum_threads_creator_principal_fk";
ALTER TABLE "public"."forum_messages"
  VALIDATE CONSTRAINT "forum_messages_author_principal_fk";
ALTER TABLE "public"."forum_thread_views"
  VALIDATE CONSTRAINT "forum_thread_views_viewer_principal_fk";
ALTER TABLE "public"."forum_outcomes"
  VALIDATE CONSTRAINT "forum_outcomes_created_by_principal_fk";
ALTER TABLE "public"."forum_context_snapshots"
  VALIDATE CONSTRAINT "forum_context_snapshots_taken_by_principal_fk";
ALTER TABLE "public"."forum_reports"
  VALIDATE CONSTRAINT "forum_reports_reporter_principal_fk";
ALTER TABLE "public"."forum_reports"
  VALIDATE CONSTRAINT "forum_reports_handled_by_principal_fk";
ALTER TABLE "public"."forum_reactions"
  VALIDATE CONSTRAINT "forum_reactions_actor_principal_fk";
