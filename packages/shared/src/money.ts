/**
 * Money value object — exact monetary representation shared by api and web.
 *
 * `amountMinor` is in integer minor units (e.g. cents) and MUST be a safe
 * integer; floating-point money is never allowed. `currency` is an ISO-4217
 * alphabetic code. See steering `financial-rules.md`.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

const ISO_4217_ALPHA = /^[A-Z]{3}$/;

/**
 * Create a validated {@link Money} value. Throws when `amountMinor` is not a
 * safe integer or `currency` is not a 3-letter ISO-4217 code.
 */
export function createMoney(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(
      `Money.amountMinor must be a safe integer (got: ${amountMinor})`,
    );
  }
  if (!ISO_4217_ALPHA.test(currency)) {
    throw new Error(
      `Money.currency must be a 3-letter ISO-4217 code (got: ${currency})`,
    );
  }
  return { amountMinor, currency };
}
