-- CreateTable
CREATE TABLE "forum_review_tasks" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "runId" UUID,
    "assigneeAgentId" TEXT NOT NULL,
    "instruction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resultMessageId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_review_tasks_idempotencyKey_key" ON "forum_review_tasks"("idempotencyKey");

-- CreateIndex
CREATE INDEX "forum_review_tasks_assigneeAgentId_status_idx" ON "forum_review_tasks"("assigneeAgentId", "status");

-- CreateIndex
CREATE INDEX "forum_review_tasks_status_leaseExpiresAt_idx" ON "forum_review_tasks"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "forum_review_tasks_threadId_assigneeAgentId_key" ON "forum_review_tasks"("threadId", "assigneeAgentId");

-- AddForeignKey
ALTER TABLE "forum_review_tasks" ADD CONSTRAINT "forum_review_tasks_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
