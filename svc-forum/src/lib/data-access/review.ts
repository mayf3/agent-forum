// review.ts — 审查就绪检测 + 记录转录
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { findParticipantsByThreadId } from './watch.js';
import { findMessagesByThreadId } from './messages.js';
import { findSnapshotsByThreadId } from './threads.js';
import { findLatestOutcomeByThreadId } from './outcomes.js';

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

  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      threadId,
      deletedAt: null,
      kind: { not: 'system' },
    },
    select: { authorId: true, id: true },
  });

  const reviewerStatuses = requiredReviewers.map(r => {
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
