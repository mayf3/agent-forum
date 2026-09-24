import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const migration = readFileSync(
  fileURLToPath(new URL('../prisma/migrations/20260924000000_workflow_instance_context/migration.sql', import.meta.url)),
  'utf8',
).replace(/--[^\n]*/g, '');

test('workflow context remediation and unique index hold a write fence in one transaction', () => {
  const begin = migration.indexOf('BEGIN;');
  const lock = migration.indexOf('LOCK TABLE "forum_threads" IN SHARE ROW EXCLUSIVE MODE;');
  const update = migration.indexOf('UPDATE forum_threads t');
  const index = migration.indexOf('CREATE UNIQUE INDEX "uq_forum_threads_workflow_instance_context"');
  const commit = migration.lastIndexOf('COMMIT;');
  assert.ok(begin >= 0 && begin < lock, 'transaction must begin before the table write fence');
  assert.ok(lock < update && update < index && index < commit,
    'write fence must cover remediation and unique index creation until commit');
});
