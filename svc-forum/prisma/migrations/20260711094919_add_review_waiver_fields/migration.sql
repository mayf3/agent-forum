-- AlterTable
ALTER TABLE "forum_participants" ADD COLUMN     "reviewWaivedAt" TIMESTAMP(3),
ADD COLUMN     "reviewWaivedById" TEXT,
ADD COLUMN     "reviewWaiverReason" TEXT;
