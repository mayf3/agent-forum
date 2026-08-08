// views.ts — 阅读量追踪（AC#1: viewCount 按 principal 去重计次）
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';

// ── View tracking (AC#1: viewCount dedup per principal) ────────────────────
//
// First view by a principal inserts a ForumThreadView row and increments the
// cached viewCount atomically; repeat views are ignored. Failures never block
// the detail response (best-effort, wrapped by the route).
export async function recordView(threadId: string, principalId: string): Promise<void> {
  if (!isUuid(threadId) || !principalId) return;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumThreadView.findUnique({
        where: { threadId_principalId: { threadId, principalId } },
        select: { id: true },
      });
      if (existing) return; // same principal already counted
      await tx.forumThreadView.create({
        data: { threadId, principalId },
      });
      await tx.forumThread.update({
        where: { id: threadId },
        data: { viewCount: { increment: 1 } },
      });
    });
  } catch {
    // Best-effort: view recording must not fail the detail request (AC#4).
  }
}
