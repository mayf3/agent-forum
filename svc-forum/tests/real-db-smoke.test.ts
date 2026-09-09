import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPrisma } from '../src/lib/prisma.js';
import { createThread, createMessage } from '../src/lib/data-access.js';

/**
 * REAL PostgreSQL smoke — the layer the mock-prisma suite cannot cover.
 *
 * The mock suite (tests/governance*.test.ts etc.) replaces the prisma
 * singleton with in-memory stores that assign ids themselves, so it exercises
 * route logic, guards, and authorization but can never observe how the real
 * query engine serializes creates (the P2011 id-omission bug passed 375/375
 * mock tests). This file runs the production data-access layer against a real
 * database and is therefore the only place that can prove INSERTs actually
 * carry a client-generated id.
 *
 * Enable with:
 *   FORUM_REAL_DB_SMOKE=1 DATABASE_URL=postgresql://… npm test -- real-db-smoke
 * It applies no migrations — run `prisma migrate deploy` against the target
 * first (see the Makefile/deploy guide). Skipped otherwise.
 */

const ENABLED = process.env.FORUM_REAL_DB_SMOKE === '1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('real PostgreSQL smoke (production data-access layer)', { skip: !ENABLED }, () => {
  let prisma: any;
  let threadId = '';
  let messageId = '';
  let principalId = '';
  const RUN = `real-db-smoke-${Date.now()}`;

  before(() => {
    prisma = getPrisma();
  });

  after(async () => {
    if (!prisma) return;
    // Cleanup is intentionally partial: once test 3 sets the revision pointer,
    // the storage contract makes the governed rows undeletable — the guard
    // trigger forbids clearing current_revision back to NULL and the RESTRICT
    // FKs forbid deleting the pointed-to revision (or the thread while
    // revisions exist). That append-only rigidity is exactly what test 3
    // asserts, so the revision/thread/principal rows stay behind, uniquely
    // titled for this run. Run this suite against a disposable database.
    await prisma.forumThreadMessage.deleteMany({ where: { threadId } }).catch(() => {});
    await prisma.forumThreadParticipant.deleteMany({ where: { threadId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it('1. createThread inserts a real row with a client-generated id (P2011 regression)', async () => {
    const thread = await createThread({
      title: `${RUN} thread`,
      type: 'discussion',
      tags: ['smoke'],
      createdById: '00000000-0000-4000-8000-0000000000aa',
      createdByName: 'real-db-smoke',
      createdByType: 'agent',
    });
    threadId = thread.id;
    assert.match(thread.id, UUID_RE, 'id must be a generated UUID, not null');
    assert.equal(thread.status, 'open');

    const row = await prisma.forumThread.findUnique({ where: { id: threadId } });
    assert.ok(row, 'thread persisted in real PostgreSQL');
    assert.equal(row.title, `${RUN} thread`);
  });

  it('2. createMessage posts into the thread (engine-serialized INSERT)', async () => {
    const message = await createMessage({
      threadId,
      authorId: '00000000-0000-4000-8000-0000000000aa',
      authorName: 'real-db-smoke',
      authorType: 'agent',
      kind: 'comment',
      content: `${RUN} message body`,
    });
    messageId = message.id;
    assert.match(message.id, UUID_RE);
    assert.equal(message.seq, 1);

    const row = await prisma.forumThreadMessage.findUnique({ where: { id: messageId } });
    assert.ok(row, 'message persisted');
    assert.equal(row.content, `${RUN} message body`);
  });

  it('3. currentRevision pointer works: revision row + FK + guard trigger intact', async () => {
    // The composite FK (id, current_revision) → forum_thread_revisions stays
    // DB-enforced even though Prisma no longer models it as a relation.
    const principal = await prisma.forumPrincipal.create({
      data: { authSubject: `${RUN}-sub`, agentId: `${RUN}-agent`, displayName: 'Real DB Smoke' },
    });
    principalId = principal.id;

    const revision = await prisma.forumThreadRevision.create({
      data: {
        threadId,
        revision: 1,
        discussionState: 'open',
        openedAt: new Date(),
        openedByPrincipalId: principalId,
      },
    });
    assert.match(revision.id, UUID_RE);

    // NULL → 1 is the one transition the guard trigger allows for a first pointer.
    await prisma.forumThread.update({ where: { id: threadId }, data: { currentRevision: 1 } });

    const updated = await prisma.forumThread.findUnique({ where: { id: threadId } });
    assert.equal(updated.currentRevision, 1);

    // "Relation read": via the unique compound key instead of an include().
    const current = await prisma.forumThreadRevision.findUnique({
      where: { threadId_revision: { threadId, revision: updated.currentRevision! } },
    });
    assert.ok(current, 'current revision row readable through (threadId, revision)');
    assert.equal(current.discussionState, 'open');

    // Guard trigger still rejects an illegal jump (1 → 3).
    await assert.rejects(
      prisma.forumThread.update({ where: { id: threadId }, data: { currentRevision: 3 } }),
      (err: any) => String(err.message).includes('revision must remain unchanged or increment by one'),
    );
  });
});
