import { createHash } from "node:crypto";

// Pure dedup-key domain (financial-rules R6). Framework-free, no clock/tz.
// The SAME normalization applies to every row at write time, and the stored
// hash IS the comparison — so incoming rows and existing imported rows always
// compare under identical rules.

/**
 * Canonical description normalization for the dedup key: trim, collapse any
 * internal whitespace runs to a single space, lowercase.
 */
export function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Dedup key hash: sha-256 hex of `"{date}|{amountMinor}|{normalizedDescription}"`.
 * `dateIso` is the date-only `YYYY-MM-DD`; `amountMinor` the integer minor
 * units. Equivalent rows (spacing/casing variants) produce the same hash; any
 * difference in date, amount, or normalized description produces a different one.
 */
export function dedupHash(
  dateIso: string,
  amountMinor: number,
  description: string,
): string {
  const canonical = `${dateIso}|${amountMinor}|${normalizeDescription(description)}`;
  return createHash("sha256").update(canonical).digest("hex");
}
