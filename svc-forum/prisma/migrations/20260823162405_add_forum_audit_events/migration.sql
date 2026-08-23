-- CreateTable
CREATE TABLE "forum_audit_events" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_principal_id" UUID,
    "auth_subject" TEXT,
    "agent_id" TEXT,
    "client_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "thread_id" UUID,
    "revision" INTEGER,
    "request_correlation_id" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "provenance" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_audit_events_pkey" PRIMARY KEY ("event_id")
);

-- AddForeignKey
ALTER TABLE "forum_audit_events" ADD CONSTRAINT "forum_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_audit_events" ADD CONSTRAINT "forum_audit_events_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-015: closed-set provenance CHECK (runtime | migration)
ALTER TABLE "forum_audit_events"
ADD CONSTRAINT "forum_audit_events_provenance_ck" CHECK (
  "provenance" IN ('runtime', 'migration')
);

-- SQL-016: append-only guard, reusing public.forum_forbid_mutation() created by
-- 20260822065412_add_forum_migration_foundation. UPDATE and DELETE are rejected
-- with SQLSTATE 55000; INSERT is the only legal write path.
CREATE TRIGGER "forum_audit_events_append_only_tg"
BEFORE UPDATE OR DELETE
ON "forum_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."forum_forbid_mutation"();

-- SQL-017: application role boundary. forum_app must already exist as a
-- non-login / minimal-privilege role created outside migrations; this migration
-- never creates, alters, or takes ownership of any role. The table owner
-- remains the migration owner; table owner and superuser can still bypass
-- grants, which is why acceptance verifies both the grants and the trigger.
GRANT SELECT, INSERT ON "forum_audit_events" TO "forum_app";
REVOKE UPDATE, DELETE, TRUNCATE ON "forum_audit_events" FROM "forum_app";
