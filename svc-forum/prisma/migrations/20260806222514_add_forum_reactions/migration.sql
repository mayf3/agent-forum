-- CreateTable
CREATE TABLE "forum_reactions" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "principal_id" TEXT NOT NULL,
    "principal_name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_reactions_message_id_idx" ON "forum_reactions"("message_id");

-- CreateIndex
CREATE INDEX "forum_reactions_thread_id_idx" ON "forum_reactions"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_reactions_message_id_principal_id_emoji_key" ON "forum_reactions"("message_id", "principal_id", "emoji");

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "forum_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
