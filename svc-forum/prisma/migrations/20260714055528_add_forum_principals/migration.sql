-- CreateTable
CREATE TABLE "forum_principals" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "principalType" TEXT NOT NULL DEFAULT 'agent',
    "agent_id" TEXT,
    "displayName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'jit',
    "status" TEXT NOT NULL DEFAULT 'active',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_principals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_principals_auth_subject_key" ON "forum_principals"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "forum_principals_agent_id_key" ON "forum_principals"("agent_id");

-- CreateIndex
CREATE INDEX "forum_principals_status_idx" ON "forum_principals"("status");

-- CreateIndex
CREATE INDEX "forum_principals_principalType_idx" ON "forum_principals"("principalType");
