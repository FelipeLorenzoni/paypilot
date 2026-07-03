/**
 * Hard-coded MVP bounds for the synchronous import (documented in the design).
 * A monthly statement is typically a few hundred rows; 1 MiB comfortably bounds
 * 5k rows. Oversized input is rejected whole (413/400) with nothing persisted.
 * Revisit as validated config in a later spec if needed.
 */
export const MAX_FILE_BYTES = 1_048_576; // 1 MiB
export const MAX_ROWS = 5000;
