-- AlterTable
ALTER TABLE "discussion_runs" ADD COLUMN     "agentAuthTokens" JSONB,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "authMode" TEXT DEFAULT 'auth-service-token-login',
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "runnerMode" TEXT DEFAULT 'async';
