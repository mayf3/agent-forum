import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as clientModule from '@prisma/client';

/**
 * Prisma generated-client contract (no DB required).
 *
 * Regression guard for the 2026-09-09 P2011 outage: modeling the
 * forum_threads → forum_thread_revisions "current revision" composite FK as a
 * Prisma relation (`fields: [id, currentRevision]`) made the engine mark the
 * primary key `id` read-only (DMMF isReadOnly=true) and silently omit it from
 * INSERTs against real PostgreSQL, while the mock-prisma test suite stayed
 * green. This file pins the generated-client properties the mock suite cannot
 * observe.
 */

function dmmf(): any {
  const mod: any = clientModule;
  return mod.dmmf ?? mod.Prisma?.dmmf;
}

function model(name: string): any {
  const d = dmmf();
  if (d.modelMap?.[name]) return d.modelMap[name];
  return d.datamodel.models.find((m: any) => m.name === name);
}

describe('prisma generated-client contract (P2011 regression guard)', () => {
  it('ForumThread.id is writable and carries the uuid() client default', () => {
    const f = model('ForumThread').fields.find((x: any) => x.name === 'id');
    assert.ok(f, 'ForumThread.id field exists');
    assert.equal(f.isId, true);
    assert.equal(
      f.isReadOnly, false,
      'ForumThread.id must NOT be read-only: a relation using id as a foreign key makes Prisma omit it from INSERTs (P2011 on real PostgreSQL)'
    );
    assert.equal(f.hasDefaultValue, true, 'id must keep a default so create() can fill it');
    assert.match(String(f.default?.name ?? ''), /^uuid/, 'default must be uuid()');
  });

  it('no ForumThread relation declares id as one of its foreign-key fields', () => {
    const relations = model('ForumThread').fields.filter((x: any) => x.kind === 'object');
    for (const r of relations) {
      const ownFields: string[] = r.relationFromFields ?? [];
      assert.equal(
        ownFields.includes('id'), false,
        `relation ${r.name} uses the primary key 'id' as a foreign key (${ownFields.join(', ')}); this re-introduces the read-only id defect`
      );
    }
  });

  it('currentRevision stays a plain nullable Int pointer (relation-free)', () => {
    const f = model('ForumThread').fields.find((x: any) => x.name === 'currentRevision');
    assert.ok(f, 'currentRevision pointer preserved');
    assert.equal(f.kind, 'scalar');
    assert.equal(f.type, 'Int');
    assert.equal(f.isRequired, false);
    assert.equal(model('ForumThread').fields.some((x: any) => x.name === 'currentRevisionRow'), false,
      'the currentRevisionRow relation must stay removed (DB-level FK is enforced by PostgreSQL)');
  });
});
