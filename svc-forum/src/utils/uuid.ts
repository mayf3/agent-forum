/**
 * UUID validation helper.
 *
 * Accepts only standard UUID v4 format: 8-4-4-4-12 hex digits.
 * Rejects short IDs, CUIDs, URL fragments, version prefixes, non-hex chars.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
