-- CreateTable
CREATE TABLE "forum_participations" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "presentation_role" TEXT,
    "presentation_status" TEXT,
    "joined_at" TIMESTAMPTZ(3),
    "left_at" TIMESTAMPTZ(3),
    "fact_state" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "legacy_evidence_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forum_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_watch_subscriptions" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "legacy_evidence_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forum_watch_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_read_states" (
    "thread_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "last_read_seq" INTEGER,
    "last_read_at" TIMESTAMPTZ(3),
    "provenance" TEXT NOT NULL,
    "legacy_evidence_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forum_read_states_pkey" PRIMARY KEY ("thread_id","principal_id")
);

-- CreateTable
CREATE TABLE "forum_mentions" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "mentioned_principal_id" UUID NOT NULL,
    "source_agent_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forum_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_notification_facts" (
    "id" UUID NOT NULL,
    "recipient_principal_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "message_id" UUID,
    "reaction_id" UUID,
    "reason" TEXT NOT NULL,
    "source_event_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forum_notification_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_participations_thread_id_principal_id_key" ON "forum_participations"("thread_id", "principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_mentions_message_id_mentioned_principal_id_key" ON "forum_mentions"("message_id", "mentioned_principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_notification_facts_recipient_principal_id_source_even_key" ON "forum_notification_facts"("recipient_principal_id", "source_event_key");

-- AddForeignKey
ALTER TABLE "forum_participations" ADD CONSTRAINT "forum_participations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_participations" ADD CONSTRAINT "forum_participations_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_participations" ADD CONSTRAINT "forum_participations_legacy_evidence_id_fkey" FOREIGN KEY ("legacy_evidence_id") REFERENCES "forum_migration_legacy_evidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_watch_subscriptions" ADD CONSTRAINT "forum_watch_subscriptions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_watch_subscriptions" ADD CONSTRAINT "forum_watch_subscriptions_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_watch_subscriptions" ADD CONSTRAINT "forum_watch_subscriptions_legacy_evidence_id_fkey" FOREIGN KEY ("legacy_evidence_id") REFERENCES "forum_migration_legacy_evidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_read_states" ADD CONSTRAINT "forum_read_states_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_read_states" ADD CONSTRAINT "forum_read_states_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_read_states" ADD CONSTRAINT "forum_read_states_legacy_evidence_id_fkey" FOREIGN KEY ("legacy_evidence_id") REFERENCES "forum_migration_legacy_evidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_mentions" ADD CONSTRAINT "forum_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "forum_messages"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_mentions" ADD CONSTRAINT "forum_mentions_mentioned_principal_id_fkey" FOREIGN KEY ("mentioned_principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_notification_facts" ADD CONSTRAINT "forum_notification_facts_recipient_principal_id_fkey" FOREIGN KEY ("recipient_principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_notification_facts" ADD CONSTRAINT "forum_notification_facts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_notification_facts" ADD CONSTRAINT "forum_notification_facts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "forum_messages"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "forum_notification_facts" ADD CONSTRAINT "forum_notification_facts_reaction_id_fkey" FOREIGN KEY ("reaction_id") REFERENCES "forum_reactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-029 .. SQL-032: Watch closed sets and interval shape
ALTER TABLE public.forum_watch_subscriptions
  ADD CONSTRAINT forum_watch_subscriptions_state_ck
    CHECK (state IN ('active', 'inactive')),
  ADD CONSTRAINT forum_watch_subscriptions_source_ck
    CHECK (source IN ('explicit', 'author', 'mention', 'migration', 'unknown')),
  ADD CONSTRAINT forum_watch_subscriptions_provenance_ck
    CHECK (provenance IN ('runtime', 'migration')),
  ADD CONSTRAINT forum_watch_subscriptions_shape_ck
    CHECK (
      (state = 'active' AND ended_at IS NULL)
      OR
      (state = 'inactive' AND ended_at IS NOT NULL)
    );

-- SQL-033: At most one active interval per thread/principal
CREATE UNIQUE INDEX forum_watch_subscriptions_one_active_uq
ON public.forum_watch_subscriptions(thread_id, principal_id)
WHERE state = 'active' AND ended_at IS NULL;

-- SQL-034 .. SQL-035: Participation closed sets
ALTER TABLE public.forum_participations
  ADD CONSTRAINT forum_participations_fact_state_ck
    CHECK (fact_state IN ('known', 'partial', 'unknown')),
  ADD CONSTRAINT forum_participations_provenance_ck
    CHECK (provenance IN ('runtime', 'migration'));

-- SQL-036 .. SQL-037: Read-state shape and provenance
ALTER TABLE public.forum_read_states
  ADD CONSTRAINT forum_read_states_shape_ck
    CHECK (
      (
        state = 'unknown'
        AND last_read_seq IS NULL
        AND last_read_at IS NULL
      )
      OR
      (
        state = 'known'
        AND last_read_seq = 0
        AND last_read_at IS NULL
      )
      OR
      (
        state = 'known'
        AND last_read_seq > 0
        AND last_read_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT forum_read_states_provenance_ck
    CHECK (provenance IN ('runtime', 'migration'));

-- SQL-038: Defensive read cursor monotonicity guard
CREATE OR REPLACE FUNCTION public.forum_read_cursor_monotonic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'known'
     AND NEW.state = 'unknown' THEN
    RAISE EXCEPTION
      'read state must not regress from known to unknown'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'known'
     AND NEW.state = 'known'
     AND NEW.last_read_seq < OLD.last_read_seq THEN
    RAISE EXCEPTION
      'read cursor must not regress'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- SQL-039: Bind guard to row-level UPDATE only
CREATE TRIGGER forum_read_cursor_monotonic_guard_tg
BEFORE UPDATE
ON public.forum_read_states
FOR EACH ROW
EXECUTE FUNCTION public.forum_read_cursor_monotonic_guard();

-- SQL-040: Notification reason closed set
ALTER TABLE public.forum_notification_facts
  ADD CONSTRAINT forum_notifications_reason_ck
    CHECK (reason IN ('mention', 'watch', 'reaction'));
