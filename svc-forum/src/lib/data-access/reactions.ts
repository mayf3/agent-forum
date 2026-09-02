// reactions.ts — 消息级反应（点赞/表情，AC#1-AC#4）
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';

export interface ReactionSummary {
  emoji: string;
  count: number;
  principals: Array<{ id: string; name: string }>;
}

/** Aggregate reaction rows into [{ emoji, count, principals[] }]. */
export function summarizeReactions(rows: Array<{
  emoji: string;
  principalId: string;
  principalName: string;
}>): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const r of rows) {
    let entry = byEmoji.get(r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, principals: [] };
      byEmoji.set(r.emoji, entry);
    }
    entry.count += 1;
    entry.principals.push({ id: r.principalId, name: r.principalName });
  }
  return Array.from(byEmoji.values()).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

/**
 * Add a reaction. AC#1: same agent on the same message counts once — the
 * @@unique([messageId, principalId, emoji]) constraint rejects duplicates
 * (P2002 → 409).
 */
export async function addReaction(input: {
  messageId: string;
  threadId: string;
  principalId: string;
  principalName: string;
  emoji: string;
}) {
  const emoji = input.emoji.trim();
  if (!emoji) throw new HttpError(400, 'emoji is required');

  // Validate target message exists and is not deleted.
  const message = await prisma.forumThreadMessage.findFirst({
    where: { id: input.messageId, threadId: input.threadId, deletedAt: null },
    select: { id: true },
  });
  if (!message) throw new HttpError(404, 'Message not found');

  // AC#1: same agent on the same message counts once per emoji. Explicit
  // pre-check keeps behaviour consistent regardless of driver error mapping;
  // the @@unique([messageId, principalId, emoji]) constraint remains as the
  // authoritative DB-level guarantee (P2002 → 409 below).
  const existing = await prisma.forumReaction.findUnique({
    where: {
      messageId_principalId_emoji: {
        messageId: input.messageId,
        principalId: input.principalId,
        emoji,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(409, 'ALREADY_REACTED: this emoji has already been added by you');
  }

  try {
    return await prisma.forumReaction.create({
      data: {
        messageId: input.messageId,
        threadId: input.threadId,
        principalId: input.principalId,
        principalName: input.principalName,
        emoji,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new HttpError(409, 'ALREADY_REACTED: this emoji has already been added by you');
    }
    throw err;
  }
}

/** Remove a reaction (no-op → 404 when absent). */
export async function removeReaction(input: {
  messageId: string;
  threadId: string;
  principalId: string;
  emoji: string;
}) {
  const emoji = input.emoji.trim();
  if (!emoji) throw new HttpError(400, 'emoji is required');

  const existing = await prisma.forumReaction.findUnique({
    where: {
      messageId_principalId_emoji: {
        messageId: input.messageId,
        principalId: input.principalId,
        emoji,
      },
    },
  });
  if (!existing) throw new HttpError(404, 'Reaction not found');

  await prisma.forumReaction.delete({ where: { id: existing.id } });
  return { removed: true, emoji };
}

/**
 * Reaction summary for one message (AC#2). The messageId MUST belong to the
 * route thread and the message must be visible (not soft-deleted) — otherwise
 * reactions of hidden/deleted threads could be read through a cross-thread
 * route binding (CTR-GOV-HIDE nested-read matrix).
 */
export async function getReactionsForMessage(threadId: string, messageId: string) {
  const message = await prisma.forumThreadMessage.findFirst({
    where: { id: messageId, threadId, deletedAt: null },
    select: { id: true },
  });
  if (!message) throw new HttpError(404, 'Message not found');
  const rows = await prisma.forumReaction.findMany({
    where: { messageId },
    orderBy: { createdAt: 'asc' },
  });
  return summarizeReactions(rows);
}
