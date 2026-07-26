#!/usr/bin/env tsx
/**
 * Identity Mapping Dry-Run Tool.
 *
 * Reads identity data from Forum and ADC databases, produces a mapping report.
 * NEVER writes to any database. NEVER modifies schema. READ ONLY.
 *
 * Usage:
 *   FORUM_DATABASE_URL=postgresql://... ADC_DATABASE_URL=postgresql://... \
 *     npx tsx scripts/identity-dry-run/index.ts
 *
 * Output:
 *   - Console: human-readable summary (masked UUIDs, no secrets)
 *   - File:    .local-reports/identity-dry-run-{timestamp}.json (full report)
 *
 * Environment:
 *   FORUM_DATABASE_URL    — PostgreSQL URL for the Forum database (default: local dev)
 *   ADC_DATABASE_URL      — PostgreSQL URL for the ADC users database (required)
 *   OUTPUT_DIR            — Report output directory (default: .local-reports)
 */

import { PrismaClient } from '@prisma/client';
import { scanForumIdentities } from './forum-inventory.js';
import { scanAdcIdentities } from './adc-inventory.js';
import { runMapping } from './mapping.js';
import { buildReport, printSummary } from './report.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main() {
  const forumDbUrl = process.env.FORUM_DATABASE_URL;
  const adcDbUrl = process.env.ADC_DATABASE_URL;
  const outputDir = process.env.OUTPUT_DIR || resolve(process.cwd(), '.local-reports');

  if (!adcDbUrl) {
    console.error('❌ ADC_DATABASE_URL is required. Set it to the ADC PostgreSQL database URL.');
    process.exit(1);
  }

  if (!forumDbUrl) {
    console.error('❌ FORUM_DATABASE_URL is required. Set it to the Forum PostgreSQL database URL.');
    process.exit(1);
  }

  console.log('🔍 Identity Mapping Dry-Run');
  console.log(`   Forum DB: ${forumDbUrl.replace(/\/\/.*@/, '//***@')}`);
  console.log(`   ADC DB:   ${adcDbUrl.replace(/\/\/.*@/, '//***@')}`);
  console.log(`   Output:   ${outputDir}/\n`);

  const forumPrisma = new PrismaClient({ datasources: { db: { url: forumDbUrl } } });
  const adcPrisma = new PrismaClient({ datasources: { db: { url: adcDbUrl } } });

  try {
    // Phase 1: Forum identity scan
    console.log('📊 Phase 1: Scanning Forum identities...');
    const forumResult = await scanForumIdentities(forumPrisma);
    console.log(`   Found ${forumResult.totalIdentityValues} identity values across ${forumResult.fields.length} fields`);
    console.log(`   Mixed-identity threads: ${forumResult.mixedIdentityThreads.length}`);
    console.log(`   Participant/message mismatches: ${forumResult.participantMessageMismatches.length}\n`);

    // Phase 2: ADC identity scan
    console.log('📊 Phase 2: Scanning ADC identities...');
    const adcInventory = await scanAdcIdentities(adcPrisma);
    console.log(`   Found ${adcInventory.totalUsers} users, ${adcInventory.roleAgentCount} agents`);
    console.log(`   Agent IDs populated: ${adcInventory.agentIdPopulated}, missing: ${adcInventory.agentIdMissing}`);
    if (adcInventory.duplicateAgentIds.length > 0) {
      console.log(`   ⚠️  Duplicate agentIds: ${adcInventory.duplicateAgentIds.length}`);
    }
    console.log('');

    // Phase 3: Collect all distinct Forum identity values for mapping
    console.log('📊 Phase 3: Collecting distinct identity values for mapping...');
    const allFieldValues = await scanAllFieldValues(forumPrisma);
    console.log(`   Collected ${allFieldValues.length} distinct identity values\n`);

    // Phase 4: Run deterministic mapping
    console.log('📊 Phase 4: Running deterministic mapping...');
    const mappingSummary = runMapping(
      allFieldValues.map(v => ({
        value: v.value,
        category: 'uuid' as const,
        table: v.table,
        field: v.field,
        recordId: '',
      })),
      adcInventory.users,
    );
    console.log(`   Exact: ${mappingSummary.exactCount}`);
    console.log(`   Missing agentId: ${mappingSummary.missingSourceAgentIdCount}`);
    console.log(`   Missing ADC: ${mappingSummary.missingAdcCount}`);
    console.log(`   Duplicate: ${mappingSummary.duplicateCount}\n`);

    // Phase 5: Report generation
    console.log('📊 Phase 5: Generating report...');
    const report = buildReport(forumResult, adcInventory, mappingSummary);
    printSummary(report);

    // Write report to file (no secrets, no passwords)
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = join(outputDir, `identity-dry-run-${timestamp}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`📄 Full report written to: ${reportPath}`);

    if (report.canSwitch) {
      console.log('✅ CAN_SWITCH = true — prerequisites met for business-agent-id mode');
    } else {
      console.log('❌ CAN_SWITCH = false — see risks above');
    }
  } finally {
    await forumPrisma.$disconnect();
    await adcPrisma.$disconnect();
  }
}

/**
 * Scan all non-empty identity values from all Forum identity fields.
 */
async function scanAllFieldValues(prisma: PrismaClient): Promise<{ value: string; table: string; field: string }[]> {
  const queries = [
    `SELECT DISTINCT "createdById" AS v, 'forum_threads' AS t, 'createdById' AS f FROM forum_threads WHERE "createdById" IS NOT NULL AND "createdById" != ''`,
    `SELECT DISTINCT "resolvedById" AS v, 'forum_threads' AS t, 'resolvedById' AS f FROM forum_threads WHERE "resolvedById" IS NOT NULL AND "resolvedById" != ''`,
    `SELECT DISTINCT "agentId" AS v, 'forum_participants' AS t, 'agentId' AS f FROM forum_participants WHERE "agentId" IS NOT NULL AND "agentId" != ''`,
    `SELECT DISTINCT "reviewWaivedById" AS v, 'forum_participants' AS t, 'reviewWaivedById' AS f FROM forum_participants WHERE "reviewWaivedById" IS NOT NULL AND "reviewWaivedById" != ''`,
    `SELECT DISTINCT "authorId" AS v, 'forum_messages' AS t, 'authorId' AS f FROM forum_messages WHERE "authorId" IS NOT NULL AND "authorId" != ''`,
    `SELECT DISTINCT "takenById" AS v, 'forum_context_snapshots' AS t, 'takenById' AS f FROM forum_context_snapshots WHERE "takenById" IS NOT NULL AND "takenById" != ''`,
    `SELECT DISTINCT "createdById" AS v, 'forum_outcomes' AS t, 'createdById' AS f FROM forum_outcomes WHERE "createdById" IS NOT NULL AND "createdById" != ''`,
    `SELECT DISTINCT "agentId" AS v, 'discussion_run_steps' AS t, 'agentId' AS f FROM discussion_run_steps WHERE "agentId" IS NOT NULL AND "agentId" != ''`,
  ];

  const results: { value: string; table: string; field: string }[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(q);
      for (const r of rows) {
        const val = String(r.v);
        if (!seen.has(val)) {
          seen.add(val);
          results.push({ value: val, table: String(r.t), field: String(r.f) });
        }
      }
    } catch {
      // Table or column may not exist yet — skip
    }
  }
  return results;
}

main().catch((err) => {
  console.error('❌ Dry-run failed:', err.message);
  process.exit(1);
});
