/**
 * ADC user database identity inventory.
 *
 * Reads user/agent identity data from the ADC database.
 * Only queries the `users` table — no writes, no schema changes.
 *
 * UUIDs are masked in console output (first 8 + last 4 chars) for privacy.
 * Full UUIDs are only written to local report files.
 */

import { PrismaClient } from '@prisma/client';
import type { AdcUser, AdcInventory } from './types.js';

/** Mask a UUID for safe console display: 550e8400-...-1234 */
export function maskUuid(uuid: string): string {
  if (!uuid || uuid.length < 36) return '(invalid)';
  return uuid.slice(0, 8) + '...' + uuid.slice(-4);
}

const SPECIFIC_AGENT_NAMES = ['blog-agent', 'writing-style-analyst', 'lobster-partner'];

async function queryAllUsers(prisma: PrismaClient): Promise<AdcUser[]> {
  // Try common column names for the users table
  const columnSets = [
    ['id', 'name', 'role', 'agent_id'],
    ['id', 'name', 'role', 'agentId'],
    ['id', 'username', 'role', 'agent_id'],
    ['id', 'display_name', 'role', 'agent_id'],
    ['id', 'name', 'role', 'business_agent_id'],
  ];

  for (const cols of columnSets) {
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM users LIMIT 1000`,
      );
      if (rows.length > 0 || true) {
        // Found the table, map columns
        return rows.map((r: any) => ({
          id: String(r[cols[0]] || ''),
          name: String(r[cols[1]] || ''),
          role: String(r[cols[2]] || ''),
          agentId: r[cols[3]] ? String(r[cols[3]]) : null,
        }));
      }
    } catch {
      // Try next column set
    }
  }

  // Last resort: try without specific column names
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM users LIMIT 1000`);
    // Use first matching columns
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    const idCol = cols.find(c => c.toLowerCase() === 'id') || cols[0];
    const nameCol = cols.find(c => c.toLowerCase().includes('name') || c.toLowerCase().includes('user')) || cols[1] || idCol;
    const roleCol = cols.find(c => c.toLowerCase() === 'role') || '';
    const agentIdCol = cols.find(c => c.toLowerCase().includes('agent_id') || c.toLowerCase().includes('agentid'));
    return rows.map((r: any) => ({
      id: String(r[idCol] || ''),
      name: String(r[nameCol] || ''),
      role: roleCol ? String(r[roleCol] || '') : '',
      agentId: agentIdCol ? (r[agentIdCol] ? String(r[agentIdCol]) : null) : null,
    }));
  } catch {
    throw new Error(
      'Could not query ADC users table. Ensure ADC_DATABASE_URL points to a PostgreSQL database with a users table.',
    );
  }
}

export async function scanAdcIdentities(prisma: PrismaClient): Promise<AdcInventory> {
  const users = await queryAllUsers(prisma);

  const totalUsers = users.length;
  const roleAgent = users.filter(u => u.role === 'agent');
  const roleAgentCount = roleAgent.length;
  const agentIdPopulated = roleAgent.filter(u => u.agentId !== null && u.agentId.trim() !== '').length;
  const agentIdMissing = roleAgentCount - agentIdPopulated;

  // Find duplicate agentIds
  const agentIdMap = new Map<string, string[]>();
  for (const u of roleAgent) {
    if (u.agentId && u.agentId.trim()) {
      const aid = u.agentId.trim();
      if (!agentIdMap.has(aid)) agentIdMap.set(aid, []);
      agentIdMap.get(aid)!.push(u.id);
    }
  }

  const duplicateAgentIds: { agentId: string; userIds: string[] }[] = [];
  const sameAgentIdMultipleUuids: { agentId: string; uuids: string[] }[] = [];
  for (const [aid, uuids] of agentIdMap) {
    if (uuids.length > 1) {
      duplicateAgentIds.push({ agentId: aid, userIds: uuids });
      // Check if same agentId has multiple different UUIDs
      const uniqueUuids = [...new Set(uuids)];
      if (uniqueUuids.length > 1) {
        sameAgentIdMultipleUuids.push({ agentId: aid, uuids: uniqueUuids });
      }
    }
  }

  // Check specific agents
  const specificAgents: { name: string; id: string; agentId: string | null }[] = [];
  for (const name of SPECIFIC_AGENT_NAMES) {
    const matches = users.filter(
      u => u.name === name || u.name?.toLowerCase().includes(name) || u.agentId === name,
    );
    if (matches.length === 0) {
      specificAgents.push({ name, id: '(not found)', agentId: null });
    } else {
      for (const m of matches) {
        specificAgents.push({ name, id: m.id, agentId: m.agentId });
      }
    }
  }

  return {
    totalUsers,
    roleAgentCount,
    agentIdPopulated,
    agentIdMissing,
    duplicateAgentIds,
    sameAgentIdMultipleUuids,
    specificAgents,
    users,
  };
}
