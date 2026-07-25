/**
 * Forum Principal — JIT (Just-In-Time) Shadow Principal service.
 *
 * Maps auth-service JWT.sub (global identity) to a local ForumPrincipal.
 * Created on first valid agent JWT access.
 *
 * Concurrent-safe, idempotent, fail-closed on identity conflicts.
 */

import { getPrisma } from './prisma.js';
import { HttpError } from '../utils/http-error.js';
import { auditLog } from './audit.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ForumPrincipalResult {
  id: string;
  authSubject: string;
  principalType: string;
  agentId: string | null;
  displayName: string | null;
  source: string;
  status: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvePrincipalParams {
  authSubject: string;
  agentId?: string;
  displayName?: string;
  principalType: string;
}

// ─── Agent ID validation ────────────────────────────────────────────────────

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/i;

export function isValidAgentId(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  return AGENT_ID_PATTERN.test(value.trim());
}

// ─── Find ───────────────────────────────────────────────────────────────────

/**
 * Find a ForumPrincipal by authSubject.
 */
export async function findPrincipal(
  authSubject: string,
): Promise<ForumPrincipalResult | null> {
  const prisma = getPrisma();
  const p = await prisma.forumPrincipal.findUnique({
    where: { authSubject },
  });
  if (!p) return null;

  return {
    id: p.id,
    authSubject: p.authSubject,
    principalType: p.principalType,
    agentId: p.agentId,
    displayName: p.displayName,
    source: p.source,
    status: p.status,
    firstSeenAt: p.firstSeenAt,
    lastSeenAt: p.lastSeenAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Find a ForumPrincipal by agentId.
 */
export async function findPrincipalByAgentId(
  agentId: string,
): Promise<ForumPrincipalResult | null> {
  const prisma = getPrisma();
  const p = await prisma.forumPrincipal.findUnique({
    where: { agentId },
  });
  if (!p) return null;

  return {
    id: p.id,
    authSubject: p.authSubject,
    principalType: p.principalType,
    agentId: p.agentId,
    displayName: p.displayName,
    source: p.source,
    status: p.status,
    firstSeenAt: p.firstSeenAt,
    lastSeenAt: p.lastSeenAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ─── JIT Resolve (find or create) ───────────────────────────────────────────

/**
 * JIT principal resolution: find existing or create new.
 *
 * Transactional and concurrent-safe:
 * 1. Find by authSubject — if exists, update lastSeenAt and return.
 * 2. If agentId is provided, check for conflict with another principal.
 * 3. Create new principal.
 * 4. If unique constraint violated (concurrent creation), retry find.
 *
 * @throws HttpError(409) if agentId conflicts with another active principal.
 * @throws HttpError(409) if same authSubject maps to different agentId.
 */
export async function resolvePrincipal(
  params: ResolvePrincipalParams,
): Promise<ForumPrincipalResult> {
  const prisma = getPrisma();
  const now = new Date();

  // Attempt find-or-create in a transaction for atomicity
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Check if principal already exists by authSubject
      const existing = await tx.forumPrincipal.findUnique({
        where: { authSubject: params.authSubject },
      });

      if (existing) {
        // Identity consistency: if existing principal has a different agentId, fail closed
        if (
          params.agentId &&
          existing.agentId &&
          existing.agentId !== params.agentId
        ) {
          auditLog({
            timestamp: now.toISOString(),
            type: 'principal.conflict',
            authSubject: params.authSubject,
            principalId: existing.id,
            agentId: params.agentId,
            success: false,
            errorCategory: 'subject_alias_changed',
          });
          throw new HttpError(409, 'Identity alias conflict: authSubject already mapped to different agentId');
        }

        // Update lastSeenAt
        const updated = await tx.forumPrincipal.update({
          where: { id: existing.id },
          data: { lastSeenAt: now },
        });

        // Check disabled status
        if (updated.status === 'disabled') {
          auditLog({
            timestamp: now.toISOString(),
            type: 'principal.disabled_hit',
            authSubject: params.authSubject,
            principalId: updated.id,
            agentId: updated.agentId,
            success: false,
          });
          throw new HttpError(403, 'Principal is disabled');
        }

        auditLog({
          timestamp: now.toISOString(),
          type: 'principal.resolved',
          authSubject: updated.authSubject,
          principalId: updated.id,
          agentId: updated.agentId,
          success: true,
        });

        return mapPrincipal(updated);
      }

      // 2. New principal: check agentId conflict if provided
      if (params.agentId && isValidAgentId(params.agentId)) {
        const agentConflict = await tx.forumPrincipal.findUnique({
          where: { agentId: params.agentId },
        });
        if (agentConflict) {
          auditLog({
            timestamp: now.toISOString(),
            type: 'principal.conflict',
            authSubject: params.authSubject,
            principalId: agentConflict.id,
            agentId: params.agentId,
            success: false,
            errorCategory: 'agent_id_taken',
          });
          throw new HttpError(409, `Agent ID "${params.agentId}" is already mapped to another principal`);
        }
      }

      // 3. Create new principal
      const created = await tx.forumPrincipal.create({
        data: {
          authSubject: params.authSubject,
          principalType: params.principalType || 'agent',
          agentId: params.agentId || null,
          displayName: params.displayName || null,
          source: 'jit',
          status: 'active',
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      auditLog({
        timestamp: now.toISOString(),
        type: 'principal.created',
        authSubject: created.authSubject,
        principalId: created.id,
        agentId: created.agentId,
        success: true,
      });

      return mapPrincipal(created);
    });

    return result;
  } catch (err: any) {
    // Re-throw HttpError as-is (they're intentional business logic failures)
    if (err instanceof HttpError) throw err;

    // Unique constraint violations (concurrent creation race)
    if (
      err?.code === 'P2002' ||
      err?.message?.includes('Unique constraint')
    ) {
      // Retry: find the existing record
      const existing = await findPrincipal(params.authSubject);
      if (existing) {
        return resolvePrincipal(params); // Retry once
      }
      // If still not found, something else went wrong
      throw new HttpError(500, 'Failed to resolve principal');
    }

    throw err;
  }
}

/**
 * Disable a principal by authSubject.
 */
export async function disablePrincipal(authSubject: string): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.forumPrincipal.findUnique({
    where: { authSubject },
  });
  if (!existing) {
    throw new HttpError(404, 'Principal not found');
  }

  await prisma.forumPrincipal.update({
    where: { id: existing.id },
    data: { status: 'disabled' },
  });

  auditLog({
    timestamp: new Date().toISOString(),
    type: 'principal.conflict', // Reusing conflict type for disable log
    authSubject,
    principalId: existing.id,
    agentId: existing.agentId ?? undefined,
    success: true,
    errorCategory: 'disabled',
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapPrincipal(p: any): ForumPrincipalResult {
  return {
    id: p.id,
    authSubject: p.authSubject,
    principalType: p.principalType,
    agentId: p.agentId,
    displayName: p.displayName,
    source: p.source,
    status: p.status,
    firstSeenAt: p.firstSeenAt,
    lastSeenAt: p.lastSeenAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
