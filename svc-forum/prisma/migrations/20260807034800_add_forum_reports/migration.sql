-- CreateTable
CREATE TABLE "forum_reports" (
    "id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reporter_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handled_by_id" TEXT,
    "handled_by_name" TEXT,
    "handled_at" TIMESTAMP(3),
    "handle_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_reports_target_type_target_id_reporter_id_key" ON "forum_reports"("target_type", "target_id", "reporter_id");

-- CreateIndex
CREATE INDEX "forum_reports_status_idx" ON "forum_reports"("status");

-- CreateIndex
CREATE INDEX "forum_reports_target_type_target_id_idx" ON "forum_reports"("target_type", "target_id");
