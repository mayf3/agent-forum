/**
 * Deterministic identity mapping between Forum identities and ADC identities.
 *
 * Rules (strict — no guessing or fuzzy matching):
 *   1. Forum UUID → Forum auth user (via exact UUID match)
 *   2. Forum auth user → ADC user (via exact UUID match)
 *   3. ADC user → ADC user.agentId
 *
 * Categories:
 *   exact                         — chain complete, agentId found
 *   missing-source-agent-id       — ADC user has no agentId set
 *   missing-adc-agent             — Forum UUID not found in ADC users
 *   duplicate-adc-agent-id        — agentId maps to multiple ADC users
 *   multiple-candidate            — Forum UUID maps to multiple ADC users
 *   historical-business-id        — value looks like business-agent-id but no ADC match
 *   unknown                       — cannot classify the identity value
 */

import type { IdentityValue, AdcUser, MappingResult, MappingStatus } from './types.js';
import { classifyIdentity } from './forum-inventory.js';
import { maskUuid } from './adc-inventory.js';

interface MappingContext {
  adcUsers: AdcUser[];
  /** Set of agentIds that are duplicated across ADC users */
  duplicateAdcAgentIds: Set<string>;
}

function buildMappingContext(adcUsers: AdcUser[]): MappingContext {
  const agentIdCount = new Map<string, number>();
  for (const u of adcUsers) {
    if (u.agentId) {
      agentIdCount.set(u.agentId, (agentIdCount.get(u.agentId) || 0) + 1);
    }
  }
  const duplicateAdcAgentIds = new Set<string>();
  for (const [aid, count] of agentIdCount) {
    if (count > 1) duplicateAdcAgentIds.add(aid);
  }
  return { adcUsers, duplicateAdcAgentIds };
}

/**
 * Get a unique set of identity values to map.
 * Deduplicates by value since many records may share the same identity.
 */
function collectUniqueValues(identityValues: IdentityValue[]): { value: string; sources: { table: string; field: string }[] }[] {
  const map = new Map<string, { value: string; sources: { table: string; field: string }[] }>();
  for (const iv of identityValues) {
    if (iv.category === 'empty') continue;
    if (!map.has(iv.value)) {
      map.set(iv.value, { value: iv.value, sources: [] });
    }
    map.get(iv.value)!.sources.push({ table: iv.table, field: iv.field });
  }
  return Array.from(map.values());
}

/**
 * Map a single identity value to ADC.
 */
function mapValue(
  value: string,
  ctx: MappingContext,
): { status: MappingStatus; mappedToAgentId?: string; note?: string } {
  const category = classifyIdentity(value);

  if (category === 'unknown') {
    return { status: 'unknown', note: 'Cannot classify identity value' };
  }

  if (category === 'business-agent-id') {
    // Check if this agentId exists in ADC
    const matches = ctx.adcUsers.filter(u => u.agentId === value);
    if (matches.length === 0) {
      return { status: 'historical-business-id', note: 'agentId not found in ADC users' };
    }
    if (matches.length > 1) {
      return {
        status: 'duplicate-adc-agent-id',
        mappedToAgentId: value,
        note: `agentId maps to ${matches.length} ADC users: ${matches.map(m => maskUuid(m.id)).join(', ')}`,
      };
    }
    return { status: 'exact', mappedToAgentId: value };
  }

  // UUID category: try to find in ADC users
  const matches = ctx.adcUsers.filter(u => u.id === value);
  if (matches.length === 0) {
    return { status: 'missing-adc-agent', note: 'UUID not found in ADC users' };
  }
  if (matches.length > 1) {
    return {
      status: 'multiple-candidate',
      note: `UUID maps to ${matches.length} ADC users`,
    };
  }

  const user = matches[0];
  if (!user.agentId || user.agentId.trim() === '') {
    return { status: 'missing-source-agent-id', note: `ADC user ${maskUuid(user.id)} has no agentId` };
  }

  if (ctx.duplicateAdcAgentIds.has(user.agentId)) {
    return { status: 'duplicate-adc-agent-id', mappedToAgentId: user.agentId, note: 'agentId is duplicated in ADC' };
  }

  return { status: 'exact', mappedToAgentId: user.agentId };
}

export interface MappingSummary {
  results: MappingResult[];
  exactCount: number;
  missingSourceAgentIdCount: number;
  missingAdcCount: number;
  duplicateCount: number;
  multipleCandidateCount: number;
  historicalCount: number;
  unknownCount: number;
  totalMapped: number;
}

/**
 * Run deterministic mapping between all unique Forum identity values and ADC users.
 */
export function runMapping(
  identityValues: IdentityValue[],
  adcUsers: AdcUser[],
): MappingSummary {
  const ctx = buildMappingContext(adcUsers);
  const uniqueValues = collectUniqueValues(identityValues);

  const results: MappingResult[] = [];
  let exactCount = 0;
  let missingSourceAgentIdCount = 0;
  let missingAdcCount = 0;
  let duplicateCount = 0;
  let multipleCandidateCount = 0;
  let historicalCount = 0;
  let unknownCount = 0;

  for (const uv of uniqueValues) {
    const { status, mappedToAgentId, note } = mapValue(uv.value, ctx);

    const result: MappingResult = {
      forumIdentityValue: uv.value.length > 40 ? uv.value.slice(0, 8) + '...' + uv.value.slice(-4) : uv.value,
      forumTable: uv.sources[0]?.table || '',
      forumField: uv.sources[0]?.field || '',
      mappingStatus: status,
      mappedToAgentId,
      note,
    };
    results.push(result);

    switch (status) {
      case 'exact': exactCount++; break;
      case 'missing-source-agent-id': missingSourceAgentIdCount++; break;
      case 'missing-adc-agent': missingAdcCount++; break;
      case 'duplicate-adc-agent-id': duplicateCount++; break;
      case 'multiple-candidate': multipleCandidateCount++; break;
      case 'historical-business-id': historicalCount++; break;
      case 'unknown': unknownCount++; break;
    }
  }

  return {
    results,
    exactCount,
    missingSourceAgentIdCount,
    missingAdcCount,
    duplicateCount,
    multipleCandidateCount,
    historicalCount,
    unknownCount,
    totalMapped: uniqueValues.length,
  };
}
