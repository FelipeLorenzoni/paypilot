/**
 * Reminder message template (requirements 7.1, 7.2, 8.3). Pure and
 * deterministic: fixed pt-BR phrasing, amount formatted manually from integer
 * minor units (no floats, no locale-data dependency), only the recipient's own
 * data (description/label, amount, due date, window context).
 */

export interface ReminderMessageItem {
  description: string;
  amountMinor: number;
  currency: string;
  dueDate: string; // YYYY-MM-DD
}

/** `123456` → `"R$ 1.234,56"` — manual thousands grouping, BRL only (MVP). */
export function formatAmountBRL(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Invalid amount: expected a positive safe integer");
  }
  const cents = String(amountMinor % 100).padStart(2, "0");
  const units = String(Math.trunc(amountMinor / 100));
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${cents}`;
}

export function formatReminderMessage(
  item: ReminderMessageItem,
  windowDays: number,
): string {
  if (item.currency !== "BRL") {
    throw new Error("Unsupported currency: reminder messages are BRL-only");
  }
  const amount = formatAmountBRL(item.amountMinor);
  const when = windowDays === 0 ? "vence hoje" : `vence em ${windowDays} dias`;
  return `PayPilot: “${item.description}” de ${amount} ${when} (${item.dueDate}).`;
}
