#!/usr/bin/env node

// Install or repair the two Phase 2 lifecycle indexes as standalone
// CREATE INDEX CONCURRENTLY statements. Prisma 5.22 executes migration files
// in a transaction, so these accepted SQL-047/SQL-048 objects must remain in a
// post-migrate, idempotent deployment step.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const definitions = [
  {
    id: 'SQL-047',
    name: 'forum_threads_visibility_state_cic_idx',
    table: 'forum_threads',
    columns: ['visibility_state'],
    predicate: '(visibility_state IS NOT NULL)',
    create: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "forum_threads_visibility_state_cic_idx" ON "public"."forum_threads"("visibility_state") WHERE "visibility_state" IS NOT NULL',
  },
  {
    id: 'SQL-048',
    name: 'forum_thread_messages_discussion_revision_cic_idx',
    table: 'forum_messages',
    // The legacy physical column is camelCase "threadId" in every merged
    // migration. The design registry's thread_id spelling is a physical-name
    // typo; the stable SQL-048 object name and query purpose are unchanged.
    columns: ['threadId', 'discussion_revision'],
    predicate: '(discussion_revision IS NOT NULL)',
    create: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "forum_thread_messages_discussion_revision_cic_idx" ON "public"."forum_messages"("threadId", "discussion_revision") WHERE "discussion_revision" IS NOT NULL',
  },
];

async function readIndex(name) {
  return prisma.$queryRawUnsafe(`
    SELECT
      tbl.relname AS table_name,
      i.indisvalid AS is_valid,
      i.indisready AS is_ready,
      i.indisunique AS is_unique,
      pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
      ARRAY(
        SELECT a.attname
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        WHERE key.ord <= i.indnkeyatts
        ORDER BY key.ord
      ) AS columns
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = idx.relnamespace
    JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
    WHERE ns.nspname = 'public' AND idx.relname = $1
  `, name);
}

function isExact(row, definition) {
  return row
    && row.table_name === definition.table
    && row.is_valid === true
    && row.is_ready === true
    && row.is_unique === false
    && row.predicate === definition.predicate
    && Array.isArray(row.columns)
    && row.columns.length === definition.columns.length
    && row.columns.every((column, index) => column === definition.columns[index]);
}

async function applyDefinition(definition) {
  let rows = await readIndex(definition.name);
  if (rows.length > 1) {
    throw new Error(`${definition.id} found multiple public indexes named ${definition.name}`);
  }

  if (rows.length === 1 && !isExact(rows[0], definition)) {
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${definition.name}"`);
    rows = [];
  }

  if (rows.length === 0) {
    await prisma.$executeRawUnsafe(definition.create);
  }

  const verified = await readIndex(definition.name);
  if (verified.length !== 1 || !isExact(verified[0], definition)) {
    throw new Error(`${definition.id} failed exact post-create verification for ${definition.name}`);
  }
  process.stdout.write(`${definition.id} ${definition.name}=READY\n`);
}

try {
  for (const definition of definitions) {
    await applyDefinition(definition);
  }
  process.stdout.write('LIFECYCLE_CIC_INDEXES=READY\n');
} finally {
  await prisma.$disconnect();
}
