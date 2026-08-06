-- DropForeignKey (idempotent — legacy tables, see note below)
ALTER TABLE "discussion_run_steps" DROP CONSTRAINT IF EXISTS "discussion_run_steps_runId_fkey";

-- DropForeignKey
ALTER TABLE "discussion_runs" DROP CONSTRAINT IF EXISTS "discussion_runs_threadId_fkey";

-- AlterTable
ALTER TABLE "forum_threads" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- DropTable (legacy models removed from schema; IF EXISTS keeps migrations
-- order-independent across sibling feature branches)
DROP TABLE IF EXISTS "discussion_run_steps";

-- DropTable
DROP TABLE IF EXISTS "discussion_runs";

-- CreateTable
CREATE TABLE "forum_thread_views" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "principal_id" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_thread_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_thread_views_threadId_idx" ON "forum_thread_views"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_thread_views_threadId_principal_id_key" ON "forum_thread_views"("threadId", "principal_id");

-- CreateIndex
CREATE INDEX "forum_threads_viewCount_idx" ON "forum_threads"("viewCount");

-- AddForeignKey
ALTER TABLE "forum_thread_views" ADD CONSTRAINT "forum_thread_views_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
