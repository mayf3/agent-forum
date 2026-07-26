/**
 * Dry-run report generator.
 *
 * Assembles all inventory and mapping data into a structured report.
 * Determines CAN_SWITCH based on strict criteria.
 *
 * WRITE OPERATIONS: ZERO. Pure aggregation.
 */

import type { DryRunReport, ForumIdentityField, MixedIdentityThread, ParticipantMessageMismatch, MappingResult } from './types.js';
import type { ForumInventoryResult } from './forum-inventory.js';
import type { AdcInventory } from './adc-inventory.js';
import type { MappingSummary } from './mapping.js';

/**
 * Determine whether it is safe to switch to business-agent-id mode.
 *
 * Returns true only when ALL of the following are satisfied:
 *   1. All active required reviewers can be exact-mapped.
 *   2. All active agent participants have unique agentId.
 *   3. No duplicate agentIds in ADC.
 *   4. No active thread has participant/message identity mismatch.
 *   5. Core agent accounts (blog-agent, writing-style-analyst, etc.) are complete.
 */
function evaluateCanSwitch(
  forumResult: ForumInventoryResult,
  adcInventory: AdcInventory,
  mappingSummary: MappingSummary,
  risks: string[],
): boolean {
  // Condition 3: No duplicate agentIds
  if (adcInventory.duplicateAgentIds.length > 0) {
    risks.push(`Duplicate agentIds in ADC: ${adcInventory.duplicateAgentIds.map(d => d.agentId).join(', ')}`);
    return false;
  }

  // Condition 4: No participant/message mismatches
  if (forumResult.participantMessageMismatches.length > 0) {
    risks.push(`${forumResult.participantMessageMismatches.length} thread(s) have participant/message identity mismatch`);
    return false;
  }

  // Condition 5: Core agent accounts
  const criticalMissing = adcInventory.specificAgents.filter(a => !a.agentId);
  if (criticalMissing.length > 0) {
    for (const a of criticalMissing) {
      risks.push(`Core agent "${a.name}" is missing agentId (ADC id: ${a.id})`);
    }
    return false;
  }

  // Condition 1: All mappings should be exact (this is the strongest check)
  if (mappingSummary.exactCount < mappingSummary.totalMapped) {
    const issues: string[] = [];
    if (mappingSummary.missingSourceAgentIdCount > 0) issues.push(`${mappingSummary.missingSourceAgentIdCount} missing source agentId`);
    if (mappingSummary.missingAdcCount > 0) issues.push(`${mappingSummary.missingAdcCount} missing ADC agent`);
    if (mappingSummary.duplicateCount > 0) issues.push(`${mappingSummary.duplicateCount} duplicate agentId`);
    if (mappingSummary.multipleCandidateCount > 0) issues.push(`${mappingSummary.multipleCandidateCount} multiple candidates`);
    if (mappingSummary.historicalCount > 0) issues.push(`${mappingSummary.historicalCount} historical business IDs`);
    if (mappingSummary.unknownCount > 0) issues.push(`${mappingSummary.unknownCount} unknown identities`);
    risks.push(`Non-exact mappings found: ${issues.join('; ')}`);
    return false;
  }

  // Condition 2: Check for mixed identity threads
  if (forumResult.mixedIdentityThreads.length > 0) {
    risks.push(`${forumResult.mixedIdentityThreads.length} thread(s) have mixed identity types`);
    return false;
  }

  return true;
}

export function buildReport(
  forumResult: ForumInventoryResult,
  adcInventory: AdcInventory,
  mappingSummary: MappingSummary,
): DryRunReport {
  const risks: string[] = [];

  const totalUuidFields = forumResult.fields.reduce((sum, f) => sum + f.uuidCount, 0);
  const totalBizAgentFields = forumResult.fields.reduce((sum, f) => sum + f.businessAgentIdCount, 0);
  const totalEmptyFields = forumResult.fields.reduce((sum, f) => sum + f.emptyCount, 0);
  const totalUnknownFields = forumResult.fields.reduce((sum, f) => sum + f.unknownCount, 0);

  const canSwitch = evaluateCanSwitch(forumResult, adcInventory, mappingSummary, risks);

  if (mappingSummary.missingSourceAgentIdCount > 0) {
    risks.push(`${mappingSummary.missingSourceAgentIdCount} UUID(s) map to ADC users without agentId`);
  }
  if (mappingSummary.missingAdcCount > 0) {
    risks.push(`${mappingSummary.missingAdcCount} UUID(s) not found in ADC users database`);
  }

  return {
    generatedAt: new Date().toISOString(),
    identityMode: 'legacy-sub',
    forumInventory: {
      totalIdentityValues: forumResult.totalIdentityValues,
      fields: forumResult.fields,
      mixedIdentityThreads: forumResult.mixedIdentityThreads,
      participantMessageMismatches: forumResult.participantMessageMismatches,
    },
    adcInventory,
    mappingResults: mappingSummary.results,
    risks,
    canSwitch,
    summary: {
      totalForumIdentities: forumResult.totalIdentityValues,
      uuidIdentities: totalUuidFields,
      businessAgentIds: totalBizAgentFields,
      emptyNullIdentities: totalEmptyFields,
      unknownIdentities: totalUnknownFields,
      exactMappings: mappingSummary.exactCount,
      missingAgentIdMappings: mappingSummary.missingSourceAgentIdCount,
      missingAdcMappings: mappingSummary.missingAdcCount,
      duplicateMappings: mappingSummary.duplicateCount,
      mixedThreadCount: forumResult.mixedIdentityThreads.length,
      mismatchCount: forumResult.participantMessageMismatches.length,
      totalActiveReviewers: 0, // Would need thread status analysis
      mappableReviewers: 0,
      canSwitch,
    },
  };
}

