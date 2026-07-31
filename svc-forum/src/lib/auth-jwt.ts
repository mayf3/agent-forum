/**
 * Standard OAuth access-token verifier (RS256 + JWKS).
 *
 * The auth-service issues standard OAuth `client_credentials` access tokens
 * signed with RS256 asymmetric keys. Forum verifies them using the auth-service
 * JWKS public-key endpoint — Forum holds NO shared symmetric secret for these
 * tokens. This is the only production-accepted inbound authentication path.
 *
 * ── Why not HS256 / AUTH_JWT_SECRET ──────────────────────────────────────────
 * Standard OAuth tokens are RS256. A shared HMAC secret cannot verify them.
 * The legacy HS256 `AUTH_JWT_SECRET` path is retained only for the discussion
 * runner's *outbound* token-login (a separate consumer, out of scope) and is
 * NOT used to verify inbound standard tokens.
 *
 * ── Error classification (critical for client behavior) ─────────────────────
 * Verification failures are split so clients do not trigger a refresh storm
 * when the JWKS endpoint itself is down:
 *
 *   • Token problems → 401 (client may refresh once for the refreshable subset)
 *       - TOKEN_INVALID_OR_EXPIRED : expired, bad signature, unknown kid
 *                                    → client refreshes + retries GET once
 *       - TOKEN_CONTRACT_INVALID   : wrong issuer / audience / type / version /
 *                                    principal_type / missing claims
 *                                    → client must NOT refresh (config/contract
 *                                      error; a fresh token has the same defect)
 *
 *   • Infrastructure problems → 503 (client must NOT refresh)
 *       - AUTH_JWKS_UNAVAILABLE    : JWKS fetch timeout / DNS / network / 5xx /
 *                                    malformed JWKS body
 *
 * ── Factory pattern (no mutable globals) ────────────────────────────────────
 * `createAccessTokenVerifier(keyResolver)` returns a verifier bound to the
 * supplied key resolver. Production wires `createRemoteJWKSet(AUTH_JWKS_URL)`;
 * tests wire `createLocalJWKSet(...)` with a locally generated RSA keypair.
 * There is no test backdoor in production code and no shared mutable state.
 */

import {
  createRemoteJWKSet,
  createLocalJWKSet,
  jwtVerify,
} from 'jose';
import {
  JWKSTimeout,
  JWKSNoMatchingKey,
  JWKSInvalid,
  JWSInvalid,
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JOSEError,
} from 'jose/errors';
import { env } from '../config/env.js';

// ── Result / error types ────────────────────────────────────────────────────

/** A successfully verified standard OAuth access token. */
export interface VerifiedAccessToken {
  /** JWT.sub — MachinePrincipal.id (global auth-service identity). */
  principalId: string;
  /** Always 'agent' — the verifier enforces principal_type === 'agent'. */
  principalType: 'agent';
  /** Stable business agent ID (JWT.agent_id). */
  agentId: string;
  /** Real OAuth machine client ID (JWT.client_id). */
  clientId: string;
  /** Scopes granted to the token, as a set for O(1) membership checks. */
  scopes: ReadonlySet<string>;
}

/**
 * Machine-readable error code. The HTTP status and refresh semantics are
 * derived from this code in the auth middleware.
 */
export type VerifyErrorCode =
  | 'TOKEN_INVALID_OR_EXPIRED' // 401 — refreshable (expired / bad sig / unknown kid)
  | 'TOKEN_CONTRACT_INVALID' // 401 — NOT refreshable (iss/aud/type/version/claims)
  | 'AUTH_JWKS_UNAVAILABLE'; // 503 — NOT refreshable (infrastructure)

export class VerifyTokenError extends Error {
  readonly code: VerifyErrorCode;
  constructor(code: VerifyErrorCode, message?: string) {
    super(message || code);
    this.name = 'VerifyTokenError';
    this.code = code;
  }
}

// ── Production key resolver ─────────────────────────────────────────────────

// ── Factory ─────────────────────────────────────────────────────────────────

