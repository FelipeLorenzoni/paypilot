/**
 * Maximum installment count for a card purchase. Hard-coded for the MVP
 * (documented in the design); revisit as validated config in a later spec if
 * needed. Values above this are rejected with a 400 VALIDATION_ERROR.
 */
export const MAX_INSTALLMENTS = 24;
