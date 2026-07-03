import { formatAmountBRL, formatReminderMessage } from "./reminder-message";

describe("formatAmountBRL (deterministic, integer minor units)", () => {
  it("formats cents, units, and thousands grouping", () => {
    expect(formatAmountBRL(1)).toBe("R$ 0,01");
    expect(formatAmountBRL(100)).toBe("R$ 1,00");
    expect(formatAmountBRL(123456)).toBe("R$ 1.234,56");
    expect(formatAmountBRL(100000000)).toBe("R$ 1.000.000,00");
  });

  it("rejects non-positive or unsafe amounts", () => {
    expect(() => formatAmountBRL(0)).toThrow(/amount/i);
    expect(() => formatAmountBRL(-5)).toThrow(/amount/i);
    expect(() => formatAmountBRL(1.5)).toThrow(/amount/i);
  });
});

describe("formatReminderMessage", () => {
  const item = {
    description: "Internet",
    amountMinor: 12000,
    currency: "BRL",
    dueDate: "2026-03-10",
  };

  it("phrases a D-3 reminder with days-before context", () => {
    const msg = formatReminderMessage(item, 3);
    expect(msg).toBe(
      "PayPilot: “Internet” de R$ 120,00 vence em 3 dias (2026-03-10).",
    );
  });

  it("phrases a D-0 reminder as due today", () => {
    const msg = formatReminderMessage(item, 0);
    expect(msg).toBe(
      "PayPilot: “Internet” de R$ 120,00 vence hoje (2026-03-10).",
    );
  });

  it("is deterministic for equal inputs", () => {
    expect(formatReminderMessage(item, 3)).toBe(formatReminderMessage(item, 3));
  });

  it("rejects non-BRL currency (MVP)", () => {
    expect(() =>
      formatReminderMessage({ ...item, currency: "USD" }, 3),
    ).toThrow(/currency/i);
  });
});
