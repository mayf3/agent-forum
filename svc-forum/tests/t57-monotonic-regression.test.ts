/**
 * T57 regression — AF-READSTATE-BATCH-MONOTONICITY.
 * Deterministic two-writer interleave over the REAL batchMarkRead via a prisma
 * middleware gate: W2 parks on its UPDATE, a newer message arrives, W1 commits
 * the newer cursor, W2 resumes. The persisted last_read_at MUST NOT regress
 * (it must equal the newest message time). Disposable PG only.
 */
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55443/svc_forum'
process.env.AUTH_JWKS_URL = process.env.AUTH_JWKS_URL || 'http://127.0.0.1:1/.well-known/jwks.json'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { createServer } from 'node:http'

const keyPair = await generateKeyPair('RS256', { extractable: true })
const pub = await exportJWK(keyPair.publicKey)
pub.kid = 't57-key'
pub.alg = 'RS256'
pub.use = 'sig'
const jwksSrv = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ keys: [pub] })) })
await new Promise<void>(r => jwksSrv.listen(0, '127.0.0.1', r))
process.env.AUTH_JWKS_URL = `http://127.0.0.1:${(jwksSrv.address() as any).port}/.well-known/jwks.json`

const { prisma } = await import('../src/lib/prisma.js')
const { batchMarkRead } = await import('../src/lib/data-access/watch.js')

const agentId = `agt-t57-${Date.now()}`
const authSubject = `sub-t57-${Date.now()}`
const principal = await prisma.forumPrincipal.create({ data: { agentId, authSubject, principalType: 'agent' } })
const thread = await prisma.forumThread.create({ data: { title: 't57', type: 'discussion', status: 'open', tags: [], createdById: principal.id, createdByName: 't57', createdByType: 'agent' } })
await prisma.forumThreadParticipant.create({ data: { threadId: thread.id, agentId: principal.id, agentName: 't57', role: 'member' } })

// baseline "100": an old read cursor
const anchor = new Date(Date.now() - 100 * 86400_000)
const part = await prisma.forumThreadParticipant.findUniqueOrThrow({ where: { threadId_agentId: { threadId: thread.id, agentId: principal.id } } })
await prisma.forumThreadParticipant.update({ where: { id: part.id }, data: { lastReadAt: anchor } })

// m1 (older), then W2 parks on its update, m2 (newer) lands, W1 commits newer, W2 resumes.
const m1 = await prisma.forumThreadMessage.create({ data: { threadId: thread.id, seq: 1, authorId: principal.id, authorName: 't57', content: 'm1' } })

let release!: () => void
const gate = new Promise<void>(r => { release = r })
let gated = false
// @ts-expect-error test seam
prisma.$use(async (params: any, next: any) => {
  const isParticipantWrite =
    (params.model === 'ForumThreadParticipant' && (params.action === 'update' || params.action === 'updateMany')) ||
    params.action === 'executeRaw'
  if (isParticipantWrite && !gated) { gated = true; await gate }
  return next(params)
})

const w2 = batchMarkRead([thread.id], principal.id)
await new Promise(r => setTimeout(r, 300))
assert.ok(gated, 'W2 write never reached the gate')
const m2 = await prisma.forumThreadMessage.create({ data: { threadId: thread.id, seq: 2, authorId: principal.id, authorName: 't57', content: 'm2' } })
await batchMarkRead([thread.id], principal.id) // W1
release()
await w2

const after = await prisma.forumThreadParticipant.findUniqueOrThrow({ where: { threadId_agentId: { threadId: thread.id, agentId: principal.id } } })
const latest = await prisma.forumThreadMessage.findFirstOrThrow({ where: { threadId: thread.id, deletedAt: null }, orderBy: { createdAt: 'desc' } })
console.log(`final=${after.lastReadAt?.toISOString()} latest=${latest.createdAt.toISOString()} m1=${m1.createdAt.toISOString()}`)
assert.ok(after.lastReadAt!.getTime() >= latest.createdAt.getTime(),
  `monotonicity violation: lastReadAt ${after.lastReadAt?.toISOString()} < latest ${latest.createdAt.toISOString()}`)
jwksSrv.close()
await prisma.$disconnect()