export type KeyResolver = Parameters<typeof jwtVerify>[1];

/**
 * Create an access-token verifier bound to `keyResolver`.
 *
 * Verifies RS256 signature + standard claims, then enforces the Forum contract:
 * type=access, version=v1, principal_type=agent, and presence of
 * sub / agent_id / client_id.
 */
export function createAccessTokenVerifier(keyResolver: KeyResolver) {
  return async function verifyAuthAccessToken(token: string): Promise<VerifiedAccessToken> {
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    let protectedHeader: Awaited<ReturnType<typeof jwtVerify>>['protectedHeader'];

    try {
      ({ payload, protectedHeader } = await jwtVerify(token, keyResolver, {
        // Only RS256 is accepted — never auto-select HS256/RS256 by alg.
        algorithms: ['RS256'],
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_SVC_FORUM_AUDIENCE,
        clockTolerance: env.AUTH_JWT_MAX_CLOCK_SKEW,
      }));
    } catch (err) {
      throw classifyVerifyError(err);
    }

    // Header kid is required (matches a JWKS entry); never hardcode a kid value.
    if (!protectedHeader.kid) {
      throw new VerifyTokenError('TOKEN_CONTRACT_INVALID', 'Token header missing kid');
    }

    // ── Forum contract claims ──────────────────────────────────────────────
    // These describe a contract/config defect, not an expired token — a freshly
    // minted token with the same defect would still fail, so clients must NOT
    // refresh in response to these.
    if (payload.type !== 'access') {
      throw new VerifyTokenError('TOKEN_CONTRACT_INVALID', 'type must be access');
    }
    if (payload.version !== 'v1') {
      throw new VerifyTokenError('TOKEN_CONTRACT_INVALID', 'version must be v1');
    }
    if (payload.principal_type !== 'agent') {
      throw new VerifyTokenError('TOKEN_CONTRACT_INVALID', 'principal_type must be agent');
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof (payload as any).agent_id !== 'string' ||
      typeof (payload as any).client_id !== 'string'
    ) {
      throw new VerifyTokenError('TOKEN_CONTRACT_INVALID', 'missing sub / agent_id / client_id');
    }

    const scopeRaw = (payload as any).scope;
    const scopes =
      typeof scopeRaw === 'string'
        ? new Set(scopeRaw.split(/\s+/).filter(Boolean))
        : new Set<string>();

    return {
      principalId: payload.sub,
      principalType: 'agent',
      agentId: (payload as any).agent_id,
      clientId: (payload as any).client_id,
      scopes,
    };
  };
}

/**
 * Map a jose verification failure to a VerifyErrorCode.
 *
 * JWKS *infrastructure* failures (timeout / network / non-JSON) → 503, so the
 * client does not hammer the token endpoint when auth-service is briefly down.
 * Everything else is a token problem → 401 (refreshable vs contract).
 */
