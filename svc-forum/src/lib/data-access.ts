import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { isUuid } from '../utils/uuid.js';

// ── Threads ────────────────────────────────────────────────

export interface CreateThreadInput {
  title: string;
  type: string;
  contextType?: string | null;
  contextId?: string | null;
  pipeline?: string | null;
  layer?: string | null;
  tags?: string[];
  createdById: string;
  createdByName: string;
  createdByType: string;
}

export interface ThreadFilter {
  type?: string;
  status?: string;
  agentId?: string;
  contextType?: string;
  contextId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export async function createThread(data: CreateThreadInput) {
  return prisma.forumThread.create({ data });
}

export async function findThreadById(id: string) {
  if (!isUuid(id)) return null;
  return prisma.forumThread.findUnique({ where: { id } });
}

export async function findThreads(filter: ThreadFilter) {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.ForumThreadWhereInput = {};

  if (filter.type) where.type = filter.type;
  if (filter.status) where.status = filter.status;
  if (filter.contextType) where.contextType = filter.contextType;
  if (filter.contextId) where.contextId = filter.contextId;

  if (filter.agentId) {
    where.participants = { some: { agentId: filter.agentId } };
  }

  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      skip,
      take: limit,
    }),
    prisma.forumThread.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function updateThread(id: string, data: Prisma.ForumThreadUpdateInput) {
  if (!isUuid(id)) throw new Error('Invalid thread id format');
  return prisma.forumThread.update({ where: { id }, data });
}

// ── Messages ───────────────────────────────────────────────

export interface CreateMessageInput {
  threadId: string;
  parentId?: string | null;
  authorId: string;
  authorName: string;
  authorType: string;
  kind: string;
  content: string;
  mentions?: string[];
  attachments?: any;
  metadata?: any;
}

