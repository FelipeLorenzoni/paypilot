// Pure installment domain (financial-rules R5). Framework-free, integer math
// only (no floats), deterministic and reproducible from the purchase inputs.

const CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Split a total (minor units) into `n` installment amounts. Uses an even base
 * `floor(total / n)` and adds the residual cents to the **first** installment,
 * so the amounts sum **exactly** to the total (no money created or lost).
 */
export function splitInstallments(totalMinor: number, n: number): number[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new Error("totalMinor must be a positive safe integer");
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("installments must be an integer >= 1");
  }
  const base = Math.floor(totalMinor / n);
  const remainder = totalMinor - base * n;
  const amounts = new Array<number>(n).fill(base);
  amounts[0] = base + remainder; // residual cents on the first installment
  return amounts;
}

/** `"YYYY-MM"` for the month `offset` months after the given cycle. */
function shiftMonth(cycle: string, offset: number): string {
  const year = Number(cycle.slice(0, 4));
  const month = Number(cycle.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) + offset;
  const y = Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * The `n` consecutive invoice cycles for an installment plan, starting at
 * `startCycle` (the cycle assigned to the purchase date). Rolls the year.
 */
export function installmentCycles(startCycle: string, n: number): string[] {
  if (!CYCLE.test(startCycle)) {
    throw new Error(`Invalid startCycle (expected YYYY-MM): ${startCycle}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("installments must be an integer >= 1");
  }
  return Array.from({ length: n }, (_, i) => shiftMonth(startCycle, i));
}