function classifyVerifyError(err: unknown): VerifyTokenError {
  // JWKS fetch infrastructure failures → 503
  if (err instanceof JWKSTimeout) {
    return new VerifyTokenError('AUTH_JWKS_UNAVAILABLE', 'JWKS request timed out');
  }
  // A malformed / non-JSON JWKS document is an infrastructure problem.
  if (err instanceof JWKSInvalid) {
    return new VerifyTokenError('AUTH_JWKS_UNAVAILABLE', 'JWKS endpoint returned invalid document');
  }
  // Network/DNS/HTTP errors are wrapped by jose in a generic JOSEError whose
  // message reveals the fetch failure — also infrastructure (503).
  if (err instanceof JOSEError && isInfrastructureError(err)) {
    return new VerifyTokenError('AUTH_JWKS_UNAVAILABLE', 'JWKS endpoint unreachable');
  }

  // Unknown / rotated-away kid: jose raises JWKSNoMatchingKey. Treat as
  // refreshable invalid (a cache refresh may resolve a newly-rotated key).
  if (err instanceof JWKSNoMatchingKey) {
    return new VerifyTokenError('TOKEN_INVALID_OR_EXPIRED', 'no key matches kid');
  }

  // Expired → refreshable
  if (err instanceof JWTExpired) {
    return new VerifyTokenError('TOKEN_INVALID_OR_EXPIRED', 'token expired');
  }

  // Bad signature / invalid JWS → refreshable (token may be corrupt/stale)
  if (err instanceof JWSSignatureVerificationFailed || err instanceof JWSInvalid) {
    return new VerifyTokenError('TOKEN_INVALID_OR_EXPIRED', 'signature verification failed');
  }

  // Claim validation failure (iss / aud / exp-outside-skew) raised by jose's
  // built-in checks. iss/aud mismatches are contract errors (not refreshable);
  // exp is already handled above as JWTExpired.
	  if (err instanceof JWTClaimValidationFailed) {
	    const claim = (err as any).claim;
	    if (claim === 'iss' || claim === 'aud') {
	      return new VerifyTokenError('TOKEN_CONTRACT_INVALID', `claim ${claim} invalid`);
	    }
	    return new VerifyTokenError('TOKEN_INVALID_OR_EXPIRED', `claim ${claim} invalid`);
	  }

	  // Plain TypeError (e.g. jose fetch failure) → infrastructure.
	  if (err instanceof TypeError && isInfrastructureError(err)) {
	    return new VerifyTokenError('AUTH_JWKS_UNAVAILABLE', 'JWKS endpoint unreachable');
	  }

	  // Fallback: unknown verification error → treat as refreshable invalid token.
	  return new VerifyTokenError('TOKEN_INVALID_OR_EXPIRED', 'token verification failed');
}

/**
 * Heuristic for "the JWKS endpoint itself is broken" (vs. a bad token).
 * jose wraps fetch failures in errors whose message/code indicate network/DNS
 * problems or a non-JSON JWKS response.
 */
function isInfrastructureError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check message of the error itself.
  const msg = err.message || '';
  if (
    msg.includes('fetch failed') ||
    msg.includes('fetch') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('Failed to parse') ||
    msg.includes('Unexpected token') ||
    msg.includes('bad port')
  ) {
    return true;
  }

  // Traverse cause chain (jose wraps fetch errors with underlying causes).
  let cause = err;
  while ((cause as any).cause instanceof Error) {
    cause = (cause as any).cause;
    const cMsg = cause.message || '';
    if (
      cMsg.includes('ECONNREFUSED') ||
      cMsg.includes('ENOTFOUND') ||
      cMsg.includes('ECONNRESET') ||
      cMsg.includes('ETIMEDOUT') ||
      cMsg.includes('bad port') ||
      cMsg.includes('fetch')
    ) {
      return true;
    }
  }

  return false;
}

// ── Production verifier ─────────────────────────────────────────────────────
//
// The trusted JWKS URL is frozen at module load from the validated env
// (src/config/env.ts parses + validates AUTH_JWKS_URL at startup). It is
// NEVER re-read from process.env at request time, so a running process
// cannot silently switch JWKS sources.
//
// The RemoteJWKSet is created lazily (first verify call) from the frozen URL.
// There is NO global set/reset test hook: tests build an isolated verifier
// via createAccessTokenVerifier(localKeyResolver), or set AUTH_JWKS_URL in a
// dedicated test process before any module import.

const trustedJwksUrl = new URL(env.AUTH_JWKS_URL);

let productionVerifier:
  | ReturnType<typeof createAccessTokenVerifier>
  | undefined;

/**
 * Production default verifier: lazily bound to the trusted remote JWKS
 * configured at startup via env.AUTH_JWKS_URL.
 */
export function verifyAuthAccessToken(token: string): Promise<VerifiedAccessToken> {
  productionVerifier ??=
    createAccessTokenVerifier(
      createRemoteJWKSet(trustedJwksUrl),
    );

  return productionVerifier(token);
}

// Re-export the local-JWKS constructor so tests can build an isolated verifier
// without touching production module state.
export { createLocalJWKSet };