export async function createMessage(data: CreateMessageInput) {
  return prisma.$transaction(async (tx) => {
    // Get next seq
    const lastMsg = await tx.forumThreadMessage.findFirst({
      where: { threadId: data.threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (lastMsg?.seq || 0) + 1;

    const message = await tx.forumThreadMessage.create({
      data: {
        threadId: data.threadId,
        parentId: data.parentId || null,
        seq,
        authorId: data.authorId,
        authorName: data.authorName,
        authorType: data.authorType,
        kind: data.kind,
        content: data.content,
        mentions: data.mentions || [],
        attachments: data.attachments ?? Prisma.JsonNull,
        metadata: data.metadata ?? Prisma.JsonNull,
      },
    });

    // Update thread messageCount and lastMessageAt
    const msgCount = await tx.forumThreadMessage.count({
      where: { threadId: data.threadId, deletedAt: null },
    });
    await tx.forumThread.update({
      where: { id: data.threadId },
      data: { messageCount: msgCount, lastMessageAt: new Date() },
    });

    return message;
  });
}

export async function findMessagesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadMessage.findMany({
    where: { threadId, deletedAt: null },
    orderBy: { seq: 'asc' },
  });
}

export async function softDeleteMessage(id: string) {
  return prisma.forumThreadMessage.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ── Participants ───────────────────────────────────────────

export async function addParticipant(data: {
  threadId: string;
  agentId: string;
  agentName: string;
  role: string;
  status: string;
}) {
  return prisma.forumThreadParticipant.create({ data });
}

export async function findParticipant(threadId: string, agentId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumThreadParticipant.findUnique({
    where: { threadId_agentId: { threadId, agentId } },
  });
}

export async function findParticipantsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadParticipant.findMany({
    where: { threadId, leftAt: null },
  });
}

export async function updateParticipant(id: string, data: Prisma.ForumThreadParticipantUpdateInput) {
  return prisma.forumThreadParticipant.update({ where: { id }, data });
}

export async function softDeleteParticipant(id: string) {
  return prisma.forumThreadParticipant.update({
    where: { id },
    data: { leftAt: new Date() },
  });
}

// ── Context Snapshots ──────────────────────────────────────

export async function createContextSnapshot(data: {
  threadId: string;
  snapshotType: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  excerptMd?: string | null;
  contentHash?: string | null;
  snapshot?: any;
  takenById: string;
  takenByName: string;
  note?: string | null;
}) {
  return prisma.forumContextSnapshot.create({ data });
}

export async function findSnapshotsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumContextSnapshot.findMany({
    where: { threadId },
    orderBy: { takenAt: 'desc' },
  });
}

// ── Outcomes ───────────────────────────────────────────────

export async function createOutcome(data: {
  threadId: string;
  summaryMd: string;
  decisionsJson?: any;
  actionItemsJson?: any;
  rejectedOptionsJson?: any;
  openQuestionsJson?: any;
  writebackTargetType?: string | null;
  writebackTargetRef?: string | null;
  createdById: string;
  createdByName: string;
}) {
  return prisma.forumOutcome.create({ data });
}

export async function findOutcomesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumOutcome.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findLatestOutcomeByThreadId(threadId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumOutcome.findFirst({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Search ─────────────────────────────────────────────────

export async function searchAll(q: string) {
  const threads = await prisma.forumThread.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: 20,
  });

  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  const outcomes = await prisma.forumOutcome.findMany({
    where: {
      summaryMd: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  return { threads, messages, outcomes };
}

// ── Review Readiness ────────────────────────────────────────

export interface ReviewReadinessResult {
  ready: boolean;
  requiredReviewers: Array<{
    agentId: string;
    agentName: string;
    satisfied: boolean;
    satisfiedBy: 'message' | 'waiver' | null;
    messageId?: string;
    waivedAt?: Date;
    waivedById?: string;
    waiverReason?: string;
  }>;
  pendingReviewerIds: string[];
}

export async function getThreadReviewReadiness(threadId: string): Promise<ReviewReadinessResult | null> {
  if (!isUuid(threadId)) return null;
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;

  const allParticipants = await findParticipantsByThreadId(threadId);
  const requiredReviewers = allParticipants.filter(p => p.role === 'required_reviewer');

  if (requiredReviewers.length === 0) {
    return { ready: true, requiredReviewers: [], pendingReviewerIds: [] };
  }

  // Get all non-system messages for this thread
  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      threadId,
      deletedAt: null,
      kind: { not: 'system' },
    },
    select: { authorId: true, id: true },
  });

  const reviewerStatuses = requiredReviewers.map(r => {
    // Check A: reviewer has posted a non-system message
    const message = messages.find(m => m.authorId === r.agentId);
    if (message) {
      return {
        agentId: r.agentId,
        agentName: r.agentName,
        satisfied: true,
        satisfiedBy: 'message' as const,
        messageId: message.id,
      };
    }

    // Check B: reviewer has been waived
    if (r.reviewWaivedAt && r.reviewWaiverReason) {
      return {
        agentId: r.agentId,
        agentName: r.agentName,
        satisfied: true,
        satisfiedBy: 'waiver' as const,
        waivedAt: r.reviewWaivedAt,
        waivedById: r.reviewWaivedById ?? undefined,
        waiverReason: r.reviewWaiverReason,
      };
    }

    return {
      agentId: r.agentId,
      agentName: r.agentName,
      satisfied: false,
      satisfiedBy: null as null,
    };
  });

  const pendingReviewerIds = reviewerStatuses
    .filter(r => !r.satisfied)
    .map(r => r.agentId);

  return {
    ready: pendingReviewerIds.length === 0,
    requiredReviewers: reviewerStatuses,
    pendingReviewerIds,
  };
}

// ── Transcript ─────────────────────────────────────────────

export async function buildTranscriptMd(threadId: string) {
  if (!isUuid(threadId)) return null;
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;

  const participants = await findParticipantsByThreadId(threadId);
  const messages = await findMessagesByThreadId(threadId);
  const snapshots = await findSnapshotsByThreadId(threadId);
  const latestOutcome = await findLatestOutcomeByThreadId(threadId);

  let md = `# ${thread.title}\n\n`;
  md += `**Thread ID:** ${thread.id}\n`;
  md += `**Type:** ${thread.type}  |  **Status:** ${thread.status}\n`;
  md += `**Created by:** ${thread.createdByName} (${thread.createdByType})  |  **Created at:** ${thread.createdAt.toISOString()}\n`;
  if (thread.resolvedAt) {
    md += `**Resolved at:** ${thread.resolvedAt.toISOString()}  |  **Resolved by:** ${thread.resolvedByName || ''}\n`;
  }
  md += `**Messages:** ${thread.messageCount}\n`;
  if (thread.contextType && thread.contextId) {
    md += `**Context:** ${thread.contextType}:${thread.contextId}\n`;
  }
  if (thread.pipeline) md += `**Pipeline:** ${thread.pipeline}\n`;
  if (thread.layer) md += `**Layer:** ${thread.layer}\n`;
  if (thread.tags.length) md += `**Tags:** ${thread.tags.join(', ')}\n`;

  md += '\n## Participants\n\n';
  if (participants.length === 0) {
    md += '*No participants*\n';
  } else {
    for (const p of participants) {
      md += `- **${p.agentName}** (${p.role}) — ${p.status}\n`;
    }
  }

  md += '\n## Context Snapshots\n\n';
  if (snapshots.length === 0) {
    md += '*No context snapshots*\n';
  } else {
    for (const s of snapshots) {
      md += `- **${s.title}** (${s.sourceType}:${s.sourceRef}) — ${s.snapshotType}\n`;
      if (s.excerptMd) md += `  > ${s.excerptMd.replace(/\n/g, '\n  > ')}\n`;
    }
  }

  md += '\n## Messages\n\n';
  if (messages.length === 0) {
    md += '*No messages*\n';
  } else {
    for (const msg of messages) {
      const indent = msg.parentId ? '> ' : '';
      md += `### ${indent}Message #${msg.seq} — ${msg.authorName} (${msg.kind})\n`;
      md += `${indent}*${msg.createdAt.toISOString()}* | authorId: \`${msg.authorId || 'unavailable'}\`\n\n`;
      md += `${indent}${msg.content}\n\n`;
      if (msg.mentions && msg.mentions.length > 0) {
        md += `${indent}*Mentions: ${msg.mentions.join(', ')}*\n\n`;
      }
      if (msg.attachments) {
        md += `${indent}*Attachments: ${JSON.stringify(msg.attachments)}*\n\n`;
      }
    }
  }

  if (latestOutcome) {
    md += '## Outcome\n\n';
    md += `${latestOutcome.summaryMd}\n\n`;
    if (latestOutcome.decisionsJson) {
      md += '### Decisions\n\n';
      const decisions = Array.isArray(latestOutcome.decisionsJson)
        ? latestOutcome.decisionsJson
        : [latestOutcome.decisionsJson];
      for (const d of decisions) {
        md += `- ${typeof d === 'string' ? d : JSON.stringify(d)}\n`;
      }
      md += '\n';
    }
    if (latestOutcome.actionItemsJson) {
      md += '### Action Items\n\n';
      const items = Array.isArray(latestOutcome.actionItemsJson)
        ? latestOutcome.actionItemsJson
        : [latestOutcome.actionItemsJson];
      for (const a of items) {
        md += `- [ ] ${typeof a === 'string' ? a : JSON.stringify(a)}\n`;
      }
      md += '\n';
    }
  }

  return md;
}
