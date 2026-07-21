-- CreateTable
CREATE TABLE "forum_threads" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'discussion',
    "status" TEXT NOT NULL DEFAULT 'open',
    "contextType" TEXT,
    "contextId" TEXT,
    "pipeline" TEXT,
    "layer" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdByType" TEXT NOT NULL DEFAULT 'agent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_participants" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "forum_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "parentId" UUID,
    "seq" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorType" TEXT NOT NULL DEFAULT 'agent',
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "content" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachments" JSONB,
    "metadata" JSONB,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_context_snapshots" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "snapshotType" TEXT NOT NULL DEFAULT 'thread_creation',
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerptMd" TEXT,
    "contentHash" TEXT,
    "snapshot" JSONB,
    "takenById" TEXT NOT NULL,
    "takenByName" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "forum_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_outcomes" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "summaryMd" TEXT NOT NULL,
    "decisionsJson" JSONB,
    "actionItemsJson" JSONB,
    "rejectedOptionsJson" JSONB,
    "openQuestionsJson" JSONB,
    "writebackTargetType" TEXT,
    "writebackTargetRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_threads_status_idx" ON "forum_threads"("status");

-- CreateIndex
CREATE INDEX "forum_threads_type_idx" ON "forum_threads"("type");

-- CreateIndex
CREATE INDEX "forum_threads_contextType_contextId_idx" ON "forum_threads"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "forum_threads_pipeline_idx" ON "forum_threads"("pipeline");

-- CreateIndex
CREATE INDEX "forum_threads_lastMessageAt_idx" ON "forum_threads"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "forum_participants_threadId_agentId_key" ON "forum_participants"("threadId", "agentId");

-- CreateIndex
CREATE INDEX "forum_messages_threadId_seq_idx" ON "forum_messages"("threadId", "seq");

-- CreateIndex
CREATE INDEX "forum_messages_threadId_createdAt_idx" ON "forum_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "forum_messages_authorId_idx" ON "forum_messages"("authorId");

-- CreateIndex
CREATE INDEX "forum_messages_kind_idx" ON "forum_messages"("kind");

-- CreateIndex
CREATE INDEX "forum_messages_parentId_idx" ON "forum_messages"("parentId");

-- CreateIndex
CREATE INDEX "forum_context_snapshots_threadId_idx" ON "forum_context_snapshots"("threadId");

-- CreateIndex
CREATE INDEX "forum_context_snapshots_sourceType_sourceRef_idx" ON "forum_context_snapshots"("sourceType", "sourceRef");

-- CreateIndex
CREATE INDEX "forum_outcomes_threadId_idx" ON "forum_outcomes"("threadId");

-- AddForeignKey
ALTER TABLE "forum_participants" ADD CONSTRAINT "forum_participants_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_messages" ADD CONSTRAINT "forum_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_context_snapshots" ADD CONSTRAINT "forum_context_snapshots_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_outcomes" ADD CONSTRAINT "forum_outcomes_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
