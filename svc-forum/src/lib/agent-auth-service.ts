/**
 * Auth-service token-login client.
 *
 * Calls the auth-service to exchange a pre-signed agent token for an
 * access token that can be used to call agent endpoints.
 *
 * TODO: Production — replace with proper service-to-service auth
 *       (mTLS, workload identity, or vault-issued short-lived tokens).
 *       Do NOT store long-lived tokens in the run table.
 */

import { env } from '../config/env.js';

export interface GetAccessTokenParams {
  agentId: string;
  agentName: string;
  preSignedToken: string;
}

export interface TokenLoginResponse {
  accessToken: string;
  expiresIn?: number;
}

/**
 * Exchange a pre-signed agent token for an access token via auth-service.
 * Throws on non-2xx response or missing accessToken.
 */
export async function getAgentAccessToken(
  params: GetAccessTokenParams,
): Promise<string> {
  const url = `${env.AUTH_SERVICE_URL}/api/auth/token-login`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: params.preSignedToken,
      name: params.agentName,
      role: 'agent',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `auth-service token-login returned ${res.status} for agent ${params.agentId}: ${body.slice(0, 300)}`,
    );
  }

  const data: TokenLoginResponse = await res.json();

  if (!data.accessToken) {
    throw new Error(
      `auth-service token-login response missing accessToken for agent ${params.agentId}`,
    );
  }

  return data.accessToken;
}
