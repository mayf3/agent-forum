/**
 * Forum database identity inventory.
 *
 * Reads identity fields from all Forum tables via Prisma raw queries.
 * Classifies each value as UUID, business-agent-id, empty/null, or unknown.
 * Detects mixed-identity threads and participant/message mismatches.
 *
 * WRITE OPERATIONS: ZERO. This file never calls CREATE, UPDATE, or DELETE.
 */

import { PrismaClient } from '@prisma/client';
import type { IdentityCategory, IdentityValue, ForumIdentityField, MixedIdentityThread, ParticipantMessageMismatch } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

export function classifyIdentity(value: string | null | undefined): IdentityCategory {
  if (!value || value.trim() === '') return 'empty';
  const trimmed = value.trim();
  if (UUID_PATTERN.test(trimmed)) return 'uuid';
  if (AGENT_ID_PATTERN.test(trimmed)) return 'business-agent-id';
  return 'unknown';
}

interface FieldDef {
  table: string;
  column: string;
}

const IDENTITY_FIELDS: FieldDef[] = [
  { table: 'forum_threads', column: 'createdById' },
  { table: 'forum_threads', column: 'resolvedById' },
  { table: 'forum_participants', column: 'agentId' },
  { table: 'forum_participants', column: 'reviewWaivedById' },
  { table: 'forum_messages', column: 'authorId' },
  { table: 'forum_context_snapshots', column: 'takenById' },
  { table: 'forum_outcomes', column: 'createdById' },
  { table: 'discussion_run_steps', column: 'agentId' },
];

