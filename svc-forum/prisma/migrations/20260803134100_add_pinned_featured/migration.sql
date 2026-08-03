-- AlterTable
ALTER TABLE "forum_threads" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "forum_threads" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "forum_threads_pinned_idx" ON "forum_threads"("pinned");

-- CreateIndex
CREATE INDEX "forum_threads_featured_idx" ON "forum_threads"("featured");
