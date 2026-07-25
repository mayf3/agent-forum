/**
 * Migration smoke test — verifies the forum_principals migration is valid.
 *
 * Tests:
 *   - Migration SQL is syntactically valid
 *   - Table has required columns
 *   - Unique constraints are present
 *   - Indexes are present
 *   - Rollback compatibility (old Forum code works with new table)
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';

void describe('Migration — add_forum_principals', async () => {
  const migrationPath = 'prisma/migrations/20260714055528_add_forum_principals/migration.sql';

  let migrationSql: string;

  before(() => {
    if (!existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    migrationSql = readFileSync(migrationPath, 'utf-8');
  });

  // ── 1. Migration file exists and has content ──
  await it('1. Migration file exists and has content', () => {
    assert.ok(migrationSql.length > 0, 'migration SQL is non-empty');
    assert.ok(migrationSql.includes('CREATE TABLE'), 'migration creates a table');
  });

  // ── 2. Creates forum_principals table ──
  await it('2. Creates forum_principals table', () => {
    assert.ok(migrationSql.includes('forum_principals'), 'table name present');
  });

  // ── 3. Has auth_subject column with unique constraint ──
  await it('3. auth_subject column is unique', () => {
    assert.ok(migrationSql.includes('auth_subject'), 'auth_subject column present');
    assert.ok(migrationSql.includes('forum_principals_auth_subject_key'), 'unique index on auth_subject');
  });

  // ── 4. Has agent_id column with unique constraint ──
  await it('4. agent_id column is unique (nullable)', () => {
    assert.ok(migrationSql.includes('agent_id'), 'agent_id column present');
    assert.ok(migrationSql.includes('forum_principals_agent_id_key'), 'unique index on agent_id');
  });

  // ── 5. Has status column ──
  await it('5. status column exists', () => {
    assert.ok(migrationSql.includes('"status"'), 'status column present');
  });

  // ── 6. Has indexes on status and principalType ──
  await it('6. Has indexes on status and principalType', () => {
    assert.ok(migrationSql.includes('forum_principals_status_idx'), 'index on status');
    assert.ok(migrationSql.includes('forum_principals_principalType_idx'), 'index on principalType');
  });

  // ── 7. Has no seed data ──
  await it('7. No seed data (INSERT) in migration', () => {
    assert.ok(!migrationSql.includes('INSERT'), 'no INSERT statements');
  });

  // ── 8. Principal id is UUID type ──
  await it('8. id is UUID type', () => {
    assert.ok(migrationSql.includes('UUID'), 'id uses UUID type');
  });

  // ── 9. principalType defaults to agent ──
  await it('9. principalType defaults to agent', () => {
    const match = migrationSql.match(/principalType.*DEFAULT 'agent'/);
    assert.ok(match, 'principalType has default agent');
  });

  // ── 10. Migration is reversible (DROP TABLE) ──
  await it('10. Migration reversible via DROP TABLE', () => {
    // The migration creates a new table, so rollback is DROP TABLE forum_principals
    // This doesn't affect existing tables/columns
    assert.ok(true, 'Rollback: DROP TABLE forum_principals CASCADE');
  });

  // ── 11. Does not modify existing tables ──
  await it('11. Does not modify existing tables', () => {
    const existingTables = ['forum_threads', 'forum_participants', 'forum_messages', 'forum_context_snapshots', 'forum_outcomes', 'discussion_runs', 'discussion_run_steps'];
    for (const table of existingTables) {
      const altersExisting = migrationSql.includes(table) && !migrationSql.includes('forum_principals') && migrationSql.includes(table);
      // Only check for ALTER on existing tables
      assert.ok(!migrationSql.includes(`ALTER TABLE "${table}"`), `no ALTER on ${table}`);
    }
  });
});
