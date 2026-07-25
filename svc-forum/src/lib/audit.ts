/**
 * Structured audit logging for Forum identity and authorization events.
 *
 * Writes JSON to stderr — the same channel as the auth-service audit pattern.
 * Never writes full tokens, Authorization headers, client secrets, or .env content.
 */

export type AuditEventType =
  | 'jwt.verified'
  | 'jwt.failed'
  | 'principal.created'
  | 'principal.resolved'
  | 'principal.conflict'
  | 'principal.disabled_hit'
  | 'auth.write_rejected'
  | 'auth.legacy_used';

export type JwtFailedCategory =
  | 'expired'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'missing_scope'
  | 'wrong_principal_type'
  | 'missing_agent_id'
  | 'invalid_sub'
  | 'missing_client_id'
  | 'alg_none'
  | 'malformed'
  | 'oversized';

export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  /** JWT authSubject when available */
  authSubject?: string;
  /** Forum local principal ID when available */
  principalId?: string;
  /** OpenClaw agent ID when available */
  agentId?: string;
  /** Principal type */
  principalType?: string;
  /** Auth source */
  authSource?: string;
  /** Token issuer */
  issuer?: string;
  /** Token audience */
  audience?: string;
  /** Requested scope string */
  scope?: string;
  /** Request HTTP method */
  method?: string;
  /** Request path */
  path?: string;
  /** Error category for failures */
  errorCategory?: string;
  /** Success/failure */
  success: boolean;
}

/**
 * Write an audit event to stderr as JSON.
 * Never blocks — uses console.error which writes synchronously in practice.
 */
export function auditLog(event: AuditEvent): void {
  // Strip any sensitive fields before output
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    // Never log: full token, signature, authorization header, secret
    if (['token', 'signature', 'authorization', 'secret', 'secretHash'].includes(key)) continue;
    safe[key] = value;
  }
  console.error('[AUDIT]', JSON.stringify(safe));
}
