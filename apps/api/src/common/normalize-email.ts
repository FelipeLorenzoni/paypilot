/**
 * Canonical email normalization used by ALL user creation and lookup paths.
 * Limited to trim + lowercase — it does NOT remove dots, strip `+` aliases, or
 * apply any provider-specific rules (see auth-jwt requirements R1).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