/**
 * Print a human-readable summary to console.
 * No passwords, tokens, or full UUIDs are printed.
 */
export function printSummary(report: DryRunReport): void {
  const s = report.summary;
  console.log('\n══════════════════════════════════════════════');
  console.log('  ADC ↔ Forum Identity Mapping Dry-Run Report');
  console.log('══════════════════════════════════════════════');
  console.log(`  Generated:        ${report.generatedAt}`);
  console.log(`  Identity Mode:    ${report.identityMode}`);
  console.log(`  CAN_SWITCH:       ${report.canSwitch ? '✅ YES' : '❌ NO'}`);
  console.log('');
  console.log('── Forum Identities ──');
  console.log(`  Total values:     ${s.totalForumIdentities}`);
  console.log(`  UUID values:      ${s.uuidIdentities}`);
  console.log(`  Business agentId: ${s.businessAgentIds}`);
  console.log(`  Empty/null:       ${s.emptyNullIdentities}`);
  console.log(`  Unknown:          ${s.unknownIdentities}`);
  console.log('');

  if (report.forumInventory.fields.length > 0) {
    console.log('── Per-Field Breakdown ──');
    for (const f of report.forumInventory.fields) {
      console.log(`  ${f.table}.${f.column}`);
      console.log(`    Total: ${f.totalCount} | UUID: ${f.uuidCount} | BizID: ${f.businessAgentIdCount} | Empty: ${f.emptyCount} | Unknown: ${f.unknownCount}`);
    }
    console.log('');
  }

  console.log('── ADC Users ──');
  console.log(`  Total users:      ${report.adcInventory.totalUsers}`);
  console.log(`  role=agent:       ${report.adcInventory.roleAgentCount}`);
  console.log(`  agentId set:      ${report.adcInventory.agentIdPopulated}`);
  console.log(`  agentId missing:  ${report.adcInventory.agentIdMissing}`);

  if (report.adcInventory.duplicateAgentIds.length > 0) {
    console.log(`  Duplicate IDs:    ${report.adcInventory.duplicateAgentIds.length}`);
    for (const d of report.adcInventory.duplicateAgentIds) {
      console.log(`    - "${d.agentId}" used by ${d.userIds.length} users`);
    }
  }
  console.log('');

  console.log('── Mapping Results ──');
  console.log(`  Total mapped:     ${s.totalForumIdentities}`);
  console.log(`  Exact:            ${s.exactMappings}`);
  console.log(`  Missing agentId:  ${s.missingAgentIdMappings}`);
  console.log(`  Missing ADC:      ${s.missingAdcMappings}`);
  console.log(`  Duplicate:        ${s.duplicateMappings}`);
  console.log('');

  if (report.forumInventory.mixedIdentityThreads.length > 0) {
    console.log(`  ⚠️  Mixed identity threads: ${report.forumInventory.mixedIdentityThreads.length}`);
    for (const m of report.forumInventory.mixedIdentityThreads.slice(0, 5)) {
      console.log(`    - Thread ${m.threadId.slice(0, 8)}...: ${m.identityValues.map(v => `${v.source}=${v.value.slice(0, 12)}...`).join(', ')}`);
    }
    if (report.forumInventory.mixedIdentityThreads.length > 5) {
      console.log(`    ... and ${report.forumInventory.mixedIdentityThreads.length - 5} more`);
    }
    console.log('');
  }

  if (report.forumInventory.participantMessageMismatches.length > 0) {
    console.log(`  ⚠️  Participant/message mismatches: ${report.forumInventory.participantMessageMismatches.length}`);
    console.log('');
  }

  if (report.risks.length > 0) {
    console.log('── Risks ──');
    for (const r of report.risks) {
      console.log(`  ⚠️  ${r}`);
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════');
  console.log(`  CAN_SWITCH = ${report.canSwitch}`);
  console.log('══════════════════════════════════════════════\n');
}
