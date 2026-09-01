-- Governance V1 — runtime writer convergence (additive only).
--
-- NO new audit/notification tables: the runtime governance writer reuses
--   • forum_audit_events   (append-only evidence storage, provenance='runtime')
--   • forum_notification_facts (subscription-storage fact table)
-- This migration only adds query indexes, two nullable columns, and widens
-- the notification reason closed set (table had no runtime writer and was
-- empty at this point — widening is data-loss-free).

-- ── Audit: query indexes on the append-only evidence table ────────────────
-- (INSERT remains the only legal write path; indexes are additive metadata)
CREATE INDEX "forum_audit_events_target_type_target_id_idx"
  ON "forum_audit_events"("target_type", "target_id");
CREATE INDEX "forum_audit_events_event_type_idx"
  ON "forum_audit_events"("event_type");
CREATE INDEX "forum_audit_events_created_at_idx"
  ON "forum_audit_events"("created_at");

-- ── Notifications: read state + bounded context payload ───────────────────
ALTER TABLE "forum_notification_facts"
  ADD COLUMN "read_at" TIMESTAMPTZ(3);
ALTER TABLE "forum_notification_facts"
  ADD COLUMN "payload" JSONB;

CREATE INDEX "forum_notification_facts_recipient_principal_id_created_at_idx"
  ON "forum_notification_facts"("recipient_principal_id", "created_at");
CREATE INDEX "forum_notification_facts_recipient_principal_id_read_at_idx"
  ON "forum_notification_facts"("recipient_principal_id", "read_at");
CREATE INDEX "forum_notification_facts_thread_id_idx"
  ON "forum_notification_facts"("thread_id");

-- ── Notifications: widen the reason closed set (SQL-040 amendment) ────────
-- Governance V1 adds lifecycle notices ('thread_notice') and moderator-action
-- notices ('moderator_notice') alongside the subscription-storage reasons.
-- Drop-and-re-add on an empty table; the widened set is a superset.
ALTER TABLE "forum_notification_facts"
  DROP CONSTRAINT "forum_notifications_reason_ck";
ALTER TABLE "forum_notification_facts"
  ADD CONSTRAINT "forum_notifications_reason_ck"
    CHECK (reason IN ('mention', 'watch', 'reaction', 'thread_notice', 'moderator_notice'));