async function queryFieldValues(prisma: PrismaClient, field: FieldDef): Promise<IdentityValue[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id AS "recordId", ${field.column} AS "value" FROM ${field.table} WHERE ${field.column} IS NOT NULL AND ${field.column} != '' LIMIT 10000`,
  );
  return rows.map((r: any) => ({
    value: String(r.value),
    category: classifyIdentity(String(r.value)),
    table: field.table,
    field: field.column,
    recordId: String(r.recordId),
  }));
}

async function countFieldStats(prisma: PrismaClient, field: FieldDef): Promise<{
  totalCount: number;
  distinctCount: number;
  uuidCount: number;
  businessAgentIdCount: number;
  emptyCount: number;
  unknownCount: number;
}> {
  const totalRow: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS cnt FROM ${field.table}`,
  );
  const totalCount = Number(totalRow[0]?.cnt || 0);

  const distinctRow: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT ${field.column}) AS cnt FROM ${field.table} WHERE ${field.column} IS NOT NULL AND ${field.column} != ''`,
  );
  const distinctCount = Number(distinctRow[0]?.cnt || 0);

  const nullRow: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS cnt FROM ${field.table} WHERE ${field.column} IS NULL OR ${field.column} = ''`,
  );
  const emptyCount = Number(nullRow[0]?.cnt || 0);

  // Get all non-empty values to classify
  const valueRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT ${field.column} AS v FROM ${field.table} WHERE ${field.column} IS NOT NULL AND ${field.column} != ''`,
  );
  let uuidCount = 0;
  let businessAgentIdCount = 0;
  let unknownCount = 0;
  for (const r of valueRows) {
    const cat = classifyIdentity(String(r.v));
    if (cat === 'uuid') uuidCount++;
    else if (cat === 'business-agent-id') businessAgentIdCount++;
    else unknownCount++;
  }

  return { totalCount, distinctCount, uuidCount, businessAgentIdCount, emptyCount, unknownCount };
}

async function findMixedIdentityThreads(prisma: PrismaClient): Promise<MixedIdentityThread[]> {
  // Find threads where participants have both UUID and non-UUID agentId
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT p."threadId", t.title, p."agentId"
    FROM forum_participants p
    JOIN forum_threads t ON t.id = p."threadId"
    WHERE p."agentId" IS NOT NULL AND p."agentId" != ''
  `);

  // Group by thread
  const threadMap = new Map<string, { threadId: string; title: string; values: Set<string> }>();
  for (const r of rows) {
    const tid = String(r.threadId);
    if (!threadMap.has(tid)) {
      threadMap.set(tid, { threadId: tid, title: String(r.title || ''), values: new Set() });
    }
    threadMap.get(tid)!.values.add(String(r.agentId));
  }

  const mixed: MixedIdentityThread[] = [];
  for (const [, info] of threadMap) {
    const categories = new Set<IdentityCategory>();
    const identityValues: { source: string; value: string; category: IdentityCategory }[] = [];
    for (const val of info.values) {
      const cat = classifyIdentity(val);
      categories.add(cat);
      identityValues.push({ source: 'participant.agentId', value: val, category: cat });
    }
    if (categories.size > 1) {
      mixed.push({ threadId: info.threadId, threadTitle: info.title, identityValues });
    }
  }

  // Also check messages for mixed authorIds within same thread
  const msgRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT m."threadId", t.title, m."authorId"
    FROM forum_messages m
    JOIN forum_threads t ON t.id = m."threadId"
    WHERE m."authorId" IS NOT NULL AND m."authorId" != ''
    ORDER BY m."threadId"
  `);

  const msgThreadMap = new Map<string, Set<string>>();
  for (const r of msgRows) {
    const tid = String(r.threadId);
    if (!msgThreadMap.has(tid)) msgThreadMap.set(tid, new Set());
    msgThreadMap.get(tid)!.add(String(r.authorId));
  }

  for (const [, info] of threadMap) {
    const msgVals = msgThreadMap.get(info.threadId);
    if (!msgVals) continue;
    const msgCategories = new Set<IdentityCategory>();
    const msgIdentityValues: { source: string; value: string; category: IdentityCategory }[] = [];
    for (const val of msgVals) {
      const cat = classifyIdentity(val);
      msgCategories.add(cat);
      msgIdentityValues.push({ source: 'message.authorId', value: val, category: cat });
    }
    if (msgCategories.size > 1) {
      const existing = mixed.find(m => m.threadId === info.threadId);
      if (existing) {
        existing.identityValues.push(...msgIdentityValues);
      } else {
        mixed.push({
          threadId: info.threadId,
          threadTitle: info.title,
          identityValues: msgIdentityValues,
        });
      }
    }
  }

  return mixed;
}

async function findParticipantMessageMismatches(prisma: PrismaClient): Promise<ParticipantMessageMismatch[]> {
  // Find threads where participant agentId doesn't match any message authorId in the same thread
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT p."threadId", t.title, p."agentId"
    FROM forum_participants p
    JOIN forum_threads t ON t.id = p."threadId"
    WHERE p."agentId" IS NOT NULL AND p."agentId" != ''
    ORDER BY p."threadId"
  `);

  const result: ParticipantMessageMismatch[] = [];
  for (const r of rows) {
    const tid = String(r.threadId);
    const agentId = String(r.agentId);

    const msgRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "authorId" FROM forum_messages WHERE "threadId" = $1 AND "authorId" IS NOT NULL AND "authorId" != ''`,
      tid,
    );
    const authorIds = msgRows.map((m: any) => String(m.authorId));

    if (authorIds.length > 0 && !authorIds.includes(agentId)) {
      const existing = result.find(m => m.threadId === tid);
      if (existing) {
        if (!existing.participantAgentId.includes(agentId)) {
          existing.participantAgentId += ',' + agentId;
        }
      } else {
        result.push({
          threadId: tid,
          threadTitle: String(r.title || ''),
          participantAgentId: agentId,
          messageAuthorIds: authorIds,
        });
      }
    }
  }

  return result;
}

export interface ForumInventoryResult {
  fields: ForumIdentityField[];
  mixedIdentityThreads: MixedIdentityThread[];
  participantMessageMismatches: ParticipantMessageMismatch[];
  totalIdentityValues: number;
}

export async function scanForumIdentities(prisma: PrismaClient): Promise<ForumInventoryResult> {
  const fields: ForumIdentityField[] = [];

  for (const fieldDef of IDENTITY_FIELDS) {
    const [samples, stats] = await Promise.all([
      queryFieldValues(prisma, fieldDef),
      countFieldStats(prisma, fieldDef),
    ]);

    fields.push({
      table: fieldDef.table,
      column: fieldDef.column,
      sample: samples.slice(0, 10),
      ...stats,
    });
  }

  const [mixedIdentityThreads, participantMessageMismatches] = await Promise.all([
    findMixedIdentityThreads(prisma),
    findParticipantMessageMismatches(prisma),
  ]);

  const totalIdentityValues = fields.reduce((sum, f) => sum + f.totalCount, 0);

  return { fields, mixedIdentityThreads, participantMessageMismatches, totalIdentityValues };
}
