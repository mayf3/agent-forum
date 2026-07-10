/**
 * Agent endpoint allowlist / SSRF protection.
 *
 * Validates agent endpoint URLs against a configured allowlist before use.
 * Prevents SSRF attacks via agentEndpoints.
 *
 * TODO: Production — consider using a dedicated proxy or service mesh
 *       for agent endpoint routing instead of URL allowlisting.
 */

import { env } from '../config/env.js';

// URLs that are always blocked regardless of allowlist
const BLOCKED_PATTERNS = [
  /^file:/,
  /^ftp:/,
  /^data:/,
  /^gopher:/,
  /^dict:/,
  /169\.254\.169\.254/, // AWS/GCP metadata IP
  /metadata\.google\.internal/,
  /metadata\.compute\.google\.internal/,
];

// Common cloud metadata IPs
const BLOCKED_IPS = [
  '169.254.169.254',
  '100.100.100.200', // Alibaba Cloud
];

function parseHost(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a URL matches a glob-like pattern.
 * Patterns support: http://host:port/path*, http://host:port/*
 */
function patternMatch(urlStr: string, pattern: string): boolean {
  const patternStr = pattern.trim();
  if (!patternStr) return false;

  // Convert pattern to regex: escape regex chars, replace * with .*
  const escaped = patternStr
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(urlStr);
  } catch {
    return false;
  }
}

export interface EndpointValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate an agent endpoint URL against the allowlist and blocklist.
 * @param urlStr - the URL to validate
 * @param patternsOverride - optional override for ALLOWED_AGENT_ENDPOINT_PATTERNS (for testing)
 */
export function validateEndpoint(urlStr: string, patternsOverride?: string): EndpointValidationResult {
  // 1. Check URL can be parsed
  const host = parseHost(urlStr);
  if (!host) {
    return { valid: false, reason: `Invalid URL: ${urlStr}` };
  }

  // 2. Require http or https
  if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    return { valid: false, reason: 'Only http/https protocols are allowed' };
  }

  // 3. Block known dangerous patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(urlStr)) {
      return { valid: false, reason: `URL matches blocked pattern: ${pattern}` };
    }
  }

  // 4. Block known metadata IPs
  for (const ip of BLOCKED_IPS) {
    if (host === ip) {
      return { valid: false, reason: `URL host is a blocked metadata IP: ${ip}` };
    }
  }

  // 5. Check against allowlist
  const patterns = patternsOverride !== undefined ? patternsOverride : env.ALLOWED_AGENT_ENDPOINT_PATTERNS;
  if (!patterns || patterns.trim() === '') {
    return { valid: false, reason: 'No allowed endpoint patterns configured (ALLOWED_AGENT_ENDPOINT_PATTERNS is empty)' };
  }

  const allowedPatterns = patterns.split(',').map(p => p.trim()).filter(Boolean);
  for (const pattern of allowedPatterns) {
    if (patternMatch(urlStr, pattern)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    reason: `URL does not match any allowed pattern. Configured patterns: ${patterns}`,
  };
}

/**
 * Validate all agent endpoints in a map.
 * Throws on first invalid endpoint.
 */
export function validateAllEndpoints(
  endpoints: Record<string, string> | null | undefined,
): void {
  if (!endpoints) return;

  for (const [agentId, endpointUrl] of Object.entries(endpoints)) {
    const result = validateEndpoint(endpointUrl);
    if (!result.valid) {
      throw new Error(
        `Agent endpoint for "${agentId}" rejected: ${result.reason}`,
      );
    }
  }
}
