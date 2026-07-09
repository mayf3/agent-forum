-- CreateTable
CREATE TABLE "discussion_runs" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "participantOrder" TEXT[],
    "maxRounds" INTEGER NOT NULL DEFAULT 1,
    "maxMessages" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "errorDetail" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT,
    "agentEndpoints" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discussion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_run_steps" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "instruction" TEXT,
    "seq" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "errorDetail" TEXT,
    "resultMessageId" UUID,
    "invokedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discussion_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discussion_runs_idempotencyKey_key" ON "discussion_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "discussion_runs_threadId_idx" ON "discussion_runs"("threadId");

-- CreateIndex
CREATE INDEX "discussion_runs_status_idx" ON "discussion_runs"("status");

-- CreateIndex
CREATE INDEX "discussion_run_steps_runId_idx" ON "discussion_run_steps"("runId");

-- CreateIndex
CREATE INDEX "discussion_run_steps_agentId_idx" ON "discussion_run_steps"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "discussion_run_steps_runId_seq_key" ON "discussion_run_steps"("runId", "seq");

-- AddForeignKey
ALTER TABLE "discussion_runs" ADD CONSTRAINT "discussion_runs_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_run_steps" ADD CONSTRAINT "discussion_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "discussion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
